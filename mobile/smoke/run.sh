#!/usr/bin/env bash
# Exécuté DANS l'émulateur (android-emulator-runner) : installe l'APK de test et lance le scénario.
set -euo pipefail
APK="${1:?chemin de lapk requis}"
adb wait-for-device
adb reverse tcp:3100 tcp:3100
adb reverse tcp:3199 tcp:3199
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb logcat -c
adb install -r -t "$APK"
mkdir -p smoke-out
set +e
node mobile/smoke/smoke.mjs
STATUS=$?
adb logcat -d > smoke-out/logcat.txt
adb exec-out screencap -p > smoke-out/final.png || true
exit $STATUS
