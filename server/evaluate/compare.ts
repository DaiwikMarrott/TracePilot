export function compareLabel(field: string, predicted: unknown, expected: string): { ok: boolean; detail: string } {
  if (typeof predicted !== "string") {
    return { ok: false, detail: `No ${field} predicted; expected "${expected}".` };
  }
  return predicted === expected
    ? { ok: true, detail: `Predicted "${predicted}".` }
    : { ok: false, detail: `Predicted "${predicted}", expected "${expected}".` };
}
