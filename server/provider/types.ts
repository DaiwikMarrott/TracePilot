import type { ErrorKind, ModelSettings, ProviderName } from "../../shared/types";

export interface ProviderRequest {
  system: string;
  user: string;
  settings: ModelSettings;
}

export interface ProviderCallbacks {
  /** Called for each text delta, in order. */
  onText: (delta: string) => void;
}

export interface ProviderResponse {
  text: string;
  /** API-reported usage; null when the provider did not report it. */
  inputTokens: number | null;
  outputTokens: number | null;
  requestId: string | null;
  messageId: string | null;
  servedModel: string | null;
  stopReason: string | null;
}

/**
 * Adapters translate provider-specific failures into this one shape so the
 * runner can apply a single retry and labelling policy.
 */
export class ProviderError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly options: { retryable: boolean; requestId?: string | null; retryAfterMs?: number | null; cause?: unknown } = {
      retryable: false,
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
  }
  get retryable() {
    return this.options.retryable;
  }
  get requestId() {
    return this.options.requestId ?? null;
  }
  get retryAfterMs() {
    return this.options.retryAfterMs ?? null;
  }
}

export interface Provider {
  readonly name: ProviderName;
  /**
   * Streams one completion. Must reject with a ProviderError, and must stop
   * promptly (rejecting with kind "cancelled") when `signal` aborts.
   */
  stream(request: ProviderRequest, callbacks: ProviderCallbacks, signal: AbortSignal): Promise<ProviderResponse>;
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => vars[key] ?? match);
}
