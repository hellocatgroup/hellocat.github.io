# Hello Cat file uploads — Cloudflare setup

The website remains hosted on GitHub Pages. The upload API uses a Cloudflare Worker, R2 for file objects, D1 for metadata, and Cloudflare Access for admin authentication.

The admin page is at /admin/ and the unlisted public download library is at /downloads/. Neither page is linked from the main navigation. The downloads page is public to anyone who knows its URL; it is not a private access-control boundary.

**Do not enable uploads or deploy the Worker until the Cloudflare Access policies and administrator email allowlist below are configured.** The admin HTML is static content; the real security boundary is Cloudflare Access plus the Worker's independent JWT and email checks.

## 1. Requirements

- The helloc.at DNS zone must be active in the Cloudflare account.
- The domain must be proxied through Cloudflare for Access and the Worker route to intercept requests.
- Wrangler CLI installed and authenticated with the Cloudflare account.
- Permission to create Workers, R2 buckets, D1 databases, and Access applications.

If helloc.at is not using Cloudflare DNS/proxy, do not expect the route in wrangler.toml to work. Move the zone to Cloudflare or adapt the API to a separate API hostname and configure CORS before deploying.

## 2. Create storage

From the repository root, create the R2 bucket:

    npx wrangler r2 bucket create hello-cat-downloads

Create the D1 database:

    npx wrangler d1 create hello-cat-downloads

Copy the database_id from the command output into wrangler.toml, replacing REPLACE_WITH_D1_DATABASE_ID.

Apply the database migration:

    npx wrangler d1 migrations apply hello-cat-downloads --remote

The migration creates the files metadata table and its public-list index.

## 3. Configure Cloudflare Access and the administrator allowlist

Create Cloudflare Access self-hosted applications covering **both** the admin page and the admin API:

- `helloc.at/admin*`
- `helloc.at/api/admin*`

Use an allow policy restricted to the exact email addresses that should administer Hello Cat. Do not use a public/Everyone policy. Protecting only the API is insufficient for the desired sign-in experience; protect the page as well.

If the dashboard requires separate Access applications for the two path patterns, create both with the same allow policy. In that case, put both application AUD tags in ACCESS_AUD, separated by commas.

Set these values in wrangler.toml:

- ACCESS_ISSUER: the exact issuer URL shown by your Cloudflare Access team, normally https://YOUR-TEAM.cloudflareaccess.com
- ACCESS_AUD: the Access application AUD tag, or comma-separated AUD tags if you created separate applications

Then configure the independent Worker allowlist. Run:

    npx wrangler secret put ADMIN_EMAILS

When prompted, enter the comma-separated email addresses that are allowed to administer files. Use the same exact addresses as the Cloudflare Access allow policy. This value is stored as a Worker secret and must not be committed to the repository.

The Worker verifies the Access JWT signature, issuer, audience, expiry, and not-before claim, then independently checks the JWT email against ADMIN_EMAILS. If the issuer, audience, or email allowlist is missing, admin endpoints fail closed and return 503. If the token is absent, invalid, expired, or belongs to an email outside the allowlist, they return 401.

## 4. Deploy the Worker

Check that the R2 bucket name, D1 database name/id, route, issuer, and audience in wrangler.toml are correct. Confirm ADMIN_EMAILS has been set as a Worker secret.

Deploy:

    npx wrangler deploy

The Worker route handles helloc.at/api/*. It does not replace the GitHub Pages website.

## 5. Verify before uploading real files

- In a private/incognito browser, open https://helloc.at/admin/. Cloudflare Access must require sign-in before serving the admin page.
- Sign in with an email on the allowlist. The upload and file-management controls should appear only after the Worker returns a valid authenticated admin file list.
- Sign in with a non-allowlisted account. Cloudflare Access should block it; even if an Access policy is accidentally broadened, the Worker email allowlist must reject its token.
- Call the admin API without an Access session. It must return 401 (or 503 if authentication configuration is incomplete); it must never accept an upload.
- Open https://helloc.at/api/files. It should return JSON containing a files array (empty before the first upload).
- Open https://helloc.at/downloads/. It should show an empty-library message until a file is published.
- Upload a small harmless test file. It should appear in the admin list and, if published, on the downloads page.
- Unpublish it and confirm it disappears from the public list and cannot be downloaded. Publish it again and test its download.
- Delete the test file and confirm it disappears.

## Security and behavior

- The admin page is static GitHub Pages content. Hiding controls in JavaScript is only a usability safeguard, not authentication.
- Cloudflare Access must protect both /admin* and /api/admin*. The Worker independently verifies the JWT and checks the administrator email allowlist on every privileged API request.
- No admin password, GitHub token, or Cloudflare API token is stored in browser JavaScript.
- Public downloads always use Content-Disposition: attachment and application/octet-stream with nosniff to avoid rendering uploaded content as an active page.
- Unpublished files are omitted from the public list and cannot be downloaded through the public endpoint.
- The default maximum upload size is 100 MiB. Change MAX_UPLOAD_BYTES in wrangler.toml to adjust it.
- The downloads page is intentionally omitted from the main site's navigation and marked noindex. Its URL is still shareable; use a separate Access policy if downloads should be restricted.
