# TracePilot

**Did this prompt change improve my application, and can I trust how it behaves when something fails?**

TracePilot is a local console for evaluating Claude prompts. You save prompt versions, run them against reusable test cases, watch responses stream in, and compare correctness, latency and token usage side by side. Every run records the exact prompt text, model settings and test-case snapshot it used, so a result can always be traced back to its inputs.

The built-in use case is support-ticket triage: Claude classifies 12 synthetic tickets into a category (`billing`, `account_access`, `technical_support`, `general_inquiry`) and an urgency (`low`, `medium`, `high`), and TracePilot checks that each response is a bare JSON object with the required fields, allowed values and expected labels.

**Stack:** React 19, TypeScript, Vite · Node.js, Express 5, SQLite (better-sqlite3) · Anthropic TypeScript SDK · Vitest, MSW, Testing Library

---

## Quick start (mock mode, no API key)

Requires Node.js **22.12 or newer** (`.nvmrc` pins 24).

```sh
git clone <this repo> && cd tracepilot
nvm use            # optional
npm install
npm run dev        # API on :8787, interface on http://localhost:5173
```

Open http://localhost:5173, choose a prompt version, and press **Start evaluation**. Everything works with the mock provider. To try failure handling without an API key, pick a **Failure simulation** scenario before starting a run.

| Command | Purpose |
| --- | --- |
| `npm run dev` | API server (tsx watch) and Vite interface together |
| `npm run eval -- [--provider mock\|anthropic] [--split dev\|holdout\|all] [--versions 1,2] [--model id]` | Run prompt versions from the command line and print a report; the runs also appear in the interface |
| `npm test` | All tests (Node project for server and SDK, jsdom project for components) |
| `npm run typecheck` / `npm run lint` | Type checking (server and client) / ESLint |
| `npm run check` | Typecheck, lint and test, as CI does |
| `npm run build` | Production build of the interface |

Local data lives in `data/tracepilot.db`, which is ignored by Git. Delete it to reset the workspace; the two seed prompt versions are recreated on the next start.

## Mock versus live operation

| | Mock provider | Claude API |
| --- | --- | --- |
| Needs | nothing | `ANTHROPIC_API_KEY` in `.env` (see `.env.example`) |
| Responses | deterministic keyword rules, streamed in small chunks | real model output |
| Usage | always **unknown**: there is no API to report it | API-reported `input_tokens` / `output_tokens` |
| Failure injection | `slow`, `rate_limit_once`, `interrupt_stream`, `malformed`, `timeout` | whatever the network and API actually do |

The mock exists so the workflow, the interface and the failure handling can be demonstrated and tested offline. It reacts to prompts in a deliberately simple way: a prompt that says "respond with only…" gets bare JSON, and one that contains "urgency guidelines" gets better urgency labels. **Mock scores say nothing about how Claude would score.**

Live mode: copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`, and restart. The key is read only by the server and is never sent to the browser or stored in run records; a test checks this. The default model is `claude-opus-5-5` (override with `TRACEPILOT_MODEL` or per run in the interface). Runs use `effort: low`, because classification is a short task, and enable the API's server-side refusal fallback (`fallbacks: "default"`), which you can switch off per run. When a fallback serves a response, the run details show which model actually answered.

## Architecture

```
client/            React interface and component tests
  src/hooks/       useRunStream (EventSource → reducer), hash routing
  src/components/  PromptEditor, RunPanel, RunHistory, CompareView, RunDetails, CaseCard
server/
  routes/          Express routes; zod-validated bodies; SSE stream and cancel
  provider/        Provider interface, ClaudeProvider (official SDK), MockProvider
  runner/          RunManager (one active run, event fan-out, cancellation) and
                   executeCase (attempts, deadlines, retries, telemetry)
  evaluate/        parseJson, validate, compare, evaluate — small pure functions
  db/              migrations, database opener, Repository
  cli/             npm run eval
