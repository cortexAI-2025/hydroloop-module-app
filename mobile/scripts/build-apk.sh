#!/usr/bin/env bash
# Construit l'APK debug du conteneur (variables : HYDROLOOP_APP_URL, VERSION_NAME, VERSION_CODE, SMOKE).
# Utilisé à l'identique par le job de build et par le job de test sur émulateur.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f package-lock.json ]; then
  npm ci
else
  echo "::warning::mobile/package-lock.json absent : généré par ce run (commité ensuite par le job commit-generated)."
  npm install
fi
node scripts/configure.mjs pre
if [ ! -d android/app ]; then npx cap add android; fi
node scripts/configure.mjs post
npx capacitor-assets generate --android
npx cap sync android
node scripts/configure.mjs post

cd android
chmod +x gradlew
./gradlew --no-daemon --stacktrace assembleDebug 2>&1 | tee ../gradle-build.log
test -s app/build/outputs/apk/debug/app-debug.apk
