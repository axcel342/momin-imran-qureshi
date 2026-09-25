# GGI Backend: Vercel Deployment Design

- **Date:** 2026-09-24
- **Status:** Approved design, spec awaiting user review
- **Branch:** `deploy/vercel` (only). `main` remains exactly as submitted.
- **Source:** the approved chat design for hosting the GGI backend on Vercel.

---

## 1. Goal

Host the existing GGI backend on Vercel as a serverless deployment backed by the live Supabase
project (`bewmbebyavgnljmkpytx`) and an Upstash Redis, **without changing the submitted `main`
branch**. Success means: the public Vercel URL serves the full API; a signed client flow works
end to end (Supabase login → device key → signed request → chat quota → subscription → metrics);
`/health` checks the real database and Redis; and the deployment is reproducible from
`deploy/vercel`.

## 2. Decisions

| #   | Decision      | Choice                                                                                                                                                   |
| --- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | Repo strategy | All deployment changes live on `deploy/vercel`; `main` stays untouched                                                                                   |
| V2  | Runtime shape | One Vercel Serverless Function (`api/index.ts`) hosting the Nest app via a cached bootstrap + one catch-all rewrite                                      |
| V3  | Redis         | Upstash Redis installed through the Vercel Marketplace; `REDIS_URL` is injected by the integration                                                       |
| V4  | Billing cron  | Disabled on Vercel (`BILLING_CRON=''`); admins trigger runs via `POST /v1/admin/billing/run`                                                             |
| V5  | Database      | Supabase. Runtime uses the **transaction** pooler (`:6543?pgbouncer=true`); migrations run from a developer machine via the **session** pooler (`:5432`) |
| V6  | Proxy         | `TRUST_PROXY=true` so rate-limit keys use the real client IP                                                                                             |
| V7  | Custom domain | Not in scope; the `*.vercel.app` URL is used                                                                                                             |

## 3. Architecture

```
Internet → Vercel edge → catch-all rewrite → api/index.ts (Node 22 function)
             │                                  │ cached Nest app (per warm instance)
             │                                  ├─ configureApp() middleware (helmet, CORS, json + rawBody, request-id, pino)
             │                                  ├─ global guards (IP limit → Auth → user limit → Roles)
             │                                  └─ PrismaService (transaction pooler) + RedisService (rediss://)
             └──────────────────────────→ Supabase Postgres 16 (live)        Upstash Redis
                                          Supabase Auth JWKS (live)
```

### 3.1 Serverless entry (`api/index.ts`)

- Creates the Nest app exactly like `src/main.ts` does — `NestFactory.create(AppModule, { bodyParser: false })`,
  `configureApp(app, loadConfig(process.env))` — but calls `app.init()` instead of `app.listen()`.
- Caches the bootstrap promise in module scope so a warm function reuses one app instance instead of
  re-creating connections per request.
- Exports one default async handler that forwards the raw Node request/response to the Express
  instance (`app.getHttpAdapter().getInstance()(req, res)`).
- **Signature preservation:** request signatures cover `originalUrl`. If Vercel rewrites the path,
  the handler restores `req.url` from `x-vercel-original-url` (or `x-forwarded-uri`) before Nest
  sees it. This is verified with a real signed request after deploy; if the headers are absent the
  path is already correct and the restoration is a no-op.
- No `.env` file exists on Vercel; config comes from project environment variables. `process.loadEnvFile`
  is not used.

### 3.2 Vercel configuration (`vercel.json`)

