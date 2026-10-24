import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TICKETS } from "../fixtures/tickets";
import { ApiError } from "@google/genai";
import { GeminiProvider, toProviderError } from "../server/provider/gemini";
import type { Provider } from "../server/provider/types";
import { executeCase } from "../server/runner/executeCase";
import { defaultModelSettings } from "../shared/defaults";

const STREAM = /generativelanguage\.googleapis\.com\/.*:streamGenerateContent/;
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const settings = { ...defaultModelSettings("gemini-3.5-flash"), provider: "google" as const };
const request = { system: "Classify.", user: "Ticket body", settings };
const provider = () => new GeminiProvider({ apiKey: "test-google-key" });

type Chunk = Record<string, unknown>;
const textChunk = (text: string, extra: Chunk = {}): Chunk => ({
  candidates: [{ content: { role: "model", parts: [{ text }] }, index: 0 }],
  modelVersion: "gemini-3.6-flash",
  responseId: "resp_1",
  ...extra,
});

/** Builds the SSE body the Gemini API returns for streamGenerateContent?alt=sse. */
function sse(chunks: (Chunk | { pause: number })[]) {
  const encoder = new TextEncoder();
  return new HttpResponse(
    new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) {
          if ("pause" in chunk && typeof chunk.pause === "number") await delay(chunk.pause);
          else controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`));
        }
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

const googleError = (status: number, statusText: string, message: string, details: unknown[] = []) =>
  HttpResponse.json({ error: { code: status, message, status: statusText, details } }, { status });

describe("GeminiProvider", () => {
  it("streams answer text (not thoughts) and reports usage, response ID, served model and finish reason", async () => {
    let body: Record<string, unknown> = {};
    let key: string | null = null;
    server.use(
      http.post(STREAM, async ({ request: req }) => {
        body = (await req.json()) as Record<string, unknown>;
        key = req.headers.get("x-goog-api-key");
        return sse([
          { candidates: [{ content: { role: "model", parts: [{ text: "thinking about it", thought: true }] } }] },
          textChunk('{"category":'),
          textChunk('"billing"}', {
            candidates: [{ content: { role: "model", parts: [{ text: '"billing"}' }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 140, candidatesTokenCount: 9, thoughtsTokenCount: 60, totalTokenCount: 209 },
          }),
        ]);
      }),
    );
    const deltas: string[] = [];
    const result = await provider().stream(request, { onText: (t) => deltas.push(t) }, new AbortController().signal);

    expect(deltas).toEqual(['{"category":', '"billing"}']);
    expect(result).toEqual({
      text: '{"category":"billing"}',
      inputTokens: 140,
      outputTokens: 69,
      requestId: null,
      messageId: "resp_1",
      servedModel: "gemini-3.6-flash",
      stopReason: "STOP",
    });
    expect(key).toBe("test-google-key");
    expect(body).toMatchObject({
      systemInstruction: { parts: [{ text: "Classify." }] },
      generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: "LOW" } },
    });
  });

  it("keeps usage unknown when the stream reports none", async () => {
    server.use(http.post(STREAM, () => sse([textChunk("{}")])));
    const result = await provider().stream(request, { onText: () => {} }, new AbortController().signal);
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
  });

  it("maps 429 RESOURCE_EXHAUSTED to a retryable rate limit using the RetryInfo delay", async () => {
    server.use(
      http.post(STREAM, () =>
        googleError(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota.", [
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "7s" },
        ]),
      ),
    );
    await expect(provider().stream(request, { onText: () => {} }, new AbortController().signal)).rejects.toMatchObject({
      kind: "rate_limit",
      retryable: true,
      retryAfterMs: 7000,
      message: "You exceeded your current quota.",
    });
  });

  it("cleans the double-encoded error body the SDK puts in the message", () => {
    // Shape observed from the live API: the API error JSON is embedded, escaped, inside another JSON string.
    const inner = JSON.stringify({
      error: {
        code: 429,
        message: "You exceeded your current quota.\n* Quota exceeded for metric: generate_content_free_tier_requests, limit: 5",
        details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "36s" }],
      },
    });
    const err = toProviderError(new ApiError({ message: JSON.stringify({ error: { message: inner, code: 429 } }), status: 429 }));
    expect(err.message).toBe("You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 5");
    expect(err.retryAfterMs).toBe(36_000);
  });

  it.each([
    [503, "UNAVAILABLE", "overloaded", true],
    [500, "INTERNAL", "server_error", true],
    [403, "PERMISSION_DENIED", "auth", false],
    [404, "NOT_FOUND", "bad_request", false],
  ])("maps HTTP %i to %s", async (status, statusText, kind, retryable) => {
    server.use(http.post(STREAM, () => googleError(status, statusText, "nope")));
    await expect(provider().stream(request, { onText: () => {} }, new AbortController().signal)).rejects.toMatchObject({
      kind,
      retryable,
    });
  });

  it("aborts when the signal fires", async () => {
    server.use(http.post(STREAM, () => sse([textChunk("{"), { pause: 5000 }, textChunk("}")])));
    const controller = new AbortController();
    const pending = provider().stream(request, { onText: () => controller.abort() }, controller.signal);
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("through the runner: an error chunk after text keeps the partial output and is labelled interrupted", async () => {
    let calls = 0;
    server.use(
      http.post(STREAM, () => {
        calls += 1;
        return sse([textChunk('{"category": "bil'), { pause: 10 }, { error: { code: 500, message: "Internal error", status: "INTERNAL" } }]);
      }),
    );
    const result = await executeCase({
      runId: "r",
      index: 0,
      fixture: TICKETS[0]!,
      provider: provider() as Provider,
      request: { ...request, settings: { ...settings, maxRetries: 2 } },
      signal: new AbortController().signal,
      now: Date.now,
      sleep: async () => {},
      emit: () => {},
      saveProgress: () => {},
    });
    expect(calls).toBe(1);
    expect(result).toMatchObject({ status: "failed", interrupted: true, output: '{"category": "bil' });
  });

  it("through the runner: a 503 before output is retried and then succeeds", async () => {
    let calls = 0;
    server.use(
      http.post(STREAM, () => {
        calls += 1;
        return calls === 1
          ? googleError(503, "UNAVAILABLE", "This model is currently experiencing high demand.")
          : sse([textChunk(JSON.stringify(TICKETS[0]!.expected), { candidates: [{ content: { parts: [{ text: JSON.stringify(TICKETS[0]!.expected) }] }, finishReason: "STOP" }] })]);
      }),
    );
    const delays: number[] = [];
    const result = await executeCase({
      runId: "r",
      index: 0,
      fixture: TICKETS[0]!,
      provider: provider(),
      request,
      signal: new AbortController().signal,
      now: Date.now,
      sleep: async (ms) => void delays.push(ms),
      emit: () => {},
      saveProgress: () => {},
    });
    expect(calls).toBe(2);
    expect(delays).toEqual([250]);
    expect(result.status).toBe("completed");
    expect(result.evaluation!.passed).toBe(true);
    // STOP is a normal finish, so it is not quoted as a cause.
    expect(result.attemptLog.map((a) => a.errorKind ?? a.outcome)).toEqual(["overloaded", "success"]);
  });
});
