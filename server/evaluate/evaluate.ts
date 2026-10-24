import type { CheckResult, Evaluation, Fixture } from "../../shared/types";
import { compareLabel } from "./compare";
import { parseResponseJson } from "./parseJson";
import { checkAllowedValues, checkRequiredFields } from "./validate";

/**
 * Runs the checks in order. A failed JSON parse skips the rest unless an
 * object could be recovered, in which case the remaining checks run on it so
 * the developer can see whether the labels were right anyway. The case only
 * passes if every check passes.
 */
export function evaluateResponse(
  response: { text: string; stopReason: string | null },
  expected: Fixture["expected"],
): Evaluation {
  const checks: CheckResult[] = [];
  const parsed = parseResponseJson(response.text);
  const stopNote =
    response.stopReason && response.stopReason !== "end_turn" ? ` (stop_reason: ${response.stopReason})` : "";

  let value: unknown;
  if (parsed.ok) {
    checks.push({ name: "json_parse", status: "passed", detail: "Response is a bare JSON object." });
    value = parsed.value;
  } else {
    checks.push({ name: "json_parse", status: "failed", detail: parsed.reason + stopNote });
    value = parsed.recovered;
  }

  const note = parsed.ok ? "" : " (checked against the recovered object)";
  if (value === undefined) {
    const detail = "Skipped because no JSON object could be read from the response.";
    for (const name of ["required_fields", "allowed_values", "category_match", "urgency_match"] as const) {
      checks.push({ name, status: "skipped", detail });
    }
    return { passed: false, checks, predicted: { category: null, urgency: null } };
  }

  const obj = value as Record<string, unknown>;
  const required = checkRequiredFields(obj);
  checks.push({ name: "required_fields", status: required.ok ? "passed" : "failed", detail: required.detail + note });
  const allowed = checkAllowedValues(obj);
  checks.push({ name: "allowed_values", status: allowed.ok ? "passed" : "failed", detail: allowed.detail + note });
  const category = compareLabel("category", obj.category, expected.category);
  checks.push({ name: "category_match", status: category.ok ? "passed" : "failed", detail: category.detail + note });
  const urgency = compareLabel("urgency", obj.urgency, expected.urgency);
  checks.push({ name: "urgency_match", status: urgency.ok ? "passed" : "failed", detail: urgency.detail + note });

  return {
    passed: checks.every((c) => c.status === "passed"),
    checks,
    predicted: {
      category: typeof obj.category === "string" ? obj.category : null,
      urgency: typeof obj.urgency === "string" ? obj.urgency : null,
    },
  };
}
