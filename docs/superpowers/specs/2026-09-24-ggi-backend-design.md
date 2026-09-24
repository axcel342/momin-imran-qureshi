# GGI Backend: AI Chat & Subscription Bundles, Design Spec (minimal build)

- **Date:** 2026-09-24
- **Status:** Revised for minimal scope, awaiting approval
- **Source requirements:** `GGI - BACKEND TEST POSTURE (1) (1).pdf` (take-home, 24h deadline)

**Scope rule:** build exactly what the PDF asks for and nothing more. Anything that isn't traceable to a PDF bullet (§13) is cut. The removed items are listed in §14 so they can be mentioned in the README as "future work".

---

## 1. Goal and success criteria

A secure REST backend in TypeScript with DDD/Clean Architecture and PostgreSQL. It has two business modules:

1. **Chat.** An authenticated user asks a question and gets a mocked OpenAI answer. The system stores the question, answer, tokens and metadata, and enforces the free and bundle quotas.
2. **Subscriptions.** Users buy Basic, Pro or Enterprise bundles, monthly or yearly, with auto-renew. Renewal is simulated with random payment failures, and cancellation is supported.

**Success means:**
- Every PDF bullet maps to a mechanism and, where the PDF asks for one, a test (§13).
- Tests need no external accounts.
- The README covers the architecture, the security model and the setup.
- No route is open.

---

## 2. Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Framework | TypeScript (strict) + **NestJS** (Express adapter) |
| D2 | ORM / migrations | **Prisma** + PostgreSQL 16 |
| D3 | Identity provider | **Supabase Auth** (email/password + GitHub OAuth, both configured in the Supabase dashboard), verified via JWKS |
| D4 | "Token alone is not enough" | **Session-bound request signing** (ECDSA P-256 key bound to the Supabase `session_id`; signed timestamp + nonce + body hash) |
| D5 | Rate-limit and nonce storage | **Redis 7** |
| D6 | Quota deduction | **Row lock (`SELECT … FOR UPDATE`) + a pure domain allocator, in one transaction after the AI call** (§8.3) |
| D7 | Validation | **Zod** `.strict()` schemas through one Nest pipe |
| D8 | Logging | **pino** (`nestjs-pino`) |
| D9 | Scheduler | `@nestjs/schedule` cron + `FOR UPDATE SKIP LOCKED` |
| D10 | Rate limiter | Small custom Redis fixed-window limiter (`INCR` + `EXPIRE`) used by two guards |
| D11 | Tests | Jest + supertest. Integration tests run against Postgres and Redis started by `compose.yaml` (Podman locally, service containers in CI). The IdP is a local mock JWKS server |
| D12 | Runtime | **Node 22 LTS** |
| D13 | Health endpoint | Protected by the `X-Health-Token` header |

---

## 3. Interpretations of ambiguous requirements (approved)

| # | PDF text | Interpretation |
|---|----------|----------------|
| A1 | "bundle with the latest remaining quota" | Free quota first, then the **most recently created** usable bundle (`createdAt DESC, id DESC`). Enterprise (unlimited) always has quota remaining. |
| A2 | 3 free per calendar month, reset on the 1st | UTC month. A row per `(user, 'YYYY-MM')`, so the reset is implicit and needs no cron job. |
| A3 | Basic 10 / Pro 100 | `maxMessages` **per billing cycle**; renewal resets `usedMessages`. |
| A4 | Cancellation ends the current cycle | Takes effect immediately: `endDate = now`, `INACTIVE (CANCELLED)`, `autoRenew = false`, `renewalDate = null`. Chat history is kept. |
| A5 | active / inactive | `status ∈ {ACTIVE, INACTIVE}` + `inactiveReason ∈ {CANCELLED, PAYMENT_FAILED, EXPIRED}`. |
| A6 | Payment at creation | The first cycle is charged on creation. If that fails, the subscription is saved as `INACTIVE (PAYMENT_FAILED)` and the API returns 402 `PAYMENT_FAILED`. |
| A7 | "Authentication endpoints" | Our auth routes are `POST /v1/auth/device-keys` and `GET /v1/auth/me`, and they get the strictest limits. |
| A8 | All endpoints protected | Health needs `X-Health-Token`. Metrics is admin-only. |
| A9 | Admin system-wide access | Admins can list any user's chats and subscriptions (via `?userId=`), cancel any subscription, view metrics and trigger billing. |

