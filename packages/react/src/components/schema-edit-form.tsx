"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";

import { validateApprovalEdit, type EditValidationIssue } from "../edit-validation";
import type { ApprovalRecord, JsonSchema } from "../types";
import { CheckIcon } from "./icons";
import { titleCase } from "./format";

type FieldKind = "string" | "number" | "integer" | "boolean" | "json";

interface EditField {
  path: string[];
  pointer: string;
  label: string;
  description?: string;
  kind: FieldKind;
  required: boolean;
  choices?: unknown[];
  minimum?: number;
  maximum?: number;
  format?: string;
}

export interface SchemaEditFormProps {
  record: ApprovalRecord;
  pending?: boolean;
  onCancel?(): void;
  onSubmit(args: Record<string, unknown>): void | Promise<void>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pointer(path: string[]): string {
  return `/${path.map((part) => part.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function inferredSchema(value: unknown): JsonSchema {
  if (typeof value === "string") return { type: "string" };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (Array.isArray(value)) return { type: "array" };
  if (isObject(value)) {
    return {
      type: "object",
      properties: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, inferredSchema(item)])),
    };
  }
  return {};
}

function schemaType(schema: JsonSchema, value: unknown): FieldKind {
  const type = schema.type;
  if (type === "string" || type === "number" || type === "integer" || type === "boolean") return type;
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  return "json";
}

function collectFields(
  schema: JsonSchema,
  values: Record<string, unknown>,
  base: string[] = [],
  parentRequired = new Set<string>(),
): EditField[] {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const keys = [...new Set([...Object.keys(properties), ...Object.keys(values)])];
  return keys.flatMap((key) => {
    const rawSchema = isObject(properties[key]) ? properties[key] : inferredSchema(values[key]);
    const path = [...base, key];
    const value = values[key];
    const nestedProperties = isObject(rawSchema.properties) ? rawSchema.properties : null;
    if ((rawSchema.type === "object" || nestedProperties) && isObject(value)) {
      const required = new Set(Array.isArray(rawSchema.required) ? rawSchema.required.filter((item): item is string => typeof item === "string") : []);
      return collectFields(rawSchema, value, path, required);
    }
    return [{
      path,
      pointer: pointer(path),
      label: typeof rawSchema.title === "string" ? rawSchema.title : titleCase(key),
      ...(typeof rawSchema.description === "string" ? { description: rawSchema.description } : {}),
      kind: schemaType(rawSchema, value),
      required: parentRequired.has(key),
      ...(Array.isArray(rawSchema.enum) ? { choices: rawSchema.enum } : {}),
      ...(typeof rawSchema.minimum === "number" ? { minimum: rawSchema.minimum } : {}),
      ...(typeof rawSchema.maximum === "number" ? { maximum: rawSchema.maximum } : {}),
      ...(typeof rawSchema.format === "string" ? { format: rawSchema.format } : {}),
    }];
  });
}

function valueAt(root: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = root;
  for (const part of path) {
    if (!isObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

function setValue(root: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const clone = structuredClone(root);
  let current = clone;
  path.forEach((part, index) => {
    if (index === path.length - 1) {
      current[part] = value;
      return;
    }
    if (!isObject(current[part])) current[part] = {};
    current = current[part] as Record<string, unknown>;
  });
  return clone;
}

function issuesForField(issues: EditValidationIssue[], field: EditField): EditValidationIssue[] {
  return issues.filter((issue) => issue.path === field.pointer || issue.path.startsWith(`${field.pointer}/`));
}

function JsonInput({
  id,
  value,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  value: unknown;
  invalid: boolean;
  describedBy?: string;
  onChange(value: unknown, parseError?: string): void;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(value, null, 2));
  useEffect(() => setDraft(JSON.stringify(value, null, 2)), [value]);
  return (
    <textarea
      aria-describedby={describedBy}
      aria-invalid={invalid}
      className="cs-field__control cs-field__control--code"
      id={id}
      onBlur={() => {
        try {
          onChange(JSON.parse(draft));
        } catch {
          onChange(value, "Enter valid JSON for this structured value.");
        }
      }}
      onChange={(event) => setDraft(event.target.value)}
      rows={5}
      value={draft}
    />
  );
}

/** Typed edit fields derived from the request's JSON Schema or current values. */
export function SchemaEditForm({ record, pending = false, onCancel, onSubmit }: SchemaEditFormProps) {
  const formId = useId();
  const [values, setValues] = useState<Record<string, unknown>>(() => structuredClone(record.action_request.args));
  const [issues, setIssues] = useState<EditValidationIssue[]>([]);
  const schema = record.context?.edit_schema ?? inferredSchema(record.action_request.args);
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
  const fields = useMemo(() => collectFields(schema, record.action_request.args, [], required), [record, schema]);

  const update = (field: EditField, value: unknown, parseError?: string) => {
    setValues((current) => setValue(current, field.path, value));
    setIssues((current) => [
      ...current.filter((issue) => issue.path !== field.pointer),
      ...(parseError ? [{ path: field.pointer, keyword: "parse", message: parseError }] : []),
    ]);
  };

  const validate = (): boolean => {
    if (issues.some((issue) => issue.keyword === "parse")) return false;
    const result = validateApprovalEdit(record, values);
    setIssues(result.errors);
    return result.valid;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    await onSubmit(values);
  };

  return (
    <form className="cs-edit-form" noValidate onSubmit={(event) => void submit(event)}>
      <div className="cs-edit-form__intro">
        <div>
          <span className="cs-eyebrow">Edit before approval</span>
          <h3>Adjust action fields</h3>
        </div>
        <p>Changes are validated against the agent’s contract and recorded in the audit trail.</p>
      </div>
      <div className="cs-edit-form__fields">
        {fields.map((field) => {
          const id = `${formId}-${field.path.join("-")}`;
          const fieldIssues = issuesForField(issues, field);
          const descriptionId = field.description ? `${id}-description` : undefined;
          const errorId = fieldIssues.length ? `${id}-error` : undefined;
          const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
          const value = valueAt(values, field.path);
          return (
            <div className="cs-field" key={field.pointer}>
              <label htmlFor={id}>{field.label}{field.required ? <span aria-hidden="true"> *</span> : null}</label>
              {field.description ? <p className="cs-field__description" id={descriptionId}>{field.description}</p> : null}
              {field.choices ? (
                <select
                  aria-describedby={describedBy}
                  aria-invalid={fieldIssues.length > 0}
                  className="cs-field__control"
                  id={id}
                  onBlur={validate}
                  onChange={(event) => update(field, field.choices?.[Number(event.target.value)])}
                  value={String(Math.max(0, field.choices.findIndex((choice) => Object.is(choice, value))))}
                >
                  {field.choices.map((choice, index) => <option key={JSON.stringify(choice)} value={index}>{String(choice)}</option>)}
                </select>
              ) : field.kind === "boolean" ? (
                <label className="cs-switch">
                  <input
                    checked={Boolean(value)}
                    id={id}
                    onBlur={validate}
                    onChange={(event) => update(field, event.target.checked)}
                    type="checkbox"
                  />
                  <span aria-hidden="true" />
                  <em>{value ? "Enabled" : "Disabled"}</em>
                </label>
              ) : field.kind === "json" ? (
                <JsonInput
                  describedBy={describedBy}
                  id={id}
                  invalid={fieldIssues.length > 0}
                  onChange={(next, parseError) => update(field, next, parseError)}
                  value={value}
                />
              ) : (
                <input
                  aria-describedby={describedBy}
                  aria-invalid={fieldIssues.length > 0}
                  className="cs-field__control"
                  id={id}
                  max={field.maximum}
                  min={field.minimum}
                  onBlur={validate}
                  onChange={(event) => {
                    const next = field.kind === "number" || field.kind === "integer"
                      ? (event.target.value === "" ? undefined : Number(event.target.value))
                      : event.target.value;
                    update(field, next);
                  }}
                  required={field.required}
                  step={field.kind === "integer" ? 1 : field.kind === "number" ? "any" : undefined}
                  type={field.kind === "number" || field.kind === "integer" ? "number" : field.format === "email" ? "email" : "text"}
                  value={typeof value === "string" || typeof value === "number" ? value : ""}
                />
              )}
              {fieldIssues.length ? (
                <p className="cs-field__error" id={errorId} role="alert">{fieldIssues[0]?.message}</p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="cs-edit-form__actions">
        {onCancel ? <button className="cs-button cs-button--ghost" disabled={pending} onClick={onCancel} type="button">Keep original</button> : null}
        <button className="cs-button cs-button--primary" disabled={pending} type="submit">
          <CheckIcon /> {pending ? "Recording approval…" : "Approve edited action"}
        </button>
      </div>
    </form>
  );
}
