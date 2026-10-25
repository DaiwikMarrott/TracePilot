import type {
  ApiErrorBody,
  CreatePromptVersionRequest,
  CreateRunRequest,
  Fixture,
  HealthResponse,
  PromptVersion,
  Run,
  RunWithCases,
} from "../../shared/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.message ?? `Request failed with status ${res.status}`, err?.issues);
  }
  return body as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  fixtures: () => request<Fixture[]>("/api/fixtures"),
  listPrompts: () => request<PromptVersion[]>("/api/prompts"),
  createPrompt: (input: CreatePromptVersionRequest) =>
    request<PromptVersion>("/api/prompts", { method: "POST", body: JSON.stringify(input) }),
  listRuns: () => request<Run[]>("/api/runs"),
  getRun: (id: string) => request<RunWithCases>(`/api/runs/${encodeURIComponent(id)}`),
  createRun: (input: CreateRunRequest) =>
    request<RunWithCases>("/api/runs", { method: "POST", body: JSON.stringify(input) }),
  cancelRun: (id: string) => request<{ ok: true }>(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return [err.message, ...err.issues].join(" — ");
  return err instanceof Error ? err.message : String(err);
}
