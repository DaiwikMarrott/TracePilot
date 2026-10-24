export type ParseResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      reason: string;
      /** A value salvaged from a fenced or embedded object, so later checks can still explain the labels. */
      recovered: unknown | undefined;
    };

const FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

/**
 * The application contract is a bare JSON object. Anything else fails, but we
 * try to recover an object from code fences or surrounding prose so the
 * failure explanation can say what the model meant.
 */
export function parseResponseJson(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, reason: "Response was empty.", recovered: undefined };
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, reason: `Response parsed as JSON ${describe(value)}, not an object.`, recovered: undefined };
    }
    return { ok: true, value };
  } catch (err) {
    const syntax = err instanceof Error ? err.message : String(err);
    const fenced = FENCE.exec(trimmed)?.[1];
    if (fenced !== undefined) {
      const recovered = tryParseObject(fenced);
      if (recovered !== undefined) {
        return {
          ok: false,
          reason: "Response wrapped the JSON in a markdown code fence with extra text; the contract requires a bare JSON object.",
          recovered,
        };
      }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start > 0 || (end >= 0 && end < trimmed.length - 1)) {
      const recovered = start >= 0 && end > start ? tryParseObject(trimmed.slice(start, end + 1)) : undefined;
      if (recovered !== undefined) {
        return { ok: false, reason: "Response contained a JSON object surrounded by extra text.", recovered };
      }
    }
    return { ok: false, reason: `Response is not valid JSON (${syntax}).`, recovered: undefined };
  }
}

function tryParseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text.trim());
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
