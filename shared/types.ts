// Types shared by the client and server: domain records, API payloads, and
// the server-sent event protocol. Keep this file free of runtime imports so
// both bundles can depend on it.

export const CATEGORIES = ["billing", "account_access", "technical_support", "general_inquiry"] as const;
export type Category = (typeof CATEGORIES)[number];

export const URGENCIES = ["low", "medium", "high"] as const;
export type Urgency = (typeof URGENCIES)[number];

/** "dev" cases are used while iterating on prompts; "holdout" cases are reserved for the final evaluation. */
export type FixtureSplit = "dev" | "holdout";
export type FixtureSelection = FixtureSplit | "all";

export interface Fixture {
  id: string;
  split: FixtureSplit;
  ticket: { subject: string; body: string };
  expected: { category: Category; urgency: Urgency };
}

/** Prompt versions are immutable: saving an edit creates a new row. */
export interface PromptVersion {
  id: number;
  version: number;
  label: string;
  systemPrompt: string;
  /** Rendered per fixture; supports {{subject}} and {{body}}. */
  userTemplate: string;
  parentId: number | null;
  createdAt: string;
}

export type ProviderName = "mock" | "anthropic";
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Deterministic failure injection for the mock provider, so failure handling can be demonstrated without an API key. */
export const MOCK_SCENARIOS = ["none", "slow", "rate_limit_once", "interrupt_stream", "malformed", "timeout"] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export interface ModelSettings {
  provider: ProviderName;
  model: string;
  maxTokens: number;
  effort: Effort;
  /** Per-attempt deadline in milliseconds. */
  timeoutMs: number;
  /** Retries for eligible failures that happen before any output text arrives. */
  maxRetries: number;
  /** Anthropic only: route refused requests through server-side fallbacks. */
  refusalFallback: boolean;
  /** Mock only. */
  mockScenario: MockScenario;
}

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type CaseStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type CheckName = "json_parse" | "required_fields" | "allowed_values" | "category_match" | "urgency_match";
export interface CheckResult {
  name: CheckName;
  status: "passed" | "failed" | "skipped";
  /** Human-readable explanation, always present for failed and skipped checks. */
  detail: string;
}
export interface Evaluation {
  passed: boolean;
  checks: CheckResult[];
  predicted: { category: string | null; urgency: string | null };
}

export type ErrorKind =
  | "rate_limit"
  | "overloaded"
  | "server_error"
  | "timeout"
  | "connection"
  | "bad_request"
  | "auth"
  | "refusal"
  | "stream_interrupted"
  | "cancelled"
  | "unknown";

export interface CaseTelemetry {
  /** Milliseconds from the start of the successful attempt to the first text delta. Null when no text arrived. */
  ttftMs: number | null;
  /** Milliseconds from case start (including retries) to its final state. */
  durationMs: number | null;
  /** API-reported usage. Null means unknown, never zero-by-default. */
  inputTokens: number | null;
  outputTokens: number | null;
  requestId: string | null;
  messageId: string | null;
  /** Model that actually served the response (can differ when a fallback ran). */
  servedModel: string | null;
  stopReason: string | null;
  attempts: number;
}

export interface CaseResult {
  runId: string;
  index: number;
  fixtureId: string;
  status: CaseStatus;
  output: string;
  /** True when output had started streaming and then the stream failed; output holds the partial text. */
  interrupted: boolean;
  evaluation: Evaluation | null;
  telemetry: CaseTelemetry;
  error: { kind: ErrorKind; message: string } | null;
  attemptLog: AttemptRecord[];
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AttemptRecord {
  attempt: number;
  startedAt: string;
  outcome: "success" | "error";
  errorKind?: ErrorKind;
  message?: string;
  requestId?: string | null;
  /** Backoff applied before the next attempt. */
  retryDelayMs?: number;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  cancelled: number;
  unfinished: number;
}

export interface Run {
  id: string;
  promptVersionId: number;
  /** Exact prompt text used, copied at run creation. */
  promptSnapshot: Pick<PromptVersion, "version" | "label" | "systemPrompt" | "userTemplate">;
  modelSettings: ModelSettings;
  fixtureSelection: FixtureSelection;
  fixtureSnapshot: Fixture[];
  /** Hash of the fixture snapshot, used to tell whether two runs are comparable. */
  fixtureHash: string;
  status: RunStatus;
  statusReason: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: RunSummary;
}

export interface RunWithCases extends Run {
  cases: CaseResult[];
}

// ---- API payloads ----

export interface HealthResponse {
  ok: true;
  liveAvailable: boolean;
  defaultModel: string;
  activeRunId: string | null;
}

export interface CreatePromptVersionRequest {
  label: string;
  systemPrompt: string;
  userTemplate: string;
  parentId: number | null;
}

export interface CreateRunRequest {
  promptVersionId: number;
  fixtureSelection: FixtureSelection;
  modelSettings: ModelSettings;
}

export interface ApiErrorBody {
  error: { message: string; issues?: string[] };
}

// ---- Server-sent events (GET /api/runs/:id/stream) ----

export type RunEvent =
  | { type: "run_status"; runId: string; status: RunStatus; reason: string | null }
  | { type: "case_status"; runId: string; index: number; status: CaseStatus }
  | { type: "case_retry"; runId: string; index: number; attempt: number; errorKind: ErrorKind; delayMs: number }
  | { type: "case_delta"; runId: string; index: number; text: string }
  | { type: "case_result"; runId: string; result: CaseResult }
  | { type: "run_end"; run: Run };
