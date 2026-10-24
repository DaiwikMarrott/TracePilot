import { ApiError, GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from "@google/genai";
import type { Effort } from "../../shared/types";
import { ProviderError, type Provider, type ProviderCallbacks, type ProviderRequest, type ProviderResponse } from "./types";

// Google Gemini (Gemini Developer API) adapter. It exists so the full
// pipeline can be exercised against a real hosted model while developing;
// it maps onto the same ProviderError kinds as the Claude adapter so the
// runner's retry and labelling policy is identical for both.

export interface GeminiProviderOptions {
  apiKey: string;
  /** Injected in tests; defaults to global fetch (which MSW intercepts). */
  fetch?: typeof fetch;
}

const THINKING: Record<Effort, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
  xhigh: ThinkingLevel.HIGH,
  max: ThinkingLevel.HIGH,
};

export class GeminiProvider implements Provider {
  readonly name = "google" as const;
  private readonly client: GoogleGenAI;

  constructor(options: GeminiProviderOptions) {
    this.client = new GoogleGenAI({
      apiKey: options.apiKey,
      // No SDK retries: the runner owns retries so every attempt is recorded.
      httpOptions: { retryOptions: { attempts: 1 }, ...(options.fetch ? { fetch: options.fetch } : {}) },
    });
  }

  async stream(request: ProviderRequest, callbacks: ProviderCallbacks, signal: AbortSignal): Promise<ProviderResponse> {
    const { settings } = request;
    let text = "";
    let last: GenerateContentResponse | null = null;
    try {
      const stream = await this.client.models.generateContentStream({
        model: settings.model,
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        config: {
          systemInstruction: request.system,
          maxOutputTokens: settings.maxTokens,
          thinkingConfig: { thinkingLevel: THINKING[settings.effort] },
          abortSignal: signal,
          httpOptions: { timeout: settings.timeoutMs },
        },
      });
      for await (const chunk of stream) {
        last = chunk;
        // Thought summaries are not part of the answer.
        const delta = (chunk.candidates?.[0]?.content?.parts ?? [])
          .filter((part) => !part.thought && typeof part.text === "string")
          .map((part) => part.text)
          .join("");
        if (delta) {
          text += delta;
          callbacks.onText(delta);
        }
      }
    } catch (err) {
      throw toProviderError(err, signal);
    }

    const usage = last?.usageMetadata;
    const candidates = usage?.candidatesTokenCount;
    return {
      text,
      inputTokens: usage?.promptTokenCount ?? null,
      // Billed output includes thinking tokens, as Claude's output_tokens does.
      outputTokens: typeof candidates === "number" ? candidates + (usage?.thoughtsTokenCount ?? 0) : null,
      // The Gemini API sends no request-ID header; the response ID is the closest identifier.
      requestId: null,
      messageId: last?.responseId ?? null,
      servedModel: last?.modelVersion ?? null,
      stopReason: last?.candidates?.[0]?.finishReason ?? null,
    };
  }
}

export function toProviderError(err: unknown, signal?: AbortSignal): ProviderError {
  if (err instanceof ProviderError) return err;
  if (signal?.aborted) return new ProviderError("cancelled", "Request was aborted", { retryable: false, cause: err });
  if (err instanceof ApiError) {
    const message = summarizeMessage(err.message);
    const status = err.status;
    if (status === 429) {
      return new ProviderError("rate_limit", message, { retryable: true, retryAfterMs: parseRetryDelay(err.message), cause: err });
    }
    if (status === 401 || status === 403) return new ProviderError("auth", message, { retryable: false, cause: err });
    if (status === 400 || status === 404 || status === 422) {
      return new ProviderError("bad_request", message, { retryable: false, cause: err });
    }
    if (status === 503 || status === 529) return new ProviderError("overloaded", message, { retryable: true, cause: err });
    if (status === 408 || status === 504) return new ProviderError("timeout", message, { retryable: true, cause: err });
    if (status >= 500) return new ProviderError("server_error", message, { retryable: true, cause: err });
    return new ProviderError("unknown", message, { retryable: false, cause: err });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return new ProviderError("timeout", `Request timed out: ${message}`, { retryable: true, cause: err });
  }
  if (err instanceof TypeError) {
    return new ProviderError("connection", `Connection error: ${message}`, { retryable: true, cause: err });
  }
  return new ProviderError("stream_interrupted", `Stream failed: ${message}`, { retryable: true, cause: err });
}

/** The SDK puts the API's JSON error body in the message; pull out the human-readable part. */
function summarizeMessage(raw: string): string {
  const match = /"message":\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
  const inner = match ? match[1]!.replace(/\\n/g, " ").replace(/\\"/g, '"') : raw;
  // The message can itself be a JSON document; unwrap one level.
  const nested = /"message":\s*"((?:[^"\\]|\\.)*)"/.exec(inner);
  return (nested ? nested[1]! : inner)
    .replace(/\\+n/g, " ") // escaped newlines left over from double-encoded JSON
    .replace(/\\+/g, "")
    .replace(/\s+\*\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/** Gemini sends RetryInfo as `"retryDelay": "17s"` in the error details. */
function parseRetryDelay(raw: string): number | null {
  const match = /retryDelay\\?"?:\s*\\?"(\d+(?:\.\d+)?)s/.exec(raw);
  return match ? Math.round(Number(match[1]) * 1000) : null;
}
