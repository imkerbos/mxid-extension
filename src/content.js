// Content script (runs on every page; NOT a module). On a page whose origin
// matches a known form app's login_url, it fills + submits the login form using
// the credential the service worker reveals.
//
// E2 hardening over the naive one-shot querySelector:
//   - waits for the form to mount (SPA/JS-rendered logins) via MutationObserver,
//   - supports two-step logins (username view → password view),
//   - fills static extra_fields (tenant/domain),
//   - framework-safe value setting (native setter + input/change/blur),
//   - a post-submit signal when the page doesn't advance (likely stale selectors),
//   - runs at most once per page load.
//
// Security (FORM-FILL-SSO-B0-SECURITY-SPEC §6): it only acts when the CURRENT
// page origin equals the descriptor's login_url origin, and only touches that
// descriptor's own selectors.

(async function () {
  if (window.__mxidFormFillRan) return
  window.__mxidFormFillRan = true

  let descriptors
  try {
    descriptors = await chrome.runtime.sendMessage({ type: 'getDescriptors' })
  } catch {
    return // service worker asleep / not ready
  }
  if (!Array.isArray(descriptors) || descriptors.length === 0) return

  const match = descriptors.find(
    (d) => d.login_url && sameOrigin(d.login_url, location.href),
  )
  if (!match || !match.username_selector) return

  // Wait for the username field — SPA login pages mount fields after load.
  const userEl = await waitFor(match.username_selector, 8000)
  if (!userEl) return // not the login form on this page (or selectors stale)

  const resp = await chrome.runtime.sendMessage({ type: 'getCredential', appId: match.app_id })
  if (resp?.error === 'step_up') {
    banner('MXID: identity check (MFA) required to fill this login.', 'Verify', openPortal)
    return
  }
  if (resp?.error === 'not_logged_in') {
    banner('MXID: sign in to MXID to auto-fill this login.', 'Sign in', openPortal)
    return
  }
  if (resp?.error || !resp?.credential) {
    console.warn('[MXID form-fill]', resp?.error || 'no credential')
    return
  }
  const { account, credential } = resp.credential

  // Username + any static extra fields (tenant code, domain, ...).
  fill(userEl, account)
  for (const ef of match.extra_fields || []) {
    const el = ef.selector && document.querySelector(ef.selector)
    if (el) fill(el, ef.value)
  }

  // Password may be on the same view or behind a "Next" step.
  let passEl = match.password_selector && document.querySelector(match.password_selector)
  if (!passEl && match.next_selector) {
    const next = document.querySelector(match.next_selector)
    if (next) {
      next.click()
      passEl = await waitFor(match.password_selector, 6000)
    }
  }
  if (!passEl) {
    console.warn('[MXID form-fill] password field not found')
    return
  }
  fill(passEl, credential)

  const submit = match.submit_selector && document.querySelector(match.submit_selector)
  if (!submit) return
  submit.click()

  // Success/failure signal: a successful login navigates away and tears down this
  // context. If we're still here after a moment with the login field present, the
  // submit didn't take — usually a stale selector after a site redesign.
  setTimeout(() => {
    if (document.querySelector(match.username_selector)) {
      banner(
        'MXID: auto-fill ran but the page did not advance — the site may have changed. Re-capture this app.',
        'Dismiss',
        () => {},
      )
    }
  }, 3500)
})()

// --- helpers ---

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

// Resolve when `selector` matches an element, or null after `timeout` ms.
// Checks immediately, then observes DOM mutations (SPA forms mount late).
function waitFor(selector, timeout) {
  return new Promise((resolve) => {
    const found = document.querySelector(selector)
    if (found) return resolve(found)
    let done = false
    const finish = (el) => {
      if (done) return
      done = true
      obs.disconnect()
      clearTimeout(timer)
      resolve(el)
    }
    const obs = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) finish(el)
    })
    obs.observe(document.documentElement, { childList: true, subtree: true })
    const timer = setTimeout(() => finish(null), timeout)
  })
}

// Set a value the way React/Vue-controlled inputs notice: native setter + the
// events their listeners fire on.
function fill(el, value) {
  el.focus()
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
}

function openPortal() {
  chrome.runtime.sendMessage({ type: 'openPortal' })
}

// Minimal in-page prompt for cases needing user action.
function banner(text, actionLabel, onAction) {
  const bar = document.createElement('div')
  bar.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#111;color:#fff;' +
    'font:14px system-ui;padding:10px 16px;display:flex;gap:12px;align-items:center;justify-content:center'
  bar.textContent = text
  const btn = document.createElement('button')
  btn.textContent = actionLabel
  btn.style.cssText = 'background:#2563eb;color:#fff;border:0;border-radius:6px;padding:4px 12px;cursor:pointer'
  btn.onclick = () => { onAction(); bar.remove() }
  const close = document.createElement('button')
  close.textContent = '✕'
  close.style.cssText = 'background:transparent;color:#aaa;border:0;cursor:pointer'
  close.onclick = () => bar.remove()
  bar.append(btn, close)
  document.documentElement.appendChild(bar)
}
