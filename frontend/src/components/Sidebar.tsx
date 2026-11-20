import { Icon } from "@/components/Icon";
import type { HealthResponse, JobSummary } from "@/types/api";

export function getInitials(name: string): string {
  const parts = (name || "ST").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatTimeAgo(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

export function Sidebar({
  open,
  onClose,
  onNew,
  sessions,
  activeJobId,
  onSelectSession,
  onDeleteSession,
  liveRate,
  health,
  onOpenHealthCheck,
  showAllHistory,
  onToggleShowAll,
}: {
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  sessions: JobSummary[];
  activeJobId: string | null;
  onSelectSession: (jobId: string) => void;
  onDeleteSession: (jobId: string) => void;
  liveRate: number;
  health: HealthResponse | null;
  onOpenHealthCheck: () => void;
  showAllHistory: boolean;
  onToggleShowAll: () => void;
}) {
  const visibleSessions = showAllHistory ? sessions : sessions.slice(0, 5);
  const apiOnline = Boolean(health && health.status === "ok");
  const statusLabel = !apiOnline
    ? "API offline"
    : health?.redis && (health.workers_active ?? 0) > 0
      ? "RQ worker + Redis ready"
      : "API ready (async mode)";

  return (
    <>
      {open && (
        <button className="sidebar-backdrop" onClick={onClose} aria-label="Close navigation" />
      )}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark">
            <Icon name="arrow" size={20} />
          </div>
          <div>
            <strong>Ascend</strong>
            <span>AI</span>
          </div>
          <small>v3</small>
          <button className="mobile-close" onClick={onClose} aria-label="Close menu">
            <Icon name="x" />
          </button>
        </div>

        <button className="new-analysis" onClick={onNew}>
          <Icon name="plus" size={17} /> New analysis
        </button>

        <div className="history-heading">
          <span>Recent analyses</span>
          {sessions.length > 5 && (
            <button onClick={onToggleShowAll}>
              {showAllHistory ? "Show less" : "View all"}
            </button>
          )}
        </div>

        <div className="session-list">
          {visibleSessions.length === 0 ? (
            <p className="empty-history">No saved sessions yet.</p>
          ) : (
            visibleSessions.map((session) => {
              const displayName =
                session.student_name ||
                (session.status === "failed" ? "Failed analysis" : "Pending profile");
              const programText = session.target_program || session.status;
              const isActive = session.job_id === activeJobId;
              return (
                <div className={`session-row ${isActive ? "active" : ""}`} key={session.job_id}>
                  <button
                    type="button"
                    className="session"
                    onClick={() => onSelectSession(session.job_id)}
                  >
                    <span className="avatar">{getInitials(displayName)}</span>
                    <span className="session-copy">
                      <strong>{displayName}</strong>
                      <small>
                        {programText} · {formatTimeAgo(session.created_at)}
                      </small>
                    </span>
                    <span className="session-score">
                      {session.score !== null && session.score !== undefined
                        ? session.score
                        : session.status === "running"
                          ? "…"
                          : "—"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="session-delete"
                    title="Delete saved session"
                    aria-label={`Delete ${displayName}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.job_id);
                    }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="sidebar-spacer" />

        <div className="rate-card">
          <div>
            <span className="live-dot" />
            <strong>Live exchange rate</strong>
          </div>
          <p>
            <span>1 USD</span>
            <b>Rs. {liveRate.toFixed(2)}</b>
          </p>
        </div>

        <button
          type="button"
          className="system-status"
          onClick={onOpenHealthCheck}
          title="Run system readiness & wake-up check"
        >
          <span>
            <i className={apiOnline ? "" : "warn"} /> {statusLabel}
          </span>
          <span>API {health?.version || "v3"}</span>
        </button>
      </aside>
    </>
  );
}