---

## 4. Architecture

### 4.1 Layers and rules

```
controllers/ → application/ (use cases) → domain/{entities,services,policies}
                     ↓ interfaces
               repositories/ (interface + Prisma implementation)
               infrastructure/ (AI mock, payment simulator, scheduler)
```

- `domain/**` must not import `@nestjs/*`, `@prisma/*`, `express` or `ioredis`. This is enforced with ESLint `no-restricted-imports` overrides; no extra plugin is needed.
- Use cases depend on repository **interfaces** and ports only.
- Controllers only validate input, build the `Actor`, call a use case and map the result.

### 4.2 Directory layout

```
src/
  main.ts                    # bootstrap: server timeouts, body limit, helmet, CORS
  app.module.ts
  config/env.ts              # Zod env schema; fail fast
  shared/
    domain/                  # DomainError, Actor, Clock
    prisma/                  # PrismaService, TransactionRunner (ALS tx client)
    redis/                   # RedisService, RateLimiter
    http/                    # guards, exception filter, timeout interceptor, zod pipe,
                             # content-type + request-id middleware, decorators
  auth/
    domain/{entities,services,policies}/  # DeviceBinding, SignatureVerifier, KeyBindingPolicy
    application/             # RegisterDeviceKey, GetMe
    repositories/            # user + device-binding repos
    infrastructure/          # SupabaseTokenVerifier (jose), NonceStore (redis)
    controllers/
  chat/
    domain/entities/         # ChatMessage, MonthlyUsage
    domain/services/         # QuotaAllocator, UsagePeriod, TokenEstimator
    domain/policies/         # ChatAccessPolicy, BundleSelectionPolicy
    domain/ports.ts          # AiCompletionPort, BundleQuotaPort
    application/             # AskQuestion, ListChats
    repositories/
    infrastructure/          # MockOpenAiAdapter
    controllers/
  subscriptions/
    domain/entities/         # Subscription
    domain/services/         # PricingCatalog, PeriodCalculator
    domain/policies/         # SubscriptionAccessPolicy
    domain/ports.ts          # PaymentGatewayPort
    application/             # Create, Cancel, SetAutoRenew, List, RunBillingCycle
    repositories/
    infrastructure/          # SimulatedPaymentGateway, BillingScheduler, BundleQuotaAdapter
    controllers/
  observability/             # HealthController, MetricsController
prisma/schema.prisma, prisma/migrations/
scripts/client.ts            # login (email/pw) → register key → signed requests
scripts/promote-admin.ts     # set role=ADMIN by email
test/unit/, test/integration/, test/support/ (mock-idp, signer, app factory)
compose.yaml                 # postgres + redis
```

### 4.3 Chat → subscriptions contract

Chat defines the port and subscriptions implements it (`BundleQuotaAdapter`), so chat never imports subscription entities:

```ts
interface BundleQuotaPort {
  lockUsableBundles(userId: string, now: Date): Promise<BundleSnapshot[]>; // FOR UPDATE, ORDER BY id
  consume(subscriptionId: string): Promise<void>;
}
type BundleSnapshot = { id: string; remaining: number | null; createdAt: Date; startDate: Date; endDate: Date };
```

### 4.4 Transactions

`TransactionRunner.run(fn)` wraps `prisma.$transaction` (ReadCommitted, 5s timeout) and stores the transaction client in `AsyncLocalStorage`. Repositories use that client when one exists, so the chat and subscription repos join the same transaction. Row locks use `$queryRaw` with the `Prisma.sql` tagged template, which is parameterized. `*Unsafe` raw queries are banned by an ESLint rule.

---

## 5. Domain model

### 5.1 Chat

