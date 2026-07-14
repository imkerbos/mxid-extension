// Sign the built extension into a CRX3 and generate the enterprise update.xml,
// without needing Chrome (CI-friendly). Run `scripts/pack.sh` first to produce
// build/unpacked.
//
//   node scripts/build-crx.mjs
//
// Signing key: key.pem in the repo root. If it's absent, crx3 GENERATES a
// throwaway key — fine for a CI build-check, but a real release MUST use the
// committed keypair's key.pem (restored from a CI secret) so the extension id
// stays the stable one MXID allow-lists. Never commit key.pem.
//
// CRX_URL (env): the URL the .crx will be hosted at, embedded in update.xml so
// managed Chrome knows where to fetch updates. Defaults to the GitHub Release
// "latest" asset URL.

import crx3 from 'crx3'
import { readFileSync, existsSync } from 'node:fs'

const DIR = 'build/unpacked'
const MANIFEST = `${DIR}/manifest.json`
if (!existsSync(MANIFEST)) {
  console.error(`missing ${MANIFEST} — run "bash scripts/pack.sh" first`)
  process.exit(1)
}

const version = JSON.parse(readFileSync(MANIFEST, 'utf8')).version
const crxURL =
  process.env.CRX_URL ||
  'https://github.com/imkerbos/mxid-extension/releases/latest/download/mxid-login.crx'

if (!existsSync('key.pem')) {
  console.warn('⚠ key.pem missing — crx3 will generate a throwaway key (id will NOT be the stable one). Release builds must restore key.pem from the CRX_KEY secret.')
}

await crx3([MANIFEST], {
  keyPath: 'key.pem',
  crxPath: 'build/mxid-login.crx',
  xmlPath: 'build/update.xml',
  crxURL,
})

console.log(`signed build/mxid-login.crx (v${version}) + build/update.xml → ${crxURL}`)
