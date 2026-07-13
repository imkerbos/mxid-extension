# MXID Login Extension (MV3) — E1 skeleton

Auto-submits login forms for MXID **form-fill (SWA)** apps using credentials the
user vaulted in MXID. This is the **E1 skeleton** from
`mxid/docs/FORM-FILL-EXTENSION-AUTH-DESIGN.md` — the core wiring, not a shipped
product.

## How it works

```
[content.js @ any page] --msg--> [background.js SW] --fetch(cookie)--> [MXID]
```

- **background.js** (service worker) is the only piece that talks to MXID. It
  reuses the user's portal session cookie (**Option A**): `credentials:'include'`
  sends `mxid_portal_sid`.
  - Syncs descriptors: `GET /api/v1/portal/formfill/apps` (which sites are form
    apps, their selectors, `credential_mode`, `has_credential`).
  - Reveals a credential on demand: `GET /api/v1/portal/apps/:id/credential`.
- **content.js** runs on every page; if the page origin matches a known form
  app's `login_url`, it asks the SW for the credential and fills + submits the
  form using the descriptor's selectors. It only ever touches that descriptor's
  own selectors on its own origin (B0 §6).
- **popup** shows synced apps + a manual Sync; **options** sets the MXID base URL.

## Current status (E1)

Implemented: manifest, SW (sync + reveal + step-up handling), content-script
fill/submit, popup, options.

**Not yet (later phases):**
- **Capture mode** (record a login → auto-generate selectors) — E4.
- Robust step-up UX (right now it shows a banner → opens the portal).
- Cross-browser (Edge/Firefox), packaging, enterprise managed install — E5.
- Narrower `host_permissions` (skeleton uses broad `https://*/*` +
  content-script filtering; production should request app origins at runtime via
  `optional_host_permissions`).

## Running it (dev)

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. Extension **Options** → set MXID base URL (default `http://localhost:3500`).
3. Sign in to the MXID portal in the same browser.
4. Open the popup → **Sync**.

### Dev limitation — cross-site cookie

Option A needs the portal cookie to be `SameSite=None; Secure`, which **requires
HTTPS**. On the plain-http dev stack the SW's cross-site fetch will NOT carry the
cookie (→ `not_logged_in`). To exercise the full flow, run MXID over HTTPS with
`MXID_SESSION_CROSS_SITE_COOKIES=true` and add this extension's id to
`MXID_SERVER_ALLOWED_ORIGINS` (`chrome-extension://<id>`). See the auth design doc.
