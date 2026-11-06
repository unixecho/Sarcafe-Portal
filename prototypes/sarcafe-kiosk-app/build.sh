#!/usr/bin/env bash
# Builds the Sarcafe kiosk APK on Linux (GitHub Actions: .github/workflows/kiosk-release.yml), the same steps as build.ps1 on the
# owner's PC: Android SDK command-line tools only, no Gradle. The signing settings come from the environment, never from a file
# in the repo: SARCAFE_KIOSK_KEYSTORE (path), SARCAFE_KIOSK_KS_ALIAS, SARCAFE_KIOSK_KS_PASS. Nothing secret is printed.
#   build.sh <versionCode> <versionName> <out-dir>
set -euo pipefail
CODE="${1:?versionCode}"; NAME="${2:?versionName}"; OUT="${3:?out dir}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
BT="$SDK/build-tools/${SARCAFE_BUILD_TOOLS:-36.1.0}"
AJ="$SDK/platforms/${SARCAFE_PLATFORM:-android-36}/android.jar"
: "${SARCAFE_KIOSK_KEYSTORE:?keystore path}" "${SARCAFE_KIOSK_KS_PASS:?keystore password}"
ALIAS="${SARCAFE_KIOSK_KS_ALIAS:-sarcafe-kiosk}"
[ -f "$AJ" ] || { echo "android.jar not found: $AJ" >&2; exit 1; }
[ -x "$BT/aapt2" ] || { echo "build-tools not found: $BT" >&2; exit 1; }
[ -f "$SARCAFE_KIOSK_KEYSTORE" ] || { echo "keystore not found" >&2; exit 1; }   # never generated here: the tablet trusts one key

rm -rf "$OUT"; mkdir -p "$OUT/assets" "$OUT/classes" "$OUT/dex"
node "$ROOT/../../scripts/assemble-kiosk-bundle.mjs" "$OUT/assets"
"$BT/aapt2" compile --dir "$ROOT/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$AJ" --manifest "$ROOT/AndroidManifest.xml" \
  --min-sdk-version 24 --target-sdk-version 30 --version-code "$CODE" --version-name "$NAME" \
  -A "$OUT/assets" "$OUT/res.zip"
mapfile -t SRCS < <(find "$ROOT/src" -name '*.java' | sort)
javac --release 8 -encoding UTF-8 -Xlint:-options -classpath "$AJ" -d "$OUT/classes" "${SRCS[@]}"
mapfile -t CLASSES < <(find "$OUT/classes" -name '*.class' | sort)
"$BT/d8" --lib "$AJ" --min-api 24 --release --output "$OUT/dex" "${CLASSES[@]}"
(cd "$OUT/dex" && jar uf "$OUT/base.apk" classes.dex)
"$BT/zipalign" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"
"$BT/apksigner" sign --ks "$SARCAFE_KIOSK_KEYSTORE" --ks-key-alias "$ALIAS" --ks-pass env:SARCAFE_KIOSK_KS_PASS \
  --key-pass env:SARCAFE_KIOSK_KS_PASS --out "$OUT/sarcafe-kiosk.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify "$OUT/sarcafe-kiosk.apk"
echo "BUILT: $OUT/sarcafe-kiosk.apk ($(( $(stat -c %s "$OUT/sarcafe-kiosk.apk") / 1024 )) KB), version $NAME ($CODE)"
