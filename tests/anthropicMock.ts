import { http, HttpResponse, delay } from "msw";

export const API_URL = "https://api.anthropic.com/v1/messages";

export type SseStep =
  | { kind: "text"; text: string }
  | { kind: "pause"; ms: number }
  /** An `error` event mid-stream, as the API sends for overload during streaming. */
  | { kind: "error_event"; type: string; message: string }
  /** Drop the connection without message_stop. */
  | { kind: "cut" };

export interface StreamScript {
  steps: SseStep[];
  usage?: { input_tokens: number; output_tokens: number } | null;
  requestId?: string;
  model?: string;
  stopReason?: string;
}

const frame = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

/** Builds a Messages API SSE response following the documented event order. */
export function sseResponse(script: StreamScript) {
  const encoder = new TextEncoder();
  const model = script.model ?? "claude-opus-5-5";
  const usage = script.usage === undefined ? { input_tokens: 120, output_tokens: 14 } : script.usage;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (type: string, data: unknown) => controller.enqueue(encoder.encode(frame(type, data)));
      send("message_start", {
        type: "message_start",
        message: {
          id: "msg_test_1",
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: usage ? { input_tokens: usage.input_tokens, output_tokens: 1 } : {},
        },
      });
      send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      for (const step of script.steps) {
        if (step.kind === "text") {
          send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: step.text } });
        } else if (step.kind === "pause") {
          await delay(step.ms);
        } else if (step.kind === "error_event") {
          send("error", { type: "error", error: { type: step.type, message: step.message } });
          controller.close();
          return;
        } else {
          controller.error(new Error("socket hang up"));
          return;
        }
      }
      send("content_block_stop", { type: "content_block_stop", index: 0 });
      send("message_delta", {
        type: "message_delta",
        delta: { stop_reason: script.stopReason ?? "end_turn", stop_sequence: null },
        usage: usage ? { output_tokens: usage.output_tokens } : {},
      });
      send("message_stop", { type: "message_stop" });
      controller.close();
    },
  });
  return new HttpResponse(body, {
    headers: { "content-type": "text/event-stream", "request-id": script.requestId ?? "req_test_1" },
  });
}

export function apiError(status: number, type: string, message: string, headers: Record<string, string> = {}) {
  return HttpResponse.json(
    { type: "error", error: { type, message } },
    { status, headers: { "request-id": `req_err_${status}`, ...headers } },
  );
}

/** Serves the given responders in order, one per request; the last repeats. */
export function sequence(...responders: (() => Response | Promise<Response>)[]) {
  let call = 0;
  const bodies: unknown[] = [];
  const handler = http.post(API_URL, async ({ request }) => {
    bodies.push(await request.json());
    const responder = responders[Math.min(call, responders.length - 1)]!;
    call += 1;
    return responder();
  });
  return { handler, calls: () => call, bodies };
}
