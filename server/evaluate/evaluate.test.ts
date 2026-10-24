import { describe, expect, it } from "vitest";
import { compareLabel } from "./compare";
import { evaluateResponse } from "./evaluate";
import { parseResponseJson } from "./parseJson";
import { checkAllowedValues, checkRequiredFields } from "./validate";

const expected = { category: "billing", urgency: "medium" } as const;
const statuses = (text: string, stopReason: string | null = "end_turn") =>
  Object.fromEntries(evaluateResponse({ text, stopReason }, expected).checks.map((c) => [c.name, c.status]));

describe("parseResponseJson", () => {
  it("accepts a bare object with surrounding whitespace", () => {
    expect(parseResponseJson('  {"a":1}\n')).toEqual({ ok: true, value: { a: 1 } });
  });
  it("rejects empty, non-object and invalid JSON with a reason", () => {
    expect(parseResponseJson("")).toMatchObject({ ok: false, reason: "Response was empty." });
    expect(parseResponseJson("[1]")).toMatchObject({ ok: false, reason: expect.stringMatching(/array, not an object/) });
    expect(parseResponseJson("{category: x")).toMatchObject({ ok: false, recovered: undefined });
  });
  it("fails fenced JSON but recovers the object for explanation", () => {
    const r = parseResponseJson('Sure!\n```json\n{"category":"billing"}\n```');
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/code fence/), recovered: { category: "billing" } });
  });
  it("recovers an object embedded in prose", () => {
    expect(parseResponseJson('The answer is {"category":"billing"} thanks')).toMatchObject({
      ok: false,
      recovered: { category: "billing" },
    });
  });
});

describe("field validators", () => {
  it("reports missing and mistyped required fields", () => {
    expect(checkRequiredFields({ category: "billing", urgency: "low" }).ok).toBe(true);
    expect(checkRequiredFields({ urgency: 3 }).detail).toBe(
      'Required fields: missing "category"; "urgency" should be a string but is 3.',
    );
  });
  it("reports values outside the allowed sets", () => {
    expect(checkAllowedValues({ category: "billing", urgency: "low" }).ok).toBe(true);
    expect(checkAllowedValues({ category: "payments", urgency: "urgent" }).detail).toMatch(
      /category "payments" is not one of .*; urgency "urgent" is not one of low, medium, high/,
    );
  });
  it("compares labels with an explanation", () => {
    expect(compareLabel("urgency", "high", "medium")).toEqual({ ok: false, detail: 'Predicted "high", expected "medium".' });
    expect(compareLabel("urgency", undefined, "medium").detail).toBe('No urgency predicted; expected "medium".');
  });
});

describe("evaluateResponse", () => {
  it("passes only when every check passes", () => {
    const result = evaluateResponse({ text: '{"category":"billing","urgency":"medium"}', stopReason: "end_turn" }, expected);
    expect(result.passed).toBe(true);
    expect(result.predicted).toEqual({ category: "billing", urgency: "medium" });
  });

  it("fails a correct but fenced answer and still checks the labels", () => {
    const result = evaluateResponse({ text: '```json\n{"category":"billing","urgency":"medium"}\n```', stopReason: "end_turn" }, expected);
    expect(result.passed).toBe(false);
    expect(statuses('```json\n{"category":"billing","urgency":"medium"}\n```')).toEqual({
      json_parse: "failed",
      required_fields: "passed",
      allowed_values: "passed",
      category_match: "passed",
      urgency_match: "passed",
    });
    expect(result.checks[3]!.detail).toMatch(/recovered object/);
  });

  it("skips downstream checks when nothing can be parsed, and notes a truncating stop reason", () => {
    const result = evaluateResponse({ text: '{"category": "bill', stopReason: "max_tokens" }, expected);
    expect(result.checks[0]!.detail).toMatch(/stop_reason: max_tokens/);
    expect(result.checks.slice(1).every((c) => c.status === "skipped")).toBe(true);
    expect(result.predicted).toEqual({ category: null, urgency: null });
  });

  it("explains a wrong label", () => {
    const result = evaluateResponse({ text: '{"category":"billing","urgency":"high"}', stopReason: "end_turn" }, expected);
    expect(result.checks.find((c) => c.name === "urgency_match")).toEqual({
      name: "urgency_match",
      status: "failed",
      detail: 'Predicted "high", expected "medium".',
    });
  });
});
