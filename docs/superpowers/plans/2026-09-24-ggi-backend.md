# GGI Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure NestJS + Prisma REST backend with a quota-metered mock AI chat module and a subscription-bundle module. It uses Supabase auth with session-bound request signing, and is built within a 24h take-home deadline.

**Architecture:**
- Clean Architecture per module (`auth/`, `chat/`, `subscriptions/`). Pure `domain/{entities,services,policies}`, Nest-aware `application/` use cases, `repositories/` (interface + Prisma implementation), `infrastructure/` adapters and thin `controllers/`.
- A global guard chain handles authentication and authorization: IP rate limit → token + signature → user rate limit → roles. Domain policies re-check authorization inside the use cases.
- Quota deduction happens in one Postgres transaction that locks rows, after the mock AI call.

**Tech Stack:**
- Runtime and framework: Node 22, TypeScript 5 (strict), NestJS 11 (Express 5).
- Data: Prisma 6 + PostgreSQL 16, ioredis + Redis 7.
- Validation, auth and crypto: Zod 4, jose 5, sanitize-html, helmet 8, pino 9, @nestjs/schedule 6.
- Tests: Jest 29 + ts-jest + supertest.

**Spec:** `docs/superpowers/specs/2026-09-24-ggi-backend-design.md` (approved). Read it before starting any task.

## Global Constraints

- TypeScript `strict: true` + `noUncheckedIndexedAccess: true`; no `any` in `src/` (ESLint `strictTypeChecked`).
- `src/**/domain/**` must not import `@nestjs/*`, `@prisma/*`, `express`, `ioredis`, or any `application/`, `repositories/`, `infrastructure/`, `controllers/` path.
- Raw SQL only through the Prisma tagged templates `` $queryRaw`…` `` / `` $executeRaw`…` ``. `$queryRawUnsafe` and `$executeRawUnsafe` are banned.
- Every non-2xx response uses the envelope `{ "error": { "code", "message", "details"?, "requestId" } }`. Codes are exactly the `ErrorCode` union in Task 3.
- Every route requires bearer token + request signature. The only exceptions are `POST /v1/auth/device-keys` (bearer only) and `GET /health` (`X-Health-Token`).
- Free quota: `FREE_MESSAGES_PER_MONTH` (default **3**) per UTC calendar month.
- Tiers: BASIC **10** / PRO **100** / ENTERPRISE **unlimited** messages per billing cycle. Prices in cents: BASIC 999/9990, PRO 2999/29990, ENTERPRISE 19999/199990 (monthly/yearly).
- Bundle selection: the newest usable bundle (`createdAt DESC, id DESC`), used only after the free quota is gone.
- Cancellation takes effect immediately: `endDate = now`, `INACTIVE/CANCELLED`, `autoRenew = false`, `renewalDate = null`.
- Rate limits per 60s window (per IP / per user):

  | Group | Per IP | Per user |
  |-------|--------|----------|
  | auth | 20 | 10 |
  | chat | 60 | 20 |
  | subscriptions | 60 | 30 |
  | admin | 60 | 60 |
  | ops | 30 | 30 |

- JSON body limit **16kb**. Request timeout `REQUEST_TIMEOUT_MS` (default **10000**) → 504 `REQUEST_TIMEOUT`.
- Request signature:
  - canonical string `GGI-SIG-V1\n{METHOD}\n{originalUrl}\n{timestamp}\n{nonce}\n{b64url sha256(rawBody)}\n{b64url sha256(accessToken)}`;
  - ECDSA P-256 / SHA-256, IEEE-P1363 encoding, base64url;
  - skew ±**60s**; nonce TTL **120s**; key-binding window **300s** after the token's latest `amr` timestamp.
- Commits end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These are inputs the spec implies but that the per-feature happy/sad-path tests would not cover. Each one has a pinned test in the task named.

1. **Markup, emoji or only-markup in a chat question.**
   - `<script>…</script>What is 2+2?` is stored as `What is 2+2?`.
   - `<b></b>` is rejected with 400.
   - Emoji text is accepted unchanged.
   - Pinned in Task 12.
2. **A client clock ahead of the server.** A timestamp 120s in the *future* must be rejected (`REQUEST_EXPIRED`), not only stale ones. Pinned in Task 5 (unit) and Task 7 (integration).
3. **A cancelled or expired bundle while the free quota is exhausted.** It must never be charged; the user gets 402 `QUOTA_EXHAUSTED`. Pinned in Task 12.
4. **Malformed list query parameters.** `?limit=abc`, `?limit=0`, `?limit=500` and `?userId=not-a-uuid` get 400 `VALIDATION_FAILED`, never 500. Pinned in Task 9.
5. **Registering a JWK that carries private key material (`d`) or an off-curve point.** Rejected with 400, and no binding is created. Pinned in Task 7.

---

## File Map

```
package.json, tsconfig.json, tsconfig.build.json, nest-cli.json, eslint.config.mjs,
.prettierrc, .prettierignore, .gitignore, .env.example, compose.yaml, docker/postgres-init.sql,
jest.unit.config.js, jest.int.config.js, .github/workflows/ci.yml, README.md
prisma/schema.prisma, prisma/migrations/<ts>_init/migration.sql
src/
  main.ts, bootstrap.ts, app.module.ts
  config/env.ts                               # Zod env schema, loadConfig, APP_CONFIG token
  shared/core.module.ts                       # global APP_CONFIG + CLOCK providers
  shared/domain/errors.ts, actor.ts, clock.ts, admin-policy.ts
  shared/application/transaction-runner.ts    # TransactionRunner port
  shared/prisma/prisma.service.ts, prisma-transaction-runner.ts, prisma.module.ts
  shared/redis/redis.service.ts, redis.module.ts, rate-limiter.ts, rate-limit.config.ts
  shared/logging/request-logger.middleware.ts
  shared/http/error-status.ts, send-error.ts, request-id.middleware.ts, content-type.middleware.ts,
              body-error.middleware.ts, exception.filter.ts, timeout.interceptor.ts,
              zod-validation.pipe.ts, sanitize.ts, request.types.ts, decorators.ts,
              rate-limit.guards.ts, roles.guard.ts, http-platform.module.ts
  auth/domain/ports.ts, entities/device-binding.ts, services/signature.ts, policies/key-binding.policy.ts
  auth/infrastructure/supabase-token-verifier.ts, ecdsa-key-crypto.ts, redis-nonce-store.ts
  auth/repositories/user.repository.ts, prisma-user.repository.ts,
                    device-binding.repository.ts, prisma-device-binding.repository.ts
  auth/application/register-device-key.use-case.ts, get-me.use-case.ts
  auth/guards/auth.guard.ts
  auth/controllers/auth.controller.ts
  auth/auth.module.ts
  subscriptions/domain/value-objects.ts, services/pricing-catalog.ts, services/period-calculator.ts,
                entities/subscription.ts, policies/subscription-access.policy.ts, ports.ts
  subscriptions/repositories/subscription.repository.ts, prisma-subscription.repository.ts
  subscriptions/infrastructure/simulated-payment-gateway.ts, bundle-quota.adapter.ts, billing.scheduler.ts
  subscriptions/application/create-subscription.use-case.ts, list-subscriptions.use-case.ts,
                set-auto-renew.use-case.ts, cancel-subscription.use-case.ts, run-billing-cycle.use-case.ts
  subscriptions/controllers/subscriptions.controller.ts, admin-billing.controller.ts
  subscriptions/subscriptions.module.ts, subscriptions/index.ts
  chat/domain/ports.ts, entities/monthly-usage.ts, entities/chat-message.ts,
       services/usage-period.ts, services/quota-allocator.ts, services/token-estimator.ts,
       policies/bundle-selection.policy.ts, policies/chat-access.policy.ts
  chat/repositories/monthly-usage.repository.ts, prisma-monthly-usage.repository.ts,
                    chat-message.repository.ts, prisma-chat-message.repository.ts
  chat/infrastructure/mock-openai.adapter.ts
  chat/application/ask-question.use-case.ts, list-chats.use-case.ts
  chat/controllers/chat.controller.ts
  chat/chat.module.ts, chat/index.ts
  observability/health.controller.ts, metrics.query.ts, get-metrics.use-case.ts,
                metrics.controller.ts, observability.module.ts
scripts/lib/signer.ts, scripts/client.ts, scripts/promote-admin.ts
test/support/test-env.ts, global-setup.ts, mock-idp.ts, test-app.ts, test-client.ts, fake-payment-gateway.ts
test/unit/**.spec.ts, test/integration/**.int-spec.ts
```

---

### Task 1: Project scaffold, tooling, env config

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.env.example`, `compose.yaml`, `docker/postgres-init.sql`, `jest.unit.config.js`, `jest.int.config.js`, `src/config/env.ts`, `src/shared/core.module.ts`, `src/shared/domain/clock.ts`
- Test: `test/unit/config/env.spec.ts`
- Also commit: `GGI - BACKEND TEST POSTURE (1) (1).pdf`

**Interfaces:**
- Produces:
  - `envSchema`
  - `type AppConfig`
  - `loadConfig(env: NodeJS.ProcessEnv): AppConfig`
  - `APP_CONFIG: symbol`
  - `interface Clock { now(): Date }`, `systemClock: Clock`, `CLOCK: symbol`
  - `CoreModule` (global; provides `APP_CONFIG`, `CLOCK`)
- `AppConfig` keys: `NODE_ENV, PORT, DATABASE_URL, REDIS_URL, SUPABASE_URL, SUPABASE_JWKS_URL?, SUPABASE_JWT_AUDIENCE, CORS_ORIGINS: string[], TRUST_PROXY: boolean, REQUEST_TIMEOUT_MS, FREE_MESSAGES_PER_MONTH, AI_MOCK_MIN_LATENCY_MS, AI_MOCK_MAX_LATENCY_MS, PAYMENT_FAILURE_RATE, BILLING_CRON: string ('' = disabled), HEALTH_CHECK_TOKEN, LOG_LEVEL`.

- [ ] **Step 1: Initialise the package and install dependencies**

Node must be 22: `node --version` should print `v22.x` (installed at `~/.local/node22`, linked in `~/.local/bin`).

```bash
cd /home/opc/golden_gate_task
npm init -y
npm i @nestjs/common@^11 @nestjs/core@^11 @nestjs/platform-express@^11 @nestjs/schedule@^6 cron@^4 \
  @prisma/client@^6 express@^5 helmet@^8 ioredis@^5 jose@^5 pino@^9 reflect-metadata@^0.2 rxjs@^7 \
  sanitize-html@^2 zod@^4
npm i -D @nestjs/cli@^11 @nestjs/testing@^11 prisma@^6 typescript@^5 @types/node@^22 @types/express@^5 \
  @types/sanitize-html@^2 jest@^29 ts-jest@^29 @types/jest@^29 supertest@^7 @types/supertest@^6 \
  eslint@^9 @eslint/js@^9 typescript-eslint@^8 eslint-config-prettier@^10 prettier@^3 tsx@^4 \
  @supabase/supabase-js@^2
```

Then set these fields in `package.json` (keep the generated `dependencies`/`devDependencies`):

```json
{
  "name": "momin-imran-qureshi",
  "version": "1.0.0",
  "private": true,
  "license": "UNLICENSED",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint . --max-warnings 0",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test:unit": "jest -c jest.unit.config.js",
    "test:int": "jest -c jest.int.config.js --runInBand",
    "test": "npm run test:unit && npm run test:int",
    "db:up": "${COMPOSE:-docker compose} -f compose.yaml up -d",
    "db:down": "${COMPOSE:-docker compose} -f compose.yaml down",
    "db:migrate": "prisma migrate deploy",
    "client": "tsx scripts/client.ts",
    "promote-admin": "tsx scripts/promote-admin.ts"
  }
}
```

- [ ] **Step 2: Write TypeScript, Nest CLI, lint and format config**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "outDir": "dist",
    "types": ["node", "jest"]
  },
  "include": ["src", "test", "scripts"]
}
```

`tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "types": ["node"] },
  "include": ["src"]
}
```

`nest-cli.json`:
```json
{ "collection": "@nestjs/schematics", "sourceRoot": "src", "compilerOptions": { "tsConfigPath": "tsconfig.build.json", "deleteOutDir": true } }
```

`eslint.config.mjs`:
```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'eslint.config.mjs', 'jest.*.config.js'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]',
          message: 'Unsafe raw SQL is forbidden; use Prisma tagged templates.',
        },
      ],
    },
  },
  {
    files: ['src/**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', '@prisma/*', 'express', 'ioredis', '**/application/**', '**/repositories/**', '**/infrastructure/**', '**/controllers/**'],
              message: 'Domain layer must stay framework-free.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  prettier,
);
```

`.prettierrc`:
```json
{ "singleQuote": true, "trailingComma": "all", "printWidth": 110 }
```

`.prettierignore`:
```
dist
coverage
node_modules
prisma/migrations
*.pdf
package-lock.json
```

`.gitignore`:
```
node_modules/
dist/
coverage/
.env
.ggi-session.json
```

- [ ] **Step 3: Write the local infrastructure files**

`compose.yaml`:
```yaml
services:
  postgres:
    image: docker.io/library/postgres:16-alpine
    environment:
      POSTGRES_USER: ggi
      POSTGRES_PASSWORD: ggi
      POSTGRES_DB: ggi
    ports: ['127.0.0.1:5432:5432']
    volumes:
      - ./docker/postgres-init.sql:/docker-entrypoint-initdb.d/01-test-db.sql:ro,Z
      - pgdata:/var/lib/postgresql/data
  redis:
    image: docker.io/library/redis:7-alpine
    ports: ['127.0.0.1:6379:6379']
volumes:
  pgdata: {}
```

`docker/postgres-init.sql`:
```sql
CREATE DATABASE ggi_test;
```

`.env.example`:
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://ggi:ggi@127.0.0.1:5432/ggi
REDIS_URL=redis://127.0.0.1:6379/0
# Supabase project URL, e.g. https://abcdefghijklmnop.supabase.co
SUPABASE_URL=
# Optional override; defaults to ${SUPABASE_URL}/auth/v1/.well-known/jwks.json
SUPABASE_JWKS_URL=
SUPABASE_JWT_AUDIENCE=authenticated
CORS_ORIGINS=http://localhost:5173
TRUST_PROXY=false
REQUEST_TIMEOUT_MS=10000
FREE_MESSAGES_PER_MONTH=3
AI_MOCK_MIN_LATENCY_MS=300
AI_MOCK_MAX_LATENCY_MS=1500
PAYMENT_FAILURE_RATE=0.2
# six-field cron (seconds first); empty disables the scheduler
BILLING_CRON=0 * * * * *
# at least 16 chars; generate with: openssl rand -hex 24
HEALTH_CHECK_TOKEN=
LOG_LEVEL=info
# Used only by scripts/client.ts
SUPABASE_ANON_KEY=
API_BASE_URL=http://localhost:3000
```

`jest.unit.config.js`:
```js
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
};
```

`jest.int.config.js`:
```js
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  setupFiles: ['<rootDir>/test/support/test-env.ts'],
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  testTimeout: 30000,
};
```

- [ ] **Step 4: Write the failing env-config test**

`test/unit/config/env.spec.ts`:
```ts
import { loadConfig } from '../../../src/config/env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
  SUPABASE_URL: 'https://abc.supabase.co',
  HEALTH_CHECK_TOKEN: 'a-very-long-health-token',
};

describe('loadConfig', () => {
  it('applies defaults for optional values', () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(3000);
    expect(c.FREE_MESSAGES_PER_MONTH).toBe(3);
    expect(c.REQUEST_TIMEOUT_MS).toBe(10000);
    expect(c.CORS_ORIGINS).toEqual([]);
    expect(c.TRUST_PROXY).toBe(false);
    expect(c.SUPABASE_JWT_AUDIENCE).toBe('authenticated');
    expect(c.SUPABASE_JWKS_URL).toBeUndefined();
  });

  it('parses CSV origins, booleans and numbers', () => {
    const c = loadConfig({ ...base, CORS_ORIGINS: 'https://a.com, https://b.com', TRUST_PROXY: 'true', PORT: '8080' });
    expect(c.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
    expect(c.TRUST_PROXY).toBe(true);
    expect(c.PORT).toBe(8080);
  });

  it('treats an empty SUPABASE_JWKS_URL as unset and an empty BILLING_CRON as disabled', () => {
    const c = loadConfig({ ...base, SUPABASE_JWKS_URL: '', BILLING_CRON: '' });
    expect(c.SUPABASE_JWKS_URL).toBeUndefined();
    expect(c.BILLING_CRON).toBe('');
  });

  it('fails fast listing missing keys without echoing secret values', () => {
    const run = () => loadConfig({ ...base, DATABASE_URL: undefined, HEALTH_CHECK_TOKEN: 'short-secret' });
    expect(run).toThrow(/DATABASE_URL/);
    expect(run).toThrow(/HEALTH_CHECK_TOKEN/);
    expect(run).not.toThrow(/short-secret/);
  });

  it('rejects max latency below min latency', () => {
    expect(() => loadConfig({ ...base, AI_MOCK_MIN_LATENCY_MS: '500', AI_MOCK_MAX_LATENCY_MS: '100' })).toThrow(
      /AI_MOCK_MAX_LATENCY_MS/,
    );
  });
});
```

- [ ] **Step 5: Run the test and confirm it fails**

Run: `npx jest -c jest.unit.config.js test/unit/config`
Expected: FAIL, "Cannot find module '../../../src/config/env'".

- [ ] **Step 6: Implement the config, clock and core module**

`src/config/env.ts`:
```ts
import { z } from 'zod';

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
const bool = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.url().optional());
const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) => z.coerce.number().int().min(min).max(max).default(def);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(3000, 1, 65535),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    SUPABASE_URL: z.url(),
    SUPABASE_JWKS_URL: optionalUrl,
    SUPABASE_JWT_AUDIENCE: z.string().min(1).default('authenticated'),
    CORS_ORIGINS: csv,
    TRUST_PROXY: bool,
    REQUEST_TIMEOUT_MS: int(10000, 100, 60000),
    FREE_MESSAGES_PER_MONTH: int(3),
    AI_MOCK_MIN_LATENCY_MS: int(300),
    AI_MOCK_MAX_LATENCY_MS: int(1500),
    PAYMENT_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.2),
    BILLING_CRON: z.string().default('0 * * * * *'),
    HEALTH_CHECK_TOKEN: z.string().min(16),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .refine((c) => c.AI_MOCK_MAX_LATENCY_MS >= c.AI_MOCK_MIN_LATENCY_MS, {
    message: 'must be >= AI_MOCK_MIN_LATENCY_MS',
    path: ['AI_MOCK_MAX_LATENCY_MS'],
  });

export type AppConfig = z.infer<typeof envSchema>;
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
```

`src/shared/domain/clock.ts`:
```ts
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };
export const CLOCK = Symbol('CLOCK');
```

`src/shared/core.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '../config/env';
import { CLOCK, systemClock } from './domain/clock';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig(process.env) },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [APP_CONFIG, CLOCK],
})
export class CoreModule {}
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `npx jest -c jest.unit.config.js test/unit/config`
Expected: PASS (5 tests). If the "not.toThrow(/short-secret/)" assertion fails, make sure the error lists only paths and messages.

- [ ] **Step 8: Start local Postgres and Redis**

This machine has Podman without a compose provider, so install `podman-compose` once:
```bash
pip3 install --user podman-compose
COMPOSE=podman-compose npm run db:up
podman ps --format '{{.Names}} {{.Status}}'
```
Expected: two containers (postgres, redis) running. On Docker machines, `npm run db:up` is enough.

- [ ] **Step 9: Lint, format and commit**

```bash
npx prettier --write . && npm run lint && npm run typecheck
git add -A
git commit -m "chore: scaffold NestJS project, tooling, env config and local infra

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Check that `git status` shows the PDF committed and `.env` not tracked.

---

### Task 2: Prisma schema, migration, transaction runner

**Files:**
- Create: `prisma/schema.prisma`, `prisma/migrations/<timestamp>_init/migration.sql` (generated, then edited), `src/shared/application/transaction-runner.ts`, `src/shared/prisma/prisma.service.ts`, `src/shared/prisma/prisma-transaction-runner.ts`, `src/shared/prisma/prisma.module.ts`, `test/support/test-env.ts`, `test/support/global-setup.ts`
- Test: `test/integration/shared/transaction-runner.int-spec.ts`

**Interfaces:**
- Consumes: `AppConfig`, `APP_CONFIG` (Task 1).
- Produces:
  - `interface TransactionRunner { run<T>(fn: () => Promise<T>): Promise<T> }`, `TRANSACTION_RUNNER: symbol`
  - `class PrismaService extends PrismaClient`
  - `class PrismaTransactionRunner implements TransactionRunner { run; db(): Db }`, where `type Db = Prisma.TransactionClient | PrismaService`
  - `PrismaModule` (global; exports `PrismaService`, `PrismaTransactionRunner`, `TRANSACTION_RUNNER`)
  - `TEST_ENV` constants
- Prisma models: `User`, `DeviceBinding`, `MonthlyUsage`, `Subscription`, `ChatMessage`, with the enums below.

- [ ] **Step 1: Write the Prisma schema**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN
}

enum Tier {
  BASIC
  PRO
  ENTERPRISE
}

enum BillingCycle {
  MONTHLY
  YEARLY
}

enum SubscriptionStatus {
  ACTIVE
  INACTIVE
}

enum InactiveReason {
  CANCELLED
  PAYMENT_FAILED
  EXPIRED
}

enum QuotaSource {
  FREE
  BUNDLE
}

model User {
  id            String          @id @db.Uuid
  email         String
  role          Role            @default(USER)
  createdAt     DateTime        @default(now()) @map("created_at") @db.Timestamptz(3)
  bindings      DeviceBinding[]
  usage         MonthlyUsage[]
  subscriptions Subscription[]
  chatMessages  ChatMessage[]

  @@map("users")
}

model DeviceBinding {
  id           String   @id @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  sessionId    String   @unique @map("session_id") @db.Uuid
  publicKeyJwk Json     @map("public_key_jwk")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  user         User     @relation(fields: [userId], references: [id])

  @@map("device_bindings")
}

model MonthlyUsage {
  userId        String @map("user_id") @db.Uuid
  period        String @db.Char(7)
  freeUsed      Int    @default(0) @map("free_used")
  freeLimit     Int    @map("free_limit")
  totalMessages Int    @default(0) @map("total_messages")
  user          User   @relation(fields: [userId], references: [id])

  @@id([userId, period])
  @@map("monthly_usage")
}

model Subscription {
  id             String             @id @db.Uuid
  userId         String             @map("user_id") @db.Uuid
  tier           Tier
  billingCycle   BillingCycle       @map("billing_cycle")
  maxMessages    Int?               @map("max_messages")
  usedMessages   Int                @default(0) @map("used_messages")
  priceCents     Int                @map("price_cents")
  autoRenew      Boolean            @map("auto_renew")
  status         SubscriptionStatus
  inactiveReason InactiveReason?    @map("inactive_reason")
  startDate      DateTime           @map("start_date") @db.Timestamptz(3)
  endDate        DateTime           @map("end_date") @db.Timestamptz(3)
  renewalDate    DateTime?          @map("renewal_date") @db.Timestamptz(3)
  cancelledAt    DateTime?          @map("cancelled_at") @db.Timestamptz(3)
  createdAt      DateTime           @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime           @updatedAt @map("updated_at") @db.Timestamptz(3)
  user           User               @relation(fields: [userId], references: [id])
  chatMessages   ChatMessage[]

  @@index([userId, status])
  @@index([status, renewalDate])
  @@map("subscriptions")
}

model ChatMessage {
  id               String        @id @db.Uuid
  userId           String        @map("user_id") @db.Uuid
  question         String
  answer           String
  quotaSource      QuotaSource   @map("quota_source")
  subscriptionId   String?       @map("subscription_id") @db.Uuid
  period           String        @db.Char(7)
  model            String
  promptTokens     Int           @map("prompt_tokens")
  completionTokens Int           @map("completion_tokens")
  totalTokens      Int           @map("total_tokens")
  latencyMs        Int           @map("latency_ms")
  requestId        String        @map("request_id")
  createdAt        DateTime      @map("created_at") @db.Timestamptz(3)
  user             User          @relation(fields: [userId], references: [id])
  subscription     Subscription? @relation(fields: [subscriptionId], references: [id])

  @@index([userId, createdAt(sort: Desc)])
  @@map("chat_messages")
}
```

- [ ] **Step 2: Generate the migration, add CHECK constraints, apply it**

```bash
cp .env.example .env   # then set SUPABASE_URL=https://placeholder.supabase.co and HEALTH_CHECK_TOKEN=$(openssl rand -hex 24) for now
npx prisma migrate dev --name init --create-only
```
Append to the end of the generated `prisma/migrations/*_init/migration.sql`:
```sql
-- Defence-in-depth invariants (see spec §6)
ALTER TABLE "monthly_usage"
  ADD CONSTRAINT "monthly_usage_free_used_check" CHECK ("free_used" >= 0 AND "free_used" <= "free_limit");
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_used_messages_check"
  CHECK ("used_messages" >= 0 AND ("max_messages" IS NULL OR "used_messages" <= "max_messages"));
```
Then run `npx prisma migrate dev` and `npx prisma generate`.
Expected: "Your database is now in sync with your schema."

- [ ] **Step 3: Write the test support files**

