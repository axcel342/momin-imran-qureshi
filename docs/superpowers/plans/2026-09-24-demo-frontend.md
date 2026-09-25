# Demo Frontend Implementation Plan

> **For agentic workers:** execute task by task. Spec:
> `docs/superpowers/specs/2026-09-24-demo-frontend-design.md` (binding). Keep the build minimal —
> small files, plain CSS, no extra dependencies.

**Goal:** a minimal one-page demo UI for the hosted GGI backend: sign in, ask, exhaust free quota,
buy a bundle, ask again.

**Branch:** `demo/frontend` (from `main`). `main` untouched.

---

### Task 1: Build the web app

**Files:** exactly the `web/` list in spec §3, plus `eslint.config.mjs` (add `web/**` to `ignores`).

**Deliverable:** `web/` app that builds and runs against the local API.

**Requirements:**

- Vite + React + TS, one page, no router/state/component libraries; only `react`, `react-dom`,
  `@supabase/supabase-js` as runtime deps and `vite`, `@vitejs/plugin-react`, `typescript`,
  `@types/react`, `@types/react-dom` as dev deps.
- IBM Plex Sans + Mono via one Google Fonts link in `index.html`; design tokens as CSS custom
  properties in `styles.css`; the meter, exhausted state and plan table exactly as the spec
  describes. Reduced-motion respected; visible focus styles.
- `src/lib/signer.ts` mirrors `scripts/lib/signer.ts`: canonical string, base64url, nonce from
  `crypto.getRandomValues` (≥16 bytes), unix-seconds timestamp, WebCrypto ECDSA P-256/SHA-256.
- `src/lib/api.ts`: `fetch` wrapper adding the signature headers and bearer token to every call;
  maps 401 `KEY_NOT_BOUND` / 402 `QUOTA_EXHAUSTED` to typed errors the UI renders.
- Flow: on mount sign out any persisted session; sign in (or create account) with email/password;
  generate P-256 key; register `{kty,crv,x,y}` at `POST /v1/auth/device-keys`; ask via
  `POST /v1/chat/messages`, render answer + meta line + meter from the response `quota`; on 402 show
  the plan table; buy via `POST /v1/subscriptions` (`monthly`/`yearly` toggle, auto-renew on);
  refresh the meter from the subscription/quota and allow the next ask; sign out clears state.
- Errors inline, plain language; payment failure (20% simulated) tells the user to try again.
- Committed `web/.env.example` with placeholders; `web/.gitignore` ignores `node_modules`, `dist`,
  `.env.local`. The worker creates `web/.env.local` from the root `.env` values for local smoke.

**Acceptance (evidence required in the report):**

1. `cd web && npm install && npm run build` exits 0.
2. Root `npm run format:check && npm run lint && npm run typecheck` exits 0 on the branch.
3. Headless Playwright smoke against `vite preview` + the local API (`node dist/main.js` from the
   repo root, already migrated), using a throwaway email: create account → ask → three asks succeed
   → fourth shows the exhausted state with the plan table → buy Basic monthly → ask again succeeds
   with a bundle meta line. Screenshots to `/tmp/opencode/web-shots/` (desktop + narrow).
   The smoke harness is created under `/tmp/opencode/web-smoke`, never inside the repo.

**Commit:** `feat(web): minimal demo frontend` + required trailer.

---

### Task 2: Design review and fixes

Dispatch a fresh reviewer with the frontend-design criteria
(`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/frontend-design/skills/frontend-design/SKILL.md`)
and the screenshots. It reports findings against the spec's identity (color/type/layout/principles),
generic-default tells, responsiveness, focus, and copy. One fix round for real findings, then a
scoped re-review. No redesign unless the review shows the identity is not delivered.

---

### Task 3: Deployment (gated on `vercel login`)

1. Implement `deploy/vercel` per its committed spec (API function, Prisma engine target, env),
   deploy it, and verify `/health` on the public URL.
2. Create the frontend Vercel project: Root Directory `web`, build `npm run build`, output `dist`,
   `web/vercel.json` SPA rewrite, `VITE_*` env vars.
3. Set the API `CORS_ORIGINS` to include the frontend origin.
4. Deployed smoke with the Playwright harness pointed at the public URLs; screenshots kept outside
   the repo.
