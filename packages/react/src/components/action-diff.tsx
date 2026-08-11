import { diffActionArgs, type ActionFieldDiff } from "../action-diff";
import type { ProposedAction } from "../types";
import { ArrowIcon, ShieldIcon } from "./icons";
import { formatValue, titleCase } from "./format";

export interface ActionDiffProps {
  action: ProposedAction;
  /** Existing values before the proposed action. Omit for a new action. */
  beforeArgs?: Record<string, unknown>;
  /** Edited or proposed values. Defaults to `action.args`. */
  afterArgs?: Record<string, unknown>;
  sensitivePaths?: Iterable<string>;
  emptyMessage?: string;
  className?: string;
}

function DiffValue({ value, removed }: { value: unknown; removed?: boolean }) {
  const formatted = formatValue(value);
  return (
    <code className={removed ? "cs-diff__value cs-diff__value--removed" : "cs-diff__value"}>
      {formatted}
    </code>
  );
}

function FieldChange({ field }: { field: ActionFieldDiff }) {
  return (
    <li className={`cs-diff__row cs-diff__row--${field.kind}`}>
      <div className="cs-diff__field">
        <span>{titleCase(field.label)}</span>
        <span className={`cs-diff__kind cs-diff__kind--${field.kind}`}>{field.kind}</span>
      </div>
      <div className="cs-diff__change">
        {field.redacted ? (
          <span className="cs-diff__redacted"><ShieldIcon /> Sensitive value redacted</span>
        ) : field.kind === "added" ? (
          <DiffValue value={field.after} />
        ) : field.kind === "removed" ? (
          <DiffValue removed value={field.before} />
        ) : (
          <>
            <DiffValue removed value={field.before} />
            <ArrowIcon className="cs-diff__arrow" />
            <DiffValue value={field.after} />
          </>
        )}
      </div>
    </li>
  );
}

/** A readable, deterministic rendering of leaf-level action argument changes. */
export function ActionDiff({
  action,
  beforeArgs = {},
  afterArgs = action.args,
  sensitivePaths,
  emptyMessage = "No field values changed.",
  className,
}: ActionDiffProps) {
  const fields = diffActionArgs(beforeArgs, afterArgs, { sensitivePaths });
  return (
    <section className={["cs-diff", className].filter(Boolean).join(" ")} aria-label={`${titleCase(action.action)} field changes`}>
      <header className="cs-diff__header">
        <span className="cs-eyebrow">Proposed action</span>
        <code className="cs-action-name">{action.action}</code>
      </header>
      {fields.length ? (
        <ul className="cs-diff__list">
          {fields.map((field) => <FieldChange field={field} key={field.path} />)}
        </ul>
      ) : (
        <p className="cs-empty-inline">{emptyMessage}</p>
      )}
    </section>
  );
}

