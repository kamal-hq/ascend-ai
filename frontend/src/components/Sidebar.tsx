import { useRef } from "react";
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
  activeThreadId,
  onSelectSession,
  onDeleteSession,
  liveRate,
  health,
  clientId,
  workspaceNotice,
  onExportWorkspace,
  onImportWorkspace,
  onLoadDemo,
  onOpenPrivacy,
  onOpenLegal,
  onOpenHealthCheck,
  showAllHistory,
  onToggleShowAll,
}: {
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  sessions: JobSummary[];
  activeJobId: string | null;
  activeThreadId: string | null;
  onSelectSession: (jobId: string) => void;
  onDeleteSession: (threadId: string, fallbackJobId: string) => void;
  liveRate: number;
  health: HealthResponse | null;
  clientId: string;
  workspaceNotice: string | null;
  onExportWorkspace: () => void;
  onImportWorkspace: (file?: File | null) => void;
  onLoadDemo: () => void;
  onOpenPrivacy: () => void;
  onOpenLegal: (doc: "privacy" | "terms") => void;
  onOpenHealthCheck: () => void;
  showAllHistory: boolean;
  onToggleShowAll: () => void;
}) {
  const importInputRef = useRef<HTMLInputElement>(null);

  // Group versions by person thread so sidebar shows 1 row per workspace thread (latest version)
  const groupedThreads = Array.from(
    sessions.reduce((map, s) => {
      const tid = s.thread_id || s.job_id;
      const prev = map.get(tid);
      const curVer = s.version ?? 1;
      const prevVer = prev?.latest.version ?? 0;
      if (!prev) {
        map.set(tid, { latest: s, count: 1 });
      } else {
        const pickLatest =
          curVer > prevVer ||
          (curVer === prevVer && Date.parse(s.created_at) > Date.parse(prev.latest.created_at));
        map.set(tid, { latest: pickLatest ? s : prev.latest, count: prev.count + 1 });
      }
      return map;
    }, new Map<string, { latest: JobSummary; count: number }>()).values(),
  ).sort((a, b) => Date.parse(b.latest.created_at) - Date.parse(a.latest.created_at));

  const visibleSessions = showAllHistory ? groupedThreads : groupedThreads.slice(0, 5);
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
          <small>BETA</small>
          <button className="mobile-close" onClick={onClose} aria-label="Close menu">
            <Icon name="x" />
          </button>
        </div>

        <button className="new-analysis" onClick={onNew}>
          <Icon name="plus" size={17} /> New analysis
        </button>

        <div className="history-heading">
          <span>Recent analyses</span>
          {groupedThreads.length > 5 && (
            <button onClick={onToggleShowAll}>
              {showAllHistory ? "Show less" : "View all"}
            </button>
          )}
        </div>

        <div className="session-list">
          {visibleSessions.length === 0 ? (
            <div className="empty-history">
              <p>No saved sessions yet.</p>
              <button type="button" className="load-demo-link" onClick={onLoadDemo}>
                Load Sara Ahmed demo
              </button>
            </div>
          ) : (
            visibleSessions.map(({ latest: session, count }) => {
              const displayName =
                session.student_name ||
                (session.status === "failed" ? "Failed analysis" : "Pending profile");
              const ver = session.version ?? 1;
              const verTag = count > 1 || ver > 1 ? ` · v${ver}` : "";
              const programText = `${session.target_program || session.status}${verTag}`;
              const tid = session.thread_id || session.job_id;
              const isActive = (activeThreadId && tid === activeThreadId) || session.job_id === activeJobId;
              return (
                <div className={`session-row ${isActive ? "active" : ""}`} key={tid}>
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
                    title="Delete saved profile & all its revisions"
                    aria-label={`Delete ${displayName}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(tid, session.job_id);
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

        <div className="workspace-card">
          <div className="workspace-head">
            <strong>Your browser workspace</strong>
            <div className="workspace-badges">
              <button
                type="button"
                className="workspace-privacy-btn"
                onClick={onOpenPrivacy}
                title="How local browser privacy & sync work"
              >
                Privacy
              </button>
              <span>#{clientId.slice(-6)}</span>
            </div>
          </div>
          <p className="workspace-meta">
            {workspaceNotice || `${sessions.length} saved session(s) · auto-synced`}
          </p>
          <div className="workspace-actions">
            <button type="button" onClick={onExportWorkspace} title="Download saved sessions backup (.json)">
              <Icon name="download" size={13} /> Save backup
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              title="Import & append sessions from a backup JSON file"
            >
              <Icon name="upload" size={13} /> Import
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                onImportWorkspace(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </div>

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

        <footer className="sidebar-legal-footer" aria-label="Legal links">
          <button type="button" onClick={() => onOpenLegal("privacy")}>
            Privacy Policy
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={() => onOpenLegal("terms")}>
            Terms of Service
          </button>
        </footer>
      </aside>
    </>
  );
}