- **`UsagePeriod`**: `'YYYY-MM'` from a UTC date; `resetsAt()` returns the 1st of the next month at 00:00Z.
- **`MonthlyUsage`** `(userId, period, freeUsed, freeLimit=3, totalMessages)`:
  - `consumeFree()` throws if `freeUsed ≥ freeLimit`;
  - `recordBundleUse()` increments `totalMessages` only.
- **`ChatMessage`** `(id, userId, question, answer, quotaSource: FREE|BUNDLE, subscriptionId?, period, model, promptTokens, completionTokens, totalTokens, latencyMs, requestId, createdAt)`: created once, complete, never updated.
- **`QuotaAllocator.allocate({ free, bundles, now })`** returns `{source:'FREE'}` or `{source:'BUNDLE', subscriptionId}`, or throws `QuotaExhaustedError { freeUsed, freeLimit, freeResetsAt }`:
  1. Use free quota if `free.used < free.limit`.
  2. Otherwise keep bundles where `startDate ≤ now < endDate` and (`remaining === null` or `remaining > 0`).
  3. Pick with `BundleSelectionPolicy` (A1).
- **`ChatAccessPolicy.canListFor(actor, targetUserId)`**: the actor is admin, or the target is the actor.
- **`TokenEstimator`**: `ceil(chars / 4)`.

### 5.2 Subscriptions

**`PricingCatalog`** (integer cents)

| Tier | maxMessages / cycle | Monthly | Yearly |
|------|------|------|------|
| BASIC | 10 | 999 | 9990 |
| PRO | 100 | 2999 | 29990 |
| ENTERPRISE | null (unlimited) | 19999 | 199990 |

**`Subscription`** (aggregate)
- Fields: `id, userId, tier, billingCycle, maxMessages|null, usedMessages, priceCents, autoRenew, status, inactiveReason?, startDate, endDate, renewalDate|null, cancelledAt?, createdAt`.
- `static create(userId, tier, cycle, autoRenew, paymentOk, now)`:
  - payment OK: `ACTIVE`, `endDate = PeriodCalculator.add(now, cycle)`, `renewalDate = endDate`;
  - payment failed: `INACTIVE / PAYMENT_FAILED`.
- `isUsableAt(now)`, `remaining()`, `consume()`.
- `setAutoRenew(v)` and `cancel(now)`: only when `ACTIVE`; otherwise `SubscriptionNotActiveError`.
- `renew(now, paymentOk?)`, applied when `ACTIVE && renewalDate ≤ now`:
  - `!autoRenew` → `EXPIRED`;
  - payment OK → next period (`startDate = endDate`, new `endDate` and `renewalDate`, `usedMessages = 0`);
  - payment failed → `INACTIVE / PAYMENT_FAILED`, `renewalDate = null`.
- `PeriodCalculator.add` uses `date-fns` `addMonths`/`addYears`, which clamp to the end of the month.

**`SubscriptionAccessPolicy`**
- `canView` / `canCancel`: the owner or an admin.
- `canSetAutoRenew`: the owner only.
- Create is always for the actor themselves.
- A non-owner non-admin gets 404; an admin who is denied gets 403.

**`PaymentGatewayPort.charge(subscriptionId, amountCents)`** returns `{ ok: boolean }`. `SimulatedPaymentGateway` fails with probability `PAYMENT_FAILURE_RATE` (default 0.2). Tests inject a fixed fake.

### 5.3 Auth

- **`DeviceBinding`** `(id, userId, sessionId UNIQUE, publicKeyJwk, createdAt)`.
- **`KeyBindingPolicy`**:
  - one binding per Supabase `session_id`, which can't be changed;
  - registration only within 300s of the token's latest `amr[].timestamp` (the actual login time);
  - anonymous tokens are rejected.
- **`SignatureVerifier`** (pure): builds the canonical string and verifies an ECDSA P-256 signature through an injected verify function.

---

## 6. Persistence

UUID primary keys (`gen_random_uuid()`), `timestamptz` everywhere.

