import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { EFFORTS, MOCK_SCENARIOS } from "../../shared/types";
import type { ApiErrorBody } from "../../shared/types";

export const createPromptVersionSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(80),
  systemPrompt: z.string().trim().min(1, "System prompt is required").max(20_000),
  userTemplate: z
    .string()
    .max(20_000)
    .refine((t) => t.includes("{{body}}"), "User template must include {{body}}"),
  parentId: z.number().int().positive().nullable(),
});

export const modelSettingsSchema = z.object({
  provider: z.enum(["mock", "anthropic"]),
  model: z.string().trim().min(1).max(100),
  maxTokens: z.number().int().min(16).max(64_000),
  effort: z.enum(EFFORTS),
  timeoutMs: z.number().int().min(100).max(600_000),
  maxRetries: z.number().int().min(0).max(5),
  refusalFallback: z.boolean(),
  mockScenario: z.enum(MOCK_SCENARIOS),
});

export const createRunSchema = z.object({
  promptVersionId: z.number().int().positive(),
  fixtureSelection: z.enum(["dev", "holdout", "all"]),
  modelSettings: modelSettingsSchema,
});

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: string[],
  ) {
    super(message);
  }
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(
      400,
      "Invalid request body",
      result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
    );
  }
  return result.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof HttpError ? err.status : 500;
  const body: ApiErrorBody = {
    error: {
      message: err instanceof HttpError ? err.message : "Internal server error",
      ...(err instanceof HttpError && err.issues ? { issues: err.issues } : {}),
    },
  };
  if (status === 500) console.error(err);
  res.status(status).json(body);
}
