import type { CreatePromptVersionRequest } from "../shared/types";

// The two prompt versions seeded into a fresh workspace. v1 is a deliberately
// thin baseline; v2 pins down the output format and defines urgency, which is
// the change TracePilot is meant to measure.
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
];