| Table | Columns / constraints |
|-------|-----------------------|
| `users` | `id` PK (= Supabase sub), `email`, `role` (`USER`/`ADMIN`), `created_at` |
| `device_bindings` | `id`, `user_id` FK, `session_id` UNIQUE, `public_key_jwk` jsonb, `created_at` |
| `monthly_usage` | PK `(user_id, period)`, `free_used`, `free_limit`, `total_messages`; CHECK `free_used BETWEEN 0 AND free_limit` |
| `subscriptions` | fields from §5.2; CHECK `max_messages IS NULL OR used_messages <= max_messages`; index `(user_id, status)`, `(status, renewal_date)` |
| `chat_messages` | fields from §5.1; index `(user_id, created_at DESC)` |

CHECK constraints are added by hand to the generated migration SQL. Nothing is deleted, so history is kept.

---

## 7. API

- Base `/v1`, JSON only.
- Every route needs **bearer token + request signature**, with two exceptions: `POST /v1/auth/device-keys` needs the bearer token only (it is the bootstrap step), and `/health` needs the probe token.
- List endpoints take `?limit=` (1–50, default 20) and return newest first.

| Method | Path | Roles | Rate group | Notes |
|--------|------|-------|-----------|-------|
| POST | `/v1/auth/device-keys` | any (bearer only) | auth | `{ publicKey: JWK }`: EC P-256 with only `kty,crv,x,y`. Creates the user row if missing. Errors: 409 `KEY_ALREADY_BOUND`, 403 `KEY_BINDING_WINDOW_CLOSED` |
| GET | `/v1/auth/me` | USER, ADMIN | auth | `{ id, email, role }` |
| POST | `/v1/chat/messages` | USER, ADMIN | chat | `{ question: string 1..4000 }` → 201 `{ id, answer, model, usage, quota:{source, subscriptionId?, freeRemaining, freeResetsAt}, createdAt }`. Error: 402 `QUOTA_EXHAUSTED` |
| GET | `/v1/chat/messages` | USER, ADMIN | chat | Own history; admin may pass `?userId=` |
| POST | `/v1/subscriptions` | USER, ADMIN | subscriptions | `{ tier, billingCycle, autoRenew }` → 201, or 402 `PAYMENT_FAILED` |
| GET | `/v1/subscriptions` | USER, ADMIN | subscriptions | Own; admin may pass `?userId=` |
| PATCH | `/v1/subscriptions/:id` | USER, ADMIN (owner) | subscriptions | `{ autoRenew }` only |
| POST | `/v1/subscriptions/:id/cancel` | USER, ADMIN | subscriptions | 409 `SUBSCRIPTION_NOT_ACTIVE` |
| POST | `/v1/admin/billing/run` | **ADMIN** | admin | Runs a renewal cycle now |
| GET | `/v1/admin/metrics` | **ADMIN** | admin | `{ users, chat:{ messagesThisMonth, free, bundle, tokensThisMonth }, subscriptions:{ activeByTier, inactiveByReason } }` |
| GET | `/health` | `X-Health-Token` | ops | DB `SELECT 1` + Redis `PING` |

**Error envelope** (every non-2xx response):

```json
{ "error": { "code": "QUOTA_EXHAUSTED", "message": "…", "details": { "freeUsed": 3, "freeLimit": 3, "freeResetsAt": "2026-10-01T00:00:00.000Z" }, "requestId": "…" } }
```

`ApiErrorCode` is an exported string-literal union:

