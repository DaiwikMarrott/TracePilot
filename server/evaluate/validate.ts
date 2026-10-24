import { CATEGORIES, URGENCIES } from "../../shared/types";

export interface FieldCheck {
  ok: boolean;
  detail: string;
}

export const REQUIRED_FIELDS = ["category", "urgency"] as const;
export const ALLOWED: Record<(typeof REQUIRED_FIELDS)[number], readonly string[]> = {
  category: CATEGORIES,
  urgency: URGENCIES,
};

export function checkRequiredFields(value: unknown): FieldCheck {
  const obj = (value ?? {}) as Record<string, unknown>;
  const missing = REQUIRED_FIELDS.filter((f) => !(f in obj));
  const wrongType = REQUIRED_FIELDS.filter((f) => f in obj && typeof obj[f] !== "string");
  const problems = [
    ...missing.map((f) => `missing "${f}"`),
    ...wrongType.map((f) => `"${f}" should be a string but is ${JSON.stringify(obj[f])}`),
  ];
  return problems.length
    ? { ok: false, detail: `Required fields: ${problems.join("; ")}.` }
    : { ok: true, detail: "category and urgency are present strings." };
}

export function checkAllowedValues(value: unknown): FieldCheck {
  const obj = (value ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    const v = obj[field];
    if (typeof v === "string" && !ALLOWED[field].includes(v)) {
      problems.push(`${field} "${v}" is not one of ${ALLOWED[field].join(", ")}`);
    }
  }
  return problems.length
    ? { ok: false, detail: `${problems.join("; ")}.` }
    : { ok: true, detail: "Values are in the allowed sets." };
}
