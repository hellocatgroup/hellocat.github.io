> Current deployment: the Worker, R2 bucket, D1 database, Access application, reusable email policy, and One-time PIN identity provider have been provisioned. The exact live values below are populated. The only administrator is the explicitly approved AtomicMail address; the Worker-side allowlist is stored as a Cloudflare secret and is not in this repository.\n\n# Hello Cat downloads API — GitHub Pages + Cloudflare Workers

The website remains hosted on GitHub Pages at:

- Main site: https://hellocatgroup.github.io/hellocat.github.io/
- Admin page: https://hellocatgroup.github.io/hellocat.github.io/admin/
- Public downloads: https://hellocatgroup.github.io/hellocat.github.io/downloads/

The frontend is a GitHub Pages **project site**, so its repository path is part of every page URL. Internal page links are relative for this reason.

The file API runs separately as a Cloudflare Worker on a `workers.dev` hostname. No custom domain, Cloudflare DNS zone, or DNS change is required.

## Important security boundary

GitHub Pages serves static files and is not behind Cloudflare Access in this setup. Therefore, the static admin page itself can be opened by anyone who knows its URL. It contains no credentials and keeps all upload/management controls hidden until the Worker confirms an authenticated administrator session.

Cloudflare Access protects **all privileged API endpoints** under `/api/admin*`, and the Worker independently validates the Access JWT and checks the email against the `ADMIN_EMAILS` secret. A visitor who can view the static admin page still cannot upload, publish, unpublish, list private admin metadata, or delete files.

If you later want Cloudflare Access to block the admin HTML page itself before it is served, the frontend must also be served through Cloudflare (for example, behind a Cloudflare-proxied custom domain or moved to Cloudflare Pages/Workers). That is not required to secure file operations and is intentionally not part of this GitHub Pages-only setup.

The public downloads page and published file download endpoints are public by design. The downloads page is unlisted and marked noindex, but its URL is shareable.

## 1. Requirements

- A Cloudflare account with Workers, R2, D1, and Zero Trust Access available.
- A configured account `workers.dev` subdomain.
- Wrangler CLI installed and authenticated:

      npx wrangler login

No `helloc.at` DNS zone or custom domain is needed.

## 2. Create storage

From the repository root, create the R2 bucket:

    npx wrangler r2 bucket create hello-cat-downloads

Create the D1 database:

    npx wrangler d1 create hello-cat-downloads

Copy the `database_id` from the command output into `wrangler.toml`, replacing `b22149ec-e51c-4079-b715-f940b89eb4fe`.

Apply the migration:

    npx wrangler d1 migrations apply hello-cat-downloads --remote

The migration creates the file metadata table and public-list index.

## 3. Configure the Worker hostname

The Worker name in `wrangler.toml` is `hello-cat-downloads-api`. With `workers_dev = true`, Cloudflare deploys it at:

    https://hello-cat-downloads-api.z0ovd.workers.dev

The verified account workers.dev subdomain for this deployment is `z0ovd`.

After the Worker is deployed, edit `js/config.js` and set:

    window.HC_CONFIG = Object.freeze({
      apiBaseUrl: "https://hello-cat-downloads-api.z0ovd.workers.dev"
    });

Use the real account subdomain in place of the placeholder. Do not include a trailing slash or an `/api` suffix. Commit and push this one-line configuration change so the GitHub Pages admin and downloads pages use the deployed API.

The Worker is intentionally configured without a `routes` entry. It does not require or modify DNS for `helloc.at`.

## 4. Configure Cloudflare Access

Create a self-hosted Access application for this exact Worker hostname and path:

    hello-cat-downloads-api.z0ovd.workers.dev/api/admin*

This protects the login callback and every admin API endpoint while leaving the public `/api/files` list and download routes accessible.

Create an **Allow** policy whose Include rule is the exact email address:

    Z0OVD@atomicmail.io

Do not use an email-domain rule, Everyone rule, or any additional email address. The application is configured to use only the One-time PIN identity provider. The Allow policy matches only Z0OVD@atomicmail.io.