- `rewrites`: `/(.*)` → `/api/index`.
- `functions`: `api/index.ts` with `maxDuration: 30` (so the app's own `REQUEST_TIMEOUT_MS=8000`
  produces the 504 envelope before Vercel's limit), memory default.
- `buildCommand`: `npx prisma generate` (the function compiler bundles `src/` TS itself; `dist/` is not used).
- `includeFiles` for the generated Prisma client if the tracer misses it (e.g.
  `node_modules/.prisma/client/**`) — verified by the first deploy and adjusted only if needed.

### 3.3 Prisma

- Add `binaryTargets = ["native", "rhel-openssl-3.0.x"]` to the generator so the query engine
  matches Vercel's Amazon Linux 2023 runtime.
- Runtime `DATABASE_URL` on Vercel:
  `postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1`
  (transaction pooler; no prepared-statement leaks across functions).
- Migrations are **not** run by Vercel. They run from this machine using the session pooler and the
  existing `npm run db:migrate`; the deployed schema is the same migration already applied.

### 3.4 Redis

- Upstash Redis via the Vercel Marketplace integration (free tier).
- The integration injects its own variables; they are mapped to `REDIS_URL` (TLS `rediss://`) in the
  project settings. `ioredis` consumes it unchanged; `maxRetriesPerRequest: 1` already makes
  failures fast and fail-closed (503).

### 3.5 Environment variables on Vercel

`NODE_ENV=production`, `DATABASE_URL` (transaction pooler), `REDIS_URL`, `SUPABASE_URL`,
`SUPABASE_JWT_AUDIENCE=authenticated`, `HEALTH_CHECK_TOKEN` (fresh random), `BILLING_CRON=''`,
`REQUEST_TIMEOUT_MS=8000`, `TRUST_PROXY=true`, `CORS_ORIGINS=''`, `FREE_MESSAGES_PER_MONTH=3`,
`AI_MOCK_MIN_LATENCY_MS=300`, `AI_MOCK_MAX_LATENCY_MS=1500`, `PAYMENT_FAILURE_RATE=0.2`,
`LOG_LEVEL=info`. `SUPABASE_ANON_KEY` and `API_BASE_URL` are only needed by the CLI, not by the
deployment. No secrets are committed.

## 4. Files changed (on `deploy/vercel` only)

- Create: `api/index.ts`, `vercel.json`
- Modify: `prisma/schema.prisma` (engine binary target), `tsconfig.json` (include `api/`),
  `eslint`/Prettier coverage if needed so `lint`, `typecheck` and `format:check` stay green
- Not touched: `src/**` (except nothing), `test/**`, `README.md`, `main`

## 5. Deployment flow

1. Implement and verify on `deploy/vercel`; push the branch. CI runs the full gate on it.
2. The user runs `vercel login` (or supplies a scoped token); the project is linked and imported.
3. Install the Upstash integration; set the environment variables above; deploy to production.
4. Run migrations from this machine against the live database (already applied; re-run is a no-op).
5. Smoke-test the public URL.

## 6. Verification

- Branch gates: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build`.
- Post-deploy, against the public URL:
  - `GET /health` with `X-Health-Token` → `{status:'ok', checks:{database:'up', redis:'up'}}`.
  - **Signed request test is the critical one:** a `signup`/`login` and `/auth/me` through the CLI
    with `API_BASE_URL=<deployment-url>` (env override; the CLI reads `.env`, so the override is
    exported or temporarily written); this proves Vercel preserves the signed path and the JWKS works.
  - Chat quota: 3 asks succeed, 4th is 402; subscribe BASIC → next ask uses the bundle.
  - Rate limiting still keys correctly (`TRUST_PROXY`).
  - A direct database check after parallel traffic confirms the function uses the pooler rather
    than exhausting direct connections.

## 7. Out of scope

- Custom domains, TLS settings beyond Vercel defaults.
- Vercel Cron / any scheduled billing on the deployment.
- Changes to `main`, the README, or the submitted API behavior.
- Performance tuning, caching, observability beyond the existing logs and `/health`.
- Multi-region or scaling configuration.

## 8. Risks and mitigations

| Risk                                                               | Mitigation                                                                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Vercel rewrite changes `originalUrl` → all signed requests 401     | Handler restores from `x-vercel-original-url`; verified with a real signed request immediately after deploy |
| Prisma engine wrong for the runtime (`libssl` mismatch)            | `binaryTargets` includes `rhel-openssl-3.0.x`; failure surfaces in the first `/health` prologue             |
| Prisma client not bundled into the function                        | `includeFiles` for `node_modules/.prisma/client/**` if the first deploy errors                              |
| Connection exhaustion against Postgres                             | Transaction pooler URL with `connection_limit=1`                                                            |
| Upstash free-tier limits or missing TLS support                    | `REDIS_URL` is `rediss://`; fail-closed 503 if unavailable; upgrade is a plan change, not a code change     |
| Cold starts slow the first request                                 | Accepted; ~1–2s                                                                                             |
| Vercel function timeout cuts long requests                         | `maxDuration: 30` with app timeout 8s so the envelope 504 wins                                              |
| Upstash integration injects a variable name other than `REDIS_URL` | Mapped in project settings; documented in the deploy branch                                                 |

## 9. Rollback

The deployment is additive: `main` is untouched and the Supabase database remains the source of
truth. Rolling back means removing the Vercel project/integration or redeploying a previous
deployment; no repository history needs rewriting. The only shared mutable state is the live
database, which the branch does not migrate beyond what is already applied.