`test/support/test-env.ts`:
```ts
export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://ggi:ggi@127.0.0.1:5432/ggi_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1',
  SUPABASE_URL: 'https://mock-project.supabase.co',
  CORS_ORIGINS: 'https://app.example.com',
  HEALTH_CHECK_TOKEN: 'test-health-token-0123456789',
  REQUEST_TIMEOUT_MS: '5000',
  AI_MOCK_MIN_LATENCY_MS: '0',
  AI_MOCK_MAX_LATENCY_MS: '0',
  PAYMENT_FAILURE_RATE: '0',
  BILLING_CRON: '',
  LOG_LEVEL: 'silent',
} as const;

Object.assign(process.env, TEST_ENV);
```

`test/support/global-setup.ts`:
```ts
import { execSync } from 'node:child_process';
import { TEST_ENV } from './test-env';

export default async function globalSetup(): Promise<void> {
  const env = { ...process.env, DATABASE_URL: TEST_ENV.DATABASE_URL };
  for (let attempt = 1; ; attempt++) {
    try {
      execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });
      return;
    } catch (err) {
      if (attempt >= 10) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
```

- [ ] **Step 4: Write the failing transaction-runner test**

`test/integration/shared/transaction-runner.int-spec.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../../src/config/env';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { PrismaTransactionRunner } from '../../../src/shared/prisma/prisma-transaction-runner';

describe('PrismaTransactionRunner', () => {
  const prisma = new PrismaService(loadConfig(process.env));
  const runner = new PrismaTransactionRunner(prisma);

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  it('exposes the ambient transaction client inside run() and the root client outside', async () => {
    expect(runner.db()).toBe(prisma);
    await runner.run(async () => {
      expect(runner.db()).not.toBe(prisma);
    });
  });

  it('rolls back every write when the callback throws', async () => {
    const id = randomUUID();
    await expect(
      runner.run(async () => {
        await runner.db().user.create({ data: { id, email: 'rollback@example.com' } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
  });

  it('joins an outer transaction instead of nesting', async () => {
    const id = randomUUID();
    await expect(
      runner.run(async () => {
        await runner.run(async () => {
          await runner.db().user.create({ data: { id, email: 'nested@example.com' } });
        });
        throw new Error('outer fails');
      }),
    ).rejects.toThrow('outer fails');
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
  });
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `npx jest -c jest.int.config.js test/integration/shared/transaction-runner`
Expected: FAIL, "Cannot find module '../../../src/shared/prisma/prisma.service'".

- [ ] **Step 6: Implement the Prisma layer**

`src/shared/application/transaction-runner.ts`:
```ts
export interface TransactionRunner {
  run<T>(fn: () => Promise<T>): Promise<T>;
}
export const TRANSACTION_RUNNER = Symbol('TRANSACTION_RUNNER');
```

`src/shared/prisma/prisma.service.ts`:
```ts
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../../config/env';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ datasourceUrl: config.DATABASE_URL });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

`src/shared/prisma/prisma-transaction-runner.ts`:
```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TransactionRunner } from '../application/transaction-runner';
import { PrismaService } from './prisma.service';

export type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class PrismaTransactionRunner implements TransactionRunner {
  private readonly als = new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor(private readonly prisma: PrismaService) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.als.getStore()) return fn();
    return this.prisma.$transaction((tx) => this.als.run(tx, fn), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5000,
      timeout: 5000,
    });
  }

  /** The ambient transaction client if inside run(), otherwise the root client. */
  db(): Db {
    return this.als.getStore() ?? this.prisma;
  }
}
```

`src/shared/prisma/prisma.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { TRANSACTION_RUNNER } from '../application/transaction-runner';
import { PrismaService } from './prisma.service';
import { PrismaTransactionRunner } from './prisma-transaction-runner';

@Global()
@Module({
  providers: [PrismaService, PrismaTransactionRunner, { provide: TRANSACTION_RUNNER, useExisting: PrismaTransactionRunner }],
  exports: [PrismaService, PrismaTransactionRunner, TRANSACTION_RUNNER],
})
export class PrismaModule {}
```

- [ ] **Step 7: Run it and confirm it passes**

Run: `npx jest -c jest.int.config.js test/integration/shared/transaction-runner`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
npm run lint && npm run typecheck
git add -A && git commit -m "feat: add Prisma schema, init migration with CHECK constraints, ALS transaction runner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: HTTP platform: errors, security middleware, validation, timeout, logging

**Files:**
- Create: `src/shared/domain/errors.ts`, `src/shared/domain/actor.ts`, `src/shared/domain/admin-policy.ts`, `src/shared/http/error-status.ts`, `src/shared/http/send-error.ts`, `src/shared/http/request.types.ts`, `src/shared/http/request-id.middleware.ts`, `src/shared/http/content-type.middleware.ts`, `src/shared/http/body-error.middleware.ts`, `src/shared/http/exception.filter.ts`, `src/shared/http/timeout.interceptor.ts`, `src/shared/http/zod-validation.pipe.ts`, `src/shared/http/sanitize.ts`, `src/shared/http/http-platform.module.ts`, `src/shared/logging/request-logger.middleware.ts`, `src/bootstrap.ts`, `src/app.module.ts`, `src/main.ts`
- Test: `test/integration/shared/http-platform.int-spec.ts`

**Interfaces:**
- Consumes: `AppConfig`, `APP_CONFIG`, `CoreModule`, `PrismaModule`.
- Produces:
  - `type ErrorCode` (the union below), `class DomainError(code, message, details?)`
  - `type Role = 'USER' | 'ADMIN'`, `interface Actor { userId; role; sessionId }`, `isAdmin(actor)`, `assertAdmin(actor)`
  - `ERROR_STATUS: Record<ErrorCode, number>`
  - `sendError(res, code, message, requestId, details?)`
  - `ZodValidationPipe`, `safeText(max)`, `stripHtml(s)`
  - `configureApp(app, config, opts?: { logStream?: pino.DestinationStream })`
  - `HttpPlatformModule`, `AppModule`
- `Express.Request` augmentation: `requestId: string; rawBody?: Buffer; actor?: Actor; verifiedToken?: VerifiedToken; timedOut?: boolean`. `VerifiedToken` is added in Task 5; until then declare the field as `verifiedToken?: unknown` and tighten it in Task 5.

- [ ] **Step 1: Write the shared domain primitives**

`src/shared/domain/errors.ts`:
```ts
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'SIGNATURE_REQUIRED'
  | 'INVALID_SIGNATURE'
  | 'KEY_NOT_BOUND'
  | 'REQUEST_EXPIRED'
  | 'REPLAY_DETECTED'
  | 'QUOTA_EXHAUSTED'
  | 'PAYMENT_FAILED'
  | 'FORBIDDEN'
  | 'KEY_BINDING_WINDOW_CLOSED'
  | 'NOT_FOUND'
  | 'KEY_ALREADY_BOUND'
  | 'SUBSCRIPTION_NOT_ACTIVE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'REQUEST_TIMEOUT'
  | 'INTERNAL_ERROR';

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
```

`src/shared/domain/actor.ts`:
```ts
export type Role = 'USER' | 'ADMIN';

export interface Actor {
  readonly userId: string;
  readonly role: Role;
  readonly sessionId: string;
}

export const isAdmin = (actor: Actor): boolean => actor.role === 'ADMIN';
```

`src/shared/domain/admin-policy.ts`:
```ts
import { isAdmin, type Actor } from './actor';
import { DomainError } from './errors';

export function assertAdmin(actor: Actor): void {
  if (!isAdmin(actor)) throw new DomainError('FORBIDDEN', 'Admin role required');
}
```

- [ ] **Step 2: Write the HTTP error plumbing**

`src/shared/http/error-status.ts`:
```ts
import type { ErrorCode } from '../domain/errors';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_TOKEN: 401,
  TOKEN_EXPIRED: 401,
  SIGNATURE_REQUIRED: 401,
  INVALID_SIGNATURE: 401,
  KEY_NOT_BOUND: 401,
  REQUEST_EXPIRED: 401,
  REPLAY_DETECTED: 401,
  QUOTA_EXHAUSTED: 402,
  PAYMENT_FAILED: 402,
  FORBIDDEN: 403,
  KEY_BINDING_WINDOW_CLOSED: 403,
  NOT_FOUND: 404,
  KEY_ALREADY_BOUND: 409,
  SUBSCRIPTION_NOT_ACTIVE: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  REQUEST_TIMEOUT: 504,
  INTERNAL_ERROR: 500,
};
```

`src/shared/http/request.types.ts`:
```ts
import type { Actor } from '../domain/actor';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      rawBody?: Buffer;
      actor?: Actor;
      verifiedToken?: unknown;
      timedOut?: boolean;
    }
  }
}

export {};
```

`src/shared/http/send-error.ts`:
```ts
import type { Response } from 'express';
import type { ErrorCode } from '../domain/errors';
import { ERROR_STATUS } from './error-status';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown>; requestId: string | null };
}

export function sendError(
  res: Response,
  code: ErrorCode,
  message: string,
  requestId: string | undefined,
  details?: Record<string, unknown>,
): void {
  const body: ApiErrorBody = {
    error: { code, message, ...(details ? { details } : {}), requestId: requestId ?? null },
  };
  res.status(ERROR_STATUS[code]).json(body);
}
```

`src/shared/http/request-id.middleware.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && UUID_RE.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
```

`src/shared/http/content-type.middleware.ts`:
```ts
import type { NextFunction, Request, Response } from 'express';
import { sendError } from './send-error';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export function contentTypeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const hasBody = Number(req.headers['content-length'] ?? '0') > 0 || req.headers['transfer-encoding'] !== undefined;
  if (!hasBody) return next();
  if (!BODY_METHODS.has(req.method)) {
    return sendError(res, 'VALIDATION_FAILED', `A request body is not allowed for ${req.method}`, req.requestId);
  }
  if (req.is('application/json') !== 'application/json') {
    return sendError(res, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json', req.requestId);
  }
  next();
}
```

`src/shared/http/body-error.middleware.ts`:
```ts
import type { NextFunction, Request, Response } from 'express';
import { sendError } from './send-error';

/** Express error middleware placed right after the JSON parser. */
export function bodyErrorMiddleware(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === 'entity.too.large') return sendError(res, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the size limit', req.requestId);
  if (type === 'entity.parse.failed') return sendError(res, 'VALIDATION_FAILED', 'Malformed JSON body', req.requestId);
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return sendError(res, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported body encoding', req.requestId);
  }
  next(err);
}
```

`src/shared/http/exception.filter.ts`:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, type ErrorCode } from '../domain/errors';
import { sendError } from './send-error';

interface Mapped {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    const mapped = this.map(exception);
    if (mapped.code === 'INTERNAL_ERROR') {
      this.logger.error({ requestId: req.requestId, err: exception instanceof Error ? exception.stack : String(exception) });
    }
    sendError(res, mapped.code, mapped.message, req.requestId, mapped.details);
  }

  private map(exception: unknown): Mapped {
    if (exception instanceof DomainError) {
      return { code: exception.code, message: exception.message, ...(exception.details ? { details: exception.details } : {}) };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 404) return { code: 'NOT_FOUND', message: 'Resource not found' };
      if (status === 413) return { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the size limit' };
      if (status === 400) return { code: 'VALIDATION_FAILED', message: 'Bad request' };
    }
    return { code: 'INTERNAL_ERROR', message: 'Internal server error' };
  }
}
```

- [ ] **Step 3: Write validation, sanitisation and the timeout interceptor**

`src/shared/http/sanitize.ts`:
```ts
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Removes all markup (script/style contents included); text is entity-encoded for safe HTML rendering. */
export function stripHtml(input: string): string {
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} }).trim();
}

export const safeText = (maxLength: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((v) => !CONTROL_CHARS.test(v), 'must not contain control characters')
    .transform(stripHtml)
    .refine((v) => v.length > 0, 'must contain text after removing markup');
```

`src/shared/http/zod-validation.pipe.ts`:
```ts
import { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { DomainError } from '../domain/errors';

export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
```

`src/shared/http/timeout.interceptor.ts`:
```ts
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { DomainError } from '../domain/errors';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      timeout(this.config.REQUEST_TIMEOUT_MS),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          req.timedOut = true;
          return throwError(() => new DomainError('REQUEST_TIMEOUT', 'Request timed out'));
        }
        return throwError(() => err);
      }),
    );
  }
}
```

`src/shared/http/http-platform.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalExceptionFilter } from './exception.filter';
import { TimeoutInterceptor } from './timeout.interceptor';

@Module({
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
  ],
})
export class HttpPlatformModule {}
```

- [ ] **Step 4: Write the request logger, bootstrap, app module and main**

`src/shared/logging/request-logger.middleware.ts`:
```ts
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info(
        {
          requestId: req.requestId,
          userId: req.actor?.userId ?? null,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          statusCode: res.statusCode,
          responseTimeMs: Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100,
        },
        'request completed',
      );
    });
    next();
  };
}
```

`src/bootstrap.ts`:
```ts
import './shared/http/request.types';
import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppConfig } from './config/env';
import { bodyErrorMiddleware } from './shared/http/body-error.middleware';
import { contentTypeMiddleware } from './shared/http/content-type.middleware';
import { requestIdMiddleware } from './shared/http/request-id.middleware';
import { requestLogger } from './shared/logging/request-logger.middleware';

export const BODY_LIMIT = '16kb';
export const SIGNATURE_HEADERS = ['X-Signature', 'X-Signature-Timestamp', 'X-Signature-Nonce'];

export function configureApp(
  app: NestExpressApplication,
  config: AppConfig,
  opts: { logStream?: pino.DestinationStream } = {},
): void {
  const logger = pino(
    {
      level: config.LOG_LEVEL,
      base: undefined,
      redact: { paths: ['req.headers.authorization', 'req.headers["x-signature"]', 'req.headers["x-health-token"]'], censor: '[REDACTED]' },
    },
    opts.logStream,
  );

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY ? 1 : false);
  app.use(requestIdMiddleware);
  app.use(requestLogger(logger));
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({
    origin: (origin, cb) => {
      cb(null, origin !== undefined && config.CORS_ORIGINS.includes(origin));
    },
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', ...SIGNATURE_HEADERS],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    credentials: false,
    maxAge: 600,
  });
  app.use(contentTypeMiddleware);
  app.use(
    express.json({
      limit: BODY_LIMIT,
      strict: true,
      type: 'application/json',
      verify: (req, _res, buf) => {
        (req as unknown as express.Request).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(bodyErrorMiddleware);
}
```

`src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { CoreModule } from './shared/core.module';
import { HttpPlatformModule } from './shared/http/http-platform.module';
import { PrismaModule } from './shared/prisma/prisma.module';

@Module({
  imports: [CoreModule, PrismaModule, HttpPlatformModule],
})
export class AppModule {}
```

`src/main.ts`:
```ts
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig } from './config/env';

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = loadConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.PORT);
  const server = app.getHttpServer() as import('node:http').Server;
  server.requestTimeout = config.REQUEST_TIMEOUT_MS + 5000;
  server.headersTimeout = Math.min(10000, server.requestTimeout);
}

void main();
```

- [ ] **Step 5: Write the failing HTTP platform integration test**

`test/integration/shared/http-platform.int-spec.ts`:
```ts
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { z } from 'zod';
import { configureApp } from '../../../src/bootstrap';
import { APP_CONFIG, loadConfig } from '../../../src/config/env';
import { CoreModule } from '../../../src/shared/core.module';
import { HttpPlatformModule } from '../../../src/shared/http/http-platform.module';
import { safeText } from '../../../src/shared/http/sanitize';
import { ZodValidationPipe } from '../../../src/shared/http/zod-validation.pipe';

const echoSchema = z.strictObject({ name: safeText(50) });

@Controller('test')
class ProbeController {
  @Post('echo')
  echo(@Body(new ZodValidationPipe(echoSchema)) body: z.infer<typeof echoSchema>) {
    return body;
  }
  @Get('slow')
  async slow() {
    await new Promise((r) => setTimeout(r, 500));
    return { ok: true };
  }
  @Get('boom')
  boom(): never {
    throw new Error('secret internal detail');
  }
}

@Module({ imports: [CoreModule, HttpPlatformModule], controllers: [ProbeController] })
class PlatformTestModule {}

