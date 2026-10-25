import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ClaudeProvider } from "../server/provider/claude";
import { ProviderError } from "../server/provider/types";
import { defaultModelSettings } from "../shared/defaults";
import { apiError, sequence, sseResponse } from "./anthropicMock";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const settings = { ...defaultModelSettings(), provider: "anthropic" as const };
const request = { system: "Classify.", user: "Ticket body", settings };
const provider = () => new ClaudeProvider({ apiKey: "test-key" });

describe("ClaudeProvider", () => {
  it("streams text deltas and returns API-reported usage and identifiers", async () => {
    const api = sequence(() =>
      sseResponse({ steps: [{ kind: "text", text: '{"category":' }, { kind: "text", text: '"billing"}' }], requestId: "req_abc" }),
    );
    server.use(api.handler);
    const deltas: string[] = [];
    const result = await provider().stream(request, { onText: (t) => deltas.push(t) }, new AbortController().signal);

    expect(deltas).toEqual(['{"category":', '"billing"}']);
    expect(result).toMatchObject({
      text: '{"category":"billing"}',
      inputTokens: 120,
      outputTokens: 14,
      requestId: "req_abc",
      messageId: "msg_test_1",
      servedModel: "claude-opus-5-5",
      stopReason: "end_turn",
    });
    expect(api.bodies[0]).toMatchObject({
      model: "claude-opus-5-5",
      system: "Classify.",
      stream: true,
      output_config: { effort: "low" },
      fallbacks: "default",
    });
  });

  it("omits the fallback parameter when disabled", async () => {
    const api = sequence(() => sseResponse({ steps: [{ kind: "text", text: "{}" }] }));
    server.use(api.handler);
    await provider().stream(
      { ...request, settings: { ...settings, refusalFallback: false } },
      { onText: () => {} },
      new AbortController().signal,
    );
    expect(api.bodies[0]).not.toHaveProperty("fallbacks");
  });

  it("classifies a 429 as a retryable rate limit with retry-after and request id", async () => {
    server.use(sequence(() => apiError(429, "rate_limit_error", "Too many requests", { "retry-after": "3" })).handler);
    const err = await provider()
      .stream(request, { onText: () => {} }, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: "rate_limit", retryable: true, retryAfterMs: 3000, requestId: "req_err_429" });
  });

  it("aborts the upstream request when the signal fires", async () => {
    server.use(
      sequence(() => sseResponse({ steps: [{ kind: "text", text: "{" }, { kind: "pause", ms: 5000 }, { kind: "text", text: "}" }] }))
        .handler,
    );
    const controller = new AbortController();
    const deltas: string[] = [];
    const pending = provider().stream(
      request,
      {
        onText: (t) => {
          deltas.push(t);
          controller.abort();
        },
      },
      controller.signal,
    );
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
    expect(deltas).toEqual(["{"]);
  });
});
