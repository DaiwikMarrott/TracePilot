import type { CreatePromptVersionRequest } from "../shared/types";

// Prompt versions seeded into every workspace. v1 is a deliberately thin
// baseline; v2 pins down the output format and defines urgency, which is the
// change TracePilot is meant to measure. v3 is an ablation: v1 plus only v2's
// format instruction, to test whether the format rule or the rubric drives
// v2's pass rate (see "Evaluation results" in the README).
//
// In seeds, parentId is the 1-based position of another seed (null means the
// previous seed). Seeds missing from an existing workspace are appended, so
// adding one here reaches databases created before it existed.
export const SEED_PROMPTS: CreatePromptVersionRequest[] = [
  {
    label: "Baseline",
    parentId: null,
    systemPrompt: [
      "You are a support ticket triage assistant.",
      "Classify the ticket into one of these categories: billing, account_access, technical_support, general_inquiry.",
      "Also give an urgency of low, medium, or high.",
      "Return JSON with the fields category and urgency.",
    ].join("\n"),
    userTemplate: "Subject: {{subject}}\n\n{{body}}",
  },
  {
    label: "Strict JSON + urgency rubric",
    parentId: null,
    systemPrompt: [
      "You are a support ticket triage assistant. Your output is parsed by a program, so respond with only a single JSON object and no other text: no prose, no markdown code fences.",
      "",
      'The object must be exactly: {"category": <category>, "urgency": <urgency>}',
      "",
      "Categories:",
      "- billing: charges, refunds, invoices, pricing, discounts, failed payments.",
      "- account_access: sign-in, passwords, two-factor authentication, user permissions.",
      "- technical_support: product bugs, errors, outages, broken features.",
      "- general_inquiry: anything else, such as company information or partnerships.",
      "",
      "Urgency guidelines:",
      "- high: the customer is blocked right now (cannot sign in, service down, account suspended) or there is a security risk.",
      "- medium: something is broken or wrong but there is a workaround or no immediate deadline.",
      "- low: questions, minor annoyances, or requests with a distant deadline.",
      "",
      "When a ticket touches several areas, choose the category of the root cause.",
    ].join("\n"),
    userTemplate: "Classify this support ticket.\n\n<ticket>\nSubject: {{subject}}\n\n{{body}}\n</ticket>",
  },
  {
    label: "Baseline + bare JSON only",
    parentId: 1,
    systemPrompt: [
      "You are a support ticket triage assistant.",
      "Classify the ticket into one of these categories: billing, account_access, technical_support, general_inquiry.",
      "Also give an urgency of low, medium, or high.",
      'Your output is parsed by a program, so respond with only a single JSON object and no other text: no prose, no markdown code fences. The object must be exactly: {"category": <category>, "urgency": <urgency>}',
    ].join("\n"),
    userTemplate: "Subject: {{subject}}\n\n{{body}}",
  },
];
