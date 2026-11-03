#!/usr/bin/env node
// Vérifie qu'aucun secret serveur ne se retrouve dans le code envoyé au navigateur (.next/static) ni dans les fichiers publics.
// Usage : SECRETS="valeur1,valeur2" node scripts/check-bundle-secrets.mjs   (valeurs = secrets réellement présents dans l'environnement du build)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['.next/static', 'public'];
const literal = (process.env.SECRETS ?? '').split(',').map((s) => s.trim()).filter((s) => s.length >= 8);
const patterns = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'clé Anthropic'],
  [/service_role/, 'référence à service_role'],
  [/SUPABASE_JWT_SECRET/, 'nom de la variable SUPABASE_JWT_SECRET'],
  [/ANTHROPIC_API_KEY/, 'nom de la variable ANTHROPIC_API_KEY'],
  [/scrypt\$[0-9a-f]{16,}\$[0-9a-f]{32,}/, 'hachage de mot de passe'],
];
let files = 0;
const problems = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(js|css|html|json|map|webmanifest|txt|svg)$/.test(name)) continue;
    files++;
    const text = readFileSync(p, 'utf8');
    for (const s of literal) if (text.includes(s)) problems.push(`${p} : valeur secrète présente`);
    for (const [re, label] of patterns) if (re.test(text)) problems.push(`${p} : ${label}`);
  }
};
for (const r of roots) { try { walk(r); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
if (!files) { console.error('Aucun fichier analysé : lancer `next build` avant.'); process.exit(2); }
if (problems.length) { console.error(`❌ ${problems.length} problème(s) :\n` + problems.join('\n')); process.exit(1); }
console.log(`✅ ${files} fichiers analysés, aucun secret serveur dans le code client.`);
