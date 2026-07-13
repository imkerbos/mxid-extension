#!/usr/bin/env bash
# Package the extension.
#
#   build/mxid-login-<version>.zip   → upload to the Chrome Web Store.
#
# For the enterprise self-hosted CRX (forced-install), pack with Chrome so it is
# signed by key.pem (which fixes the id to the stable one in gen-key.sh):
#   google-chrome --pack-extension="$PWD" --pack-extension-key="$PWD/key.pem"
#   # → ../mxid-extension.crx  — host it + update.xml on your internal HTTPS.
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p build
ZIP="build/mxid-login-$VER.zip"
rm -f "$ZIP"
# key.pem must NOT ship inside the package.
zip -r -q "$ZIP" manifest.json src -x '*.DS_Store'
echo "built $ZIP"
