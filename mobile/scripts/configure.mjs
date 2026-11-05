#!/usr/bin/env node
// Configuration reproductible du conteneur Android.
//   node scripts/configure.mjs pre    → écrit capacitor.config.json (avant `cap add android` / `cap sync`)
//   node scripts/configure.mjs post   → applique les réglages au projet Android généré (manifeste, SDK, version, code natif)
// Variables : HYDROLOOP_APP_URL (défaut https://app.hydroloopfarm.com), VERSION_NAME, VERSION_CODE, SMOKE=1 (test émulateur : localhost en clair).
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_ID = 'com.hydroloopfarm.manager';
const APP_URL = (process.env.HYDROLOOP_APP_URL || 'https://app.hydroloopfarm.com').replace(/\/+$/, '');
const VERSION_NAME = process.env.VERSION_NAME || '1.0-beta';
const VERSION_CODE = process.env.VERSION_CODE || '1';
const SMOKE = process.env.SMOKE === '1';
const url = new URL(APP_URL);
if (url.protocol !== 'https:' && !SMOKE) throw new Error(`HYDROLOOP_APP_URL doit être en HTTPS (reçu ${APP_URL}).`);

const fail = (m) => { console.error('✗ ' + m); process.exit(1); };
const read = (p) => readFileSync(join(root, p), 'utf8');
const write = (p, s) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), s); };

function pre() {
  const config = {
    appId: APP_ID,
    appName: 'HydroLoop Farm Manager',
    webDir: 'www',
    server: {
      url: APP_URL,
      cleartext: SMOKE,
      // Le conteneur ne navigue que vers l'hôte de l'application ; tout autre lien s'ouvre dans le navigateur.
      allowNavigation: [url.hostname],
    },
    android: {
      allowMixedContent: false,
      webContentsDebuggingEnabled: SMOKE,
      backgroundColor: '#f0fdf4',
      appendUserAgent: `HydroLoopAndroid/${VERSION_NAME}`,
    },
  };
  write('capacitor.config.json', JSON.stringify(config, null, 2) + '\n');
  console.log(`✓ capacitor.config.json (url ${APP_URL}${SMOKE ? ', mode SMOKE' : ''})`);
}

function sub(path, re, repl, label) {
  let s = read(path);
  if (!re.test(s)) fail(`${path} : motif introuvable pour « ${label} » (le modèle Capacitor a changé ?)`);
  write(path, s.replace(re, repl));
  console.log(`✓ ${path} : ${label}`);
}

function post() {
  const android = 'android';
  if (!existsSync(join(root, android, 'app'))) fail('android/ absent : exécuter `npx cap add android` avant.');

  // SDK : minSdk 26, cible 35
  sub(`${android}/variables.gradle`, /minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 26', 'minSdk 26');
  sub(`${android}/variables.gradle`, /targetSdkVersion\s*=\s*\d+/, 'targetSdkVersion = 35', 'targetSdk 35');
  sub(`${android}/variables.gradle`, /compileSdkVersion\s*=\s*\d+/, 'compileSdkVersion = 35', 'compileSdk 35');

  // Version
  sub(`${android}/app/build.gradle`, /versionCode\s+\d+/, `versionCode ${VERSION_CODE}`, `versionCode ${VERSION_CODE}`);
  sub(`${android}/app/build.gradle`, /versionName\s+"[^"]*"/, `versionName "${VERSION_NAME}"`, `versionName ${VERSION_NAME}`);

  // Manifeste : portrait, clavier, pas de sauvegarde Android des données, trafic en clair interdit
  const man = `${android}/app/src/main/AndroidManifest.xml`;
  let m = read(man);
  m = m.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"');
  if (!/android:networkSecurityConfig/.test(m)) m = m.replace('<application', '<application\n        android:networkSecurityConfig="@xml/network_security_config"\n        android:usesCleartextTraffic="false"');
  if (!/android:screenOrientation/.test(m)) m = m.replace('<activity', '<activity\n            android:screenOrientation="portrait"\n            android:windowSoftInputMode="adjustResize"');
  write(man, m);
  const perms = [...m.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((x) => x[1]);
  const extra = perms.filter((p) => p !== 'android.permission.INTERNET');
  if (extra.length) fail(`Permissions inattendues dans le manifeste : ${extra.join(', ')}`);
  console.log(`✓ ${man} : portrait, adjustResize, allowBackup=false, permissions = ${perms.join(', ') || 'aucune'}`);

  // Configuration réseau : HTTPS uniquement (localhost/émulateur en clair seulement pour le test SMOKE)
  write(`${android}/app/src/main/res/xml/network_security_config.xml`,
`<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors><certificates src="system" /></trust-anchors>
    </base-config>${SMOKE ? `
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">10.0.2.2</domain>
    </domain-config>` : ''}
</network-security-config>
`);
  console.log('✓ network_security_config.xml');

  // Code natif : téléchargement des blobs (export JSON/CSV) et impression PDF
  const pkgDir = `${android}/app/src/main/java/${APP_ID.replaceAll('.', '/')}`;
  for (const f of ['MainActivity.java', 'NativeBridge.java']) {
    write(`${pkgDir}/${f}`, read(`native/${f}`));
    console.log(`✓ ${pkgDir}/${f}`);
  }
}

({ pre, post }[process.argv[2]] || (() => fail('usage : configure.mjs pre|post')))();