describe('HTTP platform', () => {
  let app: NestExpressApplication;
  let http: import('node:http').Server;

  beforeAll(async () => {
    const config = loadConfig({ ...process.env, REQUEST_TIMEOUT_MS: '200' });
    const moduleRef = await Test.createTestingModule({ imports: [PlatformTestModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureApp(app, config);
    await app.init();
    http = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('sets secure headers and hides the framework', async () => {
    const res = await request(http).post('/test/echo').send({ name: 'Bob' });
    expect(res.status).toBe(201);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('generates, echoes or replaces X-Request-Id', async () => {
    const generated = await request(http).get('/test/boom');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const id = '11111111-2222-4333-8444-555555555555';
    const echoed = await request(http).get('/test/boom').set('X-Request-Id', id);
    expect(echoed.headers['x-request-id']).toBe(id);
    expect(echoed.body.error.requestId).toBe(id);
    const replaced = await request(http).get('/test/boom').set('X-Request-Id', '<script>');
    expect(replaced.headers['x-request-id']).not.toBe('<script>');
  });

  it('allows only allow-listed CORS origins', async () => {
    const ok = await request(http)
      .options('/test/echo')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.com');
    const bad = await request(http)
      .options('/test/echo')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects bodies over 16kb with 413', async () => {
    const res = await request(http).post('/test/echo').send({ name: 'x'.repeat(17 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects non-JSON content types with 415', async () => {
    const res = await request(http).post('/test/echo').set('Content-Type', 'text/plain').send('name=Bob');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a body on GET and malformed JSON with 400', async () => {
    const withBody = await request(http).get('/test/boom').set('Content-Type', 'application/json').send('{}');
    expect(withBody.status).toBe(400);
    const malformed = await request(http).post('/test/echo').set('Content-Type', 'application/json').send('{"name":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects unknown fields without echoing submitted values', async () => {
    const res = await request(http).post('/test/echo').send({ name: 'Bob', role: 'ADMIN-SECRET-VALUE' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('ADMIN-SECRET-VALUE');
  });

  it('strips markup and rejects control characters', async () => {
    const stripped = await request(http).post('/test/echo').send({ name: '<b>Bob</b><script>alert(1)</script>' });
    expect(stripped.body).toEqual({ name: 'Bob' });
    const control = await request(http).post('/test/echo').send({ name: 'Bo\u0007b' });
    expect(control.status).toBe(400);
  });

  it('times out slow handlers with 504', async () => {
    const res = await request(http).get('/test/slow');
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('REQUEST_TIMEOUT');
  });

  it('hides internal error details and maps unknown routes to NOT_FOUND', async () => {
    const boom = await request(http).get('/test/boom');
    expect(boom.status).toBe(500);
    expect(boom.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: expect.any(String) },
    });
    const missing = await request(http).get('/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 6: Run it and confirm it fails, then passes**

Run: `npx jest -c jest.int.config.js test/integration/shared/http-platform`
Expected before Steps 1–4 exist: FAIL (module not found). After Steps 1–4: PASS (10 tests).
- If the 500 test logs an error to the console, that's expected from `Logger`.
- If the CORS test fails because Nest's `enableCors` runs after other middleware, move the `enableCors` call to be the first statement after `requestIdMiddleware`.

- [ ] **Step 7: Smoke-test the real bootstrap**

Run: `npm run build && timeout 5 node dist/main.js; echo exit=$?`
Expected: the Nest startup logs, then `exit=124` (killed by timeout, meaning it booted). A config error message instead means `.env` is incomplete.

- [ ] **Step 8: Commit**

```bash
npm run lint && npm run typecheck
git add -A && git commit -m "feat: add HTTP platform (error envelope, helmet, CORS, size/content-type limits, validation, timeout, request logging)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Redis and the rate limiter

**Files:**
- Create: `src/shared/redis/redis.service.ts`, `src/shared/redis/redis.module.ts`, `src/shared/redis/rate-limit.config.ts`, `src/shared/redis/rate-limiter.ts`, `src/shared/http/decorators.ts`, `src/shared/http/rate-limit.guards.ts`
- Modify: `src/app.module.ts` (import `RedisModule`)
- Test: `test/integration/shared/rate-limiter.int-spec.ts`

**Interfaces:**
- Consumes: `APP_CONFIG`, `DomainError`.
- Produces:
  - `RedisService { client: Redis; run<T>(fn: (c: Redis) => Promise<T>): Promise<T> }` (maps Redis failures to `SERVICE_UNAVAILABLE`)
  - `type RateGroup = 'auth' | 'chat' | 'subscriptions' | 'admin' | 'ops'`, `RATE_LIMITS`, `WINDOW_SECONDS = 60`
  - `RateLimiter.hit(key, limit): Promise<{ allowed: boolean; retryAfterSeconds: number }>`
  - Decorators (in `decorators.ts`): `RateLimitGroup(group)`, `RATE_LIMIT_GROUP_KEY`
  - Guards: `IpRateLimitGuard`, `UserRateLimitGuard`. They are registered globally in Task 7.

- [ ] **Step 1: Write the failing limiter test**

`test/integration/shared/rate-limiter.int-spec.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../../src/config/env';
import { DomainError } from '../../../src/shared/domain/errors';
import { RateLimiter } from '../../../src/shared/redis/rate-limiter';
import { RedisService } from '../../../src/shared/redis/redis.service';

describe('RateLimiter', () => {
  const redis = new RedisService(loadConfig(process.env));
  const limiter = new RateLimiter(redis);
  afterAll(() => redis.onModuleDestroy());

  it('allows up to the limit within the window, then blocks with a retry hint', async () => {
    const key = `test:${randomUUID()}`;
    expect((await limiter.hit(key, 2)).allowed).toBe(true);
    expect((await limiter.hit(key, 2)).allowed).toBe(true);
    const third = await limiter.hit(key, 2);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(third.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('keeps separate counters per key', async () => {
    const a = `test:${randomUUID()}`;
    const b = `test:${randomUUID()}`;
    await limiter.hit(a, 1);
    expect((await limiter.hit(a, 1)).allowed).toBe(false);
    expect((await limiter.hit(b, 1)).allowed).toBe(true);
  });

  it('fails closed with SERVICE_UNAVAILABLE when Redis is unreachable', async () => {
    const dead = new RedisService(loadConfig({ ...process.env, REDIS_URL: 'redis://127.0.0.1:1/0' }));
    const deadLimiter = new RateLimiter(dead);
    await expect(deadLimiter.hit('x', 1)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await expect(deadLimiter.hit('x', 1)).rejects.toBeInstanceOf(DomainError);
    dead.client.disconnect();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest -c jest.int.config.js test/integration/shared/rate-limiter`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement Redis, the limiter, decorators and guards**

`src/shared/redis/redis.service.ts`:
```ts
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { DomainError } from '../domain/errors';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 1000 });
    this.client.on('error', () => undefined); // errors surface per command via run()
  }

  async run<T>(fn: (client: Redis) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch {
      throw new DomainError('SERVICE_UNAVAILABLE', 'A required dependency is unavailable');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
```

`src/shared/redis/redis.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { RateLimiter } from './rate-limiter';
import { RedisService } from './redis.service';

@Global()
@Module({ providers: [RedisService, RateLimiter], exports: [RedisService, RateLimiter] })
export class RedisModule {}
```

`src/shared/redis/rate-limit.config.ts`:
```ts
export type RateGroup = 'auth' | 'chat' | 'subscriptions' | 'admin' | 'ops';

export const WINDOW_SECONDS = 60;

export const RATE_LIMITS: Readonly<Record<RateGroup, { perIp: number; perUser: number }>> = {
  auth: { perIp: 20, perUser: 10 },
  chat: { perIp: 60, perUser: 20 },
  subscriptions: { perIp: 60, perUser: 30 },
  admin: { perIp: 60, perUser: 60 },
  ops: { perIp: 30, perUser: 30 },
};
```

`src/shared/redis/rate-limiter.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { WINDOW_SECONDS } from './rate-limit.config';
import { RedisService } from './redis.service';

const FIXED_WINDOW_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
`;

@Injectable()
export class RateLimiter {
  constructor(private readonly redis: RedisService) {}

  async hit(key: string, limit: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const [count, ttl] = (await this.redis.run((c) => c.eval(FIXED_WINDOW_LUA, 1, key, WINDOW_SECONDS))) as [number, number];
    return { allowed: count <= limit, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS };
  }
}
```

`src/shared/http/decorators.ts` (auth-mode and role decorators are added in Task 7):
```ts
import { SetMetadata } from '@nestjs/common';
import type { RateGroup } from '../redis/rate-limit.config';

export const RATE_LIMIT_GROUP_KEY = 'rateLimitGroup';
export const RateLimitGroup = (group: RateGroup) => SetMetadata(RATE_LIMIT_GROUP_KEY, group);
```

`src/shared/http/rate-limit.guards.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { DomainError } from '../domain/errors';
import { RATE_LIMITS, type RateGroup } from '../redis/rate-limit.config';
import { RateLimiter } from '../redis/rate-limiter';
import { RATE_LIMIT_GROUP_KEY } from './decorators';

function groupOf(reflector: Reflector, ctx: ExecutionContext): RateGroup {
  // Routes that forget to declare a group get the strictest limits.
  return reflector.getAllAndOverride<RateGroup | undefined>(RATE_LIMIT_GROUP_KEY, [ctx.getHandler(), ctx.getClass()]) ?? 'auth';
}

async function enforce(limiter: RateLimiter, res: Response, key: string, limit: number): Promise<void> {
  const { allowed, retryAfterSeconds } = await limiter.hit(key, limit);
  if (!allowed) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    throw new DomainError('RATE_LIMITED', 'Too many requests', { retryAfterSeconds });
  }
}

@Injectable()
export class IpRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const group = groupOf(this.reflector, ctx);
    const req = ctx.switchToHttp().getRequest<Request>();
    await enforce(this.limiter, ctx.switchToHttp().getResponse<Response>(), `rl:ip:${group}:${req.ip ?? 'unknown'}`, RATE_LIMITS[group].perIp);
    return true;
  }
}

@Injectable()
export class UserRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const userId = req.actor?.userId ?? (req.verifiedToken as { userId?: string } | undefined)?.userId;
    if (!userId) return true;
    const group = groupOf(this.reflector, ctx);
    await enforce(this.limiter, ctx.switchToHttp().getResponse<Response>(), `rl:user:${group}:${userId}`, RATE_LIMITS[group].perUser);
    return true;
  }
}
```

Add `RedisModule` to the `imports` array of `src/app.module.ts`: `imports: [CoreModule, PrismaModule, RedisModule, HttpPlatformModule]`.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx jest -c jest.int.config.js test/integration/shared/rate-limiter`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint && npm run typecheck
git add -A && git commit -m "feat: add Redis fixed-window rate limiter with per-IP and per-user guards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Auth domain: signature canonicalisation, freshness and key-binding policy

**Files:**
- Create: `src/auth/domain/ports.ts`, `src/auth/domain/entities/device-binding.ts`, `src/auth/domain/services/signature.ts`, `src/auth/domain/policies/key-binding.policy.ts`
- Modify: `src/shared/http/request.types.ts` (type `verifiedToken?: VerifiedToken`)
- Test: `test/unit/auth/signature.spec.ts`, `test/unit/auth/key-binding.policy.spec.ts`

**Interfaces:**
- Consumes: `DomainError`, `Role`.
- Produces:
  - `interface PublicJwk { kty: 'EC'; crv: 'P-256'; x: string; y: string }`
  - `interface VerifiedToken { userId: string; email: string; sessionId: string; authenticatedAt: Date | null }`
  - `interface TokenVerifier { verify(token: string): Promise<VerifiedToken> }`, `TOKEN_VERIFIER`
  - `interface KeyCrypto { verify(key: PublicJwk, data: string, signatureB64Url: string): boolean; isValidPublicKey(key: PublicJwk): boolean }`, `KEY_CRYPTO`
  - `interface NonceStore { claim(sessionId: string, nonce: string): Promise<boolean> }`, `NONCE_STORE`
  - `interface DeviceBinding { id; userId; sessionId; publicKeyJwk: PublicJwk; createdAt: Date }`, `interface BoundSession { userId: string; role: Role; publicKeyJwk: PublicJwk }`
  - `SIGNATURE_VERSION`, `interface SignedRequestParts { method; url; timestamp; nonce; bodySha256; tokenSha256 }`, `canonicalString(parts): string`
  - `class SignatureVerifier(crypto: KeyCrypto, maxSkewSeconds = 60)` with `assertFresh(timestamp: string, now: Date): void` and `assertValid(parts, signature, key): void`
  - `class KeyBindingPolicy(windowSeconds = 300)` with `assertCanBind(input: { authenticatedAt: Date | null; alreadyBound: boolean }, now: Date): void`

- [ ] **Step 1: Write the failing unit tests**

`test/unit/auth/signature.spec.ts`:
```ts
import { canonicalString, SignatureVerifier, type SignedRequestParts } from '../../../src/auth/domain/services/signature';
import type { KeyCrypto, PublicJwk } from '../../../src/auth/domain/ports';

const key: PublicJwk = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' };
const parts: SignedRequestParts = {
  method: 'post',
  url: '/v1/chat/messages?x=1',
  timestamp: '1790000000',
  nonce: 'nonce-abcdefghijklmnopqrstu',
  bodySha256: 'bodyhash',
  tokenSha256: 'tokenhash',
};
// Fake crypto: a "signature" is valid iff it equals the canonical string reversed.
const fakeCrypto: KeyCrypto = {
  verify: (_k, data, sig) => sig === [...data].reverse().join(''),
  isValidPublicKey: () => true,
};
const now = new Date(1790000000 * 1000);

describe('canonicalString', () => {
  it('joins the version, upper-cased method and all parts with newlines', () => {
    expect(canonicalString(parts)).toBe(
      'GGI-SIG-V1\nPOST\n/v1/chat/messages?x=1\n1790000000\nnonce-abcdefghijklmnopqrstu\nbodyhash\ntokenhash',
    );
  });
});

describe('SignatureVerifier', () => {
  const verifier = new SignatureVerifier(fakeCrypto, 60);

  it('accepts timestamps within ±60s', () => {
    expect(() => verifier.assertFresh('1790000060', now)).not.toThrow();
    expect(() => verifier.assertFresh('1789999940', now)).not.toThrow();
  });

  it('rejects stale timestamps', () => {
    expect(() => verifier.assertFresh('1789999939', now)).toThrow(expect.objectContaining({ code: 'REQUEST_EXPIRED' }));
  });

  it('rejects timestamps from a client clock running ahead (Review Focus #2)', () => {
    expect(() => verifier.assertFresh('1790000120', now)).toThrow(expect.objectContaining({ code: 'REQUEST_EXPIRED' }));
  });

  it('rejects non-integer timestamps as a missing signature', () => {
    expect(() => verifier.assertFresh('17900.5', now)).toThrow(expect.objectContaining({ code: 'SIGNATURE_REQUIRED' }));
  });

  it('accepts a valid signature and rejects any tampered part', () => {
    const good = [...canonicalString(parts)].reverse().join('');
    expect(() => verifier.assertValid(parts, good, key)).not.toThrow();
    for (const field of Object.keys(parts) as (keyof SignedRequestParts)[]) {
      const tampered = { ...parts, [field]: `${parts[field]}!` };
      expect(() => verifier.assertValid(tampered, good, key)).toThrow(expect.objectContaining({ code: 'INVALID_SIGNATURE' }));
    }
  });
});
```

`test/unit/auth/key-binding.policy.spec.ts`:
```ts
import { KeyBindingPolicy } from '../../../src/auth/domain/policies/key-binding.policy';

describe('KeyBindingPolicy', () => {
  const policy = new KeyBindingPolicy(300);
  const now = new Date('2026-09-24T12:00:00Z');

  it('allows binding within 300s of authentication', () => {
    expect(() => policy.assertCanBind({ authenticatedAt: new Date('2026-09-24T11:55:01Z'), alreadyBound: false }, now)).not.toThrow();
  });

  it('rejects a second binding for the same session', () => {
    expect(() => policy.assertCanBind({ authenticatedAt: now, alreadyBound: true }, now)).toThrow(
      expect.objectContaining({ code: 'KEY_ALREADY_BOUND' }),
    );
  });

  it('rejects binding after the window or without an authentication time', () => {
    expect(() => policy.assertCanBind({ authenticatedAt: new Date('2026-09-24T11:54:59Z'), alreadyBound: false }, now)).toThrow(
      expect.objectContaining({ code: 'KEY_BINDING_WINDOW_CLOSED' }),
    );
    expect(() => policy.assertCanBind({ authenticatedAt: null, alreadyBound: false }, now)).toThrow(
      expect.objectContaining({ code: 'KEY_BINDING_WINDOW_CLOSED' }),
    );
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx jest -c jest.unit.config.js test/unit/auth`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the auth domain**

`src/auth/domain/ports.ts`:
```ts
export interface PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface VerifiedToken {
  userId: string;
  email: string;
  sessionId: string;
  /** Latest `amr[].timestamp`: when the user actually authenticated. */
  authenticatedAt: Date | null;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export interface KeyCrypto {
  verify(key: PublicJwk, data: string, signatureB64Url: string): boolean;
  isValidPublicKey(key: PublicJwk): boolean;
}
export const KEY_CRYPTO = Symbol('KEY_CRYPTO');

export interface NonceStore {
  /** Returns true if the nonce was unused (and is now consumed). */
  claim(sessionId: string, nonce: string): Promise<boolean>;
}
export const NONCE_STORE = Symbol('NONCE_STORE');
```

`src/auth/domain/entities/device-binding.ts`:
```ts
import type { Role } from '../../../shared/domain/actor';
import type { PublicJwk } from '../ports';

export interface DeviceBinding {
  id: string;
  userId: string;
  sessionId: string;
  publicKeyJwk: PublicJwk;
  createdAt: Date;
}

export interface BoundSession {
  userId: string;
  role: Role;
  publicKeyJwk: PublicJwk;
}
```

`src/auth/domain/services/signature.ts`:
```ts
import { DomainError } from '../../../shared/domain/errors';
import type { KeyCrypto, PublicJwk } from '../ports';

export const SIGNATURE_VERSION = 'GGI-SIG-V1';

export interface SignedRequestParts {
  method: string;
  url: string;
  timestamp: string;
  nonce: string;
  bodySha256: string;
  tokenSha256: string;
}

export function canonicalString(p: SignedRequestParts): string {
  return [SIGNATURE_VERSION, p.method.toUpperCase(), p.url, p.timestamp, p.nonce, p.bodySha256, p.tokenSha256].join('\n');
}

export class SignatureVerifier {
  constructor(
    private readonly crypto: KeyCrypto,
    private readonly maxSkewSeconds = 60,
  ) {}

  assertFresh(timestamp: string, now: Date): void {
    const ts = Number(timestamp);
    if (!Number.isSafeInteger(ts)) throw new DomainError('SIGNATURE_REQUIRED', 'Signature timestamp is malformed');
    if (Math.abs(now.getTime() / 1000 - ts) > this.maxSkewSeconds) {
      throw new DomainError('REQUEST_EXPIRED', 'Request timestamp is outside the allowed window');
    }
  }

  assertValid(parts: SignedRequestParts, signature: string, key: PublicJwk): void {
    if (!this.crypto.verify(key, canonicalString(parts), signature)) {
      throw new DomainError('INVALID_SIGNATURE', 'Request signature is invalid');
    }
  }
}
```

`src/auth/domain/policies/key-binding.policy.ts`:
```ts
import { DomainError } from '../../../shared/domain/errors';

export class KeyBindingPolicy {
  constructor(private readonly windowSeconds = 300) {}

  assertCanBind(input: { authenticatedAt: Date | null; alreadyBound: boolean }, now: Date): void {
    if (input.alreadyBound) throw new DomainError('KEY_ALREADY_BOUND', 'A key is already bound to this session');
    const auth = input.authenticatedAt;
    if (!auth || now.getTime() - auth.getTime() > this.windowSeconds * 1000) {
      throw new DomainError('KEY_BINDING_WINDOW_CLOSED', 'Key binding window has closed; sign in again');
    }
  }
}
```

In `src/shared/http/request.types.ts`, add `import type { VerifiedToken } from '../../auth/domain/ports';` and change the field to `verifiedToken?: VerifiedToken;`. In `rate-limit.guards.ts`, simplify the lookup to `req.actor?.userId ?? req.verifiedToken?.userId`.

- [ ] **Step 4: Run them and confirm they pass**

Run: `npx jest -c jest.unit.config.js test/unit/auth`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint && npm run typecheck
git add -A && git commit -m "feat(auth): add signature canonicalisation, freshness check and key-binding policy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Token verification, ECDSA crypto, nonce store, mock IdP

**Files:**
- Create: `src/auth/infrastructure/supabase-token-verifier.ts`, `src/auth/infrastructure/ecdsa-key-crypto.ts`, `src/auth/infrastructure/redis-nonce-store.ts`, `scripts/lib/signer.ts`, `test/support/mock-idp.ts`
- Test: `test/unit/auth/ecdsa-key-crypto.spec.ts`, `test/integration/auth/token-verifier.int-spec.ts`

**Interfaces:**
- Consumes: `TokenVerifier`, `VerifiedToken`, `KeyCrypto`, `PublicJwk`, `NonceStore`, `canonicalString`, `RedisService`, `AppConfig`.
- Produces:
  - `SupabaseTokenVerifier implements TokenVerifier`
  - `EcdsaKeyCrypto implements KeyCrypto`
  - `RedisNonceStore implements NonceStore` (TTL 120s)
  - `sha256b64url(data)` and `signRequest({ method, url, rawBody, token, privateKey, timestamp?, nonce? }): Record<string,string>` (in `scripts/lib/signer.ts`)
  - `MockIdp` with:
    - `MockIdp.start(): Promise<MockIdp>`
    - `jwksUrl`, `issuer`
    - `token(opts?: TokenOptions): Promise<string>`, where `TokenOptions = { userId?; sessionId?; email?; expiresInSeconds?; issuer?; audience?; authenticatedAt?: Date; isAnonymous?: boolean; omitSessionId?: boolean; foreignKey?: boolean }`
    - `stop()`

- [ ] **Step 1: Write the signer (shared by tests and the CLI)**

`scripts/lib/signer.ts`:
```ts
import { createHash, randomBytes, sign, type KeyObject } from 'node:crypto';
import { canonicalString } from '../../src/auth/domain/services/signature';

export const sha256b64url = (data: string | Buffer): string => createHash('sha256').update(data).digest('base64url');

export function signRequest(input: {
  method: string;
  url: string;
  rawBody: string;
  token: string;
  privateKey: KeyObject;
  timestamp?: number;
  nonce?: string;
}): Record<string, string> {
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? randomBytes(16).toString('base64url');
  const data = canonicalString({
    method: input.method,
    url: input.url,
    timestamp,
    nonce,
    bodySha256: sha256b64url(input.rawBody),
    tokenSha256: sha256b64url(input.token),
  });
  const signature = sign('sha256', Buffer.from(data), { key: input.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return {
    Authorization: `Bearer ${input.token}`,
    'X-Signature-Timestamp': timestamp,
    'X-Signature-Nonce': nonce,
    'X-Signature': signature,
  };
}
```

- [ ] **Step 2: Write the failing ECDSA unit test**

`test/unit/auth/ecdsa-key-crypto.spec.ts`:
```ts
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { EcdsaKeyCrypto } from '../../../src/auth/infrastructure/ecdsa-key-crypto';
import type { PublicJwk } from '../../../src/auth/domain/ports';

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, jwk: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! } as PublicJwk };
}

describe('EcdsaKeyCrypto', () => {
  const crypto = new EcdsaKeyCrypto();

  it('verifies an IEEE-P1363 P-256 signature and rejects a different key or data', () => {
    const a = keyPair();
    const b = keyPair();
    const sig = sign('sha256', Buffer.from('hello'), { key: a.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    expect(crypto.verify(a.jwk, 'hello', sig)).toBe(true);
    expect(crypto.verify(a.jwk, 'hellO', sig)).toBe(false);
    expect(crypto.verify(b.jwk, 'hello', sig)).toBe(false);
    expect(crypto.verify(a.jwk, 'hello', 'not-a-signature')).toBe(false);
  });

  it('accepts real P-256 public keys and rejects off-curve points (Review Focus #5)', () => {
    expect(crypto.isValidPublicKey(keyPair().jwk)).toBe(true);
    const offCurve: PublicJwk = { kty: 'EC', crv: 'P-256', x: randomBytes(32).toString('base64url'), y: randomBytes(32).toString('base64url') };
    expect(crypto.isValidPublicKey(offCurve)).toBe(false);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx jest -c jest.unit.config.js test/unit/auth/ecdsa`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement ECDSA crypto and the nonce store**

`src/auth/infrastructure/ecdsa-key-crypto.ts`:
```ts
import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { KeyCrypto, PublicJwk } from '../domain/ports';

@Injectable()
export class EcdsaKeyCrypto implements KeyCrypto {
  verify(key: PublicJwk, data: string, signatureB64Url: string): boolean {
    try {
      const publicKey = createPublicKey({ key: key as JsonWebKey, format: 'jwk' });
      return verify('sha256', Buffer.from(data), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signatureB64Url, 'base64url'));
    } catch {
      return false;
    }
  }

  isValidPublicKey(key: PublicJwk): boolean {
    try {
      createPublicKey({ key: key as JsonWebKey, format: 'jwk' });
      return true;
    } catch {
      return false;
    }
  }
}
```

`src/auth/infrastructure/redis-nonce-store.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { RedisService } from '../../shared/redis/redis.service';
import type { NonceStore } from '../domain/ports';

export const NONCE_TTL_SECONDS = 120;

@Injectable()
export class RedisNonceStore implements NonceStore {
  constructor(private readonly redis: RedisService) {}

  async claim(sessionId: string, nonce: string): Promise<boolean> {
    const result = await this.redis.run((c) => c.set(`nonce:${sessionId}:${nonce}`, '1', 'EX', NONCE_TTL_SECONDS, 'NX'));
    return result === 'OK';
  }
}
```

Run: `npx jest -c jest.unit.config.js test/unit/auth/ecdsa`. Expected: PASS (2 tests).

- [ ] **Step 5: Write the mock IdP**

`test/support/mock-idp.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { TEST_ENV } from './test-env';

export interface TokenOptions {
  userId?: string;
  sessionId?: string;
  email?: string;
  expiresInSeconds?: number;
  issuer?: string;
  audience?: string;
  authenticatedAt?: Date;
  isAnonymous?: boolean;
  omitSessionId?: boolean;
  foreignKey?: boolean;
}

/** A real HTTP JWKS endpoint + ES256 signer that mints Supabase-shaped access tokens. */
export class MockIdp {
  readonly issuer = `${TEST_ENV.SUPABASE_URL}/auth/v1`;
  private port = 0;

  private constructor(
    private readonly server: Server,
    private readonly privateKey: KeyLike,
    private readonly foreignKey: KeyLike,
  ) {}

  static async start(): Promise<MockIdp> {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const foreign = await generateKeyPair('ES256');
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'mock-key-1', alg: 'ES256', use: 'sig' };
    const server = createServer((req, res) => {
      if (req.url === '/jwks.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const idp = new MockIdp(server, privateKey, foreign.privateKey);
    idp.port = (server.address() as AddressInfo).port;
    return idp;
  }

  get jwksUrl(): string {
    return `http://127.0.0.1:${this.port}/jwks.json`;
  }

  async token(opts: TokenOptions = {}): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    const authAt = Math.floor((opts.authenticatedAt ?? new Date()).getTime() / 1000);
    const claims: Record<string, unknown> = {
      email: opts.email ?? 'user@example.com',
      role: 'authenticated',
      aal: 'aal1',
      amr: [{ method: 'password', timestamp: authAt }],
      is_anonymous: opts.isAnonymous ?? false,
    };
    if (!opts.omitSessionId) claims.session_id = opts.sessionId ?? randomUUID();
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: opts.foreignKey ? 'foreign-key' : 'mock-key-1', typ: 'JWT' })
      .setSubject(opts.userId ?? randomUUID())
      .setIssuer(opts.issuer ?? this.issuer)
      .setAudience(opts.audience ?? 'authenticated')
      .setIssuedAt(nowSec - 1)
      .setExpirationTime(nowSec + (opts.expiresInSeconds ?? 3600))
      .sign(opts.foreignKey ? this.foreignKey : this.privateKey);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
```

- [ ] **Step 6: Write the failing token-verifier integration test**

`test/integration/auth/token-verifier.int-spec.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { SupabaseTokenVerifier } from '../../../src/auth/infrastructure/supabase-token-verifier';
import { loadConfig } from '../../../src/config/env';
import { MockIdp } from '../../support/mock-idp';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('SupabaseTokenVerifier (against a real JWKS endpoint)', () => {
  let idp: MockIdp;
  let verifier: SupabaseTokenVerifier;

  beforeAll(async () => {
    idp = await MockIdp.start();
    verifier = new SupabaseTokenVerifier(loadConfig({ ...process.env, SUPABASE_JWKS_URL: idp.jwksUrl }));
  });
  afterAll(() => idp.stop());

  it('returns identity facts for a valid token', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const authAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const v = await verifier.verify(await idp.token({ userId, sessionId, email: 'a@b.co', authenticatedAt: authAt }));
    expect(v).toEqual({ userId, sessionId, email: 'a@b.co', authenticatedAt: authAt });
  });

  it.each([
    ['wrong issuer', { issuer: 'https://evil.supabase.co/auth/v1' }],
    ['wrong audience', { audience: 'service_role' }],
    ['unknown signing key', { foreignKey: true }],
    ['anonymous user', { isAnonymous: true }],
    ['missing session_id', { omitSessionId: true }],
  ])('rejects %s with INVALID_TOKEN', async (_name, opts) => {
    await expect(verifier.verify(await idp.token(opts))).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('rejects expired tokens with TOKEN_EXPIRED', async () => {
    await expect(verifier.verify(await idp.token({ expiresInSeconds: -60 }))).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('rejects alg:none and garbage with INVALID_TOKEN', async () => {
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: randomUUID(), session_id: randomUUID() })}.`;
    await expect(verifier.verify(none)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    await expect(verifier.verify('not.a.jwt')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `npx jest -c jest.int.config.js test/integration/auth/token-verifier`
Expected: FAIL (module not found).

- [ ] **Step 8: Implement the Supabase token verifier**

`src/auth/infrastructure/supabase-token-verifier.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { DomainError } from '../../shared/domain/errors';
import type { TokenVerifier, VerifiedToken } from '../domain/ports';

const claimsSchema = z.object({
  sub: z.uuid(),
  session_id: z.uuid(),
  email: z.string().optional(),
  is_anonymous: z.boolean().optional(),
  amr: z.array(z.object({ method: z.string(), timestamp: z.number() })).optional(),
});

@Injectable()
export class SupabaseTokenVerifier implements TokenVerifier {
  private readonly issuer: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.issuer = `${config.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;
    const jwksUrl = config.SUPABASE_JWKS_URL ?? `${this.issuer}/.well-known/jwks.json`;
    this.jwks = createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 30_000, timeoutDuration: 3_000 });
  }

  async verify(token: string): Promise<VerifiedToken> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.config.SUPABASE_JWT_AUDIENCE,
        algorithms: ['ES256', 'RS256'],
        clockTolerance: 5,
        requiredClaims: ['sub', 'exp', 'iat'],
      }));
    } catch (err) {
      if (err instanceof errors.JWTExpired) throw new DomainError('TOKEN_EXPIRED', 'Access token has expired');
      if (err instanceof errors.JWKSTimeout) throw new DomainError('SERVICE_UNAVAILABLE', 'Identity provider unavailable');
      if (err instanceof errors.JOSEError) throw new DomainError('INVALID_TOKEN', 'Access token is invalid');
      throw new DomainError('SERVICE_UNAVAILABLE', 'Identity provider unavailable');
    }
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success || claims.data.is_anonymous === true) throw new DomainError('INVALID_TOKEN', 'Access token is invalid');
    const times = (claims.data.amr ?? []).map((a) => a.timestamp);
    return {
      userId: claims.data.sub,
      email: claims.data.email ?? '',
      sessionId: claims.data.session_id,
      authenticatedAt: times.length > 0 ? new Date(Math.max(...times) * 1000) : null,
    };
  }
}
```
Note: if jose rejects `not.a.jwt` with a non-JOSE error, it maps to `SERVICE_UNAVAILABLE` and the test fails. In that case, add a `/^[\w-]+\.[\w-]+\.[\w-]*$/` shape check before `jwtVerify` that throws `INVALID_TOKEN`.

- [ ] **Step 9: Run it and confirm it passes**

Run: `npx jest -c jest.int.config.js test/integration/auth/token-verifier`
Expected: PASS (8 tests).

- [ ] **Step 10: Commit**

```bash
npm run lint && npm run typecheck
git add -A && git commit -m "feat(auth): verify Supabase JWTs via JWKS, add ECDSA key crypto, nonce store and mock IdP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Device-key registration, auth guard, RBAC guard, /auth/me

**Files:**
- Create: `src/auth/repositories/user.repository.ts`, `src/auth/repositories/prisma-user.repository.ts`, `src/auth/repositories/device-binding.repository.ts`, `src/auth/repositories/prisma-device-binding.repository.ts`, `src/auth/application/register-device-key.use-case.ts`, `src/auth/application/get-me.use-case.ts`, `src/auth/guards/auth.guard.ts`, `src/shared/http/roles.guard.ts`, `src/auth/controllers/auth.controller.ts`, `src/auth/auth.module.ts`, `test/support/test-app.ts`, `test/support/test-client.ts`
- Modify: `src/shared/http/decorators.ts` (add auth-mode, roles and param decorators), `src/app.module.ts` (import `AuthModule`)
- Test: `test/integration/auth/auth-access.int-spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–6.
- Produces:
  - Decorators: `Roles(...roles: Role[])`, `ROLES_KEY`, `BearerOnly()`, `HealthProbe()`, `AUTH_MODE_KEY`, `type AuthMode = 'signed' | 'bearer-only' | 'health-probe'`, `CurrentActor()`, `CurrentToken()`
  - `UserRepository { upsert({id,email}): Promise<void>; findById(id): Promise<{id;email;role:Role}|null> }`, `USER_REPOSITORY`
  - `DeviceBindingRepository { findBoundSession(sessionId): Promise<BoundSession|null>; existsForSession(sessionId): Promise<boolean>; create(b: DeviceBinding): Promise<void> }`, `DEVICE_BINDING_REPOSITORY`
  - `AuthGuard`, `RolesGuard`
  - Test support:
    - `createTestApp(opts?: { env?: Record<string,string>; logStream?: pino.DestinationStream }): Promise<TestContext>`, `closeTestApp(ctx)`, `resetState(ctx)`
    - `TestContext { app; http; prisma: PrismaService; redis: RedisService; idp: MockIdp; config: AppConfig }`
    - `TestClient.register(ctx, opts?: { role?: Role; userId?: string }): Promise<TestClient>`
    - `TestClient` members: `userId, email, sessionId, token, publicKeyJwk, headers(method, url, rawBody?, overrides?)`, and `get(url)`, `post(url, body?)`, `patch(url, body)`, which return a supertest `Test`
- Global guard order (registered in `AuthModule`): `IpRateLimitGuard → AuthGuard → UserRateLimitGuard → RolesGuard`.

- [ ] **Step 1: Add the auth-mode, role and parameter decorators**

Append to `src/shared/http/decorators.ts`:
```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { VerifiedToken } from '../../auth/domain/ports';
import type { Actor, Role } from '../domain/actor';
import { DomainError } from '../domain/errors';

export type AuthMode = 'signed' | 'bearer-only' | 'health-probe';
export const AUTH_MODE_KEY = 'authMode';
/** Bearer token only; used solely by device-key registration (bootstrap step). */
export const BearerOnly = () => SetMetadata(AUTH_MODE_KEY, 'bearer-only' satisfies AuthMode);
/** X-Health-Token only; used solely by /health. */
export const HealthProbe = () => SetMetadata(AUTH_MODE_KEY, 'health-probe' satisfies AuthMode);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.actor) throw new DomainError('UNAUTHENTICATED', 'Authentication required');
  return req.actor;
});

export const CurrentToken = createParamDecorator((_: unknown, ctx: ExecutionContext): VerifiedToken => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.verifiedToken) throw new DomainError('UNAUTHENTICATED', 'Authentication required');
  return req.verifiedToken;
});
```
(Merge the `@nestjs/common` import with the existing `SetMetadata` import.)

- [ ] **Step 2: Write the repositories**

`src/auth/repositories/user.repository.ts`:
```ts
import type { Role } from '../../shared/domain/actor';

export interface UserRecord {
  id: string;
  email: string;
  role: Role;
}

export interface UserRepository {
  upsert(user: { id: string; email: string }): Promise<void>;
  findById(id: string): Promise<UserRecord | null>;
}
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
```

`src/auth/repositories/prisma-user.repository.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PrismaTransactionRunner } from '../../shared/prisma/prisma-transaction-runner';
import type { UserRecord, UserRepository } from './user.repository';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly tx: PrismaTransactionRunner) {}

  async upsert(user: { id: string; email: string }): Promise<void> {
    await this.tx.db().user.upsert({ where: { id: user.id }, create: user, update: { email: user.email } });
  }

  findById(id: string): Promise<UserRecord | null> {
    return this.tx.db().user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
  }
}
```

`src/auth/repositories/device-binding.repository.ts`:
```ts
import type { BoundSession, DeviceBinding } from '../domain/entities/device-binding';

export interface DeviceBindingRepository {
  findBoundSession(sessionId: string): Promise<BoundSession | null>;
  existsForSession(sessionId: string): Promise<boolean>;
  /** Throws DomainError KEY_ALREADY_BOUND if the session already has a binding. */
  create(binding: DeviceBinding): Promise<void>;
}
export const DEVICE_BINDING_REPOSITORY = Symbol('DEVICE_BINDING_REPOSITORY');
```

`src/auth/repositories/prisma-device-binding.repository.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../../shared/domain/errors';
import { PrismaTransactionRunner } from '../../shared/prisma/prisma-transaction-runner';
import type { BoundSession, DeviceBinding } from '../domain/entities/device-binding';
import type { PublicJwk } from '../domain/ports';
import type { DeviceBindingRepository } from './device-binding.repository';

@Injectable()
export class PrismaDeviceBindingRepository implements DeviceBindingRepository {
  constructor(private readonly tx: PrismaTransactionRunner) {}

  async findBoundSession(sessionId: string): Promise<BoundSession | null> {
    const row = await this.tx.db().deviceBinding.findUnique({
      where: { sessionId },
      select: { userId: true, publicKeyJwk: true, user: { select: { role: true } } },
    });
    return row ? { userId: row.userId, role: row.user.role, publicKeyJwk: row.publicKeyJwk as unknown as PublicJwk } : null;
  }

  async existsForSession(sessionId: string): Promise<boolean> {
    return (await this.tx.db().deviceBinding.count({ where: { sessionId } })) > 0;
  }

  async create(b: DeviceBinding): Promise<void> {
    try {
      await this.tx.db().deviceBinding.create({
        data: { id: b.id, userId: b.userId, sessionId: b.sessionId, publicKeyJwk: { ...b.publicKeyJwk }, createdAt: b.createdAt },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new DomainError('KEY_ALREADY_BOUND', 'A key is already bound to this session');
      }
      throw err;
    }
  }
}
```

- [ ] **Step 3: Write the use cases**

`src/auth/application/register-device-key.use-case.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../shared/application/transaction-runner';
import { CLOCK, type Clock } from '../../shared/domain/clock';
import { DomainError } from '../../shared/domain/errors';
import { KeyBindingPolicy } from '../domain/policies/key-binding.policy';
import { KEY_CRYPTO, type KeyCrypto, type PublicJwk, type VerifiedToken } from '../domain/ports';
import { DEVICE_BINDING_REPOSITORY, type DeviceBindingRepository } from '../repositories/device-binding.repository';
import { USER_REPOSITORY, type UserRepository } from '../repositories/user.repository';

@Injectable()
export class RegisterDeviceKeyUseCase {
  private readonly policy = new KeyBindingPolicy(300);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(DEVICE_BINDING_REPOSITORY) private readonly bindings: DeviceBindingRepository,
    @Inject(KEY_CRYPTO) private readonly crypto: KeyCrypto,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(token: VerifiedToken, publicKey: PublicJwk): Promise<{ bindingId: string }> {
    if (!this.crypto.isValidPublicKey(publicKey)) {
      throw new DomainError('VALIDATION_FAILED', 'publicKey is not a valid P-256 public key');
    }
    const now = this.clock.now();
    const alreadyBound = await this.bindings.existsForSession(token.sessionId);
    this.policy.assertCanBind({ authenticatedAt: token.authenticatedAt, alreadyBound }, now);
    const bindingId = randomUUID();
    await this.tx.run(async () => {
      await this.users.upsert({ id: token.userId, email: token.email });
      await this.bindings.create({ id: bindingId, userId: token.userId, sessionId: token.sessionId, publicKeyJwk: publicKey, createdAt: now });
    });
    return { bindingId };
  }
}
```

`src/auth/application/get-me.use-case.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../shared/domain/actor';
import { DomainError } from '../../shared/domain/errors';
import { USER_REPOSITORY, type UserRecord, type UserRepository } from '../repositories/user.repository';

@Injectable()
export class GetMeUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(actor: Actor): Promise<UserRecord> {
    const user = await this.users.findById(actor.userId);
    if (!user) throw new DomainError('NOT_FOUND', 'User not found');
    return user;
  }
}
```

- [ ] **Step 4: Write the guards**

`src/auth/guards/auth.guard.ts`:
```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { CLOCK, type Clock } from '../../shared/domain/clock';
import { DomainError } from '../../shared/domain/errors';
import { AUTH_MODE_KEY, type AuthMode } from '../../shared/http/decorators';
import { SignatureVerifier } from '../domain/services/signature';
import { KEY_CRYPTO, NONCE_STORE, TOKEN_VERIFIER, type KeyCrypto, type NonceStore, type TokenVerifier } from '../domain/ports';
import { DEVICE_BINDING_REPOSITORY, type DeviceBindingRepository } from '../repositories/device-binding.repository';

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest();
const b64url = (data: string | Buffer) => sha256(data).toString('base64url');
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const TS_RE = /^\d{1,12}$/;
const SIG_RE = /^[A-Za-z0-9_-]{16,256}$/;

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly verifier: SignatureVerifier;

  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly tokens: TokenVerifier,
    @Inject(DEVICE_BINDING_REPOSITORY) private readonly bindings: DeviceBindingRepository,
    @Inject(NONCE_STORE) private readonly nonces: NonceStore,
    @Inject(KEY_CRYPTO) crypto: KeyCrypto,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.verifier = new SignatureVerifier(crypto, 60);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const mode = this.reflector.getAllAndOverride<AuthMode | undefined>(AUTH_MODE_KEY, [ctx.getHandler(), ctx.getClass()]) ?? 'signed';
    const req = ctx.switchToHttp().getRequest<Request>();

    if (mode === 'health-probe') {
      const given = req.header('x-health-token') ?? '';
      if (!timingSafeEqual(sha256(given), sha256(this.config.HEALTH_CHECK_TOKEN))) {
        throw new DomainError('UNAUTHENTICATED', 'Health token required');
      }
      return true;
    }

    const auth = req.header('authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(auth);
    if (!match?.[1]) throw new DomainError('UNAUTHENTICATED', 'Bearer token required');
    const token = match[1];
    const verified = await this.tokens.verify(token);
    req.verifiedToken = verified;
    if (mode === 'bearer-only') return true;

    const timestamp = req.header('x-signature-timestamp');
    const nonce = req.header('x-signature-nonce');
    const signature = req.header('x-signature');
    if (!timestamp || !nonce || !signature || !TS_RE.test(timestamp) || !NONCE_RE.test(nonce) || !SIG_RE.test(signature)) {
      throw new DomainError('SIGNATURE_REQUIRED', 'Request signature headers are missing or malformed');
    }
    this.verifier.assertFresh(timestamp, this.clock.now());

    const bound = await this.bindings.findBoundSession(verified.sessionId);
    if (!bound || bound.userId !== verified.userId) throw new DomainError('KEY_NOT_BOUND', 'No key is bound to this session');

    this.verifier.assertValid(
      {
        method: req.method,
        url: req.originalUrl,
        timestamp,
        nonce,
        bodySha256: b64url(req.rawBody ?? Buffer.alloc(0)),
        tokenSha256: b64url(token),
      },
      signature,
      bound.publicKeyJwk,
    );

    if (!(await this.nonces.claim(verified.sessionId, nonce))) {
      throw new DomainError('REPLAY_DETECTED', 'Nonce has already been used');
    }
    req.actor = { userId: bound.userId, role: bound.role, sessionId: verified.sessionId };
    return true;
  }
}
```

`src/shared/http/roles.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '../domain/actor';
import { DomainError } from '../domain/errors';
import { ROLES_KEY } from './decorators';

/** Controller-level RBAC. Signed routes MUST declare @Roles (default deny). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!req.actor) return true; // bearer-only / health-probe routes carry no actor; AuthGuard already vetted them
    if (!roles || !roles.includes(req.actor.role)) throw new DomainError('FORBIDDEN', 'Insufficient role');
    return true;
  }
}
```

- [ ] **Step 5: Write the controller and module; wire the global guards**

`src/auth/controllers/auth.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../shared/domain/actor';
import { BearerOnly, CurrentActor, CurrentToken, RateLimitGroup, Roles } from '../../shared/http/decorators';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { GetMeUseCase } from '../application/get-me.use-case';
import { RegisterDeviceKeyUseCase } from '../application/register-device-key.use-case';
import type { VerifiedToken } from '../domain/ports';

const coordinate = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'must be a base64url P-256 coordinate');
const registerSchema = z.strictObject({
  publicKey: z.strictObject({ kty: z.literal('EC'), crv: z.literal('P-256'), x: coordinate, y: coordinate }),
});

@Controller('v1/auth')
@RateLimitGroup('auth')
export class AuthController {
  constructor(
    private readonly registerKey: RegisterDeviceKeyUseCase,
    private readonly getMe: GetMeUseCase,
  ) {}

  @Post('device-keys')
  @HttpCode(201)
  @BearerOnly()
  register(@CurrentToken() token: VerifiedToken, @Body(new ZodValidationPipe(registerSchema)) body: z.infer<typeof registerSchema>) {
    return this.registerKey.execute(token, body.publicKey);
  }

  @Get('me')
  @Roles('USER', 'ADMIN')
  me(@CurrentActor() actor: Actor) {
    return this.getMe.execute(actor);
  }
}
```

`src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { IpRateLimitGuard, UserRateLimitGuard } from '../shared/http/rate-limit.guards';
import { RolesGuard } from '../shared/http/roles.guard';
import { GetMeUseCase } from './application/get-me.use-case';
import { RegisterDeviceKeyUseCase } from './application/register-device-key.use-case';
import { AuthController } from './controllers/auth.controller';
import { KEY_CRYPTO, NONCE_STORE, TOKEN_VERIFIER } from './domain/ports';
import { AuthGuard } from './guards/auth.guard';
import { EcdsaKeyCrypto } from './infrastructure/ecdsa-key-crypto';
import { RedisNonceStore } from './infrastructure/redis-nonce-store';
import { SupabaseTokenVerifier } from './infrastructure/supabase-token-verifier';
import { DEVICE_BINDING_REPOSITORY } from './repositories/device-binding.repository';
import { PrismaDeviceBindingRepository } from './repositories/prisma-device-binding.repository';
import { PrismaUserRepository } from './repositories/prisma-user.repository';
import { USER_REPOSITORY } from './repositories/user.repository';

@Module({
  controllers: [AuthController],
  providers: [
    RegisterDeviceKeyUseCase,
    GetMeUseCase,
    { provide: TOKEN_VERIFIER, useClass: SupabaseTokenVerifier },
    { provide: KEY_CRYPTO, useClass: EcdsaKeyCrypto },
    { provide: NONCE_STORE, useClass: RedisNonceStore },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: DEVICE_BINDING_REPOSITORY, useClass: PrismaDeviceBindingRepository },
    // Order matters: global guards run in registration order.
    { provide: APP_GUARD, useClass: IpRateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: UserRateLimitGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
```

Add `AuthModule` to the `imports` of `src/app.module.ts`.

- [ ] **Step 6: Write the test app factory and signed test client**

`test/support/test-app.ts`:
```ts
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type pino from 'pino';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { APP_CONFIG, loadConfig, type AppConfig } from '../../src/config/env';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { RedisService } from '../../src/shared/redis/redis.service';
import { MockIdp } from './mock-idp';

export interface TestContext {
  app: NestExpressApplication;
  http: Server;
  prisma: PrismaService;
  redis: RedisService;
  idp: MockIdp;
  config: AppConfig;
}

export async function createTestApp(opts: { env?: Record<string, string>; logStream?: pino.DestinationStream } = {}): Promise<TestContext> {
  const idp = await MockIdp.start();
  const config = loadConfig({ ...process.env, SUPABASE_JWKS_URL: idp.jwksUrl, ...opts.env });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, config, opts.logStream ? { logStream: opts.logStream } : {});
  await app.init();
  return { app, http: app.getHttpServer() as Server, prisma: app.get(PrismaService), redis: app.get(RedisService), idp, config };
}

export async function resetState(ctx: TestContext): Promise<void> {
  await ctx.prisma.$executeRaw`TRUNCATE chat_messages, monthly_usage, subscriptions, device_bindings, users CASCADE`;
  await ctx.redis.client.flushdb();
}

export async function closeTestApp(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.idp.stop();
}
```

`test/support/test-client.ts`:
```ts
import { generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import request, { type Test } from 'supertest';
import type { PublicJwk } from '../../src/auth/domain/ports';
import type { Role } from '../../src/shared/domain/actor';
import { signRequest } from '../../scripts/lib/signer';
import type { TestContext } from './test-app';

export function newKeyPair(): { privateKey: KeyObject; publicKeyJwk: PublicJwk } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, publicKeyJwk: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! } };
}

export class TestClient {
  private constructor(
    private readonly ctx: TestContext,
    readonly userId: string,
    readonly email: string,
    readonly sessionId: string,
    readonly token: string,
    readonly privateKey: KeyObject,
    readonly publicKeyJwk: PublicJwk,
  ) {}

  static async register(ctx: TestContext, opts: { role?: Role; userId?: string } = {}): Promise<TestClient> {
    const userId = opts.userId ?? randomUUID();
    const sessionId = randomUUID();
    const email = `${userId.slice(0, 8)}@example.com`;
    const token = await ctx.idp.token({ userId, sessionId, email });
    const { privateKey, publicKeyJwk } = newKeyPair();
    const res = await request(ctx.http).post('/v1/auth/device-keys').set('Authorization', `Bearer ${token}`).send({ publicKey: publicKeyJwk });
    if (res.status !== 201) throw new Error(`device-key registration failed: ${res.status} ${JSON.stringify(res.body)}`);
    if (opts.role === 'ADMIN') await ctx.prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
    return new TestClient(ctx, userId, email, sessionId, token, privateKey, publicKeyJwk);
  }

  headers(method: string, url: string, rawBody = '', overrides: { timestamp?: number; nonce?: string; token?: string } = {}) {
    const { token = this.token, ...rest } = overrides;
    return signRequest({ method, url, rawBody, token, privateKey: this.privateKey, ...rest });
  }

  get(url: string): Test {
    return request(this.ctx.http).get(url).set(this.headers('GET', url));
  }

  post(url: string, body?: unknown): Test {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const req = request(this.ctx.http).post(url).set(this.headers('POST', url, raw));
    return body === undefined ? req : req.set('Content-Type', 'application/json').send(raw);
  }

  patch(url: string, body: unknown): Test {
    const raw = JSON.stringify(body);
    return request(this.ctx.http).patch(url).set(this.headers('PATCH', url, raw)).set('Content-Type', 'application/json').send(raw);
  }
}
```

- [ ] **Step 7: Write the failing auth-access integration test**

`test/integration/auth/auth-access.int-spec.ts`:
```ts
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { newKeyPair, TestClient } from '../../support/test-client';
import { signRequest } from '../../../scripts/lib/signer';

describe('Authenticated API access', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetState(ctx));
  afterAll(() => closeTestApp(ctx));

  const code = (res: request.Response) => (res.body as { error?: { code?: string } }).error?.code;

  it('happy path: registered key + signed request returns the user', async () => {
    const client = await TestClient.register(ctx);
    const res = await client.get('/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: client.userId, email: client.email, role: 'USER' });
  });

  it('rejects missing or non-bearer credentials with UNAUTHENTICATED', async () => {
    expect(code(await request(ctx.http).get('/v1/auth/me'))).toBe('UNAUTHENTICATED');
    expect(code(await request(ctx.http).get('/v1/auth/me').set('Authorization', 'Basic abc'))).toBe('UNAUTHENTICATED');
  });

  it('rejects invalid and expired tokens', async () => {
    const bad = await ctx.idp.token({ audience: 'service_role' });
    expect(code(await request(ctx.http).get('/v1/auth/me').set('Authorization', `Bearer ${bad}`))).toBe('INVALID_TOKEN');
    const expired = await ctx.idp.token({ expiresInSeconds: -60 });
    expect(code(await request(ctx.http).get('/v1/auth/me').set('Authorization', `Bearer ${expired}`))).toBe('TOKEN_EXPIRED');
  });

  it('requires a signature: a valid token alone is not sufficient', async () => {
    const client = await TestClient.register(ctx);
    const res = await request(ctx.http).get('/v1/auth/me').set('Authorization', `Bearer ${client.token}`);
    expect(res.status).toBe(401);
    expect(code(res)).toBe('SIGNATURE_REQUIRED');
  });

  it('rejects a signed request from a session with no bound key', async () => {
    const token = await ctx.idp.token();
    const { privateKey } = newKeyPair();
    const headers = signRequest({ method: 'GET', url: '/v1/auth/me', rawBody: '', token, privateKey });
    expect(code(await request(ctx.http).get('/v1/auth/me').set(headers))).toBe('KEY_NOT_BOUND');
  });

  it('rejects a stolen token used with the attacker’s own key', async () => {
    const victim = await TestClient.register(ctx);
    const attacker = newKeyPair();
    const headers = signRequest({ method: 'GET', url: '/v1/auth/me', rawBody: '', token: victim.token, privateKey: attacker.privateKey });
    expect(code(await request(ctx.http).get('/v1/auth/me').set(headers))).toBe('INVALID_SIGNATURE');
  });

  it('rejects a new token for another session of the same user (key is session-bound)', async () => {
    const client = await TestClient.register(ctx);
    const otherSession = await ctx.idp.token({ userId: client.userId, sessionId: randomUUID() });
    const res = await request(ctx.http).get('/v1/auth/me').set(client.headers('GET', '/v1/auth/me', '', { token: otherSession }));
    expect(code(res)).toBe('KEY_NOT_BOUND');
  });

  it('rejects a session_id reused under a different subject', async () => {
    const client = await TestClient.register(ctx);
    const forged = await ctx.idp.token({ userId: randomUUID(), sessionId: client.sessionId });
    const res = await request(ctx.http).get('/v1/auth/me').set(client.headers('GET', '/v1/auth/me', '', { token: forged }));
    expect(code(res)).toBe('KEY_NOT_BOUND');
  });

  it('rejects tampered URLs, stale or future timestamps, and replays', async () => {
    const client = await TestClient.register(ctx);
    const tampered = await request(ctx.http).get('/v1/auth/me?x=1').set(client.headers('GET', '/v1/auth/me'));
    expect(code(tampered)).toBe('INVALID_SIGNATURE');
    const now = Math.floor(Date.now() / 1000);
    const stale = await request(ctx.http).get('/v1/auth/me').set(client.headers('GET', '/v1/auth/me', '', { timestamp: now - 120 }));
    expect(code(stale)).toBe('REQUEST_EXPIRED');
    const future = await request(ctx.http).get('/v1/auth/me').set(client.headers('GET', '/v1/auth/me', '', { timestamp: now + 120 }));
    expect(code(future)).toBe('REQUEST_EXPIRED');
    const headers = client.headers('GET', '/v1/auth/me');
    expect((await request(ctx.http).get('/v1/auth/me').set(headers)).status).toBe(200);
    expect(code(await request(ctx.http).get('/v1/auth/me').set(headers))).toBe('REPLAY_DETECTED');
  });

  describe('device-key registration', () => {
    it('rejects a second key for the same session', async () => {
      const client = await TestClient.register(ctx);
      const res = await request(ctx.http)
        .post('/v1/auth/device-keys')
        .set('Authorization', `Bearer ${client.token}`)
        .send({ publicKey: newKeyPair().publicKeyJwk });
      expect(res.status).toBe(409);
      expect(code(res)).toBe('KEY_ALREADY_BOUND');
    });

    it('rejects binding more than 300s after authentication', async () => {
      const token = await ctx.idp.token({ authenticatedAt: new Date(Date.now() - 10 * 60 * 1000) });
      const res = await request(ctx.http).post('/v1/auth/device-keys').set('Authorization', `Bearer ${token}`).send({ publicKey: newKeyPair().publicKeyJwk });
      expect(res.status).toBe(403);
      expect(code(res)).toBe('KEY_BINDING_WINDOW_CLOSED');
    });

    it('rejects private-key material and off-curve points without creating a binding (Review Focus #5)', async () => {
      const token = await ctx.idp.token();
      const { publicKeyJwk } = newKeyPair();
      const withD = await request(ctx.http)
        .post('/v1/auth/device-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ publicKey: { ...publicKeyJwk, d: randomBytes(32).toString('base64url') } });
      expect(withD.status).toBe(400);
      const offCurve = await request(ctx.http)
        .post('/v1/auth/device-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ publicKey: { kty: 'EC', crv: 'P-256', x: randomBytes(32).toString('base64url'), y: randomBytes(32).toString('base64url') } });
      expect(offCurve.status).toBe(400);
      expect(await ctx.prisma.deviceBinding.count()).toBe(0);
    });
  });

  it('keeps admins and users distinct in /auth/me', async () => {
    const admin = await TestClient.register(ctx, { role: 'ADMIN' });
    expect((await admin.get('/v1/auth/me')).body.role).toBe('ADMIN');
  });
});
```

- [ ] **Step 8: Run it and confirm it fails, then passes**

Run: `npx jest -c jest.int.config.js test/integration/auth/auth-access`
Expected: PASS (13 tests) once Steps 1–6 are in place. Common fixes:
- If Nest can't resolve `AuthGuard` dependencies, check that `CoreModule`, `PrismaModule` and `RedisModule` are `@Global()` and imported in `AppModule`.
- If `@CurrentToken()` returns `undefined`, the route is missing `@BearerOnly()`.

- [ ] **Step 9: Re-run the whole integration suite, then commit**

Run: `npm run test:int`. Expected: all previous suites still PASS.
```bash
npm run lint && npm run typecheck
git add -A && git commit -m "feat(auth): session-bound device keys, signed-request auth guard, RBAC guard, /auth/me

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Subscriptions domain

**Files:**
- Create: `src/subscriptions/domain/value-objects.ts`, `src/subscriptions/domain/services/pricing-catalog.ts`, `src/subscriptions/domain/services/period-calculator.ts`, `src/subscriptions/domain/entities/subscription.ts`, `src/subscriptions/domain/policies/subscription-access.policy.ts`, `src/subscriptions/domain/ports.ts`
- Test: `test/unit/subscriptions/period-calculator.spec.ts`, `test/unit/subscriptions/subscription.spec.ts`, `test/unit/subscriptions/subscription-access.policy.spec.ts`

**Interfaces:**
- Consumes: `DomainError`, `Actor`, `isAdmin`.
- Produces:
  - `type Tier = 'BASIC'|'PRO'|'ENTERPRISE'`, `type BillingCycle = 'MONTHLY'|'YEARLY'`, `type SubscriptionStatus = 'ACTIVE'|'INACTIVE'`, `type InactiveReason = 'CANCELLED'|'PAYMENT_FAILED'|'EXPIRED'`
  - `PRICING_CATALOG: Record<Tier, { maxMessages: number|null; priceCents: Record<BillingCycle, number> }>`, `priceFor(tier, cycle): number`
  - `addMonthsUtc(date, months): Date`, `addCycle(date, cycle): Date`
  - `interface SubscriptionProps { id; userId; tier; billingCycle; maxMessages: number|null; usedMessages; priceCents; autoRenew; status; inactiveReason: InactiveReason|null; startDate; endDate; renewalDate: Date|null; cancelledAt: Date|null; createdAt }`
  - `class Subscription` with:
    - `static create({ id, userId, tier, billingCycle, autoRenew, paymentSucceeded, now })`, `static restore(props)`
    - `toSnapshot(): SubscriptionProps`
    - getters `id, userId, autoRenew, priceCents, status, createdAt, startDate, endDate`
    - `isUsableAt(now)`, `remaining(): number|null`, `consume(now)`, `setAutoRenew(v)`, `cancel(now)`, `isDueForRenewal(now)`, `renew(now, paymentSucceeded: boolean|undefined)`
  - `SubscriptionAccessPolicy { canView, canCancel, canSetAutoRenew, canListFor }`, `accessDenied(actor): DomainError`
  - `PaymentGateway { charge(input: { subscriptionId: string; userId: string; amountCents: number }): Promise<{ ok: boolean }> }`, `PAYMENT_GATEWAY`

- [ ] **Step 1: Write the failing tests**

`test/unit/subscriptions/period-calculator.spec.ts`:
```ts
import { addCycle, addMonthsUtc } from '../../../src/subscriptions/domain/services/period-calculator';

describe('period calculator (UTC, end-of-month clamping)', () => {
  it('adds a month keeping the time of day', () => {
    expect(addMonthsUtc(new Date('2026-09-24T10:30:00Z'), 1).toISOString()).toBe('2026-10-24T10:30:00.000Z');
  });
  it('clamps Jan 31 to the last day of February', () => {
    expect(addMonthsUtc(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonthsUtc(new Date('2028-01-31T00:00:00Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
  it('rolls over the year for December and for yearly cycles', () => {
    expect(addCycle(new Date('2026-12-15T00:00:00Z'), 'MONTHLY').toISOString()).toBe('2027-01-15T00:00:00.000Z');
    expect(addCycle(new Date('2028-02-29T00:00:00Z'), 'YEARLY').toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });
});
```

`test/unit/subscriptions/subscription.spec.ts`:
```ts
import { Subscription } from '../../../src/subscriptions/domain/entities/subscription';

const now = new Date('2026-09-24T12:00:00Z');
const make = (over: Partial<Parameters<typeof Subscription.create>[0]> = {}) =>
  Subscription.create({ id: 's1', userId: 'u1', tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true, paymentSucceeded: true, now, ...over });

describe('Subscription lifecycle', () => {
  it('creates an active bundle with catalog quota, price and dates', () => {
    const s = make().toSnapshot();
    expect(s).toMatchObject({
      status: 'ACTIVE',
      inactiveReason: null,
      maxMessages: 10,
      usedMessages: 0,
      priceCents: 999,
      startDate: now,
      endDate: new Date('2026-10-24T12:00:00Z'),
      renewalDate: new Date('2026-10-24T12:00:00Z'),
      autoRenew: true,
      createdAt: now,
    });
    expect(make({ tier: 'PRO', billingCycle: 'YEARLY' }).toSnapshot()).toMatchObject({ maxMessages: 100, priceCents: 29990 });
    expect(make({ tier: 'ENTERPRISE' }).toSnapshot().maxMessages).toBeNull();
  });

  it('creates an inactive PAYMENT_FAILED bundle when the first charge fails', () => {
    const s = make({ paymentSucceeded: false });
    expect(s.toSnapshot()).toMatchObject({ status: 'INACTIVE', inactiveReason: 'PAYMENT_FAILED', renewalDate: null, autoRenew: false });
    expect(s.isUsableAt(now)).toBe(false);
  });

  it('consumes up to maxMessages then refuses', () => {
    const s = make();
    for (let i = 0; i < 10; i++) s.consume(now);
    expect(s.remaining()).toBe(0);
    expect(s.isUsableAt(now)).toBe(false);
    expect(() => s.consume(now)).toThrow(expect.objectContaining({ code: 'QUOTA_EXHAUSTED' }));
  });

  it('never exhausts an unlimited Enterprise bundle', () => {
    const s = make({ tier: 'ENTERPRISE' });
    for (let i = 0; i < 1000; i++) s.consume(now);
    expect(s.remaining()).toBeNull();
    expect(s.isUsableAt(now)).toBe(true);
    expect(s.toSnapshot().usedMessages).toBe(1000);
  });

  it('is not usable before start or at/after end', () => {
    const s = make();
    expect(s.isUsableAt(new Date('2026-09-24T11:59:59Z'))).toBe(false);
    expect(s.isUsableAt(new Date('2026-10-24T12:00:00Z'))).toBe(false);
  });

  it('toggles auto-renew only while active', () => {
    const s = make();
    s.setAutoRenew(false);
    expect(s.autoRenew).toBe(false);
    s.cancel(now);
    expect(() => s.setAutoRenew(true)).toThrow(expect.objectContaining({ code: 'SUBSCRIPTION_NOT_ACTIVE' }));
  });

  it('cancels immediately and keeps usage history', () => {
    const s = make();
    s.consume(now);
    const at = new Date('2026-09-30T00:00:00Z');
    s.cancel(at);
    expect(s.toSnapshot()).toMatchObject({
      status: 'INACTIVE',
      inactiveReason: 'CANCELLED',
      endDate: at,
      renewalDate: null,
      autoRenew: false,
      cancelledAt: at,
      usedMessages: 1,
    });
    expect(() => s.cancel(at)).toThrow(expect.objectContaining({ code: 'SUBSCRIPTION_NOT_ACTIVE' }));
  });

  it('renews into the next period on successful payment and resets usage', () => {
    const s = make();
    s.consume(now);
    const due = new Date('2026-10-24T12:00:01Z');
    expect(s.isDueForRenewal(due)).toBe(true);
    s.renew(due, true);
    expect(s.toSnapshot()).toMatchObject({
      status: 'ACTIVE',
      startDate: new Date('2026-10-24T12:00:00Z'),
      endDate: new Date('2026-11-24T12:00:00Z'),
      renewalDate: new Date('2026-11-24T12:00:00Z'),
      usedMessages: 0,
    });
  });

  it('deactivates on failed renewal payment', () => {
    const s = make();
    s.renew(new Date('2026-10-25T00:00:00Z'), false);
    expect(s.toSnapshot()).toMatchObject({ status: 'INACTIVE', inactiveReason: 'PAYMENT_FAILED', renewalDate: null });
  });

  it('expires at period end when auto-renew is off', () => {
    const s = make({ autoRenew: false });
    s.renew(new Date('2026-10-25T00:00:00Z'), undefined);
    expect(s.toSnapshot()).toMatchObject({ status: 'INACTIVE', inactiveReason: 'EXPIRED', renewalDate: null });
  });

  it('ignores renew() when not yet due', () => {
    const s = make();
    s.renew(now, true);
    expect(s.toSnapshot().startDate).toEqual(now);
  });
});
```

`test/unit/subscriptions/subscription-access.policy.spec.ts`:
```ts
import type { Actor } from '../../../src/shared/domain/actor';
import { Subscription } from '../../../src/subscriptions/domain/entities/subscription';
import { accessDenied, SubscriptionAccessPolicy as P } from '../../../src/subscriptions/domain/policies/subscription-access.policy';

const owner: Actor = { userId: 'u1', role: 'USER', sessionId: 's' };
const other: Actor = { userId: 'u2', role: 'USER', sessionId: 's' };
const admin: Actor = { userId: 'a1', role: 'ADMIN', sessionId: 's' };
const sub = Subscription.create({ id: 'x', userId: 'u1', tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true, paymentSucceeded: true, now: new Date() });

describe('SubscriptionAccessPolicy', () => {
  it.each([
    ['canView', owner, true], ['canView', other, false], ['canView', admin, true],
    ['canCancel', owner, true], ['canCancel', other, false], ['canCancel', admin, true],
    ['canSetAutoRenew', owner, true], ['canSetAutoRenew', other, false], ['canSetAutoRenew', admin, false],
  ] as const)('%s for %o is %s', (rule, actor, expected) => {
    expect(P[rule](actor, sub)).toBe(expected);
  });

  it('lets only admins list other users', () => {
    expect(P.canListFor(owner, 'u1')).toBe(true);
    expect(P.canListFor(owner, 'u2')).toBe(false);
    expect(P.canListFor(admin, 'u2')).toBe(true);
  });

  it('hides existence from non-admins (404) but tells admins 403', () => {
    expect(accessDenied(other).code).toBe('NOT_FOUND');
    expect(accessDenied(admin).code).toBe('FORBIDDEN');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx jest -c jest.unit.config.js test/unit/subscriptions`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the subscriptions domain**

`src/subscriptions/domain/value-objects.ts`:
```ts
export type Tier = 'BASIC' | 'PRO' | 'ENTERPRISE';
export type BillingCycle = 'MONTHLY' | 'YEARLY';
export type SubscriptionStatus = 'ACTIVE' | 'INACTIVE';
export type InactiveReason = 'CANCELLED' | 'PAYMENT_FAILED' | 'EXPIRED';
export const TIERS = ['BASIC', 'PRO', 'ENTERPRISE'] as const;
export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
```

`src/subscriptions/domain/services/pricing-catalog.ts`:
```ts
import type { BillingCycle, Tier } from '../value-objects';

export interface Plan {
  maxMessages: number | null; // null = unlimited
  priceCents: Record<BillingCycle, number>;
}

export const PRICING_CATALOG: Readonly<Record<Tier, Plan>> = {
  BASIC: { maxMessages: 10, priceCents: { MONTHLY: 999, YEARLY: 9990 } },
  PRO: { maxMessages: 100, priceCents: { MONTHLY: 2999, YEARLY: 29990 } },
  ENTERPRISE: { maxMessages: null, priceCents: { MONTHLY: 19999, YEARLY: 199990 } },
};

export const priceFor = (tier: Tier, cycle: BillingCycle): number => PRICING_CATALOG[tier].priceCents[cycle];
```

`src/subscriptions/domain/services/period-calculator.ts`:
```ts
import type { BillingCycle } from '../value-objects';

/** Adds calendar months in UTC, clamping to the last day of the target month. */
export function addMonthsUtc(date: Date, months: number): Date {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()),
  );
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

export const addCycle = (date: Date, cycle: BillingCycle): Date => addMonthsUtc(date, cycle === 'MONTHLY' ? 1 : 12);
```

`src/subscriptions/domain/entities/subscription.ts`:
```ts
import { DomainError } from '../../../shared/domain/errors';
import { addCycle } from '../services/period-calculator';
import { PRICING_CATALOG, priceFor } from '../services/pricing-catalog';
import type { BillingCycle, InactiveReason, SubscriptionStatus, Tier } from '../value-objects';

export interface SubscriptionProps {
  id: string;
  userId: string;
  tier: Tier;
  billingCycle: BillingCycle;
  maxMessages: number | null;
  usedMessages: number;
  priceCents: number;
  autoRenew: boolean;
  status: SubscriptionStatus;
  inactiveReason: InactiveReason | null;
  startDate: Date;
  endDate: Date;
  renewalDate: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

export class Subscription {
  private constructor(private props: SubscriptionProps) {}

  static create(input: {
    id: string;
    userId: string;
    tier: Tier;
    billingCycle: BillingCycle;
    autoRenew: boolean;
    paymentSucceeded: boolean;
    now: Date;
  }): Subscription {
    const endDate = addCycle(input.now, input.billingCycle);
    const ok = input.paymentSucceeded;
    return new Subscription({
      id: input.id,
      userId: input.userId,
      tier: input.tier,
      billingCycle: input.billingCycle,
      maxMessages: PRICING_CATALOG[input.tier].maxMessages,
      usedMessages: 0,
      priceCents: priceFor(input.tier, input.billingCycle),
      autoRenew: ok ? input.autoRenew : false,
      status: ok ? 'ACTIVE' : 'INACTIVE',
      inactiveReason: ok ? null : 'PAYMENT_FAILED',
      startDate: input.now,
      endDate,
      renewalDate: ok ? endDate : null,
      cancelledAt: null,
      createdAt: input.now,
    });
  }

  static restore(props: SubscriptionProps): Subscription {
    return new Subscription({ ...props });
  }

  toSnapshot(): SubscriptionProps {
    return { ...this.props };
  }

  get id(): string { return this.props.id; }
  get userId(): string { return this.props.userId; }
  get autoRenew(): boolean { return this.props.autoRenew; }
  get priceCents(): number { return this.props.priceCents; }
  get status(): SubscriptionStatus { return this.props.status; }
  get createdAt(): Date { return this.props.createdAt; }
  get startDate(): Date { return this.props.startDate; }
  get endDate(): Date { return this.props.endDate; }

  remaining(): number | null {
    return this.props.maxMessages === null ? null : Math.max(0, this.props.maxMessages - this.props.usedMessages);
  }

  isUsableAt(now: Date): boolean {
    const p = this.props;
    const remaining = this.remaining();
    return p.status === 'ACTIVE' && p.startDate <= now && now < p.endDate && (remaining === null || remaining > 0);
  }

  consume(now: Date): void {
    if (!this.isUsableAt(now)) throw new DomainError('QUOTA_EXHAUSTED', 'Subscription has no remaining messages');
    this.props.usedMessages += 1;
  }

  setAutoRenew(value: boolean): void {
    this.assertActive();
    this.props.autoRenew = value;
  }

  cancel(now: Date): void {
    this.assertActive();
    Object.assign(this.props, {
      status: 'INACTIVE',
      inactiveReason: 'CANCELLED',
      endDate: now,
      renewalDate: null,
      autoRenew: false,
      cancelledAt: now,
    } satisfies Partial<SubscriptionProps>);
  }

  isDueForRenewal(now: Date): boolean {
    return this.props.status === 'ACTIVE' && this.props.renewalDate !== null && this.props.renewalDate <= now;
  }

  renew(now: Date, paymentSucceeded: boolean | undefined): void {
    if (!this.isDueForRenewal(now)) return;
    if (!this.props.autoRenew) return this.deactivate('EXPIRED');
    if (!paymentSucceeded) return this.deactivate('PAYMENT_FAILED');
    const startDate = this.props.endDate;
    const endDate = addCycle(startDate, this.props.billingCycle);
    Object.assign(this.props, { startDate, endDate, renewalDate: endDate, usedMessages: 0 } satisfies Partial<SubscriptionProps>);
  }

  private deactivate(reason: InactiveReason): void {
    Object.assign(this.props, { status: 'INACTIVE', inactiveReason: reason, renewalDate: null } satisfies Partial<SubscriptionProps>);
  }

  private assertActive(): void {
    if (this.props.status !== 'ACTIVE') throw new DomainError('SUBSCRIPTION_NOT_ACTIVE', 'Subscription is not active');
  }
}
```

`src/subscriptions/domain/policies/subscription-access.policy.ts`:
```ts
import { isAdmin, type Actor } from '../../../shared/domain/actor';
import { DomainError } from '../../../shared/domain/errors';
import type { Subscription } from '../entities/subscription';

const owns = (actor: Actor, sub: Subscription) => sub.userId === actor.userId;

export const SubscriptionAccessPolicy = {
  canView: (actor: Actor, sub: Subscription): boolean => isAdmin(actor) || owns(actor, sub),
  canCancel: (actor: Actor, sub: Subscription): boolean => isAdmin(actor) || owns(actor, sub),
  canSetAutoRenew: (actor: Actor, sub: Subscription): boolean => owns(actor, sub),
  canListFor: (actor: Actor, targetUserId: string): boolean => isAdmin(actor) || targetUserId === actor.userId,
};

/** Non-admins must not learn that someone else's subscription exists. */
export const accessDenied = (actor: Actor): DomainError =>
  isAdmin(actor) ? new DomainError('FORBIDDEN', 'Not allowed for this subscription') : new DomainError('NOT_FOUND', 'Subscription not found');
```

`src/subscriptions/domain/ports.ts`:
```ts
export interface PaymentGateway {
  charge(input: { subscriptionId: string; userId: string; amountCents: number }): Promise<{ ok: boolean }>;
}
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `npx jest -c jest.unit.config.js test/unit/subscriptions`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
npm run lint && npm run typecheck
git add -A && git commit -m "feat(subscriptions): add pricing catalog, UTC period maths, Subscription aggregate and access policy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Subscriptions API (create, list, auto-renew, cancel)

**Files:**
- Create: `src/subscriptions/repositories/subscription.repository.ts`, `src/subscriptions/repositories/prisma-subscription.repository.ts`, `src/subscriptions/infrastructure/simulated-payment-gateway.ts`, `src/subscriptions/application/create-subscription.use-case.ts`, `src/subscriptions/application/list-subscriptions.use-case.ts`, `src/subscriptions/application/set-auto-renew.use-case.ts`, `src/subscriptions/application/cancel-subscription.use-case.ts`, `src/subscriptions/controllers/subscriptions.controller.ts`, `src/subscriptions/subscriptions.module.ts`, `src/subscriptions/index.ts`, `test/support/fake-payment-gateway.ts`
- Modify: `src/app.module.ts` (import `SubscriptionsModule`), `test/support/test-app.ts` (override `PAYMENT_GATEWAY`, expose `payments`)
- Test: `test/integration/subscriptions/subscriptions-api.int-spec.ts`

**Interfaces:**
- Consumes: the Task 8 domain, `TransactionRunner`, `Clock`, `PrismaTransactionRunner`, decorators, `ZodValidationPipe`.
- Produces:
  - `SubscriptionRepository` with:
    - `findById(id)`, `lockById(id)` (FOR UPDATE)
    - `listByUser(userId, limit)`, `listActiveForUser(userId)`, `lockActiveForUser(userId)` (FOR UPDATE ORDER BY id)
    - `lockDueForRenewal(now, limit)` (FOR UPDATE SKIP LOCKED)
    - `save(sub)`
  - `SUBSCRIPTION_REPOSITORY`
  - Use cases `CreateSubscriptionUseCase`, `ListSubscriptionsUseCase`, `SetAutoRenewUseCase`, `CancelSubscriptionUseCase`
  - `SubscriptionsModule` (exports `SUBSCRIPTION_REPOSITORY`, `PAYMENT_GATEWAY`)
  - `listQuerySchema` (reused by chat): `z.strictObject({ userId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) })`, exported from `src/shared/http/list-query.ts`
  - `TestContext.payments: FakePaymentGateway`
- API response: a subscription snapshot object (dates serialised as ISO strings). List endpoints return `{ items: [...] }`.

- [ ] **Step 1: Write the repository interface and Prisma implementation**

`src/subscriptions/repositories/subscription.repository.ts`:
```ts
import type { Subscription } from '../domain/entities/subscription';

export interface SubscriptionRepository {
  findById(id: string): Promise<Subscription | null>;
  /** SELECT … FOR UPDATE; call inside TransactionRunner.run(). */
  lockById(id: string): Promise<Subscription | null>;
  listByUser(userId: string, limit: number): Promise<Subscription[]>;
  listActiveForUser(userId: string): Promise<Subscription[]>;
  /** Locks the user's ACTIVE subscriptions in id order (fixed lock order). */
  lockActiveForUser(userId: string): Promise<Subscription[]>;
  /** Claims due subscriptions with FOR UPDATE SKIP LOCKED. */
  lockDueForRenewal(now: Date, limit: number): Promise<Subscription[]>;
  save(sub: Subscription): Promise<void>;
}
export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');
```

`src/subscriptions/repositories/prisma-subscription.repository.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { Subscription as Row } from '@prisma/client';
import { PrismaTransactionRunner } from '../../shared/prisma/prisma-transaction-runner';
import { Subscription } from '../domain/entities/subscription';
import type { SubscriptionRepository } from './subscription.repository';

const toDomain = (r: Row): Subscription =>
  Subscription.restore({
    id: r.id,
    userId: r.userId,
    tier: r.tier,
    billingCycle: r.billingCycle,
    maxMessages: r.maxMessages,
    usedMessages: r.usedMessages,
    priceCents: r.priceCents,
    autoRenew: r.autoRenew,
    status: r.status,
    inactiveReason: r.inactiveReason,
    startDate: r.startDate,
    endDate: r.endDate,
    renewalDate: r.renewalDate,
    cancelledAt: r.cancelledAt,
    createdAt: r.createdAt,
  });

@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly tx: PrismaTransactionRunner) {}

  async findById(id: string): Promise<Subscription | null> {
    const row = await this.tx.db().subscription.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async lockById(id: string): Promise<Subscription | null> {
    await this.tx.db().$queryRaw`SELECT id FROM subscriptions WHERE id = ${id}::uuid FOR UPDATE`;
    return this.findById(id);
  }

  async listByUser(userId: string, limit: number): Promise<Subscription[]> {
    const rows = await this.tx.db().subscription.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(toDomain);
  }

  async listActiveForUser(userId: string): Promise<Subscription[]> {
    const rows = await this.tx.db().subscription.findMany({ where: { userId, status: 'ACTIVE' }, orderBy: { id: 'asc' } });
    return rows.map(toDomain);
  }

  async lockActiveForUser(userId: string): Promise<Subscription[]> {
    const locked = await this.tx.db().$queryRaw<{ id: string }[]>`
      SELECT id FROM subscriptions WHERE user_id = ${userId}::uuid AND status = 'ACTIVE' ORDER BY id FOR UPDATE`;
    return this.byIds(locked.map((r) => r.id));
  }

  async lockDueForRenewal(now: Date, limit: number): Promise<Subscription[]> {
    const locked = await this.tx.db().$queryRaw<{ id: string }[]>`
      SELECT id FROM subscriptions
      WHERE status = 'ACTIVE' AND renewal_date <= ${now}
      ORDER BY renewal_date LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    return this.byIds(locked.map((r) => r.id));
  }

  async save(sub: Subscription): Promise<void> {
    const s = sub.toSnapshot();
    const { id, userId, createdAt, ...mutable } = s;
    await this.tx.db().subscription.upsert({ where: { id }, create: { id, userId, createdAt, ...mutable }, update: mutable });
  }

  private async byIds(ids: string[]): Promise<Subscription[]> {
    if (ids.length === 0) return [];
    const rows = await this.tx.db().subscription.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    return rows.map(toDomain);
  }
}
```

- [ ] **Step 2: Write the payment gateways, use cases, controller and module**

`src/subscriptions/infrastructure/simulated-payment-gateway.ts`:
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import type { PaymentGateway } from '../domain/ports';

@Injectable()
export class SimulatedPaymentGateway implements PaymentGateway {
  private readonly logger = new Logger('SimulatedPaymentGateway');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async charge(input: { subscriptionId: string; userId: string; amountCents: number }): Promise<{ ok: boolean }> {
    await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 80)));
    const ok = Math.random() >= this.config.PAYMENT_FAILURE_RATE;
    this.logger.log({ msg: 'payment simulated', subscriptionId: input.subscriptionId, amountCents: input.amountCents, ok });
    return { ok };
  }
}
```

`test/support/fake-payment-gateway.ts`:
```ts
import type { PaymentGateway } from '../../src/subscriptions/domain/ports';

export class FakePaymentGateway implements PaymentGateway {
  private queue: boolean[] = [];
  calls = 0;

  failNext(times = 1): void {
    for (let i = 0; i < times; i++) this.queue.push(false);
  }

  reset(): void {
    this.queue = [];
    this.calls = 0;
  }

  charge(): Promise<{ ok: boolean }> {
    this.calls++;
    return Promise.resolve({ ok: this.queue.shift() ?? true });
  }
}
```

`src/shared/http/list-query.ts`:
```ts
import { z } from 'zod';

export const listQuerySchema = z.strictObject({
  userId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
```

`src/subscriptions/application/create-subscription.use-case.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../shared/domain/actor';
import { CLOCK, type Clock } from '../../shared/domain/clock';
import { DomainError } from '../../shared/domain/errors';
import { Subscription, type SubscriptionProps } from '../domain/entities/subscription';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../domain/ports';
import { priceFor } from '../domain/services/pricing-catalog';
import type { BillingCycle, Tier } from '../domain/value-objects';
import { SUBSCRIPTION_REPOSITORY, type SubscriptionRepository } from '../repositories/subscription.repository';

@Injectable()
export class CreateSubscriptionUseCase {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subs: SubscriptionRepository,
    @Inject(PAYMENT_GATEWAY) private readonly payments: PaymentGateway,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Always creates for the actor themselves (policy: no creating on behalf of others). */
  async execute(actor: Actor, input: { tier: Tier; billingCycle: BillingCycle; autoRenew: boolean }): Promise<SubscriptionProps> {
    const id = randomUUID();
    const payment = await this.payments.charge({ subscriptionId: id, userId: actor.userId, amountCents: priceFor(input.tier, input.billingCycle) });
    const sub = Subscription.create({ id, userId: actor.userId, ...input, paymentSucceeded: payment.ok, now: this.clock.now() });
    await this.subs.save(sub);
    if (!payment.ok) throw new DomainError('PAYMENT_FAILED', 'Payment was declined; the subscription is inactive', { subscriptionId: id });
    return sub.toSnapshot();
  }
}
```

`src/subscriptions/application/list-subscriptions.use-case.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../shared/domain/actor';
import { DomainError } from '../../shared/domain/errors';
import type { SubscriptionProps } from '../domain/entities/subscription';
import { SubscriptionAccessPolicy } from '../domain/policies/subscription-access.policy';
import { SUBSCRIPTION_REPOSITORY, type SubscriptionRepository } from '../repositories/subscription.repository';

@Injectable()
export class ListSubscriptionsUseCase {
  constructor(@Inject(SUBSCRIPTION_REPOSITORY) private readonly subs: SubscriptionRepository) {}

  async execute(actor: Actor, query: { userId?: string | undefined; limit: number }): Promise<SubscriptionProps[]> {
    const target = query.userId ?? actor.userId;
    if (!SubscriptionAccessPolicy.canListFor(actor, target)) throw new DomainError('FORBIDDEN', 'Cannot list another user’s subscriptions');
    return (await this.subs.listByUser(target, query.limit)).map((s) => s.toSnapshot());
  }
}
```

`src/subscriptions/application/set-auto-renew.use-case.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../shared/application/transaction-runner';
import type { Actor } from '../../shared/domain/actor';
import { DomainError } from '../../shared/domain/errors';
import type { SubscriptionProps } from '../domain/entities/subscription';
import { accessDenied, SubscriptionAccessPolicy } from '../domain/policies/subscription-access.policy';
import { SUBSCRIPTION_REPOSITORY, type SubscriptionRepository } from '../repositories/subscription.repository';

@Injectable()
export class SetAutoRenewUseCase {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subs: SubscriptionRepository,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
  ) {}

  execute(actor: Actor, id: string, autoRenew: boolean): Promise<SubscriptionProps> {
    return this.tx.run(async () => {
      const sub = await this.subs.lockById(id);
      if (!sub) throw new DomainError('NOT_FOUND', 'Subscription not found');
      if (!SubscriptionAccessPolicy.canSetAutoRenew(actor, sub)) throw accessDenied(actor);
      sub.setAutoRenew(autoRenew);
      await this.subs.save(sub);
      return sub.toSnapshot();
    });
  }
}
```

`src/subscriptions/application/cancel-subscription.use-case.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../shared/application/transaction-runner';
import type { Actor } from '../../shared/domain/actor';
import { CLOCK, type Clock } from '../../shared/domain/clock';
import { DomainError } from '../../shared/domain/errors';
import type { SubscriptionProps } from '../domain/entities/subscription';
import { accessDenied, SubscriptionAccessPolicy } from '../domain/policies/subscription-access.policy';
import { SUBSCRIPTION_REPOSITORY, type SubscriptionRepository } from '../repositories/subscription.repository';

@Injectable()
export class CancelSubscriptionUseCase {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subs: SubscriptionRepository,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(actor: Actor, id: string): Promise<SubscriptionProps> {
    return this.tx.run(async () => {
      const sub = await this.subs.lockById(id);
      if (!sub) throw new DomainError('NOT_FOUND', 'Subscription not found');
      if (!SubscriptionAccessPolicy.canCancel(actor, sub)) throw accessDenied(actor);
      sub.cancel(this.clock.now());
      await this.subs.save(sub);
      return sub.toSnapshot();
    });
  }
}
```

`src/subscriptions/controllers/subscriptions.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../shared/domain/actor';
import { CurrentActor, RateLimitGroup, Roles } from '../../shared/http/decorators';
import { listQuerySchema, type ListQuery } from '../../shared/http/list-query';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { CancelSubscriptionUseCase } from '../application/cancel-subscription.use-case';
import { CreateSubscriptionUseCase } from '../application/create-subscription.use-case';
import { ListSubscriptionsUseCase } from '../application/list-subscriptions.use-case';
import { SetAutoRenewUseCase } from '../application/set-auto-renew.use-case';
import { BILLING_CYCLES, TIERS } from '../domain/value-objects';

const createSchema = z.strictObject({ tier: z.enum(TIERS), billingCycle: z.enum(BILLING_CYCLES), autoRenew: z.boolean() });
const patchSchema = z.strictObject({ autoRenew: z.boolean() });
const idPipe = new ZodValidationPipe(z.uuid());

@Controller('v1/subscriptions')
@RateLimitGroup('subscriptions')
@Roles('USER', 'ADMIN')
export class SubscriptionsController {
  constructor(
    private readonly createUc: CreateSubscriptionUseCase,
    private readonly listUc: ListSubscriptionsUseCase,
    private readonly autoRenewUc: SetAutoRenewUseCase,
    private readonly cancelUc: CancelSubscriptionUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  create(@CurrentActor() actor: Actor, @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.createUc.execute(actor, body);
  }

  @Get()
  async list(@CurrentActor() actor: Actor, @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery) {
    return { items: await this.listUc.execute(actor, query) };
  }

  @Patch(':id')
  setAutoRenew(@CurrentActor() actor: Actor, @Param('id', idPipe) id: string, @Body(new ZodValidationPipe(patchSchema)) body: z.infer<typeof patchSchema>) {
    return this.autoRenewUc.execute(actor, id, body.autoRenew);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', idPipe) id: string) {
    return this.cancelUc.execute(actor, id);
  }
}
```

`src/subscriptions/subscriptions.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { CancelSubscriptionUseCase } from './application/cancel-subscription.use-case';
import { CreateSubscriptionUseCase } from './application/create-subscription.use-case';
import { ListSubscriptionsUseCase } from './application/list-subscriptions.use-case';
import { SetAutoRenewUseCase } from './application/set-auto-renew.use-case';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { PAYMENT_GATEWAY } from './domain/ports';
import { SimulatedPaymentGateway } from './infrastructure/simulated-payment-gateway';
import { PrismaSubscriptionRepository } from './repositories/prisma-subscription.repository';
import { SUBSCRIPTION_REPOSITORY } from './repositories/subscription.repository';

@Module({
  controllers: [SubscriptionsController],
  providers: [
    CreateSubscriptionUseCase,
    ListSubscriptionsUseCase,
    SetAutoRenewUseCase,
    CancelSubscriptionUseCase,
    { provide: SUBSCRIPTION_REPOSITORY, useClass: PrismaSubscriptionRepository },
    { provide: PAYMENT_GATEWAY, useClass: SimulatedPaymentGateway },
  ],
  exports: [SUBSCRIPTION_REPOSITORY, PAYMENT_GATEWAY],
})
export class SubscriptionsModule {}
```

`src/subscriptions/index.ts`:
```ts
export { SubscriptionsModule } from './subscriptions.module';
```

Add `SubscriptionsModule` to `AppModule.imports`. In `test/support/test-app.ts`:
- add `import { PAYMENT_GATEWAY } from '../../src/subscriptions/domain/ports';` and `import { FakePaymentGateway } from './fake-payment-gateway';`
- add `payments: FakePaymentGateway` to `TestContext`
- in `createTestApp`, create `const payments = new FakePaymentGateway();` and chain `.overrideProvider(PAYMENT_GATEWAY).useValue(payments)` before `.compile()`
- return `payments`
- in `resetState`, call `ctx.payments.reset();`

- [ ] **Step 3: Write the failing API integration test**

`test/integration/subscriptions/subscriptions-api.int-spec.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { TestClient } from '../../support/test-client';

describe('Subscriptions API', () => {
  let ctx: TestContext;
  let user: TestClient;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(ctx);
    user = await TestClient.register(ctx);
  });
  afterAll(() => closeTestApp(ctx));

  it('creates an active bundle with catalog quota and price', async () => {
    const res = await user.post('/v1/subscriptions', { tier: 'PRO', billingCycle: 'YEARLY', autoRenew: true });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tier: 'PRO', billingCycle: 'YEARLY', maxMessages: 100, priceCents: 29990, status: 'ACTIVE', autoRenew: true, userId: user.userId });
    expect(new Date(res.body.endDate).getUTCFullYear()).toBe(new Date(res.body.startDate).getUTCFullYear() + 1);
  });

  it('returns 402 PAYMENT_FAILED and persists the bundle as inactive when payment fails', async () => {
    ctx.payments.failNext();
    const res = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PAYMENT_FAILED');
    const list = await user.get('/v1/subscriptions');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ status: 'INACTIVE', inactiveReason: 'PAYMENT_FAILED', id: res.body.error.details.subscriptionId });
  });

  it('rejects mass-assignment attempts on create and patch', async () => {
    const create = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true, userId: randomUUID(), maxMessages: 1e6 });
    expect(create.status).toBe(400);
    const sub = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    const patch = await user.patch(`/v1/subscriptions/${sub.body.id}`, { autoRenew: false, status: 'ACTIVE' });
    expect(patch.status).toBe(400);
  });

  it('toggles auto-renew for the owner', async () => {
    const sub = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    const res = await user.patch(`/v1/subscriptions/${sub.body.id}`, { autoRenew: false });
    expect(res.status).toBe(200);
    expect(res.body.autoRenew).toBe(false);
  });

  it('cancels immediately, then refuses to cancel again', async () => {
    const sub = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    const res = await user.post(`/v1/subscriptions/${sub.body.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'INACTIVE', inactiveReason: 'CANCELLED', autoRenew: false, renewalDate: null });
    const again = await user.post(`/v1/subscriptions/${sub.body.id}/cancel`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SUBSCRIPTION_NOT_ACTIVE');
  });

  it('enforces domain policy: other users get 404, admins may cancel but not toggle auto-renew', async () => {
    const sub = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    const other = await TestClient.register(ctx);
    expect((await other.post(`/v1/subscriptions/${sub.body.id}/cancel`)).status).toBe(404);
    const admin = await TestClient.register(ctx, { role: 'ADMIN' });
    expect((await admin.patch(`/v1/subscriptions/${sub.body.id}`, { autoRenew: false })).status).toBe(403);
    expect((await admin.post(`/v1/subscriptions/${sub.body.id}/cancel`)).status).toBe(200);
  });

  it('lists only own subscriptions unless admin', async () => {
    await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    const other = await TestClient.register(ctx);
    expect((await other.get(`/v1/subscriptions?userId=${user.userId}`)).status).toBe(403);
    const admin = await TestClient.register(ctx, { role: 'ADMIN' });
    const res = await admin.get(`/v1/subscriptions?userId=${user.userId}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it.each(['?limit=abc', '?limit=0', '?limit=500', '?userId=not-a-uuid', '?foo=bar'])(
    'rejects malformed list query %s with 400 (Review Focus #4)',
    async (qs) => {
      const res = await user.get(`/v1/subscriptions${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    },
  );

  it('rejects a non-uuid id with 400', async () => {
    expect((await user.post('/v1/subscriptions/123/cancel')).status).toBe(400);
  });
});
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx jest -c jest.int.config.js test/integration/subscriptions/subscriptions-api`
Expected: PASS (all tests). If `@Query()` gives a frozen object error under Express 5, the pipe already returns a new object, so check that the pipe is passed to `@Query(...)` and not applied globally.

- [ ] **Step 5: Commit**

```bash
npm run lint && npm run typecheck && npm run test:int
git add -A && git commit -m "feat(subscriptions): create/list/auto-renew/cancel API with simulated payments and row locking

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Billing cycle: renewal job and admin trigger

**Files:**
- Create: `src/subscriptions/application/run-billing-cycle.use-case.ts`, `src/subscriptions/infrastructure/billing.scheduler.ts`, `src/subscriptions/controllers/admin-billing.controller.ts`
- Modify: `src/subscriptions/subscriptions.module.ts`, `src/app.module.ts` (add `ScheduleModule.forRoot()`)
- Test: `test/integration/subscriptions/billing.int-spec.ts`

**Interfaces:**
- Consumes: `SubscriptionRepository.lockDueForRenewal`, `PaymentGateway`, `TransactionRunner`, `assertAdmin`.
- Produces:
  - `RunBillingCycleUseCase.execute(trigger: Actor | 'scheduler'): Promise<{ processed: number; renewed: number; failed: number; expired: number }>`
  - `POST /v1/admin/billing/run` (ADMIN) returns that summary with 200.

- [ ] **Step 1: Write the failing billing test**

`test/integration/subscriptions/billing.int-spec.ts`:
```ts
import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { TestClient } from '../../support/test-client';

describe('Billing cycle', () => {
  let ctx: TestContext;
  let user: TestClient;
  let admin: TestClient;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(ctx);
    user = await TestClient.register(ctx);
    admin = await TestClient.register(ctx, { role: 'ADMIN' });
  });
  afterAll(() => closeTestApp(ctx));

  async function dueSubscription(autoRenew: boolean): Promise<string> {
    const res = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew });
    const past = new Date(Date.now() - 1000);
    await ctx.prisma.subscription.update({ where: { id: res.body.id }, data: { endDate: past, renewalDate: past, usedMessages: 4 } });
    return res.body.id as string;
  }

  it('renews due subscriptions into a fresh period when payment succeeds', async () => {
    const id = await dueSubscription(true);
    const before = await ctx.prisma.subscription.findUniqueOrThrow({ where: { id } });
    const res = await admin.post('/v1/admin/billing/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ processed: 1, renewed: 1, failed: 0, expired: 0 });
    const after = await ctx.prisma.subscription.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ status: 'ACTIVE', usedMessages: 0, startDate: before.endDate });
    expect(after.endDate.getTime()).toBeGreaterThan(Date.now());
  });

  it('marks the subscription inactive when the renewal payment fails', async () => {
    const id = await dueSubscription(true);
    ctx.payments.failNext();
    const res = await admin.post('/v1/admin/billing/run');
    expect(res.body).toEqual({ processed: 1, renewed: 0, failed: 1, expired: 0 });
    expect(await ctx.prisma.subscription.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'INACTIVE', inactiveReason: 'PAYMENT_FAILED' });
  });

  it('expires without charging when auto-renew is off', async () => {
    const id = await dueSubscription(false);
    const callsBefore = ctx.payments.calls;
    const res = await admin.post('/v1/admin/billing/run');
    expect(res.body).toEqual({ processed: 1, renewed: 0, failed: 0, expired: 1 });
    expect(ctx.payments.calls).toBe(callsBefore);
    expect(await ctx.prisma.subscription.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'INACTIVE', inactiveReason: 'EXPIRED' });
  });

  it('does not touch subscriptions that are not yet due', async () => {
    await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    expect((await admin.post('/v1/admin/billing/run')).body.processed).toBe(0);
  });

  it('forbids non-admins at the controller level', async () => {
    const res = await user.post('/v1/admin/billing/run');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest -c jest.int.config.js test/integration/subscriptions/billing`
Expected: FAIL with 404 NOT_FOUND on `/v1/admin/billing/run`.

- [ ] **Step 3: Implement the use case, scheduler and admin controller**

`src/subscriptions/application/run-billing-cycle.use-case.ts`:
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../shared/application/transaction-runner';
import type { Actor } from '../../shared/domain/actor';
import { assertAdmin } from '../../shared/domain/admin-policy';
import { CLOCK, type Clock } from '../../shared/domain/clock';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../domain/ports';
import { SUBSCRIPTION_REPOSITORY, type SubscriptionRepository } from '../repositories/subscription.repository';

export interface BillingSummary {
  processed: number;
  renewed: number;
  failed: number;
  expired: number;
}

const BATCH_SIZE = 10; // keeps each transaction well under the 5s timeout
const MAX_BATCHES = 100;

@Injectable()
export class RunBillingCycleUseCase {
  private readonly logger = new Logger('RunBillingCycle');

  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subs: SubscriptionRepository,
    @Inject(PAYMENT_GATEWAY) private readonly payments: PaymentGateway,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(trigger: Actor | 'scheduler'): Promise<BillingSummary> {
    if (trigger !== 'scheduler') assertAdmin(trigger);
    const summary: BillingSummary = { processed: 0, renewed: 0, failed: 0, expired: 0 };
    const now = this.clock.now();
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const count = await this.tx.run(async () => {
        const due = await this.subs.lockDueForRenewal(now, BATCH_SIZE);
        for (const sub of due) {
          const payment = sub.autoRenew ? await this.payments.charge({ subscriptionId: sub.id, userId: sub.userId, amountCents: sub.priceCents }) : undefined;
          sub.renew(now, payment?.ok);
          await this.subs.save(sub);
          summary.processed++;
          if (!payment) summary.expired++;
          else if (payment.ok) summary.renewed++;
          else summary.failed++;
          this.logger.log({ msg: 'subscription billed', subscriptionId: sub.id, outcome: payment ? (payment.ok ? 'renewed' : 'payment_failed') : 'expired' });
        }
        return due.length;
      });
      if (count < BATCH_SIZE) break;
    }
    return summary;
  }
}
```

`src/subscriptions/infrastructure/billing.scheduler.ts`:
```ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { RunBillingCycleUseCase } from '../application/run-billing-cycle.use-case';

@Injectable()
export class BillingScheduler implements OnModuleInit {
  private readonly logger = new Logger('BillingScheduler');
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly registry: SchedulerRegistry,
    private readonly billing: RunBillingCycleUseCase,
  ) {}

  onModuleInit(): void {
    if (!this.config.BILLING_CRON) return;
    const job = new CronJob(this.config.BILLING_CRON, () => void this.tick());
    this.registry.addCronJob('billing', job);
    job.start();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const summary = await this.billing.execute('scheduler');
      if (summary.processed > 0) this.logger.log({ msg: 'billing cycle complete', ...summary });
    } catch (err) {
      this.logger.error({ msg: 'billing cycle failed', err: err instanceof Error ? err.message : String(err) });
    } finally {
      this.running = false;
    }
  }
}
```

`src/subscriptions/controllers/admin-billing.controller.ts`:
```ts
import { Controller, HttpCode, Post } from '@nestjs/common';
import type { Actor } from '../../shared/domain/actor';
import { CurrentActor, RateLimitGroup, Roles } from '../../shared/http/decorators';
import { RunBillingCycleUseCase } from '../application/run-billing-cycle.use-case';

@Controller('v1/admin/billing')
@RateLimitGroup('admin')
@Roles('ADMIN')
export class AdminBillingController {
  constructor(private readonly billing: RunBillingCycleUseCase) {}

  @Post('run')
  @HttpCode(200)
  run(@CurrentActor() actor: Actor) {
    return this.billing.execute(actor);
  }
}
```

In `subscriptions.module.ts`, add `AdminBillingController` to `controllers`, and add `RunBillingCycleUseCase` and `BillingScheduler` to `providers`. In `app.module.ts`, add `ScheduleModule.forRoot()` (from `@nestjs/schedule`) to `imports`.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx jest -c jest.int.config.js test/integration/subscriptions/billing`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint && npm run typecheck
git add -A && git commit -m "feat(subscriptions): auto-renewal billing cycle with SKIP LOCKED batches, cron scheduler and admin trigger

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Chat domain: usage period, monthly usage, quota allocator, policies

**Files:**
- Create: `src/chat/domain/ports.ts`, `src/chat/domain/services/usage-period.ts`, `src/chat/domain/entities/monthly-usage.ts`, `src/chat/domain/entities/chat-message.ts`, `src/chat/domain/policies/bundle-selection.policy.ts`, `src/chat/domain/policies/chat-access.policy.ts`, `src/chat/domain/services/quota-allocator.ts`, `src/chat/domain/services/token-estimator.ts`
- Test: `test/unit/chat/usage-period.spec.ts`, `test/unit/chat/quota-allocator.spec.ts`, `test/unit/chat/chat-access.policy.spec.ts`

**Interfaces:**
- Consumes: `DomainError`, `Actor`, `isAdmin`.
- Produces:
  - `interface BundleSnapshot { id: string; remaining: number | null; createdAt: Date; startDate: Date; endDate: Date }`
  - `interface BundleQuotaPort { peekUsableBundles(userId, now): Promise<BundleSnapshot[]>; lockUsableBundles(userId, now): Promise<BundleSnapshot[]>; consume(subscriptionId, now): Promise<void> }`, `BUNDLE_QUOTA`
  - `interface AiCompletion { id: string; model: string; content: string; usage: { promptTokens; completionTokens; totalTokens }; latencyMs: number }`
  - `interface AiCompletionPort { complete(question: string): Promise<AiCompletion> }`, `AI_COMPLETION`
  - `class UsagePeriod { value: string; static fromDate(d); resetsAt(): Date }`
  - `class MonthlyUsage` with:
    - `constructor(userId, period, freeUsed, freeLimit, totalMessages)`, `static empty(userId, period, freeLimit)`
    - getters `freeUsed, freeRemaining, totalMessages`
    - `hasFreeRemaining()`, `consumeFree()`, `recordBundleUse()`
  - `interface ChatMessageRecord { id; userId; question; answer; quotaSource: 'FREE'|'BUNDLE'; subscriptionId: string|null; period; model; promptTokens; completionTokens; totalTokens; latencyMs; requestId; createdAt }`
  - `selectBundle(bundles): BundleSnapshot | undefined`
  - `type Allocation = { source: 'FREE' } | { source: 'BUNDLE'; subscriptionId: string }`
  - `class QuotaAllocator { allocate({ usage, bundles, now }): Allocation }`
  - `ChatAccessPolicy.canListFor(actor, targetUserId)`
  - `estimateTokens(text): number`

- [ ] **Step 1: Write the failing tests**

`test/unit/chat/usage-period.spec.ts`:
```ts
import { UsagePeriod } from '../../../src/chat/domain/services/usage-period';

describe('UsagePeriod (UTC calendar month)', () => {
  it('formats YYYY-MM and resets on the 1st of the next month', () => {
    const p = UsagePeriod.fromDate(new Date('2026-09-30T23:59:59.999Z'));
    expect(p.value).toBe('2026-09');
    expect(p.resetsAt().toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
  it('switches period exactly at midnight UTC on the 1st', () => {
    expect(UsagePeriod.fromDate(new Date('2026-10-01T00:00:00.000Z')).value).toBe('2026-10');
  });
  it('rolls over the year in December', () => {
    const p = UsagePeriod.fromDate(new Date('2026-12-15T00:00:00Z'));
    expect(p.value).toBe('2026-12');
    expect(p.resetsAt().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
```

`test/unit/chat/quota-allocator.spec.ts`:
```ts
import { MonthlyUsage } from '../../../src/chat/domain/entities/monthly-usage';
import type { BundleSnapshot } from '../../../src/chat/domain/ports';
import { QuotaAllocator } from '../../../src/chat/domain/services/quota-allocator';

const now = new Date('2026-09-24T12:00:00Z');
const usage = (freeUsed: number) => new MonthlyUsage('u1', '2026-09', freeUsed, 3, freeUsed);
const bundle = (id: string, over: Partial<BundleSnapshot> = {}): BundleSnapshot => ({
  id,
  remaining: 5,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  startDate: new Date('2026-09-01T00:00:00Z'),
  endDate: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

describe('QuotaAllocator', () => {
  const allocator = new QuotaAllocator();

  it('uses free quota first even when bundles exist', () => {
    expect(allocator.allocate({ usage: usage(2), bundles: [bundle('b1')], now })).toEqual({ source: 'FREE' });
  });

  it('uses the most recently created usable bundle once free quota is exhausted', () => {
    const older = bundle('b-old', { createdAt: new Date('2026-09-01T00:00:00Z') });
    const newer = bundle('b-new', { createdAt: new Date('2026-09-10T00:00:00Z') });
    expect(allocator.allocate({ usage: usage(3), bundles: [older, newer], now })).toEqual({ source: 'BUNDLE', subscriptionId: 'b-new' });
  });

  it('breaks createdAt ties by id descending', () => {
    const t = new Date('2026-09-10T00:00:00Z');
    expect(allocator.allocate({ usage: usage(3), bundles: [bundle('a', { createdAt: t }), bundle('b', { createdAt: t })], now })).toEqual({
      source: 'BUNDLE',
      subscriptionId: 'b',
    });
  });

  it('skips exhausted, expired and not-yet-started bundles', () => {
    const bundles = [
      bundle('exhausted', { remaining: 0, createdAt: new Date('2026-09-20T00:00:00Z') }),
      bundle('expired', { endDate: now, createdAt: new Date('2026-09-19T00:00:00Z') }),
      bundle('future', { startDate: new Date('2026-09-25T00:00:00Z'), createdAt: new Date('2026-09-18T00:00:00Z') }),
      bundle('ok', { createdAt: new Date('2026-09-02T00:00:00Z') }),
    ];
    expect(allocator.allocate({ usage: usage(3), bundles, now })).toEqual({ source: 'BUNDLE', subscriptionId: 'ok' });
  });

  it('treats a null remaining (Enterprise) as unlimited', () => {
    expect(allocator.allocate({ usage: usage(3), bundles: [bundle('ent', { remaining: null })], now })).toEqual({ source: 'BUNDLE', subscriptionId: 'ent' });
  });

  it('throws a typed QUOTA_EXHAUSTED error with reset details when nothing is available', () => {
    expect(() => allocator.allocate({ usage: usage(3), bundles: [bundle('x', { remaining: 0 })], now })).toThrow(
      expect.objectContaining({
        code: 'QUOTA_EXHAUSTED',
        details: { freeUsed: 3, freeLimit: 3, freeResetsAt: '2026-10-01T00:00:00.000Z', usableBundles: 0 },
      }),
    );
  });
});

describe('MonthlyUsage', () => {
  it('consumes free quota and tracks totals', () => {
    const u = MonthlyUsage.empty('u1', '2026-09', 3);
    u.consumeFree();
    u.recordBundleUse();
    expect({ freeUsed: u.freeUsed, freeRemaining: u.freeRemaining, total: u.totalMessages }).toEqual({ freeUsed: 1, freeRemaining: 2, total: 2 });
  });
  it('refuses to consume beyond the free limit', () => {
    const u = usage(3);
    expect(() => u.consumeFree()).toThrow(expect.objectContaining({ code: 'QUOTA_EXHAUSTED' }));
  });
});
```

`test/unit/chat/chat-access.policy.spec.ts`:
```ts
import { ChatAccessPolicy } from '../../../src/chat/domain/policies/chat-access.policy';

describe('ChatAccessPolicy', () => {
  it('lets users list only their own chats and admins list anyone', () => {
    expect(ChatAccessPolicy.canListFor({ userId: 'u1', role: 'USER', sessionId: 's' }, 'u1')).toBe(true);
    expect(ChatAccessPolicy.canListFor({ userId: 'u1', role: 'USER', sessionId: 's' }, 'u2')).toBe(false);
    expect(ChatAccessPolicy.canListFor({ userId: 'a', role: 'ADMIN', sessionId: 's' }, 'u2')).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx jest -c jest.unit.config.js test/unit/chat`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the chat domain**

`src/chat/domain/ports.ts`:
```ts
export interface BundleSnapshot {
  id: string;
  remaining: number | null; // null = unlimited
  createdAt: Date;
  startDate: Date;
  endDate: Date;
}

export interface BundleQuotaPort {
  /** Non-locking read of the user's usable bundles (pre-check). */
  peekUsableBundles(userId: string, now: Date): Promise<BundleSnapshot[]>;
  /** Locks the user's active bundles (FOR UPDATE, id order) and returns the usable ones. */
  lockUsableBundles(userId: string, now: Date): Promise<BundleSnapshot[]>;
  consume(subscriptionId: string, now: Date): Promise<void>;
}
export const BUNDLE_QUOTA = Symbol('BUNDLE_QUOTA');

export interface AiCompletion {
  id: string;
  model: string;
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
}

export interface AiCompletionPort {
  complete(question: string): Promise<AiCompletion>;
}
export const AI_COMPLETION = Symbol('AI_COMPLETION');
```

`src/chat/domain/services/usage-period.ts`:
```ts
export class UsagePeriod {
  private constructor(
    readonly value: string,
    private readonly year: number,
    private readonly month: number,
  ) {}

  static fromDate(date: Date): UsagePeriod {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    return new UsagePeriod(`${y}-${String(m + 1).padStart(2, '0')}`, y, m);
  }

  resetsAt(): Date {
    return new Date(Date.UTC(this.year, this.month + 1, 1));
  }
}
```

`src/chat/domain/entities/monthly-usage.ts`:
```ts
import { DomainError } from '../../../shared/domain/errors';

export class MonthlyUsage {
  constructor(
    readonly userId: string,
    readonly period: string,
    private _freeUsed: number,
    readonly freeLimit: number,
    private _totalMessages: number,
  ) {}

  static empty(userId: string, period: string, freeLimit: number): MonthlyUsage {
    return new MonthlyUsage(userId, period, 0, freeLimit, 0);
  }

  get freeUsed(): number { return this._freeUsed; }
  get totalMessages(): number { return this._totalMessages; }
  get freeRemaining(): number { return Math.max(0, this.freeLimit - this._freeUsed); }

  hasFreeRemaining(): boolean {
    return this._freeUsed < this.freeLimit;
  }

  consumeFree(): void {
    if (!this.hasFreeRemaining()) throw new DomainError('QUOTA_EXHAUSTED', 'Free monthly quota is exhausted');
    this._freeUsed += 1;
    this._totalMessages += 1;
  }

  recordBundleUse(): void {
    this._totalMessages += 1;
  }
}
```

`src/chat/domain/entities/chat-message.ts`:
```ts
export type QuotaSource = 'FREE' | 'BUNDLE';

export interface ChatMessageRecord {
  id: string;
  userId: string;
  question: string;
  answer: string;
  quotaSource: QuotaSource;
  subscriptionId: string | null;
  period: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  requestId: string;
  createdAt: Date;
}
```

`src/chat/domain/policies/bundle-selection.policy.ts`:
```ts
import type { BundleSnapshot } from '../ports';

/** Spec A1: "latest remaining quota" = the most recently created usable bundle (ties: id DESC). */
export function selectBundle(usable: readonly BundleSnapshot[]): BundleSnapshot | undefined {
  return [...usable].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0];
}
```

`src/chat/domain/policies/chat-access.policy.ts`:
```ts
import { isAdmin, type Actor } from '../../../shared/domain/actor';

export const ChatAccessPolicy = {
  canListFor: (actor: Actor, targetUserId: string): boolean => isAdmin(actor) || targetUserId === actor.userId,
};
```

`src/chat/domain/services/quota-allocator.ts`:
```ts
import { DomainError } from '../../../shared/domain/errors';
import type { MonthlyUsage } from '../entities/monthly-usage';
import { selectBundle } from '../policies/bundle-selection.policy';
import type { BundleSnapshot } from '../ports';
import { UsagePeriod } from './usage-period';

export type Allocation = { source: 'FREE' } | { source: 'BUNDLE'; subscriptionId: string };

const isUsable = (b: BundleSnapshot, now: Date) => b.startDate <= now && now < b.endDate && (b.remaining === null || b.remaining > 0);

export class QuotaAllocator {
  allocate(input: { usage: MonthlyUsage; bundles: readonly BundleSnapshot[]; now: Date }): Allocation {
    if (input.usage.hasFreeRemaining()) return { source: 'FREE' };
    const chosen = selectBundle(input.bundles.filter((b) => isUsable(b, input.now)));
    if (!chosen) {
      throw new DomainError('QUOTA_EXHAUSTED', 'Monthly free quota is used up and no active bundle has remaining messages', {
        freeUsed: input.usage.freeUsed,
        freeLimit: input.usage.freeLimit,
        freeResetsAt: UsagePeriod.fromDate(input.now).resetsAt().toISOString(),
        usableBundles: 0,
      });
    }
    return { source: 'BUNDLE', subscriptionId: chosen.id };
  }
}
```

`src/chat/domain/services/token-estimator.ts`:
```ts
/** Rough OpenAI-style estimate (~4 chars/token); used only by the mock. */
export const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `npx jest -c jest.unit.config.js test/unit/chat`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
npm run lint && npm run typecheck
git add -A && git commit -m "feat(chat): add UTC usage period, monthly usage, quota allocator and bundle selection policy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Chat API: ask a question with transactional quota deduction, list history

**Files:**
- Create: `src/chat/repositories/monthly-usage.repository.ts`, `src/chat/repositories/prisma-monthly-usage.repository.ts`, `src/chat/repositories/chat-message.repository.ts`, `src/chat/repositories/prisma-chat-message.repository.ts`, `src/chat/infrastructure/mock-openai.adapter.ts`, `src/subscriptions/infrastructure/bundle-quota.adapter.ts`, `src/chat/application/ask-question.use-case.ts`, `src/chat/application/list-chats.use-case.ts`, `src/chat/controllers/chat.controller.ts`, `src/chat/chat.module.ts`, `src/chat/index.ts`
- Modify: `src/subscriptions/subscriptions.module.ts` (provide and export `BUNDLE_QUOTA`), `src/app.module.ts` (import `ChatModule`)
- Test: `test/integration/chat/chat-api.int-spec.ts`

**Interfaces:**
- Consumes: the Task 11 domain, `SubscriptionRepository`, `TransactionRunner`, `Clock`, `APP_CONFIG`, `listQuerySchema`, `safeText`, `stripHtml`.
- Produces:
  - `MonthlyUsageRepository { find(userId, period): Promise<MonthlyUsage|null>; lockOrCreate(userId, period, freeLimit): Promise<MonthlyUsage>; save(usage): Promise<void> }`, `MONTHLY_USAGE_REPOSITORY`
  - `ChatMessageRepository { create(record): Promise<void>; listByUser(userId, limit): Promise<ChatMessageRecord[]> }`, `CHAT_MESSAGE_REPOSITORY`
  - `AskQuestionUseCase.execute({ actor, question, requestId, isCancelled }): Promise<AskResult>`, where `AskResult = { message: ChatMessageRecord; quota: { source; subscriptionId: string|null; freeRemaining: number; freeResetsAt: Date } }`
  - `ListChatsUseCase.execute(actor, { userId?, limit })`
  - `POST /v1/chat/messages` returns 201 `{ id, question, answer, model, usage:{promptTokens,completionTokens,totalTokens}, quota:{source, subscriptionId, freeRemaining, freeResetsAt}, createdAt }`
  - `GET /v1/chat/messages` returns `{ items: ChatMessageRecord[] }`

- [ ] **Step 1: Write the repositories**

`src/chat/repositories/monthly-usage.repository.ts`:
```ts
import type { MonthlyUsage } from '../domain/entities/monthly-usage';

export interface MonthlyUsageRepository {
  find(userId: string, period: string): Promise<MonthlyUsage | null>;
  /** INSERT … ON CONFLICT DO NOTHING, then SELECT … FOR UPDATE. Call inside a transaction. */
  lockOrCreate(userId: string, period: string, freeLimit: number): Promise<MonthlyUsage>;
  save(usage: MonthlyUsage): Promise<void>;
}
export const MONTHLY_USAGE_REPOSITORY = Symbol('MONTHLY_USAGE_REPOSITORY');
```

`src/chat/repositories/prisma-monthly-usage.repository.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PrismaTransactionRunner } from '../../shared/prisma/prisma-transaction-runner';
import { MonthlyUsage } from '../domain/entities/monthly-usage';
import type { MonthlyUsageRepository } from './monthly-usage.repository';

interface Row {
  user_id: string;
  period: string;
  free_used: number;
  free_limit: number;
  total_messages: number;
}

@Injectable()
export class PrismaMonthlyUsageRepository implements MonthlyUsageRepository {
  constructor(private readonly tx: PrismaTransactionRunner) {}

  async find(userId: string, period: string): Promise<MonthlyUsage | null> {
    const r = await this.tx.db().monthlyUsage.findUnique({ where: { userId_period: { userId, period } } });
    return r ? new MonthlyUsage(r.userId, r.period, r.freeUsed, r.freeLimit, r.totalMessages) : null;
  }

  async lockOrCreate(userId: string, period: string, freeLimit: number): Promise<MonthlyUsage> {
    const db = this.tx.db();
    await db.$executeRaw`
      INSERT INTO monthly_usage (user_id, period, free_used, free_limit, total_messages)
      VALUES (${userId}::uuid, ${period}, 0, ${freeLimit}, 0)
      ON CONFLICT (user_id, period) DO NOTHING`;
    const rows = await db.$queryRaw<Row[]>`
      SELECT user_id, period, free_used, free_limit, total_messages
      FROM monthly_usage WHERE user_id = ${userId}::uuid AND period = ${period} FOR UPDATE`;
    const r = rows[0];
    if (!r) throw new Error('monthly_usage row missing after upsert');
    return new MonthlyUsage(r.user_id, r.period, r.free_used, r.free_limit, r.total_messages);
  }

  async save(usage: MonthlyUsage): Promise<void> {
    await this.tx.db().monthlyUsage.update({
      where: { userId_period: { userId: usage.userId, period: usage.period } },
      data: { freeUsed: usage.freeUsed, totalMessages: usage.totalMessages },
    });
  }
}
```

`src/chat/repositories/chat-message.repository.ts`:
```ts
import type { ChatMessageRecord } from '../domain/entities/chat-message';

export interface ChatMessageRepository {
  create(record: ChatMessageRecord): Promise<void>;
  listByUser(userId: string, limit: number): Promise<ChatMessageRecord[]>;
}
export const CHAT_MESSAGE_REPOSITORY = Symbol('CHAT_MESSAGE_REPOSITORY');
```

`src/chat/repositories/prisma-chat-message.repository.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PrismaTransactionRunner } from '../../shared/prisma/prisma-transaction-runner';
import type { ChatMessageRecord } from '../domain/entities/chat-message';
import type { ChatMessageRepository } from './chat-message.repository';

@Injectable()
export class PrismaChatMessageRepository implements ChatMessageRepository {
  constructor(private readonly tx: PrismaTransactionRunner) {}

  async create(record: ChatMessageRecord): Promise<void> {
    await this.tx.db().chatMessage.create({ data: { ...record } });
  }

  listByUser(userId: string, limit: number): Promise<ChatMessageRecord[]> {
    return this.tx.db().chatMessage.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit });
  }
}
```

- [ ] **Step 2: Write the adapters (mock OpenAI, bundle quota)**

`src/chat/infrastructure/mock-openai.adapter.ts`:
```ts
import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { stripHtml } from '../../shared/http/sanitize';
import type { AiCompletion, AiCompletionPort } from '../domain/ports';
import { estimateTokens } from '../domain/services/token-estimator';

const CANNED = [
  'Here is a concise answer based on general knowledge.',
  'Great question. In short: it depends on context, but the common approach is outlined below.',
  'The key idea is to break the problem into smaller, testable parts.',
  'Short answer: yes, with a few caveats worth checking.',
  'Most practitioners would start with the simplest option and iterate.',
];

/** Mirrors the OpenAI Chat Completions response shape, with simulated latency. */
interface OpenAiChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: { index: number; message: { role: 'assistant'; content: string }; finish_reason: 'stop' }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

@Injectable()
export class MockOpenAiAdapter implements AiCompletionPort {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async complete(question: string): Promise<AiCompletion> {
    const started = Date.now();
    const { AI_MOCK_MIN_LATENCY_MS: min, AI_MOCK_MAX_LATENCY_MS: max } = this.config;
    await new Promise((r) => setTimeout(r, min + Math.floor(Math.random() * (max - min + 1))));
    const raw = this.fakeOpenAi(question);
    const content = stripHtml(raw.choices[0]?.message.content ?? '');
    return {
      id: raw.id,
      model: raw.model,
      content,
      usage: { promptTokens: raw.usage.prompt_tokens, completionTokens: raw.usage.completion_tokens, totalTokens: raw.usage.total_tokens },
      latencyMs: Date.now() - started,
    };
  }

  private fakeOpenAi(question: string): OpenAiChatCompletion {
    const idx = createHash('sha256').update(question).digest()[0]! % CANNED.length;
    const content = `${CANNED[idx]!} (mock response to: "${question.slice(0, 80)}")`;
    const prompt = estimateTokens(question);
    const completion = estimateTokens(content);
    return {
      id: `chatcmpl-mock-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
    };
  }
}
```

`src/subscriptions/infrastructure/bundle-quota.adapter.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { BundleQuotaPort, BundleSnapshot } from '../../chat/domain/ports';
import { DomainError } from '../../shared/domain/errors';
import type { Subscription } from '../domain/entities/subscription';
import { SUBSCRIPTION_REPOSITORY, type SubscriptionRepository } from '../repositories/subscription.repository';

const toSnapshot = (s: Subscription): BundleSnapshot => ({
  id: s.id,
  remaining: s.remaining(),
  createdAt: s.createdAt,
  startDate: s.startDate,
  endDate: s.endDate,
});

/** Subscriptions' implementation of the port the chat module defines. */
@Injectable()
export class BundleQuotaAdapter implements BundleQuotaPort {
  constructor(@Inject(SUBSCRIPTION_REPOSITORY) private readonly subs: SubscriptionRepository) {}

  async peekUsableBundles(userId: string, now: Date): Promise<BundleSnapshot[]> {
    return (await this.subs.listActiveForUser(userId)).filter((s) => s.isUsableAt(now)).map(toSnapshot);
  }

  async lockUsableBundles(userId: string, now: Date): Promise<BundleSnapshot[]> {
    return (await this.subs.lockActiveForUser(userId)).filter((s) => s.isUsableAt(now)).map(toSnapshot);
  }

  async consume(subscriptionId: string, now: Date): Promise<void> {
    const sub = await this.subs.findById(subscriptionId);
    if (!sub) throw new DomainError('QUOTA_EXHAUSTED', 'Subscription not available');
    sub.consume(now);
    await this.subs.save(sub);
  }
}
```

In `subscriptions.module.ts`:
- add `import { BUNDLE_QUOTA } from '../chat/domain/ports';` and `import { BundleQuotaAdapter } from './infrastructure/bundle-quota.adapter';`
- add `{ provide: BUNDLE_QUOTA, useClass: BundleQuotaAdapter }` to `providers`
- add `BUNDLE_QUOTA` to `exports`

- [ ] **Step 3: Write the use cases, controller and module**

`src/chat/application/ask-question.use-case.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../shared/application/transaction-runner';
import type { Actor } from '../../shared/domain/actor';
import { CLOCK, type Clock } from '../../shared/domain/clock';
import { DomainError } from '../../shared/domain/errors';
import type { ChatMessageRecord, QuotaSource } from '../domain/entities/chat-message';
import { MonthlyUsage } from '../domain/entities/monthly-usage';
import { AI_COMPLETION, BUNDLE_QUOTA, type AiCompletionPort, type BundleQuotaPort } from '../domain/ports';
import { QuotaAllocator } from '../domain/services/quota-allocator';
import { UsagePeriod } from '../domain/services/usage-period';
import { CHAT_MESSAGE_REPOSITORY, type ChatMessageRepository } from '../repositories/chat-message.repository';
import { MONTHLY_USAGE_REPOSITORY, type MonthlyUsageRepository } from '../repositories/monthly-usage.repository';

export interface AskResult {
  message: ChatMessageRecord;
  quota: { source: QuotaSource; subscriptionId: string | null; freeRemaining: number; freeResetsAt: Date };
}

@Injectable()
export class AskQuestionUseCase {
  private readonly allocator = new QuotaAllocator();

  constructor(
    @Inject(MONTHLY_USAGE_REPOSITORY) private readonly usage: MonthlyUsageRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY) private readonly messages: ChatMessageRepository,
    @Inject(BUNDLE_QUOTA) private readonly bundles: BundleQuotaPort,
    @Inject(AI_COMPLETION) private readonly ai: AiCompletionPort,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async execute(input: { actor: Actor; question: string; requestId: string; isCancelled: () => boolean }): Promise<AskResult> {
    const userId = input.actor.userId;
    const freeLimit = this.config.FREE_MESSAGES_PER_MONTH;

    // 1. Cheap, non-locking pre-check: don't spend an AI call on a user with no quota.
    const checkNow = this.clock.now();
    const period = UsagePeriod.fromDate(checkNow).value;
    const snapshot = (await this.usage.find(userId, period)) ?? MonthlyUsage.empty(userId, period, freeLimit);
    if (!snapshot.hasFreeRemaining()) {
      this.allocator.allocate({ usage: snapshot, bundles: await this.bundles.peekUsableBundles(userId, checkNow), now: checkNow });
    }

    // 2. Mock AI call: outside any transaction, no locks held.
    const completion = await this.ai.complete(input.question);
    if (input.isCancelled()) throw new DomainError('REQUEST_TIMEOUT', 'Request timed out');

    // 3. Authoritative, atomic deduction. Lock order: monthly_usage, then subscriptions by id.
    return this.tx.run(async () => {
      const now = this.clock.now();
      const p = UsagePeriod.fromDate(now);
      const usage = await this.usage.lockOrCreate(userId, p.value, freeLimit);
      const bundles = usage.hasFreeRemaining() ? [] : await this.bundles.lockUsableBundles(userId, now);
      const allocation = this.allocator.allocate({ usage, bundles, now });
      if (allocation.source === 'FREE') {
        usage.consumeFree();
      } else {
        await this.bundles.consume(allocation.subscriptionId, now);
        usage.recordBundleUse();
      }
      await this.usage.save(usage);
      const message: ChatMessageRecord = {
        id: randomUUID(),
        userId,
        question: input.question,
        answer: completion.content,
        quotaSource: allocation.source,
        subscriptionId: allocation.source === 'BUNDLE' ? allocation.subscriptionId : null,
        period: p.value,
        model: completion.model,
        promptTokens: completion.usage.promptTokens,
        completionTokens: completion.usage.completionTokens,
        totalTokens: completion.usage.totalTokens,
        latencyMs: completion.latencyMs,
        requestId: input.requestId,
        createdAt: now,
      };
      await this.messages.create(message);
      return {
        message,
        quota: { source: allocation.source, subscriptionId: message.subscriptionId, freeRemaining: usage.freeRemaining, freeResetsAt: p.resetsAt() },
      };
    });
  }
}
```

`src/chat/application/list-chats.use-case.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../shared/domain/actor';
import { DomainError } from '../../shared/domain/errors';
import type { ChatMessageRecord } from '../domain/entities/chat-message';
import { ChatAccessPolicy } from '../domain/policies/chat-access.policy';
import { CHAT_MESSAGE_REPOSITORY, type ChatMessageRepository } from '../repositories/chat-message.repository';

@Injectable()
export class ListChatsUseCase {
  constructor(@Inject(CHAT_MESSAGE_REPOSITORY) private readonly messages: ChatMessageRepository) {}

  execute(actor: Actor, query: { userId?: string | undefined; limit: number }): Promise<ChatMessageRecord[]> {
    const target = query.userId ?? actor.userId;
    if (!ChatAccessPolicy.canListFor(actor, target)) throw new DomainError('FORBIDDEN', 'Cannot list another user’s chats');
    return this.messages.listByUser(target, query.limit);
  }
}
```

`src/chat/controllers/chat.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { Actor } from '../../shared/domain/actor';
import { CurrentActor, RateLimitGroup, Roles } from '../../shared/http/decorators';
import { listQuerySchema, type ListQuery } from '../../shared/http/list-query';
import { safeText } from '../../shared/http/sanitize';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AskQuestionUseCase } from '../application/ask-question.use-case';
import { ListChatsUseCase } from '../application/list-chats.use-case';

const askSchema = z.strictObject({ question: safeText(4000) });

@Controller('v1/chat')
@RateLimitGroup('chat')
@Roles('USER', 'ADMIN')
export class ChatController {
  constructor(
    private readonly askUc: AskQuestionUseCase,
    private readonly listUc: ListChatsUseCase,
  ) {}

  @Post('messages')
  @HttpCode(201)
  async ask(@CurrentActor() actor: Actor, @Req() req: Request, @Body(new ZodValidationPipe(askSchema)) body: z.infer<typeof askSchema>) {
    const { message: m, quota } = await this.askUc.execute({
      actor,
      question: body.question,
      requestId: req.requestId,
      isCancelled: () => req.timedOut === true,
    });
    return {
      id: m.id,
      question: m.question,
      answer: m.answer,
      model: m.model,
      usage: { promptTokens: m.promptTokens, completionTokens: m.completionTokens, totalTokens: m.totalTokens },
      quota,
      createdAt: m.createdAt,
    };
  }

  @Get('messages')
  async list(@CurrentActor() actor: Actor, @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery) {
    return { items: await this.listUc.execute(actor, query) };
  }
}
```

`src/chat/chat.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions';
import { AskQuestionUseCase } from './application/ask-question.use-case';
import { ListChatsUseCase } from './application/list-chats.use-case';
import { ChatController } from './controllers/chat.controller';
import { AI_COMPLETION } from './domain/ports';
import { MockOpenAiAdapter } from './infrastructure/mock-openai.adapter';
import { CHAT_MESSAGE_REPOSITORY } from './repositories/chat-message.repository';
import { MONTHLY_USAGE_REPOSITORY } from './repositories/monthly-usage.repository';
import { PrismaChatMessageRepository } from './repositories/prisma-chat-message.repository';
import { PrismaMonthlyUsageRepository } from './repositories/prisma-monthly-usage.repository';

@Module({
  imports: [SubscriptionsModule],
  controllers: [ChatController],
  providers: [
    AskQuestionUseCase,
    ListChatsUseCase,
    { provide: AI_COMPLETION, useClass: MockOpenAiAdapter },
    { provide: MONTHLY_USAGE_REPOSITORY, useClass: PrismaMonthlyUsageRepository },
    { provide: CHAT_MESSAGE_REPOSITORY, useClass: PrismaChatMessageRepository },
  ],
})
export class ChatModule {}
```

`src/chat/index.ts`:
```ts
export { ChatModule } from './chat.module';
export { UsagePeriod } from './domain/services/usage-period';
```

Add `ChatModule` to `AppModule.imports`.

- [ ] **Step 4: Write the failing chat integration test**

`test/integration/chat/chat-api.int-spec.ts`:
```ts
import request from 'supertest';
import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { TestClient } from '../../support/test-client';

describe('Chat API', () => {
  let ctx: TestContext;
  let user: TestClient;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(ctx);
    user = await TestClient.register(ctx);
  });
  afterAll(() => closeTestApp(ctx));

  const ask = (c: TestClient, question = 'What is DDD?') => c.post('/v1/chat/messages', { question });
  const exhaustFree = async (c: TestClient) => {
    for (let i = 0; i < 3; i++) expect((await ask(c)).status).toBe(201);
  };

  it('answers with a mocked OpenAI response and stores question, answer, tokens and metadata', async () => {
    const res = await ask(user, 'How do transactions work?');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      question: 'How do transactions work?',
      model: 'gpt-4o-mini',
      quota: { source: 'FREE', subscriptionId: null, freeRemaining: 2 },
    });
    expect(res.body.usage.totalTokens).toBe(res.body.usage.promptTokens + res.body.usage.completionTokens);
    const row = await ctx.prisma.chatMessage.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row).toMatchObject({ userId: user.userId, question: 'How do transactions work?', answer: res.body.answer, requestId: res.headers['x-request-id'] });
  });

  it('gives 3 free messages then a typed 402 QUOTA_EXHAUSTED', async () => {
    await exhaustFree(user);
    const res = await ask(user);
    expect(res.status).toBe(402);
    expect(res.body.error).toMatchObject({ code: 'QUOTA_EXHAUSTED', details: { freeUsed: 3, freeLimit: 3, usableBundles: 0 } });
  });

  it('charges the newest bundle after free quota', async () => {
    const older = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    const newer = await user.post('/v1/subscriptions', { tier: 'PRO', billingCycle: 'MONTHLY', autoRenew: true });
    await exhaustFree(user);
    const res = await ask(user);
    expect(res.status).toBe(201);
    expect(res.body.quota).toMatchObject({ source: 'BUNDLE', subscriptionId: newer.body.id });
    expect((await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: newer.body.id } })).usedMessages).toBe(1);
    expect((await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: older.body.id } })).usedMessages).toBe(0);
  });

  it('never charges a cancelled or expired bundle (Review Focus #3)', async () => {
    const cancelled = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    await user.post(`/v1/subscriptions/${cancelled.body.id}/cancel`);
    const expired = await user.post('/v1/subscriptions', { tier: 'PRO', billingCycle: 'MONTHLY', autoRenew: true });
    await ctx.prisma.subscription.update({ where: { id: expired.body.id }, data: { endDate: new Date(Date.now() - 1000) } });
    await exhaustFree(user);
    const res = await ask(user);
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('QUOTA_EXHAUSTED');
  });

  it('is atomic under concurrency: 10 parallel requests with 3 free left → exactly 3 succeed', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => ask(user, `parallel ${i}`)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 402)).toHaveLength(7);
    const usage = await ctx.prisma.monthlyUsage.findFirstOrThrow({ where: { userId: user.userId } });
    expect(usage.freeUsed).toBe(3);
    expect(await ctx.prisma.chatMessage.count({ where: { userId: user.userId } })).toBe(3);
  });

  it('never over-draws a bundle under concurrency', async () => {
    const sub = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    await exhaustFree(user);
    const results = await Promise.all(Array.from({ length: 15 }, (_, i) => ask(user, `drain ${i}`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect((await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: sub.body.id } })).usedMessages).toBe(10);
  });

  it('sanitises markup, rejects markup-only questions and keeps emoji (Review Focus #1)', async () => {
    const xss = await ask(user, '<script>alert(1)</script>What is 2+2?');
    expect(xss.status).toBe(201);
    expect(xss.body.question).toBe('What is 2+2?');
    expect(xss.body.answer).not.toMatch(/<script/i);
    expect((await ask(user, '<b></b>')).status).toBe(400);
    const emoji = await ask(user, 'Explain 🚀 rockets');
    expect(emoji.status).toBe(201);
    expect(emoji.body.question).toBe('Explain 🚀 rockets');
  });

  it('rejects a body that differs from the signed body', async () => {
    const signedRaw = JSON.stringify({ question: 'harmless' });
    const res = await request(ctx.http)
      .post('/v1/chat/messages')
      .set(user.headers('POST', '/v1/chat/messages', signedRaw))
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ question: 'tampered' }));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('lists own history; users cannot list others; admins can', async () => {
    await ask(user);
    const own = await user.get('/v1/chat/messages');
    expect(own.body.items).toHaveLength(1);
    const other = await TestClient.register(ctx);
    expect((await other.get(`/v1/chat/messages?userId=${user.userId}`)).status).toBe(403);
    const admin = await TestClient.register(ctx, { role: 'ADMIN' });
    expect((await admin.get(`/v1/chat/messages?userId=${user.userId}`)).body.items).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `npx jest -c jest.int.config.js test/integration/chat`
Expected: PASS (9 tests).
- If the concurrency test gets more than 3 × 201, the lock is not held: check that `lockOrCreate` runs inside `tx.run` (inspect `this.tx.db() !== prisma`).
- If it deadlocks or times out, check that `lockUsableBundles` orders by `id`.

- [ ] **Step 6: Commit**

```bash
npm run lint && npm run typecheck && npm run test:int
git add -A && git commit -m "feat(chat): ask endpoint with mock OpenAI, row-locked atomic quota deduction, history listing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Observability: health, metrics, structured logs

**Files:**
- Create: `src/observability/health.controller.ts`, `src/observability/metrics.query.ts`, `src/observability/get-metrics.use-case.ts`, `src/observability/metrics.controller.ts`, `src/observability/observability.module.ts`
- Modify: `src/app.module.ts` (import `ObservabilityModule`)
- Test: `test/integration/observability/observability.int-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `RedisService`, `assertAdmin`, `UsagePeriod` (from `src/chat/index.ts`), `HealthProbe`, `Roles`, `RateLimitGroup`, `CurrentActor`.
- Produces:
  - `GET /health` returns 200 `{ status: 'ok', checks: { database: 'up', redis: 'up' } }`, or 503 with `status: 'degraded'`.
  - `GET /v1/admin/metrics` returns `{ users, chat: { period, messages, free, bundle, tokens }, subscriptions: { activeByTier: Record<Tier,number>, inactiveByReason: Record<InactiveReason,number> } }`.

- [ ] **Step 1: Write the failing observability test**

`test/integration/observability/observability.int-spec.ts`:
```ts
import { Writable } from 'node:stream';
import request from 'supertest';
import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { TestClient } from '../../support/test-client';

describe('Observability', () => {
  let ctx: TestContext;
  const lines: Record<string, unknown>[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const l of chunk.toString().split('\n').filter(Boolean)) lines.push(JSON.parse(l) as Record<string, unknown>);
      cb();
    },
  });

  beforeAll(async () => {
    ctx = await createTestApp({ env: { LOG_LEVEL: 'info' }, logStream });
  });
  beforeEach(() => resetState(ctx));
  afterAll(() => closeTestApp(ctx));

  it('protects /health with the probe token', async () => {
    expect((await request(ctx.http).get('/health')).status).toBe(401);
    expect((await request(ctx.http).get('/health').set('X-Health-Token', 'wrong-token-wrong-token')).status).toBe(401);
    const ok = await request(ctx.http).get('/health').set('X-Health-Token', ctx.config.HEALTH_CHECK_TOKEN);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('serves usage and subscription metrics to admins only', async () => {
    const user = await TestClient.register(ctx);
    await user.post('/v1/chat/messages', { question: 'hello' });
    await user.post('/v1/subscriptions', { tier: 'PRO', billingCycle: 'MONTHLY', autoRenew: true });
    expect((await user.get('/v1/admin/metrics')).status).toBe(403);
    const admin = await TestClient.register(ctx, { role: 'ADMIN' });
    const res = await admin.get('/v1/admin/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      users: 2,
      chat: { messages: 1, free: 1, bundle: 0 },
      subscriptions: { activeByTier: { BASIC: 0, PRO: 1, ENTERPRISE: 0 }, inactiveByReason: { CANCELLED: 0, PAYMENT_FAILED: 0, EXPIRED: 0 } },
    });
    expect(res.body.chat.tokens).toBeGreaterThan(0);
  });

  it('logs request id, user id and response time as structured JSON without secrets', async () => {
    const user = await TestClient.register(ctx);
    lines.length = 0;
    const res = await user.get('/v1/auth/me');
    await new Promise((r) => setImmediate(r));
    const entry = lines.find((l) => l.path === '/v1/auth/me');
    expect(entry).toMatchObject({ requestId: res.headers['x-request-id'], userId: user.userId, statusCode: 200, method: 'GET' });
    expect(typeof entry?.responseTimeMs).toBe('number');
    expect(JSON.stringify(lines)).not.toContain(user.token);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest -c jest.int.config.js test/integration/observability`
Expected: FAIL (404 on `/health`).

- [ ] **Step 3: Implement health and metrics**

`src/observability/health.controller.ts`:
```ts
import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthProbe, RateLimitGroup } from '../shared/http/decorators';
import { PrismaService } from '../shared/prisma/prisma.service';
import { RedisService } from '../shared/redis/redis.service';

@Controller('health')
@RateLimitGroup('ops')
@HealthProbe()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'up' as const, () => 'down' as const),
      this.redis.client.ping().then(() => 'up' as const, () => 'down' as const),
    ]);
    const healthy = database === 'up' && redis === 'up';
    res.status(healthy ? 200 : 503);
    return { status: healthy ? 'ok' : 'degraded', checks: { database, redis } };
  }
}
```

Note: `IpRateLimitGuard` uses Redis. If Redis is down, `/health` returns 503 `SERVICE_UNAVAILABLE` from the guard, which is still a correct "unhealthy" signal.

`src/observability/metrics.query.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { UsagePeriod } from '../chat';
import { PrismaService } from '../shared/prisma/prisma.service';

export interface Metrics {
  users: number;
  chat: { period: string; messages: number; free: number; bundle: number; tokens: number };
  subscriptions: {
    activeByTier: { BASIC: number; PRO: number; ENTERPRISE: number };
    inactiveByReason: { CANCELLED: number; PAYMENT_FAILED: number; EXPIRED: number };
  };
}

@Injectable()
export class MetricsQuery {
  constructor(private readonly prisma: PrismaService) {}

  async collect(now: Date): Promise<Metrics> {
    const period = UsagePeriod.fromDate(now).value;
    const [users, chat, active, inactive] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.chatMessage.groupBy({ by: ['quotaSource'], where: { period }, _count: { _all: true }, _sum: { totalTokens: true } }),
      this.prisma.subscription.groupBy({ by: ['tier'], where: { status: 'ACTIVE' }, _count: { _all: true } }),
      this.prisma.subscription.groupBy({ by: ['inactiveReason'], where: { status: 'INACTIVE' }, _count: { _all: true } }),
    ]);
    const bySource = (s: 'FREE' | 'BUNDLE') => chat.find((c) => c.quotaSource === s);
    const activeByTier = { BASIC: 0, PRO: 0, ENTERPRISE: 0 };
    for (const a of active) activeByTier[a.tier] = a._count._all;
    const inactiveByReason = { CANCELLED: 0, PAYMENT_FAILED: 0, EXPIRED: 0 };
    for (const i of inactive) if (i.inactiveReason) inactiveByReason[i.inactiveReason] = i._count._all;
    const free = bySource('FREE')?._count._all ?? 0;
    const bundle = bySource('BUNDLE')?._count._all ?? 0;
    return {
      users,
      chat: { period, messages: free + bundle, free, bundle, tokens: chat.reduce((n, c) => n + (c._sum.totalTokens ?? 0), 0) },
      subscriptions: { activeByTier, inactiveByReason },
    };
  }
}
```

`src/observability/get-metrics.use-case.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../shared/domain/actor';
import { assertAdmin } from '../shared/domain/admin-policy';
import { CLOCK, type Clock } from '../shared/domain/clock';
import { MetricsQuery, type Metrics } from './metrics.query';

@Injectable()
export class GetMetricsUseCase {
  constructor(
    private readonly query: MetricsQuery,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(actor: Actor): Promise<Metrics> {
    assertAdmin(actor); // domain-level check in addition to @Roles('ADMIN')
    return this.query.collect(this.clock.now());
  }
}
```

`src/observability/metrics.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import type { Actor } from '../shared/domain/actor';
import { CurrentActor, RateLimitGroup, Roles } from '../shared/http/decorators';
import { GetMetricsUseCase } from './get-metrics.use-case';

@Controller('v1/admin/metrics')
@RateLimitGroup('admin')
@Roles('ADMIN')
export class MetricsController {
  constructor(private readonly metrics: GetMetricsUseCase) {}

  @Get()
  get(@CurrentActor() actor: Actor) {
    return this.metrics.execute(actor);
  }
}
```

`src/observability/observability.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { GetMetricsUseCase } from './get-metrics.use-case';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { MetricsQuery } from './metrics.query';

@Module({ controllers: [HealthController, MetricsController], providers: [MetricsQuery, GetMetricsUseCase] })
export class ObservabilityModule {}
```

Add `ObservabilityModule` to `AppModule.imports`.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx jest -c jest.int.config.js test/integration/observability`
Expected: PASS (3 tests). If the log test can't find the entry, check that `requestLogger` is registered **before** the routes. It is registered in `configureApp`, which runs before `app.init()`.

- [ ] **Step 5: Commit**

```bash
npm run lint && npm run typecheck
git add -A && git commit -m "feat(observability): token-protected health check, admin metrics, structured request logs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Cross-cutting security integration: default deny, rate limits, timeout behaviour

**Files:**
- Test: `test/integration/security/default-deny.int-spec.ts`, `test/integration/security/rate-limit.int-spec.ts`, `test/integration/security/timeout.int-spec.ts`

**Interfaces:**
- Consumes: `createTestApp`, `TestClient`, and all routes.
- Produces: no new code, unless a test exposes a bug. Fix bugs in the owning file.

- [ ] **Step 1: Write the default-deny test (enumerates every registered route)**

`test/integration/security/default-deny.int-spec.ts`:
```ts
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { closeTestApp, createTestApp, type TestContext } from '../../support/test-app';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
}

describe('Default deny: no open or bypassable endpoints', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => closeTestApp(ctx));

  function routes(): { method: string; path: string }[] {
    const instance = ctx.app.getHttpAdapter().getInstance() as { router: { stack: Layer[] } };
    return instance.router.stack
      .filter((l): l is Required<Layer> => l.route !== undefined)
      .flatMap((l) => Object.keys(l.route.methods).map((m) => ({ method: m, path: l.route.path.replace(':id', randomUUID()) })));
  }

  it('discovers all application routes', () => {
    expect(routes().length).toBeGreaterThanOrEqual(11);
  });

  it('rejects every route without credentials with 401', async () => {
    for (const { method, path } of routes()) {
      const res = await (request(ctx.http) as unknown as Record<string, (p: string) => request.Test>)[method]!(path);
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 401 });
    }
  });

  it('rejects every signed route when only a bearer token is presented', async () => {
    const token = await ctx.idp.token();
    for (const { method, path } of routes().filter((r) => r.path !== '/v1/auth/device-keys' && r.path !== '/health')) {
      const res = await (request(ctx.http) as unknown as Record<string, (p: string) => request.Test>)[method]!(path).set('Authorization', `Bearer ${token}`);
      expect({ method, path, code: res.body?.error?.code }).toEqual({ method, path, code: 'SIGNATURE_REQUIRED' });
    }
  });
});
```
If Express 5 doesn't expose `router.stack` on the instance, use `instance._router.stack` (Express 4 naming) as the fallback in `routes()`.

- [ ] **Step 2: Write the rate-limit test**

`test/integration/security/rate-limit.int-spec.ts`:
```ts
import request from 'supertest';
import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { TestClient } from '../../support/test-client';

describe('Rate limiting', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetState(ctx));
  afterAll(() => closeTestApp(ctx));

  it('limits chat per user (20/min) with Retry-After, independently of other groups and users', async () => {
    const a = await TestClient.register(ctx);
    const b = await TestClient.register(ctx);
    for (let i = 0; i < 20; i++) expect((await a.get('/v1/chat/messages')).status).toBe(200);
    const limited = await a.get('/v1/chat/messages');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await a.get('/v1/subscriptions')).status).toBe(200); // other group unaffected
    expect((await b.get('/v1/chat/messages')).status).toBe(200); // other user unaffected
  });

  it('limits the auth group per IP (20/min) before any token verification', async () => {
    for (let i = 0; i < 20; i++) expect((await request(ctx.http).post('/v1/auth/device-keys')).status).toBe(401);
    const limited = await request(ctx.http).post('/v1/auth/device-keys');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('limits the auth group per user (10/min)', async () => {
    const a = await TestClient.register(ctx); // 1 auth-group hit for this user
    let last = 200;
    for (let i = 0; i < 10; i++) last = (await a.get('/v1/auth/me')).status;
    expect(last).toBe(429);
  });
});
```

- [ ] **Step 3: Write the timeout-not-charged test**

`test/integration/security/timeout.int-spec.ts`:
```ts
import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { TestClient } from '../../support/test-client';

describe('Global timeout on a real route', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp({ env: { REQUEST_TIMEOUT_MS: '200', AI_MOCK_MIN_LATENCY_MS: '600', AI_MOCK_MAX_LATENCY_MS: '600' } });
  });
  beforeEach(() => resetState(ctx));
  afterAll(() => closeTestApp(ctx));

  it('returns 504 and never charges quota for an answer the user did not receive', async () => {
    const user = await TestClient.register(ctx);
    const res = await user.post('/v1/chat/messages', { question: 'slow one' });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('REQUEST_TIMEOUT');
    await new Promise((r) => setTimeout(r, 800)); // let the background AI call finish
    expect(await ctx.prisma.chatMessage.count()).toBe(0);
    const usage = await ctx.prisma.monthlyUsage.findFirst({ where: { userId: user.userId } });
    expect(usage?.freeUsed ?? 0).toBe(0);
  });
});
```

- [ ] **Step 4: Run all three and fix any failures in the owning source file**

Run: `npx jest -c jest.int.config.js test/integration/security`
Expected: PASS. Likely fixes:
- The per-user auth test counts the registration hit. With 10 `/auth/me` calls, the 10th is the 11th auth-group hit for that user, so it returns 429. If it's off by one, check the `perUser` value in `RATE_LIMITS.auth` rather than the test.
- If a route appears in default-deny with status 404, its controller is missing from a module.

- [ ] **Step 5: Run everything, then commit**

```bash
npm run lint && npm run typecheck && npm test
git add -A && git commit -m "test: default-deny route sweep, per-IP/per-user rate limits, timeout-not-charged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: CLI scripts (signed client, promote admin)

**Files:**
- Create: `scripts/client.ts`, `scripts/promote-admin.ts`

**Interfaces:**
- Consumes: `signRequest` (`scripts/lib/signer.ts`), `@supabase/supabase-js`, `@prisma/client`.
- Produces:
  - `npm run client -- <command>` with commands: `signup <email> <password>`, `login <email> <password>`, `login-token <accessToken>`, `me`, `ask "<question>"`, `chats`, `subscribe <TIER> <MONTHLY|YEARLY> [autoRenew=true]`, `subs`, `auto-renew <id> <true|false>`, `cancel <id>`, `metrics`, `billing-run`
  - `npm run promote-admin -- <email>`

- [ ] **Step 1: Write the client**

`scripts/client.ts`:
```ts
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from './lib/signer';

if (existsSync('.env')) process.loadEnvFile('.env');
const SESSION_FILE = '.ggi-session.json';
const API = process.env.API_BASE_URL ?? 'http://localhost:3000';

interface Session {
  accessToken: string;
  privateKeyPem: string;
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

async function bind(accessToken: string): Promise<void> {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const res = await fetch(`${API}/v1/auth/device-keys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } }),
  });
  console.log(res.status, await res.text());
  if (!res.ok) process.exit(1);
  const session: Session = { accessToken, privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() };
  writeFileSync(SESSION_FILE, JSON.stringify(session));
  chmodSync(SESSION_FILE, 0o600);
  console.log(`Key bound. Session saved to ${SESSION_FILE}`);
}

async function call(method: string, path: string, body?: unknown): Promise<void> {
  if (!existsSync(SESSION_FILE)) throw new Error('Not logged in: run `npm run client -- login <email> <password>`');
  const s = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as Session;
  const rawBody = body === undefined ? '' : JSON.stringify(body);
  const headers = signRequest({ method, url: path, rawBody, token: s.accessToken, privateKey: createPrivateKey(s.privateKeyPem) });
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: rawBody }),
  });
  const text = await res.text();
  console.log(res.status, text ? JSON.stringify(JSON.parse(text), null, 2) : '');
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const supabase = () => createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  switch (cmd) {
    case 'signup': {
      const { error } = await supabase().auth.signUp({ email: args[0] ?? '', password: args[1] ?? '' });
      console.log(error ? `Error: ${error.message}` : 'Signed up. Confirm your email if confirmation is enabled, then log in.');
      return;
    }
    case 'login': {
      const { data, error } = await supabase().auth.signInWithPassword({ email: args[0] ?? '', password: args[1] ?? '' });
      if (error || !data.session) throw new Error(error?.message ?? 'no session');
      return bind(data.session.access_token);
    }
    case 'login-token':
      return bind(args[0] ?? '');
    case 'me':
      return call('GET', '/v1/auth/me');
    case 'ask':
      return call('POST', '/v1/chat/messages', { question: args.join(' ') });
    case 'chats':
      return call('GET', '/v1/chat/messages');
    case 'subscribe':
      return call('POST', '/v1/subscriptions', { tier: args[0], billingCycle: args[1], autoRenew: (args[2] ?? 'true') === 'true' });
    case 'subs':
      return call('GET', '/v1/subscriptions');
    case 'auto-renew':
      return call('PATCH', `/v1/subscriptions/${args[0] ?? ''}`, { autoRenew: args[1] === 'true' });
    case 'cancel':
      return call('POST', `/v1/subscriptions/${args[0] ?? ''}/cancel`);
    case 'metrics':
      return call('GET', '/v1/admin/metrics');
    case 'billing-run':
      return call('POST', '/v1/admin/billing/run');
    default:
      console.log('Commands: signup|login <email> <pw> · login-token <jwt> · me · ask <q> · chats · subscribe <TIER> <CYCLE> [autoRenew] · subs · auto-renew <id> <bool> · cancel <id> · metrics · billing-run');
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

`scripts/promote-admin.ts`:
```ts
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

if (existsSync('.env')) process.loadEnvFile('.env');

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) throw new Error('usage: npm run promote-admin -- <email>');
  const prisma = new PrismaClient();
  const { count } = await prisma.user.updateMany({ where: { email }, data: { role: 'ADMIN' } });
  console.log(count > 0 ? `Promoted ${email} to ADMIN` : `No user with email ${email} (they must bind a key once first)`);
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add -A && git commit -m "feat: add signed CLI client and admin promotion script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
These scripts are exercised manually in Task 16. Their signing core is already covered by the integration tests, which use the same `signRequest`.

---

### Task 16: Supabase provisioning and end-to-end smoke test

**Prerequisite, done by the user:** run `supabase login` in their own terminal on this machine (`~/.local/bin/supabase login`). The token lands in `~/.supabase/access-token`. Agents must not try to drive the interactive login.

**Files:**
- Modify: `.env` (local only, never committed)

- [ ] **Step 1: Create the project**

```bash
supabase orgs list --agent no -o json
DB_PASS=$(openssl rand -base64 24)
supabase projects create momin-imran-qureshi-ggi --org-id <ORG_ID> --db-password "$DB_PASS" --region us-east-1 --agent no
supabase projects list --agent no -o json   # note the project ref
supabase projects api-keys --project-ref <REF> --agent no -o json   # note the anon key
```

- [ ] **Step 2: Check that asymmetric JWT signing keys are active**

```bash
curl -s https://<REF>.supabase.co/auth/v1/.well-known/jwks.json
```
Expected: `{"keys":[{"kty":"EC",...,"alg":"ES256"}]}` (or RSA). If `keys` is empty, the project still uses the legacy HS256 secret. Ask the user to open Dashboard → Project Settings → JWT Keys and migrate to (and rotate onto) asymmetric signing keys, then re-check.

- [ ] **Step 3: Configure auth (email/password on, GitHub OAuth on, auto-confirm for the demo)**

The user creates a GitHub OAuth App at https://github.com/settings/applications/new with:
- Homepage: `https://<REF>.supabase.co`
- Callback: `https://<REF>.supabase.co/auth/v1/callback`

They then supply the client ID and secret. Apply them:
```bash
curl -s -X PATCH "https://api.supabase.com/v1/projects/<REF>/config/auth" \
  -H "Authorization: Bearer $(cat ~/.supabase/access-token)" -H "Content-Type: application/json" \
  -d '{"external_email_enabled":true,"mailer_autoconfirm":true,"external_github_enabled":true,
       "external_github_client_id":"<GITHUB_CLIENT_ID>","external_github_secret":"<GITHUB_CLIENT_SECRET>"}'
```
Expected: JSON echoing the auth config with `external_github_enabled: true`.

- [ ] **Step 4: Fill `.env` and run the whole flow**

Set `SUPABASE_URL=https://<REF>.supabase.co`, `SUPABASE_ANON_KEY=<anon>` and `HEALTH_CHECK_TOKEN=$(openssl rand -hex 24)` in `.env`. Then:
```bash
npm run db:migrate && npm run build && (npm start &) && sleep 3
npm run client -- signup demo@example.com 'Str0ng-Passw0rd!'
npm run client -- login demo@example.com 'Str0ng-Passw0rd!'
npm run client -- me
for i in 1 2 3 4; do npm run client -- ask "question $i"; done   # 4th → 402 QUOTA_EXHAUSTED
npm run client -- subscribe BASIC MONTHLY
npm run client -- ask "now from bundle"                           # quota.source = BUNDLE
npm run promote-admin -- demo@example.com
npm run client -- metrics
curl -s localhost:3000/health -H "X-Health-Token: $HEALTH_CHECK_TOKEN"
```
Expected: each command prints the documented status. Stop the server afterwards.

---

### Task 17: README, CI, final verification, push

**Files:**
- Create: `README.md`, `.github/workflows/ci.yml`

- [ ] **Step 1: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: ggi, POSTGRES_PASSWORD: ggi, POSTGRES_DB: ggi_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U ggi" --health-interval 5s --health-timeout 5s --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx prisma generate
      - run: npm run format:check
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run test:int
```

- [ ] **Step 2: Write the README**

`README.md` must contain these sections. Copy tables and protocol text **verbatim from the spec** (§2 decisions, §3 interpretations, §4 architecture, §7 API, §8 flows, §9 security model and residual risks, §14 cut list) rather than paraphrasing them. The spec is the source of truth, and copying keeps the two consistent:
1. **Overview.** What the service does, and the list of 11 endpoints (table from spec §7).
2. **Architecture decisions.**
   - Layer diagram (spec §4.1) and module layout.
   - Why NestJS, Prisma, Supabase and Redis.
   - The chat → subscriptions port.
   - The quota flow (pre-check → AI → locked transaction) and why it's concurrency-safe (with the 10-parallel test as proof).
   - The interpretations table A1–A9.
3. **Security model.**
   - Table from spec §9.
   - The request-signing protocol: the canonical string plus the order of server checks.
   - Guard order.
   - Rate-limit table.
   - Residual risks.
4. **Setup.**
   - Prerequisites: Node 22, Docker or Podman + podman-compose.
   - `cp .env.example .env`, `npm ci`, `npm run db:up`, `npm run db:migrate`, `npm run start:dev`.
   - Supabase setup (Task 16 steps 1–3 in prose).
   - CLI client usage.
   - Promoting an admin.
5. **Testing.** `npm run test:unit`, `npm run test:int`. The IdP is mocked with a real JWKS server, not bypassed. What each suite covers.
6. **Future work.** Spec §14.

- [ ] **Step 3: Full verification**

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
```
Expected: all green. Paste the final test summary into the commit message body.

- [ ] **Step 4: Commit and push**

```bash
git add -A && git commit -m "docs: README (architecture, security model, setup) and CI workflow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
gh run watch --exit-status || gh run list --limit 1
```
Expected: the CI run on GitHub passes. The repository `axcel342/momin-imran-qureshi` is public and contains the PDF.
