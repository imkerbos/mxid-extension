#!/usr/bin/env bash
# Generate the extension signing key ONCE, and derive the two values that pin a
# stable extension id: the manifest "key" and the id itself.
#
# The private key (../mxid-login-key.pem) is the CRX signing key — keep it secret, out of git.
# The manifest "key" is the PUBLIC key; committing it fixes the extension id
# across every install (dev, CRX, Web Store upload), which is what MXID's CORS
# allow-list (chrome-extension://<id>) needs.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f ../mxid-login-key.pem ]]; then
  openssl genrsa 2048 > ../mxid-login-key.pem 2>/dev/null
  echo "generated ../mxid-login-key.pem (KEEP SECRET — gitignored)"
else
  echo "../mxid-login-key.pem already exists — reusing"
fi

PUBDER_B64=$(openssl rsa -in ../mxid-login-key.pem -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')
ID=$(openssl rsa -in ../mxid-login-key.pem -pubout -outform DER 2>/dev/null \
      | openssl dgst -sha256 -binary | head -c16 | xxd -p | tr '0-9a-f' 'a-p')

echo
echo "extension id : $ID"
echo
echo "manifest \"key\" (add to manifest.json):"
echo "  \"key\": \"$PUBDER_B64\""
echo
echo "CORS: add  chrome-extension://$ID  to MXID_SERVER_ALLOWED_ORIGINS"
