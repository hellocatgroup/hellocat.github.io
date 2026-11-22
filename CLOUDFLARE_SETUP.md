# Hello Cat downloads service

This document describes the live GitHub Pages + Cloudflare setup.

## Live URLs

- Main site: https://hellocatgroup.github.io/hellocat.github.io/
- Admin page: https://hellocatgroup.github.io/hellocat.github.io/admin/
- Public downloads: https://hellocatgroup.github.io/hellocat.github.io/downloads/
- Worker API: https://hello-cat-downloads-api.z0ovd.workers.dev

The website remains hosted on GitHub Pages as a project site. The file API runs separately on Cloudflare Workers. No custom domain, Cloudflare DNS zone, or DNS change is required.

## Provisioned resources

- Worker: `hello-cat-downloads-api`
- Worker subdomain: `z0ovd.workers.dev`
- R2 bucket: `hello-cat-downloads`
- D1 database: `hello-cat-downloads`
- D1 migration: `cloudflare/migrations/0001_create_files.sql`
- Access application: `Hello Cat Downloads Admin`
- Access login method: One-time PIN only
- Access policy: one exact administrator email address, configured in Cloudflare
- Worker secret: `ADMIN_EMAILS`, stored in Cloudflare and not committed to this repository

The D1 migration creates the file metadata table and the index used by the public downloads list.

## Security boundary

GitHub Pages serves the static admin page publicly. The page contains no credentials and keeps management controls hidden until the Worker confirms an authenticated administrator session.

Cloudflare Access protects every privileged API endpoint under `/api/admin*`. Its reusable Allow policy matches only the approved administrator email. The application uses the One-time PIN identity provider so the administrator does not need to be a member of the Cloudflare account.

The Worker independently validates the Access JWT signature, issuer, audience, expiry, not-before claim, and the exact email against the `ADMIN_EMAILS` Worker secret. Privileged API routes also reject requests whose `Origin` header does not exactly match the GitHub Pages origin.

The static admin page itself is not behind Cloudflare Access. This is intentional: authorization is enforced by the API, not by hiding the HTML page. Anyone who knows the admin URL can view the shell, but cannot list private admin metadata, upload, publish, unpublish, or delete files without the authorized Access session.

The public downloads page and published download endpoints are public by design. The downloads page is unlisted and marked `noindex, nofollow`, but its URL is shareable. Only published files appear there; unpublished files cannot be downloaded through the public endpoint.

## Configuration

The frontend API base URL is configured in `js/config.js`:

```js
window.HC_CONFIG = Object.freeze({
  apiBaseUrl: "https://hello-cat-downloads-api.z0ovd.workers.dev"
});
```

The Worker configuration is mirrored in `wrangler.toml`, including the D1 database ID, R2 binding, Access issuer and audience, allowed frontend origin, admin return URL, and upload-size limit.

The `ADMIN_EMAILS` value is a Cloudflare Worker secret. Never add its value to `js/config.js`, HTML, `wrangler.toml`, or any other public repository file.

The Worker allows requests from this exact frontend origin:

- `https://hellocatgroup.github.io`

The origin does not include the repository path. The admin return URL does include the full project-site path.

## Upload and download behavior

- Maximum upload size: 90 MiB.
- Files are stored privately in R2.
- File metadata and publication state are stored in D1.
- Admins can upload, publish, unpublish, and delete files.
- Only published files appear on the public downloads page.
- Downloads are served as attachments with `application/octet-stream` and `X-Content-Type-Options: nosniff`.

The Worker uses credentialed CORS only for the exact GitHub Pages origin. The browser admin client uses `credentials: "include"`. Its API requests use simple GET/POST requests so they do not require a separate Access-protected preflight flow.

## Sign in and test

1. Open the admin page: https://hellocatgroup.github.io/hellocat.github.io/admin/
2. Select **Sign in with Cloudflare Access**.
3. Authenticate using the approved administrator email and the One-time PIN sent by Cloudflare.
4. Return to the admin page. The upload and management controls appear only after the Worker confirms authorization.
5. Upload a small harmless test file and publish it.
6. Open the downloads page and confirm the file appears and downloads.
7. Unpublish it and confirm it disappears from the public list; publish it again and confirm it returns.
8. Delete the test file when finished.
9. Test with a different email address. Cloudflare Access should deny it, and the Worker-side allowlist provides an independent second check.

Public API endpoints:

- `GET https://hello-cat-downloads-api.z0ovd.workers.dev/api/files` returns the published file list.
- `GET https://hello-cat-downloads-api.z0ovd.workers.dev/api/files/<FILE_ID>/download` downloads a published file.

## Future deployments

From the repository root, with Wrangler installed and authenticated:

```sh
npx wrangler deploy
```

The existing `ADMIN_EMAILS` secret remains stored in Cloudflare. Do not put it in source control. After future changes, verify the active Worker version, bindings, Access policy, public file list, and an authenticated upload before treating the service as production-ready.

GitHub Pages updates automatically after commits to the configured publishing branch. No custom domain or DNS change is required for this setup.
