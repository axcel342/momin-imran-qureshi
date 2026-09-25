# Demo Frontend: Minimal Smoke Demo (Design Spec)

- **Date:** 2026-09-24
- **Status:** Approved in chat; awaiting implementation
- **Branch:** `demo/frontend` (branched from `main`). `main` stays untouched.
- **Subject:** a quota-metered AI assistant over the existing GGI backend. **Audience:** a reviewer
  or visitor evaluating the backend. **Job:** sign in, get an answer, hit the quota wall, buy a
  bundle, ask again — in under a minute, with the quota model always visible.

## 1. Scope

**In:** one page, no router. Email/password sign-in, one chat view with a live quota meter and
per-answer meta line, the quota-exhausted state with a three-row plan table (monthly/yearly,
auto-renew on), bundle purchase, ask-again-from-bundle, sign out, one footer proof line naming the
signed request session.

**Out:** GitHub login in the UI, IndexedDB/key persistence, chat history persistence, admin views,
protocol inspector, component/state libraries, web test suite, web README, custom domain.

## 2. Design identity — "the meter"

One bold element: a mechanical odometer-style meter that rolls when quota is spent. Everything else
quiet: single column, left-aligned, whitespace and tabular figures instead of cards or borders.

**Color tokens:** enamel `#F3F3F0` (page), housing `#16191C` (type/rules), steel `#8B9298`
(secondary/hairlines), meter `#D99A00` (spent-quota figures and track), cutoff `#B3261E`
(exhausted/errors). Deliberately avoids the cream+serif+terracotta and near-black+acid-green
defaults.

**Type:** IBM Plex Sans (400/500/600) for UI; IBM Plex Mono with tabular figures for the meter,
token counts and latency. One Google Fonts link; no npm font packages.

**Layout:** 64ch exchanges, composer pinned at the bottom, meter top-right. Per-answer meta is a
single right-aligned mono line with whitespace columns: `free quota 2/3 left    118 tokens    812 ms`.
Exhausted state replaces the meter's track with `cutoff` and shows the plan table inline where the
composer was:

```
[  Ask a question…                                [  Ask  ] ]
 Uses 1 of 1 free. Resets 1 October.
 signed as 9f3c…a1 · Supabase session
```

**Principles:** state is always on screen (never a toast); hierarchy from spacing and figures, not
decoration; copy plain and specific ("No messages left this month. Resets 1 October."); one motion
moment (meter roll) that respects `prefers-reduced-motion`; visible keyboard focus; errors inline
beside the action.

## 3. Technical decisions

| #   | Decision     | Choice                                                                                                                            |
| --- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Stack        | Vite + React + TypeScript, one page, plain CSS with custom properties                                                             |
| F2  | Auth         | `@supabase/supabase-js`, email/password only; auto-confirm is on in the Supabase project                                          |
| F3  | Signing      | WebCrypto ECDSA P-256 + SHA-256; signatures are already IEEE-P1363, matching the server                                           |
| F4  | Key lifetime | In-memory only. On mount the app signs out any persisted Supabase session so every visit binds a fresh key inside the 300s window |
| F5  | Reference    | `scripts/lib/signer.ts` and `scripts/client.ts` are the proven client; the web signer mirrors them exactly                        |
| F6  | JWK          | Register exactly `{kty,crv,x,y}` — the server's strict schema rejects extra fields                                                |
| F7  | API errors   | 402 `QUOTA_EXHAUSTED` renders the exhausted state; 401 `KEY_NOT_BOUND` prompts a fresh sign-in; other errors show inline          |

**Canonical string (spec §8.2):**
`GGI-SIG-V1\n{METHOD}\n{originalUrl}\n{timestamp}\n{nonce}\n{b64url sha256(rawBody)}\n{b64url sha256(accessToken)}`,
sent as `X-Signature`, `X-Signature-Timestamp`, `X-Signature-Nonce` with `Authorization: Bearer`.
`originalUrl` is the browser path+query (`/v1/...`); GET bodies hash the empty buffer.

**Files:** `web/` — `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.env.example`,
`.gitignore`, `src/main.tsx`, `src/App.tsx`, `src/views/SignIn.tsx`, `src/views/Chat.tsx`,
`src/lib/supabase.ts`, `src/lib/signer.ts`, `src/lib/api.ts`, `src/styles.css`.
Root changes: `eslint.config.mjs` ignores `web/**`; nothing else.

**Config:** `web/.env.local` (git-ignored) holds `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
(public by design), `VITE_API_BASE_URL=http://localhost:3000` for dev. `web/.env.example` is
committed with placeholders. Root `.env` already allows `http://localhost:5173` via `CORS_ORIGINS`.

## 4. Deploy plan (after the app works locally)

1. Implement the approved API deployment spec on `deploy/vercel` (spec already committed there) and
   deploy it once `vercel login` is available.
2. Deploy `web/` as a static Vercel project (Root Directory `web`, SPA rewrite to `index.html`),
   with the `VITE_*` values set in the project environment.
3. Add the frontend origin to the API's `CORS_ORIGINS`.
4. Smoke both public URLs: sign in → ask → exhaust → buy → ask from bundle.

## 5. Verification

- `web/`: `npm run build` green; root `format:check`, `lint`, `typecheck`, `test` stay green on the
  branch (CI).
- Local smoke against the local API (Supabase DB + local Redis) driven headlessly with Playwright —
  the smoke harness lives outside the repo (`/tmp/opencode/web-smoke`), not in the project.
- Design review pass by a fresh subagent against the frontend-design criteria, using screenshots.
- Post-deploy smoke on the public URLs.

## 6. Out of scope

Everything not listed above, including: GitHub OAuth in the UI, persistence, admin UI, tests inside
`web/`, styling beyond the single CSS file, animation libraries, analytics, README changes on
`main`.