| Status | Codes |
|--------|-------|
| 400 | `VALIDATION_FAILED` (issue paths, submitted values not echoed) |
| 401 | `UNAUTHENTICATED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `SIGNATURE_REQUIRED`, `INVALID_SIGNATURE`, `KEY_NOT_BOUND`, `REQUEST_EXPIRED`, `REPLAY_DETECTED` |
| 402 | `QUOTA_EXHAUSTED`, `PAYMENT_FAILED` |
| 403 | `FORBIDDEN`, `KEY_BINDING_WINDOW_CLOSED` |
| 404 | `NOT_FOUND` |
| 409 | `KEY_ALREADY_BOUND`, `SUBSCRIPTION_NOT_ACTIVE` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 429 | `RATE_LIMITED` (+ `Retry-After`) |
| 503 | `SERVICE_UNAVAILABLE` |
| 504 | `REQUEST_TIMEOUT` |
| 500 | `INTERNAL_ERROR` |

Domain errors carry a `code`, and one global exception filter maps them to HTTP responses.

---

## 8. Key flows

### 8.1 Request pipeline

```
Node server (requestTimeout, headersTimeout)
 → request-id middleware (accept X-Request-Id only if it is a UUID, else generate; echo in response)
 → pino-http (reqId, userId once known, responseTime)
 → helmet (CSP default-src 'none', HSTS, nosniff, frame-ancestors none, no-referrer) + Cache-Control: no-store
 → CORS (CORS_ORIGINS allowlist, no credentials)
 → content-type check (POST/PATCH must be application/json → 415)
 → JSON parser (16kb limit → 413; raw body kept for signing)
 → global guards, in order:
     IpRateLimitGuard → AuthGuard (default deny) → UserRateLimitGuard → RolesGuard (@Roles)
 → TimeoutInterceptor (REQUEST_TIMEOUT_MS=10s → 504)
 → ZodValidationPipe (.strict(), trims strings, strips HTML from free text via sanitize-html)
 → controller → use case (domain policy check) → domain
 → GlobalExceptionFilter
