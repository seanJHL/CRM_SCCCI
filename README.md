# SCCCI CRM

SCCCI CRM is a Cloudflare Workers + React CRM that connects to Gmail and Google Calendar through Google OAuth 2.0. It classifies Gmail threads, prepares editable reply drafts, detects scheduling language, checks availability, and manages confirmed calendar bookings.

The application never sends an email or creates, updates, or cancels a calendar event without a final user confirmation.

## Project layout

- `apps/web` — TanStack Start SPA and protected CRM dashboard
- `apps/api` — Hono API on Cloudflare Workers
- Neon PostgreSQL + Drizzle — users, encrypted OAuth credentials, sessions, CRM cache, bookings, and audit logs

## Local setup

Requirements: Node.js 22+ and pnpm 10.33.0.

```sh
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Fill in `apps/api/.dev.vars`, then apply the migrations to the same Neon database:

```sh
DATABASE_URL='postgresql://...' pnpm db:migrate
```

Start both applications:

```sh
pnpm dev
```

- Web: `http://localhost:3001/login`
- API: `http://localhost:8787/api/health`
- OAuth callback: `http://localhost:8787/api/auth/google/callback`

## Google Cloud configuration

1. Create or select a Google Cloud project.
2. Enable the Gmail API and Google Calendar API.
3. Configure the OAuth consent screen with accurate app identity, support contact, privacy policy, and data-use disclosures.
4. Create an OAuth client of type **Web application**.
5. Add the exact local, preview, and production callback URLs from `apps/api/wrangler.jsonc` as authorised redirect URIs.
6. Add test users while the consent screen remains in testing mode.

The API requests only these feature scopes:

- `openid`, `email`, `profile` — sign-in identity
- `gmail.readonly` — read thread content
- `gmail.send` — send a reply only after confirmation
- `calendar.events` — list and manage confirmed events
- `calendar.events.freebusy` — check user/participant availability where accessible

`gmail.readonly` is a restricted scope. A public production app may require Google OAuth verification and, when restricted-scope data is stored or transmitted by the server, a security assessment. Publish a privacy policy that explicitly states that the app’s use of Google Workspace information follows the Google API Services User Data Policy, including Limited Use requirements.

## Required secrets

Generate the encryption and session secrets:

```sh
openssl rand -base64 32
openssl rand -base64 48
```

Set these in `.dev.vars` locally and as Cloudflare Worker secrets for preview/production:

- `DATABASE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ENCRYPTION_KEY` — base64-encoded 32-byte AES-GCM key
- `SESSION_SECRET` — high-entropy HMAC key
- `AUTH_SECRET` — retained for existing API features
- Web Push VAPID keys used by the existing reminder features

Example production commands:

```sh
cd apps/api
pnpm exec wrangler secret put DATABASE_URL --env production
pnpm exec wrangler secret put GOOGLE_CLIENT_ID --env production
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --env production
pnpm exec wrangler secret put ENCRYPTION_KEY --env production
pnpm exec wrangler secret put SESSION_SECRET --env production
```

`GOOGLE_REDIRECT_URI` and `CORS_ORIGIN` are environment-specific non-secret values in `wrangler.jsonc`.

The current frontend and API production URLs are on different sites, so the session cookie uses `Secure; SameSite=None`. For the most reliable browser privacy compatibility, expose the API on a same-site custom hostname such as `api.crm.seanleejh.com`, update `VITE_API_URL`, `CORS_ORIGIN`, `GOOGLE_REDIRECT_URI`, and the Google authorised redirect URI together.

## Security and privacy model

- CRM API routes require a server-side session; raw session tokens live only in HttpOnly cookies and are HMAC-hashed in the database.
- Credentialed mutations validate the browser `Origin` to prevent CSRF.
- OAuth uses state, nonce, PKCE, issuer/audience/expiry validation, and Google JWK signature verification.
- Access and refresh tokens are AES-256-GCM encrypted at rest and refreshed server-side.
- Revoked/expired tokens and missing scopes return actionable `GOOGLE_REAUTH_REQUIRED` or `GOOGLE_PERMISSION_REQUIRED` errors.
- Gmail bodies are fetched on demand and are not persisted. Cached records contain only the metadata needed for the CRM.
- Classification and draft generation are local, rules-based operations; no Gmail or Calendar data is sent to an external AI provider or used for model training.
- Audit details are PII-masked before storage.
- Disconnect revokes Google access and clears CRM data. Delete removes the user, every session, encrypted credentials, cached records, bookings, and audit logs.

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The API tests cover protected routes, timezone-aware natural-language parsing, working-hour recommendations, email classification, PII masking, token encryption, session hashing, and reply-draft behaviour.
