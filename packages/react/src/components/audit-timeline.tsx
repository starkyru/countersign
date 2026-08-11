import type { AuditEvent } from "../types";
import { auditLabel, formatTimestamp } from "./format";

export interface AuditTimelineProps {
  events: AuditEvent[];
  loading?: boolean;
  error?: Error | null;
  className?: string;
}

function eventDetail(event: AuditEvent): string | null {
  if (event.decision?.type === "reject" && event.decision.reason) return event.decision.reason;
  if (event.decision?.type === "respond") return event.decision.message;
  const message = event.metadata?.message;
  return typeof message === "string" && message ? message : null;
}

/** Read-only request history with actor, timestamp, and execution outcomes. */
export function AuditTimeline({ events, loading = false, error, className }: AuditTimelineProps) {
  return (
    <section className={["cs-timeline", className].filter(Boolean).join(" ")} aria-label="Decision history">
      <div className="cs-section-heading">
        <div>
          <span className="cs-eyebrow">Trace</span>
          <h3>Decision history</h3>
        </div>
        <span className="cs-section-heading__count">{events.length} event{events.length === 1 ? "" : "s"}</span>
      </div>
      {error ? <p className="cs-alert" role="alert">History couldn’t be loaded. {error.message}</p> : null}
      {loading ? <div className="cs-timeline__skeleton" aria-label="Loading decision history" /> : null}
      {!loading && !error && events.length === 0 ? (
        <p className="cs-empty-inline">No audit events have been recorded.</p>
      ) : null}
      <ol className="cs-timeline__list">
        {events.map((event) => {
          const detail = eventDetail(event);
          return (
            <li className={`cs-timeline__event cs-timeline__event--${event.type}`} key={event.id}>
              <span className="cs-timeline__marker" aria-hidden="true" />
              <div className="cs-timeline__content">
                <div className="cs-timeline__title-row">
                  <strong>{auditLabel[event.type]}</strong>
                  <time dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
                </div>
                <p>{event.actor?.name ?? event.actor?.id ?? (event.type === "requested" ? "Agent runtime" : "System")}</p>
                {detail ? <blockquote>{detail}</blockquote> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

