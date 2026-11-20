# TracePilot: notes for contributors and coding agents

A local console for evaluating prompt versions against fixed fixtures. README.md covers the product, the architecture and the live results. This file covers working in the code.

## Commands

- Node 24 (`nvm use`). Under Node < 22.12, better-sqlite3 can crash with SIGSEGV; the server, CLI and `npm test` refuse to start.
- `npm run check`: typecheck, then lint, then all tests. Run it before every commit; CI runs the same steps with no API keys.
- `npx vitest run <path>`: run one test file. Server and SDK tests use the `server` project (Node); `client/src/**/*.test.tsx` use `client` (jsdom).
- `npm run dev`: API on 127.0.0.1:8787, interface on :5173. `npm run eval -- --provider mock --split holdout`: CLI runs.
- Live runs need `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` in `.env`. The Gemini free tier allows 20 requests per model per day, so don't spend it on smoke tests; use the mock.

## Where things live

- `shared/types.ts`: every domain type, API payload and SSE event. Start here.
- `server/runner/executeCase.ts`: retry, deadline, interruption and telemetry policy for one case. `runManager.ts`: the single active run.
- `server/provider/*`: adapters translate vendor errors into a shared `ProviderError` kind. The runner never sees vendor types.
- `server/evaluate/*`: pure check functions. Explanation strings are asserted exactly in tests.
- `server/db/migrations.ts`: append-only. Never edit a shipped migration; add a new one.
- `fixtures/tickets.ts`: 8 dev and 4 holdout tickets. Don't tune prompts against holdout cases.

## Invariants (tests enforce these)

- Prompt versions and run inputs are immutable; SQLite triggers reject updates. An edit is a new version.
- Retry only before output starts. After any text, a failure is final and the case is marked `interrupted`.
- Unknown telemetry stays `null` and is shown as "unknown", never 0. Totals with unknowns are lower bounds.
- API keys stay on the server. They never appear in responses, run records or logs.
- SDK-level retries stay disabled; the runner owns the retry loop so every attempt is logged.

## Conventions

- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`), one logical change each, with tests in the same commit.
- Server input is validated with zod in `server/routes/validation.ts`.
- Interface work must stay keyboard-operable, with labelled controls and live-region status text. Component tests use roles and accessible names, not CSS selectors.
- Use injected `now`/`sleep` and fake timers for anything time-based; tests should not sleep for real.
