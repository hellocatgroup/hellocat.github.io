# Hello Cat downloads service

This document describes the live GitHub Pages + Cloudflare setup.

## Live URLs

- Main site: https://helloc.at/
- Alternate main site: https://www.helloc.at/
- Admin entry: https://helloc.at/admin/
- Protected admin app: https://hello-cat-downloads-api.z0ovd.workers.dev/admin/
- Public downloads: https://helloc.at/downloads/
- Worker API: https://hello-cat-downloads-api.z0ovd.workers.dev

The main website and public downloads page remain on GitHub Pages. The admin application is served by the Cloudflare Worker on the same origin as its protected API. This makes the Access authorization cookie first-party for admin requests and avoids third-party-cookie/CORS login redirects.

## Provisioned resources

- Worker: `hello-cat-downloads-api`
- Worker subdomain: `z0ovd.workers.dev`
- R2 bucket: `hello-cat-downloads`
- D1 database: `hello-cat-downloads`
- Access application: `Hello Cat Downloads Admin`
- Access identity provider: One-time PIN
- Access allow policy: exact approved administrator email
- Worker secret: `ADMIN_EMAILS` (stored in Cloudflare; never commit it)

## Authentication flow

1. Open the GitHub Pages admin entry. It redirects the browser to the Worker-hosted `/admin/` page.
2. Cloudflare Access protects both `/admin*` and `/api/admin*`. If there is no valid session, Access presents its One-time PIN login as a normal top-level browser navigation.
3. The Worker independently validates the Access JWT issuer, audience, signature, expiry, not-before claim, and email against the `ADMIN_EMAILS` secret before serving the admin application or processing file-management requests.
4. The Worker fetches the static admin HTML source from `admin/app.html` and injects a base URL pointing at the GitHub Pages project site. CSS, images, and JavaScript assets remain hosted on GitHub Pages.
5. The admin JavaScript calls the API on the same Worker origin. The Access cookie is therefore first-party; it is not sent as a third-party cookie from the GitHub Pages origin.

The static source file `admin/app.html` is public repository content, which is expected. It contains no credentials. Directly opening it on GitHub Pages redirects to the protected Worker-hosted admin app. Authorization is enforced server-side, not by hiding frontend code.

## Security boundary

- Cloudflare Access protects the Worker-hosted admin page and every privileged API endpoint.
- The Access Allow policy matches only the explicitly approved administrator email. The app uses the One-time PIN identity provider.
- The Worker independently validates the signed Access JWT and exact email allowlist.
- Privileged API requests must originate from the Worker admin origin (or, for same-origin GETs without an Origin header, carry `Sec-Fetch-Site: same-origin`) and must pass JWT/email validation.
- The public downloads API only lists published files. Unpublished files cannot be downloaded through public routes.
- Files are stored in R2 and metadata/publication state is stored in D1.
- Upload limit: 90 MiB. Downloads are sent as attachments with `application/octet-stream` and `nosniff`.

The public downloads page and published file URLs are public by design. The downloads page is marked `noindex, nofollow`, but its URL is shareable.

## Live configuration

The frontend API base URL in `js/config.js` is:

```js
window.HC_CONFIG = Object.freeze({
  apiBaseUrl: "https://hello-cat-downloads-api.z0ovd.workers.dev"
});
```

The Worker configuration is mirrored in `wrangler.toml`:

- `ACCESS_ISSUER`: Cloudflare Access team issuer.
- `ACCESS_AUD`: Access application audience tag.
- `ALLOWED_ORIGINS`: comma-separated allowed public-site origins, including https://helloc.at and https://www.helloc.at.
- `ADMIN_ORIGIN`: Worker origin used by the same-origin admin interface.
- `ADMIN_SOURCE_URL`: raw GitHub source HTML for the admin app.
- `ADMIN_ASSET_BASE_URL`: custom-domain admin directory, so the existing `../css`, `../js`, `../assets`, and `../downloads/` paths resolve correctly.
- `ADMIN_APP_URL`: Worker-hosted admin URL.
- `MAX_UPLOAD_BYTES`: 90 MiB.

The `ADMIN_EMAILS` value is a Cloudflare Worker secret. Never put it in `js/config.js`, HTML, `wrangler.toml`, or any other public repository file.

## Test

1. Open https://helloc.at/admin/ . It should redirect to the Worker-hosted admin app.
2. If not already authenticated, Cloudflare Access should show the One-time PIN login as a full-page navigation.
3. Sign in with the approved administrator email. After Access returns to `/admin/`, the Worker verifies the JWT and the admin interface loads.
4. Confirm the file list and upload controls appear.
5. Upload a small harmless test file and publish it. Confirm it appears at https://helloc.at/downloads/ and downloads.
6. Unpublish it and confirm it disappears from the public list; publish it again and confirm it returns.
7. Test from a different email address. Cloudflare Access should deny it, and the Worker's independent allowlist must also reject it.

Public API endpoints:

- `GET https://hello-cat-downloads-api.z0ovd.workers.dev/api/files`
- `GET https://hello-cat-downloads-api.z0ovd.workers.dev/api/files/<FILE_ID>/download`

## Future Worker deployment

From the repository root, with Wrangler installed and authenticated:

```sh
npx wrangler deploy
```

The existing `ADMIN_EMAILS` secret remains stored in Cloudflare. Do not add it to source control. After future code changes, verify the active Worker version, Access application paths and allow policy, public file list, and an authenticated upload.