Copy the Access team issuer and the application's AUD tag into `wrangler.toml`:

- `ACCESS_ISSUER`: the exact issuer URL shown by Cloudflare Access, normally `https://green-scene-7051.cloudflareaccess.com`.
- `ACCESS_AUD`: the AUD tag for this self-hosted application.

The Worker supports a comma-separated AUD list, but this setup uses one application.

Set the independent Worker-side email allowlist as a secret:

    npx wrangler secret put ADMIN_EMAILS

When prompted, enter exactly:

    Z0OVD@atomicmail.io

This is a Worker secret. Never put it in `js/config.js`, HTML, or any other public repository file.

## 5. Configure the public frontend origin

The Worker variables in `wrangler.toml` are already set for the current GitHub Pages project site:

- `ALLOWED_ORIGIN = "https://hellocatgroup.github.io"`
- `ADMIN_PAGE_URL = "https://hellocatgroup.github.io/hellocat.github.io/admin/"`
- `MAX_UPLOAD_BYTES = "94371840"`

The origin intentionally contains only the scheme and hostname; it does not include the repository path. The admin return URL includes the full project-site path.

The Worker sends credentialed CORS headers only to the exact configured GitHub Pages origin. Privileged API routes also reject requests whose Origin header does not exactly match that origin, as a CSRF defense. The browser admin client uses `credentials: "include"` so the Cloudflare Access session cookie is sent to the Worker.

The admin client uses simple CORS requests (GET and POST with browser-generated FormData or URL-encoded bodies) to avoid an Access-blocked preflight. Do not add custom request headers or change these actions to PATCH/DELETE without also configuring Cloudflare Access CORS preflight handling.

## 6. Deploy

The Worker is already deployed. The `ADMIN_EMAILS` secret is stored in Cloudflare and is not committed to GitHub. For a future code deployment, run:

    npx wrangler deploy

Confirm the deployed URL matches the hostname used in the Access application and in `js/config.js`.

## 7. Sign in and test

1. Open the GitHub Pages admin page:
   https://hellocatgroup.github.io/hellocat.github.io/admin/
2. Once `js/config.js` contains the deployed Worker URL, the page will check for an existing authorized session.
3. If no session is present, select **Sign in with Cloudflare Access**. This opens the protected Worker login endpoint. After successful Access authentication and the Worker's independent email check, the Worker returns the browser to the admin page.
4. The browser must allow the Cloudflare Access cookie for the `workers.dev` hostname in cross-site requests. If the sign-in succeeds but the admin page still cannot verify the session, check browser third-party-cookie/privacy settings for that Worker hostname, then refresh.
5. Confirm the upload and management controls appear only after the Worker returns a valid admin file list.
6. Try a different email address. Cloudflare Access should deny it; even if the Access policy is accidentally broadened, the Worker allowlist must still reject its JWT.

Test the public endpoints:

- `https://hello-cat-downloads-api.z0ovd.workers.dev/api/files` returns JSON with a `files` array.
- `https://hello-cat-downloads-api.z0ovd.workers.dev/api/files/<FILE_ID>/download` downloads a published file.
- The GitHub Pages downloads page lists only published files.

Then upload a small harmless test file, verify it appears on the downloads page, unpublish it and confirm it disappears, publish it again, download it, and finally delete it.

## Security and behavior

- Cloudflare Access protects `/api/admin*`; the Worker independently verifies the signed JWT, issuer, audience, expiry, not-before claim, and exact email allowlist.
- The static GitHub Pages admin shell is public in this deployment, but privileged controls remain hidden until the API confirms authorization. No file-management action is trusted to frontend visibility alone.
- Public file listing contains published files only. Unpublished files cannot be downloaded through the public endpoint.
- Uploaded files are served as attachments with `application/octet-stream` and `nosniff`.
- The default maximum upload size is 90 MiB.
- `workers.dev` is convenient for this hobby project and does not require a custom domain. Cloudflare recommends a custom domain or route for business-critical production services.
