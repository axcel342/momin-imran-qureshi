# Handoff: GGI backend take-home

**Read first:**

1. `GGI - BACKEND TEST POSTURE (1) (1).pdf`, the original requirements.
2. `docs/superpowers/specs/2026-09-24-ggi-backend-design.md`, the approved design spec (minimal build).
3. `docs/superpowers/plans/2026-09-24-ggi-backend.md`, the approved implementation plan: 17 test-first tasks.

## Status (2026-09-24)

- Spec: approved by the user.
- Plan: written and pushed. **No tasks started.** Start at Task 1.
- Execution method: not yet confirmed by the user. The recommendation was _native_: one agent implements all tasks in order, then one fresh reviewer checks the whole branch. The tasks form a strict dependency chain, so run them in order.
- **Deadline:** 24h from receipt of the task, about **2026-09-25 07:40 UTC**. If time runs short, follow the priority order in spec §14 and §15.

## Decisions already made (do not re-ask)

- **Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Redis 7, Zod 4, jose 5 (not 6: it is ESM-only and breaks Jest), Node 22.
- **Auth:** Supabase Auth, verified via JWKS. The extra mechanism is session-bound ECDSA request signing.
- **Quota:** a pre-check, then the mock AI call, then a row-locked transaction. There is no reserve/refund step.
- **Interpretations A1–A9** in spec §3 are approved as written.
- **Build scope is minimal.** The user explicitly wants the smallest build that meets the PDF. Do not add scope.

## Repo and identity

- Remote: https://github.com/axcel342/momin-imran-qureshi (public; the brief requires it to be named after the user's full name, Momin Imran Qureshi).
- Git identity is set repo-locally: `axcel342 <mominimran000@gmail.com>`. `gh` is authenticated as `axcel342`.
- Work happens on `main`, because the submission is read from the default branch.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Machine state (Oracle Linux 9, aarch64, SELinux enforcing)

- **Node 22.23.3** is installed at `~/.local/node22`, with `node`/`npm`/`npx` symlinked in `~/.local/bin`, which comes before `/usr/bin` on PATH. `/usr/bin/node` is v20 (end-of-life), so do not use it.
- **Containers:** Podman 5.8 is installed, **Docker is not, and there is no compose provider**. Plan Task 1 Step 8 installs one with `pip3 install --user podman-compose`, then run `COMPOSE=podman-compose npm run db:up`. Ports 5432 and 6379 were free.
- **Supabase CLI 2.117.0** is at `~/.local/bin/supabase`. Always pass `--agent no` or the output switches to JSON mode.

## Blocked on the user

1. **`supabase login`.** It cannot be completed from a non-interactive agent shell: the CLI needs a TTY, and a pty workaround was blocked by the permission classifier, so do not retry it. The user must run `~/.local/bin/supabase login` in their own terminal. This is only needed for **Task 16**. Everything before it runs against the mock IdP.
2. **GitHub OAuth app** for Supabase social login (Task 16 Step 3). The user must create it on github.com, because it can't be done via API. They then provide the client ID and secret.
