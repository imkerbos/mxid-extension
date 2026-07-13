# Publishing the extension (E5)

The extension has a **stable id** now — `bfdbncnhgjdbaeipacekokclgbkhlpic` —
because `manifest.json` carries the public `key` (see `scripts/gen-key.sh`). That
id is what you add to MXID's `MXID_SERVER_ALLOWED_ORIGINS`:

```
chrome-extension://bfdbncnhgjdbaeipacekokclgbkhlpic
```

> The private signing key is `key.pem` (git-ignored). Keep it — you need the same
> key to publish updates so the id stays stable. Losing it = new id = re-configure
> CORS + re-deploy to every browser.

## Which distribution model?

| | Chrome Web Store (Model 1) | Enterprise self-hosted (Model 2) |
|---|---|---|
| Install | user clicks a link | auto-pushed by MDM/GPO, nothing to click |
| Visibility | Public / Unlisted / Private-to-Workspace | fully private |
| Review | Google reviews each version | none |
| Infra | none | internal HTTPS host for `.crx` + `update.xml` |
| Updates | automatic | automatic (via `update.xml`) |
| Best for | broad / self-serve / mixed devices | managed corporate fleet |

**Recommendation for MXID (on-prem enterprise IAM):** **Model 2 — enterprise
forced-install.** Customers already run MDM (Intune/Jamf/GPO); a private, pinned,
no-Google-review push fits the security posture and the "auto-installed on every
employee browser" requirement. Offer Model 1 (Unlisted) as the low-friction option
for small teams / self-serve.

---

## Model 1 — Chrome Web Store

1. `bash scripts/pack.sh` → `build/mxid-login-<ver>.zip`.
2. Chrome Web Store **Developer Dashboard** ($5 one-time account) → **New item** →
   upload the zip.
3. Fill the listing (name, icons, screenshots, privacy). Set **Visibility**:
   *Unlisted* (link-only) or *Private* (your Google Workspace org).
4. Submit → review → published. Chrome auto-updates users.
5. Note the store-assigned id — with our `key` in the manifest it will match
   `bfdbncnhgjdbaeipacekokclgbkhlpic`; confirm and keep CORS in sync.

## Model 2 — Enterprise self-hosted (forced-install)

1. **Pack + sign the CRX** with the stable key:
   ```
   google-chrome --pack-extension="$PWD" --pack-extension-key="$PWD/key.pem"
   # → ../mxid-extension.crx   (Edge: msedge --pack-extension=… works too)
   ```
2. **Host** `mxid-extension.crx` + `deploy/update.xml` on an internal **HTTPS**
   server. Edit `update.xml`'s `codebase` to the real CRX URL.
3. **Force-install via policy** (id;update_url):
   - **Windows GPO / Intune:** policy `ExtensionInstallForcelist` (Chrome) /
     the Edge equivalent →
     `bfdbncnhgjdbaeipacekokclgbkhlpic;https://YOUR-HOST/update.xml`
   - **macOS (Jamf / MDM):** same key via a Chrome/Edge configuration profile.
4. **Updating:** bump `version` in `manifest.json` **and** `update.xml`, re-pack,
   replace the hosted `.crx` + `update.xml`. Chrome polls and auto-updates.

### Firefox (if needed)
Separate build (see ROADMAP E5): add `webextension-polyfill`, a Firefox manifest
variant, sign via addons.mozilla.org, or self-distribute with the enterprise
policy `ExtensionSettings` → `installation_mode: force_installed`.

---

## Server prerequisites (both models)

- [ ] MXID served over **HTTPS** (SameSite=None cookie requires Secure).
- [ ] `MXID_SESSION_CROSS_SITE_COOKIES=true`.
- [ ] `chrome-extension://bfdbncnhgjdbaeipacekokclgbkhlpic` in `MXID_SERVER_ALLOWED_ORIGINS`.
- [ ] `form_fill` feature in the EE license.
- [ ] Form apps + descriptors configured; users have stored credentials (or an
      admin set the shared credential).

## Release checklist

1. Bump `manifest.json` `version`.
2. `bash scripts/pack.sh` (zip) and/or Chrome `--pack-extension` (CRX).
3. Model 1: upload zip to the store. Model 2: replace hosted `.crx` + bump
   `update.xml`.
4. Verify CORS origin still matches the id.
