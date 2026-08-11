import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";

import type { ApprovalRecord, JsonSchema } from "./types";

export interface EditValidationIssue {
  path: string;
  keyword: string;
  message: string;
}

export type EditValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: EditValidationIssue[] };

/** Thrown by `createValidatedEditDecision` when the graph's edit contract fails. */
export class ApprovalEditValidationError extends Error {
  readonly issues: EditValidationIssue[];

  constructor(issues: EditValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "ApprovalEditValidationError";
    this.issues = issues;
  }
}

function issueFromAjv(error: ErrorObject): EditValidationIssue {
  return {
    path: error.instancePath || "args",
    keyword: error.keyword,
    message: error.message ?? "does not satisfy the edit schema",
  };
}

function schemaFailure(error: unknown): EditValidationResult {
  const message = error instanceof Error ? error.message : "The edit schema could not be evaluated";
  return { valid: false, errors: [{ path: "schema", keyword: "schema", message }] };
}

/**
 * Validate edited action arguments before submitting them to an approval store.
 *
 * Existing Agent Inbox requests may omit `context.edit_schema`; those retain
 * their legacy permissive edit behavior. New requests can attach a standard
 * JSON Schema for safe structured editing.
 */
export function validateApprovalEdit(
  record: Pick<ApprovalRecord, "config" | "context">,
  args: Record<string, unknown>,
): EditValidationResult {
  if (!record.config.allow_edit) {
    return {
      valid: false,
      errors: [{ path: "args", keyword: "permission", message: "Editing is disabled for this approval" }],
    };
  }
  const schema: JsonSchema | undefined = record.context?.edit_schema;
  if (!schema) {
    return { valid: true, errors: [] };
  }
  try {
    const validator = new Ajv2020({ allErrors: true, strict: false });
    const valid = validator.validate(schema, args);
    if (valid) {
      return { valid: true, errors: [] };
    }
    return { valid: false, errors: (validator.errors ?? []).map(issueFromAjv) };
  } catch (error) {
    return schemaFailure(error);
  }
}

/** Build an edit decision only when it conforms to the graph's edit contract. */
export function createValidatedEditDecision(
  record: Pick<ApprovalRecord, "config" | "context">,
  args: Record<string, unknown>,
): { type: "edit"; args: Record<string, unknown> } {
  const result = validateApprovalEdit(record, args);
  if (!result.valid) {
    throw new ApprovalEditValidationError(result.errors);
  }
  return { type: "edit", args };
}
