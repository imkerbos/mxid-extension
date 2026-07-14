// Service worker: the only component that talks to MXID. It reuses the user's
// portal session cookie (Option A — see docs/FORM-FILL-EXTENSION-AUTH-DESIGN.md),
// so `credentials: 'include'` carries mxid_portal_sid. That requires the portal
// cookie to be SameSite=None (MXID's MXID_SESSION_CROSS_SITE_COOKIES=true) and
// HTTPS — on a plain-http dev stack the cookie won't ride the cross-site fetch.

import { API, getBaseUrl, TOKEN_HEADER } from './config.js'

async function getToken() {
  const { extToken } = await chrome.storage.local.get('extToken')
  return extToken || ''
}

// pair this install: POST /formfill/pair (step-up gated). On success store the
// binding token. A malicious extension cannot pass the step-up, so it can't pair.
async function pair() {
  const base = await getBaseUrl()
  let res
  try {
    res = await fetch(base + API.pair, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_label: (navigator.userAgent || 'browser').slice(0, 120) }),
    })
  } catch (e) {
    return { error: 'network', detail: String(e) }
  }
  const body = await res.json().catch(() => ({}))
  if (res.ok && body.data?.token) {
    await chrome.storage.local.set({ extToken: body.data.token })
    return { ok: true }
  }
  if (body.code === 40133) return { error: 'step_up', base }
  if (res.status === 401) return { error: 'not_logged_in', base }
  return { error: 'http_' + res.status, base }
}

// --- MXID API calls (session-cookie authed) ---

async function syncDescriptors() {
  const base = await getBaseUrl()
  let res
  try {
    res = await fetch(base + API.list, { credentials: 'include' })
  } catch (e) {
    return { error: 'network', detail: String(e) }
  }
  if (res.status === 401) return { error: 'not_logged_in' }
  if (!res.ok) return { error: 'http_' + res.status }
  const body = await res.json().catch(() => ({}))
  const apps = Array.isArray(body.data) ? body.data : []
  await chrome.storage.local.set({ descriptors: apps, syncedAt: Date.now() })
  return { apps }
}

function sameOriginUrl(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

// storeCredential PUTs the user's captured account+password for a form app.
// Cookie-authed; no step-up (storing your own password isn't high-risk).
async function storeCredential(appId, account, credential) {
  const base = await getBaseUrl()
  try {
    const r = await fetch(base + `/api/v1/portal/apps/${appId}/credential`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, credential }),
    })
    return r.ok
  } catch {
    return false
  }
}

// flushPendingCapture stores the credential the content script stashed at login
// time. It runs from multiple triggers (captureResult message, storage.onChanged,
// SW wake, sync alarm) so a torn-down message after a fast post-login 301 never
// loses the credential. Idempotent: storeCredential is a PUT, so re-running is safe.
async function flushPendingCapture() {
  const { pendingCapture, descriptors } = await chrome.storage.local.get([
    'pendingCapture',
    'descriptors',
  ])
  if (!pendingCapture) return { credentialSaved: false }
  const { descriptor, account, credential } = pendingCapture
  let credentialSaved = false
  if (account && credential && descriptor && descriptor.login_url) {
    const app = (descriptors || []).find(
      (d) => d.login_url && sameOriginUrl(d.login_url, descriptor.login_url),
    )
    if (app && app.app_id && app.credential_mode !== 'shared') {
      credentialSaved = await storeCredential(app.app_id, account, credential)
    } else {
      // No matching per_user form app to store into — nothing to retry, drop it.
      await chrome.storage.local.remove('pendingCapture')
      return { credentialSaved: false }
    }
  }
  // Clear only on success (or when there was nothing to store) so a transient
  // network failure keeps the pending creds for a later trigger to retry.
  if (credentialSaved || !(account && credential)) {
    await chrome.storage.local.remove('pendingCapture')
  }
  return { credentialSaved }
}

async function getCredential(appId) {
  const base = await getBaseUrl()
  const token = await getToken()
  let res
  try {
    res = await fetch(base + API.reveal(appId), {
      credentials: 'include',
      headers: token ? { [TOKEN_HEADER]: token } : {},
    })
  } catch (e) {
    return { error: 'network', detail: String(e) }
  }
  if (res.ok) {
    const body = await res.json().catch(() => ({}))
    return { credential: body.data }
  }
  const body = await res.json().catch(() => ({}))
  // 40137 = pairing_required, 40133 = step_up, 40136 = not authorized, 401 = no session.
  if (body.code === 40137) return { error: 'pairing_required', base }
  if (body.code === 40133) return { error: 'step_up', base }
  if (res.status === 401) return { error: 'not_logged_in', base }
  return { error: 'http_' + res.status, code: body.code, base }
}

// --- messaging (content script + popup) ---

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    switch (msg?.type) {
      case 'sync':
        sendResponse(await syncDescriptors())
        break
      case 'getDescriptors': {
        const { descriptors } = await chrome.storage.local.get('descriptors')
        sendResponse(descriptors || [])
        break
      }
      case 'getBaseUrl':
        sendResponse({ base: await getBaseUrl() })
        break
      case 'getCredential':
        sendResponse(await getCredential(msg.appId))
        break
      case 'pair':
        sendResponse(await pair())
        break
      case 'openPortal': {
        const base = await getBaseUrl()
        chrome.tabs.create({ url: base + API.portal })
        sendResponse({ ok: true })
        break
      }
      case 'startCapture':
        // Arm capture; the content script on the active tab picks it up on reload.
        await chrome.storage.local.set({ capturing: true, lastCapture: null })
        sendResponse({ ok: true })
        break
      case 'captureResult': {
        // Fast path: the content script already stashed pendingCapture to storage
        // synchronously, so flush from there (single source of truth). If this
        // message was lost to a post-login nav, the storage.onChanged / wake
        // handlers below flush the same pendingCapture instead.
        await chrome.storage.local.set({ capturing: false, lastCapture: msg.descriptor })
        const res = await flushPendingCapture()
        sendResponse({ ok: true, credentialSaved: res.credentialSaved })
        break
      }
      default:
        sendResponse({ error: 'unknown_message' })
    }
  })()
  return true // async response
})

// --- lifecycle: sync on install + periodically ---

chrome.runtime.onInstalled.addListener(() => {
  syncDescriptors()
  flushPendingCapture()
  chrome.alarms.create('sync', { periodInMinutes: 30 })
})

// SW woke on browser start — flush any capture left pending from a prior session.
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(() => flushPendingCapture())

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'sync') {
    syncDescriptors()
    flushPendingCapture() // retry a capture whose store failed transiently
  }
})

// Primary backstop: when the content script writes pendingCapture synchronously
// during the login (even as the page unloads), this wakes the SW to flush it,
// independent of whether the captureResult message was delivered.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.pendingCapture && changes.pendingCapture.newValue) {
    flushPendingCapture()
  }
})
