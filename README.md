# SCCCI CRM

SCCCI CRM is a pnpm monorepo containing:

- `apps/web`: TanStack Start + React frontend
- `apps/api`: Hono API running on Cloudflare Workers

## Prerequisites

- Node.js 22 LTS or newer
- pnpm 10.33.0 (the version declared in `package.json`)

Enable the package manager through Corepack if pnpm is not already installed:

```sh
corepack enable
corepack prepare pnpm@10.33.0 --activate
```

## First-time setup

Install all workspace dependencies from the repository root:

```sh
pnpm install
```

Create the API's local secrets file:

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Then replace the placeholder `DATABASE_URL` and `AUTH_SECRET` values in
`apps/api/.dev.vars`. The frontend already defaults to the local API at
`http://localhost:8787`; use `apps/web/.env.local` only when you need to
override it.

## Run locally

Start the web app and API together:

```sh
pnpm dev
```

- Web app: http://localhost:3001
- API: http://localhost:8787
- Health check: http://localhost:8787/api/health

To run only one service:

```sh
pnpm dev:web
pnpm dev:api
```

## Verify the repository

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
