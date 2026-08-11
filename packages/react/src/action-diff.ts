import type { ProposedAction } from "./types";

export type ActionDiffKind = "added" | "removed" | "changed";

export interface ActionFieldDiff {
  /** RFC 6901-style pointer into the action args; root fields start with `/`. */
  path: string;
  /** Human-readable path suitable for a UI label, such as `items[0].amount`. */
  label: string;
  kind: ActionDiffKind;
  before: unknown;
  after: unknown;
  redacted: boolean;
}

export interface ActionDiffOptions {
  /** JSON-pointer paths whose before/after values must never be returned. */
  sensitivePaths?: Iterable<string>;
  /** Replacement value for a redacted field. Defaults to `[redacted]`. */
  redaction?: string;
}

const missing = Symbol("countersign-missing");
type Missing = typeof missing;

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === "object";
}

function escapePointerPart(part: string): string {
  return part.replaceAll("~", "~0").replaceAll("/", "~1");
}

function pointerLabel(path: string): string {
  const parts = path
    .split("/")
    .slice(1)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  return parts.reduce((label, part) => {
    if (/^\d+$/.test(part)) {
      return `${label}[${part}]`;
    }
    return label ? `${label}.${part}` : part;
  }, "");
}

function equalJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!isContainer(left) || !isContainer(right) || Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && equalJson(valueAt(left, key), valueAt(right, key)))
  );
}

function objectKeys(value: Record<string, unknown> | unknown[]): string[] {
  return Array.isArray(value) ? Array.from({ length: value.length }, (_, index) => String(index)) : Object.keys(value);
}

function valueAt(value: Record<string, unknown> | unknown[], key: string): unknown {
  return Array.isArray(value) ? value[Number(key)] : value[key];
}

/**
 * Compute leaf-level JSON diffs for a proposed action edit.
 *
 * Objects are compared by sorted keys and arrays by index, making output
 * deterministic enough for audit exports and reviewer UIs alike. Empty
 * objects/arrays are retained as meaningful field changes.
 */
export function diffActionArgs(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  options: ActionDiffOptions = {},
): ActionFieldDiff[] {
  const sensitivePaths = new Set(options.sensitivePaths);
  const redaction = options.redaction ?? "[redacted]";
  const changes: ActionFieldDiff[] = [];

  const visit = (previous: unknown | Missing, next: unknown | Missing, path: string): void => {
    if (previous !== missing && next !== missing && equalJson(previous, next)) return;
    const previousIsContainer = previous !== missing && isContainer(previous);
    const nextIsContainer = next !== missing && isContainer(next);
    if (previousIsContainer && nextIsContainer && Array.isArray(previous) === Array.isArray(next)) {
      const keys = [...new Set([...objectKeys(previous), ...objectKeys(next)])].sort((left, right) => {
        const leftNumber = Number(left);
        const rightNumber = Number(right);
        return Number.isInteger(leftNumber) && Number.isInteger(rightNumber) ? leftNumber - rightNumber : left.localeCompare(right);
      });
      if (keys.length > 0) {
        for (const key of keys) {
          visit(
            Object.hasOwn(previous, key) ? valueAt(previous, key) : missing,
            Object.hasOwn(next, key) ? valueAt(next, key) : missing,
            `${path}/${escapePointerPart(key)}`,
          );
        }
        return;
      }
    }
    const redacted = [...sensitivePaths].some(
      (sensitivePath) => path === sensitivePath || path.startsWith(`${sensitivePath}/`),
    );
    changes.push({
      path,
      label: pointerLabel(path),
      kind: previous === missing ? "added" : next === missing ? "removed" : "changed",
      before: redacted || previous === missing ? undefined : previous,
      after: redacted || next === missing ? undefined : next,
      redacted,
      ...(redacted ? { before: redaction, after: redaction } : {}),
    });
  };

  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((left, right) => left.localeCompare(right));
  for (const key of keys) {
    visit(
      Object.hasOwn(before, key) ? before[key] : missing,
      Object.hasOwn(after, key) ? after[key] : missing,
      `/${escapePointerPart(key)}`,
    );
  }
  return changes;
}

/** Diff a full proposed action while retaining its stable tool/action name. */
export function diffProposedAction(
  original: ProposedAction,
  editedArgs: Record<string, unknown>,
  options?: ActionDiffOptions,
): { action: string; fields: ActionFieldDiff[] } {
  return { action: original.action, fields: diffActionArgs(original.args, editedArgs, options) };
}
