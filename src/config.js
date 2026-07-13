// Shared config for the service worker (an ES module). The MXID base URL is
// stored in chrome.storage.sync so an operator can point the extension at their
// deployment via the options page. Content scripts are NOT modules and must not
// import this — they receive everything they need over messaging.

export const DEFAULT_BASE = 'http://localhost:3500'

export const API = {
  // Descriptor sync: which sites are form apps, how to fill them, whether a
  // credential is already stored. (EE route, cookie-authed.)
  list: '/api/v1/portal/formfill/apps',
  // Reveal a single credential (the only plaintext endpoint; step-up gated).
  reveal: (appId) => `/api/v1/portal/apps/${appId}/credential`,
  // Pair this extension install (step-up gated) → a binding token that reveal
  // requires in addition to the cookie, so another extension can't ride it.
  pair: '/api/v1/portal/formfill/pair',
  // Where to send the user to (re)authenticate / do step-up.
  portal: '/',
}

// Header carrying the per-install binding token on reveal.
export const TOKEN_HEADER = 'X-MXID-FormFill-Token'

export async function getBaseUrl() {
  const { mxidBaseUrl } = await chrome.storage.sync.get('mxidBaseUrl')
  return (mxidBaseUrl || DEFAULT_BASE).replace(/\/+$/, '')
}
