# Hello Cat file uploads — Cloudflare setup

The website remains hosted on GitHub Pages. The upload API uses a Cloudflare Worker, R2 for file objects, D1 for metadata, and Cloudflare Access for admin authentication.

The admin page is at /admin/ and the unlisted public download library is at /downloads/. Neither page is linked from the main navigation. The downloads page is public to anyone who knows its URL; it is not a private access-control boundary.

## 1. Requirements

- The helloc.at DNS zone must be active in the Cloudflare account.
- The domain must be proxied through Cloudflare for the Worker route to intercept /api/*.
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

## 3. Configure Cloudflare Access

Create a Cloudflare Access self-hosted application for the admin interface and admin API. Protect both paths:

- helloc.at/admin*
- helloc.at/api/admin*

Use an allow policy restricted to the email addresses that should administer Hello Cat. Do not use a public/Everyone policy.

If the dashboard requires separate Access applications for the two path patterns, create both with the same allow policy. In that case, put both application AUD tags in ACCESS_AUD, separated by commas.

Set these values in wrangler.toml:

- ACCESS_ISSUER: the exact issuer URL shown by your Cloudflare Access team, normally https://YOUR-TEAM.cloudflareaccess.com
- ACCESS_AUD: the Access application AUD tag, or comma-separated AUD tags if you created separate applications

The Worker independently verifies the Cf-Access-Jwt-Assertion signature, issuer, audience, expiry, and not-before claim for every admin API request. Do not remove this check or expose admin endpoints without Access.

## 4. Deploy the Worker

Check that the R2 bucket name, D1 database name/id, route, issuer, and audience in wrangler.toml are correct.

Deploy:

    npx wrangler deploy

The Worker route handles helloc.at/api/*. It does not replace the GitHub Pages website.

## 5. Verify

After deployment:

- Open https://helloc.at/api/files. It should return JSON containing a files array (empty before the first upload).
- Open https://helloc.at/downloads/. It should show an empty-library message until a file is published.
- Open https://helloc.at/admin/. Cloudflare Access should require an authorized admin sign-in.
- Upload a small test file. It should appear in the admin list and, if published, on the downloads page.
- Unpublish it and confirm it disappears from the public list. Publish it again and test its download.
- Delete the test file and confirm it disappears.

## Security and behavior

- No admin password, GitHub token, or Cloudflare API token is stored in browser JavaScript.
- Admin HTML and admin API paths should both be protected by Cloudflare Access.
- The Worker verifies Access JWTs itself before listing, uploading, publishing, or deleting files.
- Public downloads always use Content-Disposition: attachment and application/octet-stream with nosniff to avoid rendering uploaded content as an active page.
- Unpublished files are omitted from the public list and cannot be downloaded through the public endpoint.
- The default maximum upload size is 100 MiB. Change MAX_UPLOAD_BYTES in wrangler.toml to adjust it.
- The downloads page is intentionally omitted from the main site's navigation and marked noindex. Its URL is still shareable; use a separate Access policy if downloads should be restricted.
