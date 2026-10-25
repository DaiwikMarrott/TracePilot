import { ProviderError, type Provider, type ProviderCallbacks, type ProviderRequest, type ProviderResponse } from "./types";

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export const abortableSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

/**
 * A deterministic stand-in for Claude so the whole workflow runs without an
 * API key. It reacts to the prompt the way the demo needs (a prompt that
 * demands bare JSON gets bare JSON; one that defines urgency gets better
 * urgency labels) and can inject failures via `settings.mockScenario`.
 * Its labels come from keyword rules, so mock results say nothing about how
 * Claude would score.
 */
export class MockProvider implements Provider {
  readonly name = "mock" as const;
  private calls = 0;

  constructor(
    private readonly options: { chunkDelayMs?: number; sleep?: Sleep } = {},
  ) {}

  async stream(request: ProviderRequest, callbacks: ProviderCallbacks, signal: AbortSignal): Promise<ProviderResponse> {
    const sleep = this.options.sleep ?? abortableSleep;
    const scenario = request.settings.mockScenario;
    const attempt = request.attempt ?? 1;
    const call = ++this.calls;
    const requestId = `mock_req_${call.toString().padStart(4, "0")}`;
    const baseDelay = this.options.chunkDelayMs ?? 35;
    const delay = scenario === "slow" ? baseDelay * 12 : baseDelay;

    const wait = async (ms: number) => {
      try {
        await sleep(ms, signal);
      } catch (reason) {
        throw new ProviderError("cancelled", "Request was aborted", { retryable: false, requestId, cause: reason });
      }
    };

    await wait(delay * 3); // time to first token

    if (scenario === "rate_limit_once" && attempt === 1) {
      throw new ProviderError("rate_limit", "429 rate_limit_error: mock rate limit", {
        retryable: true,
        requestId,
        retryAfterMs: 250,
      });
    }
    if (scenario === "timeout" && attempt === 1) {
      // Never respond; only the runner's deadline (or a cancel) ends this.
      await wait(24 * 60 * 60 * 1000);
    }

    const text = scenario === "malformed" ? malformedResponse(request) : classify(request);
    const chunks = text.match(/.{1,6}/gs) ?? [];
    const interruptAt = scenario === "interrupt_stream" && call % 2 === 1 ? Math.ceil(chunks.length / 2) : -1;

    let emitted = "";
    for (const [i, chunk] of chunks.entries()) {
      if (i === interruptAt) {
        throw new ProviderError("stream_interrupted", "Mock stream closed before message_stop", {
          retryable: true,
          requestId,
        });
      }
      await wait(delay);
      callbacks.onText(chunk);
      emitted += chunk;
    }

    return {
      text: emitted,
      // No API, so no reported usage. Showing an estimate here would look like a measurement.
      inputTokens: null,
      outputTokens: null,
      requestId,
      messageId: `mock_msg_${call}`,
      servedModel: "mock-classifier",
      stopReason: "end_turn",
    };
  }
}

function classify({ system, user }: ProviderRequest): string {
  const knowsRubric = /urgency guidelines/i.test(system);
  const strictJson = /respond with only/i.test(system);
  const category = pickCategory(user, knowsRubric);
  const urgency = knowsRubric ? rubricUrgency(user) : naiveUrgency(user);
  const json = JSON.stringify({ category, urgency });
  return strictJson ? json : `Here is the classification for this ticket:\n\n\`\`\`json\n${json}\n\`\`\``;
}

function pickCategory(text: string, rootCause: boolean): string {
  const billing = /charge|refund|invoice|discount|renewal|card|pricing|plan\b/i.test(text);
  const access = /sign in|log in|password|2fa|two-factor|locked out|admin access/i.test(text);
  const technical = /error|500|export|bug|toggle|crash|broken|api\b|reload/i.test(text);
  // With the root-cause instruction, a billing problem that causes a lockout is billing.
  if (rootCause && billing) return "billing";
  if (access) return "account_access";
  if (billing) return "billing";
  if (technical) return "technical_support";
  return "general_inquiry";
}

function naiveUrgency(text: string): string {
  return /urgent|down|asap|immediately/i.test(text) ? "high" : "medium";
}

function rubricUrgency(text: string): string {
  if (/can't sign in|cannot sign in|locked out|completely down|suspended|urgently|still log in|in two hours/i.test(text)) {
    return "high";
  }
  if (/not urgent|minor|curious|discount|program|weeks away|evaluating/i.test(text)) return "low";
  return "medium";
}

function malformedResponse(request: ProviderRequest): string {
  const valid = JSON.parse(classify({ ...request, system: request.system + "\nrespond with only json" }));
  // A plausible model mistake: unquoted keys, an invented category, a truncated object.
  return `{category: "${valid.category}-ish", "urgency": "${valid.urgency}"`;
}