```

`AuthGuard` is global and denies by default. The only non-signature routes are the ones marked `@BearerOnly()` (key registration) or `@HealthProbe()`. An integration test calls every route without credentials and expects 401.

### 8.2 Request signing

**Client** (`scripts/client.ts` and the test signer):
1. Log in to Supabase with `supabase-js`.
2. Generate a P-256 key pair.
3. Call `POST /v1/auth/device-keys`.
4. Sign each request with these headers:
   - `X-Signature-Timestamp` (unix seconds)
   - `X-Signature-Nonce` (base64url, ≥128 bits)
   - `X-Signature` (base64url ECDSA P-256/SHA-256, IEEE-P1363) over:

```
GGI-SIG-V1\n{METHOD}\n{originalUrl}\n{timestamp}\n{nonce}\n{base64url sha256(rawBody)}\n{base64url sha256(accessToken)}
```

**Server checks, in order:**
1. Bearer token present.
2. `jose.jwtVerify` with the remote JWKS:
   - `iss = ${SUPABASE_URL}/auth/v1`, `aud = authenticated`, algorithms `ES256`/`RS256`, 5s clock tolerance;
   - `sub`, `exp` and `session_id` required; `is_anonymous !== true`.
3. Signature headers present.
4. `|now − ts| ≤ 60s`.
5. Load the binding by `session_id` and check that `user_id = sub`.
6. Verify the signature.
7. Redis `SET nonce:{sessionId}:{nonce} NX EX 120`; if it already exists, the request is a replay.
8. Attach `Actor { userId, role, sessionId }` to the request.

Redis errors make the request fail closed with 503.

### 8.3 Ask a question (minimal flow)

```
AskQuestion(actor, question):
  1. Pre-check (no lock): if the user has neither free quota nor a usable bundle → 402 QUOTA_EXHAUSTED  (don't pay for an AI call)
  2. answer = AiCompletionPort.complete(question)          ← mock, random 300–1500ms latency, outside any transaction
  3. Tx (authoritative):
       INSERT monthly_usage … ON CONFLICT DO NOTHING
       SELECT monthly_usage … FOR UPDATE                    ← serialises this user's requests
       bundles = BundleQuotaPort.lockUsableBundles(user)    ← FOR UPDATE, ORDER BY id (fixed lock order)
       allocation = QuotaAllocator.allocate(...)            ← pure domain; throws QuotaExhausted if a race was lost
       consumeFree() | consume(bundle) + recordBundleUse()
       INSERT chat_messages (question, answer, tokens, requestId, source, …)
     commit → 201
```

- **Atomic and concurrency-safe:** quota is only deducted inside the locked transaction, and the CHECK constraints guard it a second time. N parallel requests with 3 free messages left produce exactly 3 × 201.
- **Why this order:** nothing is reserved before the AI call, so there's no PENDING state, no refund path and no clean-up job. The cost is that a request which loses a race wastes one mock AI call, which is acceptable.
- **Timeouts:** if the request has already timed out (504 sent) when the AI call returns, the use case skips the transaction, so the user is never charged for an answer they didn't receive.

### 8.4 Mock OpenAI

- Waits a random delay between `AI_MOCK_MIN_LATENCY_MS` and `AI_MOCK_MAX_LATENCY_MS`.
- Returns an OpenAI-shaped result (`id`, `model: 'gpt-4o-mini'`, `choices[0].message.content`, `usage`).
- The content is a canned answer chosen by hashing the question, and it is sanitized before storage.

### 8.5 Billing cycle

A cron job (`BILLING_CRON`, every minute) and `POST /v1/admin/billing/run` both call `RunBillingCycle`:

```
Tx: SELECT subscriptions WHERE status='ACTIVE' AND renewal_date <= now
    ORDER BY renewal_date FOR UPDATE SKIP LOCKED LIMIT 50
    for each: paymentOk = autoRenew ? gateway.charge(...) : undefined
              sub.renew(now, paymentOk); save
```

The result of each payment is logged. Each run advances one cycle.

---

## 9. Security model

| Requirement | Mechanism |
|-------------|-----------|
| External OIDC, email/password + OAuth, no custom auth | Supabase Auth; the app never handles passwords |
| Server-side verification (iss/aud/exp) | `jose` + remote JWKS, pinned algorithms |
| Token alone not sufficient | Session-bound request signing + timestamp + single-use nonce |
| RBAC, controller level | `RolesGuard` + `@Roles` |
| RBAC, domain level | `ChatAccessPolicy`, `SubscriptionAccessPolicy`, `KeyBindingPolicy` inside use cases |
| Headers / CORS / size / content type / timeout | §8.1 |
| Rate limits (per minute, env-overridable) | auth 20/IP, 10/user · chat 60/IP, 20/user · subscriptions 60/IP, 30/user · admin 60/60 · ops 30/IP |
| Schema validation, unknown fields rejected | Zod `.strict()` on body and query; UUID params validated |
| XSS | JSON-only API, CSP `default-src 'none'`, nosniff; free text stripped of HTML before storage |
| Injection | Prisma parameterized queries; ESLint bans `$queryRawUnsafe`/`$executeRawUnsafe` |
| Mass assignment | Explicit DTO-to-command mapping; `userId` always from `Actor`; PATCH accepts only `autoRenew` |
| Config | Zod-validated env; the app refuses to boot if config is invalid; `.env.example` only |

**Residual risks (in the README):**
- **Trust on first use when binding a key.** A token stolen within 5 minutes of login, before the client binds its key, could be bound by an attacker. The real client then gets `KEY_ALREADY_BOUND`, which can be detected. DPoP-capable IdPs would close this gap.
- **Signatures cover `originalUrl`.** A proxy must not rewrite paths.

---

## 10. Observability

- **Logs:** pino JSON with `requestId`, `userId`, `method`, `route`, `statusCode`, `responseTime`. Authorization and signature headers are redacted.
- **Health:** `/health` checks the DB and Redis.
- **Metrics:** `/v1/admin/metrics`, JSON from aggregate queries.

---

## 11. Configuration (Zod-validated env)

`NODE_ENV, PORT, DATABASE_URL, REDIS_URL, SUPABASE_URL, SUPABASE_JWKS_URL (optional override), SUPABASE_JWT_AUDIENCE=authenticated, CORS_ORIGINS, TRUST_PROXY, REQUEST_TIMEOUT_MS=10000, FREE_MESSAGES_PER_MONTH=3, AI_MOCK_MIN_LATENCY_MS=300, AI_MOCK_MAX_LATENCY_MS=1500, PAYMENT_FAILURE_RATE=0.2, BILLING_CRON, HEALTH_CHECK_TOKEN, LOG_LEVEL`

---

## 12. Testing (only what the PDF requires, plus the concurrency proof)

**Unit** (pure domain, no I/O):
- `QuotaAllocator` and `UsagePeriod`:
  - free first;
  - free exhausted → latest bundle;
  - exhausted, expired and inactive bundles skipped;
  - unlimited bundle;
  - none → typed error;
  - UTC month boundary.
- `Subscription` lifecycle: create OK/failed, consume to the limit, set auto-renew, cancel, renew success/failure/expire, month-end clamping.
- Policies and `SignatureVerifier` (tampered fields are rejected).

**Integration** (supertest + real Postgres/Redis from `compose.yaml`):
- **Mock IdP, not bypassed:** a local HTTP server serves a JWKS for a generated ES256 key and mints Supabase-shaped tokens. The app's real verifier fetches from it.
- **Authenticated access:**
  - no token, wrong issuer, wrong audience, expired, `alg:none` → 401;
  - no binding → `KEY_NOT_BOUND`;
  - bad signature → 401; replayed nonce → 401;
  - happy path → 2xx;
  - every route without credentials → 401;
  - user on admin route → 403; user A listing user B's chats → 403 or 404.
- **Quota:** 3 free then 402; **10 parallel requests with 3 free left → exactly 3 × 201**; bundle used after the free quota.
- **Rate limiting:** per-user chat limit → 429 with `Retry-After`; per-IP auth limit → 429.
- **Security middleware:** helmet headers; disallowed CORS origin; 413; 415; unknown field → 400; timeout → 504; error envelope shape.

**Enforcement:** `npm run lint` (typescript-eslint strict + Prettier), `typecheck`, `test`. A GitHub Actions workflow runs lint, typecheck and tests on every push.

---

## 13. Requirements traceability

| PDF requirement | Where |
|-----------------|-------|
| TS, REST, DDD, relational DB | §2, §4 |
| Chat endpoint, mocked OpenAI, stored question/answer/tokens/metadata | §7, §8.3, §8.4 |
| Monthly usage, 3 free, reset on the 1st | A2, `monthly_usage` |
| Multiple bundles, tiers, latest-remaining deduction, typed errors | §5, A1, §7 |
| Simulated latency; atomic, concurrency-safe transactional deduction | §8.3, §8.4 |
| Subscription create, cycles, auto-renew, required fields | §5.2, §7 |
| Auto-renew, random payment failure → inactive, cancellation keeps history | §5.2, §8.5, A4–A6 |
| External OIDC + OAuth, no custom auth; token verification; extra mechanism | §8.2 |
| RBAC at controller + domain level | §8.1, §5 |
| Headers, CORS, size, content type, timeout, rate limits, validation, XSS, injection, mass assignment | §9 |
| Clean Architecture, `chat/` + `subscriptions/` | §4 |
| Strict TS, migrations, env config, ESLint + Prettier | §6, §11, §12 |
| Central errors, structured logs, health, metrics | §7, §10 |
| Unit and integration tests, IdP mocked | §12 |
| Public repo, README, PDF | §15 |

---

## 14. Cut for time (README "future work")

- OAuth PKCE CLI script. GitHub login is configured in Supabase, and `scripts/client.ts` accepts a `--token` from any login flow.
- Reserve/complete flow with PENDING status, refunds and a sweeper, replaced by the flow in §8.3.
- Billing-events table. Payment results are logged instead.
- Logout/revoke-key endpoint, binding expiry, route audit at boot (covered by the test instead), boundaries plugin, Testcontainers.
- GET-by-id endpoints, the plans endpoint, the usage endpoint and separate admin list controllers.
- Dockerfile for the API. `compose.yaml` runs only Postgres and Redis, and the app runs with `npm run start:dev`.
- OpenAPI docs and Prometheus metrics.

## 15. Delivery

- **README:** architecture and layer rules, decisions and interpretations, security model with residual risks, and setup (Supabase: enable asymmetric JWT signing keys, email and GitHub providers; `.env`; `podman compose up` or `docker compose up`; migrations; running the tests; `scripts/client.ts` usage).
- **Repo:** public GitHub repository named after your full name, with the PDF committed at the root.
