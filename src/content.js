// Content script (runs on every page; NOT a module). On a page whose origin
// matches a known form app's login_url, it fills + submits the login form using
// the credential the service worker reveals.
//
// E2 hardening: MutationObserver wait for the form, two-step logins, extra_fields,
// framework-safe value setting, post-submit stale-selector signal, run-once.
// E3 step-up: on step_up/not_logged_in, open the portal and poll — once the user
// clears MFA there, auto-fill without a page reload.
//
// Security (FORM-FILL-SSO-B0-SECURITY-SPEC §6): only acts when the CURRENT page
// origin equals the descriptor's login_url origin, and only its own selectors.

(async function () {
  if (window.__mxidFormFillRan) return
  window.__mxidFormFillRan = true

  let descriptors
  try {
    descriptors = await chrome.runtime.sendMessage({ type: 'getDescriptors' })
  } catch {
    return
  }
  if (!Array.isArray(descriptors) || descriptors.length === 0) return

  const match = descriptors.find(
    (d) => d.login_url && sameOrigin(d.login_url, location.href),
  )
  if (!match || !match.username_selector) return

  // The username field must exist (waited for) before we do anything.
  const userEl = await waitFor(match.username_selector, 8000)
  if (!userEl) return

  await attempt(match, false)
})()

// attempt: fetch a credential and fill, or (when not polling) offer the step-up /
// sign-in action and start polling for the moment it becomes available.
async function attempt(match, polling) {
  const resp = await chrome.runtime.sendMessage({ type: 'getCredential', appId: match.app_id })

  if (resp?.error === 'step_up' || resp?.error === 'not_logged_in') {
    if (polling) return false // keep waiting for the user to finish in the portal
    const isStepUp = resp.error === 'step_up'
    banner(
      isStepUp
        ? 'MXID: identity check (MFA) required to fill this login.'
        : 'MXID: sign in to MXID to auto-fill this login.',
      isStepUp ? 'Verify' : 'Sign in',
      () => {
        openPortal()
        pollUntilFilled(match)
      },
    )
    return false
  }
  if (resp?.error || !resp?.credential) {
    if (!polling) console.warn('[MXID form-fill]', resp?.error || 'no credential')
    return false
  }
  await doFill(match, resp.credential)
  return true
}

// pollUntilFilled: after the user is sent to the portal to authenticate / step up,
// retry every 3s (up to ~2 min) until the credential comes through, then fill.
function pollUntilFilled(match) {
  let tries = 0
  const iv = setInterval(async () => {
    tries += 1
    const filled = await attempt(match, true)
    if (filled || tries > 40) clearInterval(iv)
  }, 3000)
}

// doFill: the actual username → (extra) → (next step) → password → submit flow.
async function doFill(match, cred) {
  const userEl = await waitFor(match.username_selector, 4000)
  if (!userEl) return
  fill(userEl, cred.account)
  for (const ef of match.extra_fields || []) {
    const el = ef.selector && document.querySelector(ef.selector)
    if (el) fill(el, ef.value)
  }

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
  fill(passEl, cred.credential)

  const submit = match.submit_selector && document.querySelector(match.submit_selector)
  if (!submit) return
  submit.click()

  // A successful login navigates away and tears down this context. If we're still
  // here with the login field present, the submit didn't take (stale selectors).
  setTimeout(() => {
    if (document.querySelector(match.username_selector)) {
      banner(
        'MXID: auto-fill ran but the page did not advance — the site may have changed. Re-capture this app.',
        'Dismiss',
        () => {},
      )
    }
  }, 3500)
}

// --- helpers ---

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

// Resolve when `selector` matches, or null after `timeout` ms. Immediate check,
// then a MutationObserver (SPA forms mount late).
function waitFor(selector, timeout) {
  return new Promise((resolve) => {
    const f = document.querySelector(selector)
    if (f) return resolve(f)
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

// Framework-safe value setting: native setter + the events React/Vue listen for.
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