shared/            types, SSE event protocol, summary rules, default settings
fixtures/          12 synthetic tickets (8 dev, 4 holdout) and the two seed prompts
tests/             integration, SSE, MSW failure-simulation tests
```

**Request flow.** `POST /api/runs` validates the request, copies the prompt version, model settings and selected fixtures into a new `queued` run, and returns it. The client then opens `GET /api/runs/:id/stream` (server-sent events). Opening the stream starts the run, so execution is tied to an observer. The runner executes cases **one at a time** and emits `run_status`, `case_status`, `case_delta`, `case_retry`, `case_result` and `run_end` events. `POST /api/runs/:id/cancel` (the **Stop** button), or the last client disconnecting, aborts the run's `AbortController`. That signal is passed to the SDK, so the in-flight HTTP request to Anthropic is aborted, not just ignored.

**State.** Runs move `queued → running → completed | failed | cancelled`. Cases move `queued → running → completed | failed | cancelled`. A case that never started stays `queued` and is shown as **unfinished**. The interface groups cases into five buckets — passed, failed checks, error, cancelled, unfinished — so an incomplete evaluation never looks like a clean result. If the server stops mid-run, the run is marked failed on the next start ("Server stopped before the run finished") rather than left `running`.

**Persistence and immutability.** SQLite with ordered, append-only migrations. Database triggers reject any `UPDATE` or `DELETE` on `prompt_versions` and any change to a run's recorded inputs, so "editing a prompt cannot change an earlier run" is enforced by the schema, not just by convention. Saving an edit always creates a new version (`parent_id` links it to its source). Each run stores a hash of its fixture snapshot, and the comparison view warns when two runs were not evaluated on identical cases.

**Evaluation.** Five checks run in order: `json_parse` → `required_fields` → `allowed_values` → `category_match` → `urgency_match`. A case passes only if all five pass, and every failed or skipped check carries a sentence explaining why. When the JSON check fails but an object can be recovered (from a code fence or surrounding prose), the remaining checks still run against the recovered object and say so. That separates "wrong format" from "wrong answer".

## Failure handling and telemetry

| Situation | Behaviour |
| --- | --- |
| 429, 5xx, 529 overloaded, connection error, deadline hit **before any text** | Retried up to `maxRetries` (default 2) with backoff of 250 ms × 2ⁿ (capped at 4 s), or the `retry-after` value when the API sends one. Each attempt is logged with its error and request ID. |
| Any failure **after text has started** | Not retried. The partial output is kept and the case is labelled **interrupted**, so a retry can never silently replace output you already saw. |
| Deadline (`timeoutMs`, default 30 s) | Per attempt and covers the whole attempt, including streaming. Implemented with its own `AbortController`, so it uses the same abort path as Stop. |
| 401/403, 400/404/422 | Not retryable. The run stops with a `failed` status and a reason, because every remaining case would fail the same way. |
| Malformed output | The case completes; the `json_parse` check fails with the parser's reason. |
| `stop_reason` other than `end_turn` (e.g. `max_tokens`, `refusal`) | Recorded per case and quoted in the JSON check's explanation. |

Per case, TracePilot records time to first text (measured from the start of the successful attempt), total duration including retries, API-reported input and output tokens, request ID, message ID, served model, stop reason and the attempt log. **Missing values stay `null` and are shown as "unknown"**: run totals become a lower bound ("≥ 1,240 (1 unknown)") instead of a sum that quietly treats unknown as zero. The run-details view puts these measurements next to the exact prompt text and model settings that produced them.

The SDK's own retries are disabled (`maxRetries: 0`) so that the runner owns the retry policy and every attempt is visible.

## Testing

`npm test` runs 59 tests in two Vitest projects. None needs an API key, and CI (`.github/workflows/ci.yml`) runs type checking, lint, tests and the build with no credentials.

- **Evaluators** (`server/evaluate/*.test.ts`): each check on its own, with exact explanation strings.
- **Runner policy** (`server/runner/executeCase.test.ts`): fake timers drive retries, backoff, `retry-after`, deadlines before and during output, interrupted output, unknown usage, and cancellation during backoff. Timings are asserted to the millisecond.
- **Failure simulation** (`tests/failureSimulation.test.ts`): the real `ClaudeProvider` and runner against an MSW-simulated Messages API that follows the documented SSE event order. Covers 429 with `retry-after`, persistent 529, a response that never starts, malformed text, missing usage, a dropped connection mid-stream, an `error` event mid-stream, an `error` event before text, 401, and cancellation mid-stream. The cancellation test asserts on the signal of the actual `fetch` call the SDK made. Backoff sleeps are recorded instead of awaited, so the suite is fast and exact.
- **SSE and persistence** (`tests/streaming.test.ts`, `tests/persistence.test.ts`): streamed deltas reassemble into the stored output; Stop and client disconnect abort upstream and record `cancelled`; a second concurrent run is refused; versions survive a restart; triggers block edits; run snapshots stay unchanged after a prompt edit.
- **Components and accessibility** (`client/src/**/*.test.tsx`): the primary workflow driven with only the keyboard (Tab to Start, Enter, watch the status message, Tab to Stop, Enter; select two runs with Space and open the comparison), every control has an accessible name, focus moves to the heading of a newly opened view, and save errors are announced in an alert.

Accessibility choices that tests can't fully check: a `:focus-visible` outline on every interactive element; status always shown as text, never by colour alone; live progress in a polite `role="status"` region (streamed text itself is not announced, to avoid noise); semantic tables with captions; and light and dark colour schemes. Contrast has not yet been measured with a checker; that and a screen-reader pass are worth doing before the demo.

## Design tradeoffs

- **Retry only before output.** Retrying after partial output would make streamed text disappear and be replaced, and could hide a flaky stream behind a clean final answer. The cost is that an interrupted case needs a manual re-run. For an evaluation tool, an honest record matters more than recovering automatically.
- **Runner-owned retries instead of the SDK's.** The SDK retries well, but invisibly. Owning the loop makes each attempt, its request ID and its backoff visible, and lets the policy depend on whether output had started, which the SDK can't know.
- **Strict JSON, with recovery for explanation.** The contract is "the program can `JSON.parse` the response", so fenced JSON fails. Recovering the object anyway shows whether the model got the labels right but the format wrong. Structured outputs (`output_config.format`) would guarantee valid JSON, but would also make the format check meaningless, and following the format is part of what this evaluates.
- **The stream starts the run; the last disconnect cancels it.** This avoids orphaned runs spending tokens with nobody watching. The tradeoff is that you can't start a run and close the tab. The CLI (`npm run eval`) covers unattended runs.
- **One active run, cases in sequence.** This matches the scope (a local workspace), keeps latency measurements free of self-inflicted contention, and makes rate-limit behaviour easy to read. Parallel cases would be faster for large fixture sets.
- **Snapshots copied into each run row.** This duplicates prompt and fixture text, but a run is self-describing even if fixture files change, and comparisons can tell when two runs were not evaluated on the same cases.
- **No jitter in backoff.** This keeps runs and tests reproducible. With many concurrent clients you would add jitter; a single local runner doesn't need it.

## Results

### Mock provider (observed)

`npm run eval -- --provider mock --split holdout` on the four reserved holdout tickets:

| Version | Passed | Main failure |
| --- | --- | --- |
| v1 Baseline | 0 / 4 | Every response wrapped the JSON in a code fence with prose (`json_parse`). Against the recovered objects: T10 predicted `account_access`/`medium` instead of `billing`/`high`, T11 predicted urgency `high` instead of `low` (the ticket says "not urgent"), and T12 predicted `medium` instead of `low`. |
| v2 Strict JSON + urgency rubric | 4 / 4 | — |

On the eight dev tickets: v1 0/8, v2 8/8. These figures show that the pipeline and the explanations work; they are not evidence about Claude, because the mock's rules were written alongside the v2 prompt.

### Claude API (not yet run)

The live final evaluation has **not** been run in this repository yet: no API key was available while it was built. To run it:

```sh
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env
npm run eval -- --provider anthropic --split holdout --versions 1,2
```

Record the observed pass counts, failures, time to first text and token usage here, including any failures. The holdout tickets (T09–T12) were not used to tune prompt wording.

## Demonstration script (about 3 minutes)

1. **Prompt comparison** (≈60 s). Show the v1 and v2 prompts in the editor. Run v1 and then v2 on the dev set. Open **Run history**, select both, and choose **Compare selected**. Point out improved and regressed cases and a failed check's explanation (for example, fenced JSON in v1, or `Predicted "high", expected "low"`).
2. **Run inspection** (≈60 s). Open a run's details: the recorded prompt text, model settings and fixture hash; per-case time to first text, duration, tokens (unknown in mock mode), attempts and request IDs. Run the **Rate limit on first attempt** scenario and show the attempt log with the retry and its delay.
3. **Cancellation and interruption** (≈60 s). Start a **Slow stream** run and press **Stop** mid-response: the case is cancelled with its partial text kept, and the remaining cases show as unfinished. Then run **Interrupt every other stream** and show cases labelled interrupted, with partial output and no retry.

## Limitations and next steps

- A single workspace, one active run, and cases in sequence, by design for this scope.
- No authentication: the server is meant to run on localhost only.
- No cost estimates. Token counts are shown, but prices change and are not hard-coded.
- The fixtures are small and synthetic, so a 4-case holdout cannot show statistically meaningful differences. A real evaluation would need more cases and repeated runs to measure variance.
- Partial output is saved when a case finishes, not continuously, so a server crash mid-stream loses that case's text (the run is still marked failed on restart).
