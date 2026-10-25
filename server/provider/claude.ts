import Anthropic from "@anthropic-ai/sdk";
import type { ErrorKind } from "../../shared/types";
import { ProviderError, type Provider, type ProviderCallbacks, type ProviderRequest, type ProviderResponse } from "./types";

// Server-side refusal fallback ("default" routes by refusal category, so no
// model list to maintain). Only some models accept it; it can be switched off
// per run in the model settings.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface ClaudeProviderOptions {
  apiKey: string;
  baseURL?: string;
  /** Injected in tests so MSW can intercept requests. */
  fetch?: typeof fetch;
}

export class ClaudeProvider implements Provider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(options: ClaudeProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      fetch: options.fetch,
      // Retries are owned by the runner so every attempt is visible in the
      // run record and retries never happen after output has started.
      maxRetries: 0,
    });
  }

  async stream(request: ProviderRequest, callbacks: ProviderCallbacks, signal: AbortSignal): Promise<ProviderResponse> {
    const { settings } = request;
    let requestId: string | null = null;
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: settings.model,
          max_tokens: settings.maxTokens,
          system: request.system,
          messages: [{ role: "user", content: request.user }],
          output_config: { effort: settings.effort },
          ...(settings.refusalFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
        },
        { signal, timeout: settings.timeoutMs },
      );
      stream.on("connect", () => {
        requestId = stream.request_id ?? null;
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          callbacks.onText(event.delta.text);
        }
      }
      const message = await stream.finalMessage();
      requestId = stream.request_id ?? requestId;
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      return {
        text,
        inputTokens: typeof message.usage?.input_tokens === "number" ? message.usage.input_tokens : null,
        outputTokens: typeof message.usage?.output_tokens === "number" ? message.usage.output_tokens : null,
        requestId,
        messageId: message.id ?? null,
        servedModel: message.model ?? null,
        stopReason: message.stop_reason ?? null,
      };
    } catch (err) {
      throw toProviderError(err, requestId, signal);
    }
  }
}

export function toProviderError(err: unknown, requestId: string | null, signal?: AbortSignal): ProviderError {
  if (err instanceof ProviderError) return err;
  if (signal?.aborted || err instanceof Anthropic.APIUserAbortError) {
    return new ProviderError("cancelled", "Request was aborted", { retryable: false, requestId, cause: err });
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError("timeout", "Request timed out", { retryable: true, requestId, cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError("connection", `Connection error: ${err.message}`, { retryable: true, requestId, cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    const id = err.requestID ?? requestId;
    const message = err.message;
    if (err instanceof Anthropic.RateLimitError) {
      return new ProviderError("rate_limit", message, {
        retryable: true,
        requestId: id,
        retryAfterMs: parseRetryAfter(err.headers),
        cause: err,
      });
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      return new ProviderError("auth", message, { retryable: false, requestId: id, cause: err });
    }
    if (
      err instanceof Anthropic.BadRequestError ||
      err instanceof Anthropic.NotFoundError ||
      err instanceof Anthropic.UnprocessableEntityError
    ) {
      return new ProviderError("bad_request", message, { retryable: false, requestId: id, cause: err });
    }
    // Server errors, including an `error` event sent mid-stream (status undefined).
    const kind: ErrorKind = err.status === 529 || err.type === "overloaded_error" ? "overloaded" : "server_error";
    return new ProviderError(kind, message, {
      retryable: true,
      requestId: id,
      retryAfterMs: parseRetryAfter(err.headers),
      cause: err,
    });
  }
  // Anything else thrown while reading the body (socket reset, malformed SSE).
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError("stream_interrupted", `Stream failed: ${message}`, { retryable: true, requestId, cause: err });
}

function parseRetryAfter(headers: Headers | undefined): number | null {
  const value = headers?.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
}
