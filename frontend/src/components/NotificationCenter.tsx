import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import {
  formatRelativeTime,
  type AppNotification,
  type NotificationAction,
  type VisitContext,
} from "@/lib/notifications";

type FilterTab = "all" | "deadlines" | "updates";

export function NotificationBell({
  notifications,
  readIds,
  visit,
  hasTrackedScholarships,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClearAll,
  onAction,
}: {
  notifications: AppNotification[];
  readIds: Set<string>;
  visit: VisitContext;
  hasTrackedScholarships: boolean;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onAction: (action: NotificationAction, notifId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;
  const hasUrgentUnread = notifications.some(
    (n) => !readIds.has(n.id) && (n.tone === "red" || n.tone === "amber"),
  );

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const deadlineItems = notifications.filter((n) => n.kind === "deadline" || n.kind === "task");
  const updateItems = notifications.filter((n) => n.kind === "greeting" || n.kind === "milestone");
  const visibleItems =
    filter === "deadlines" ? deadlineItems : filter === "updates" ? updateItems : notifications;

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`notif-btn ${open ? "open" : ""}`}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        title="Notifications & upcoming deadlines"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" size={17} />
        {unreadCount > 0 && (
          <span className={`notif-badge ${hasUrgentUnread ? "urgent" : ""}`}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-popover" role="dialog" aria-label="Notification center">
          <div className="notif-pop-head">
            <div>
              <strong>Notifications</strong>
              {unreadCount > 0 && <span className="notif-unread-pill">{unreadCount} new</span>}
            </div>
            <div className="notif-head-actions">
              {unreadCount > 0 && (
                <button type="button" onClick={onMarkAllRead}>
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button type="button" onClick={onClearAll}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="notif-persona-bar">
            <span className="notif-persona-icon">
              <Icon name={visit.personaIcon} size={14} />
            </span>
            <div>
              <b>{visit.personaBadge}</b>
              <small>
                Visit #{visit.visitCount}
                {visit.streakDays >= 2 ? ` · ${visit.streakDays}-day streak` : ""}
                {hasTrackedScholarships ? " · Watching tracked deadlines" : " · Watching top matches"}
              </small>
            </div>
          </div>

          <div className="notif-filter-tabs">
            <button
              type="button"
              className={filter === "all" ? "active" : ""}
              onClick={() => setFilter("all")}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              className={filter === "deadlines" ? "active" : ""}
              onClick={() => setFilter("deadlines")}
            >
              Deadlines ({deadlineItems.length})
            </button>
            <button
              type="button"
              className={filter === "updates" ? "active" : ""}
              onClick={() => setFilter("updates")}
            >
              Updates ({updateItems.length})
            </button>
          </div>

          <div className="notif-list">
            {visibleItems.length === 0 ? (
              <div className="notif-empty">
                <span className="notif-empty-icon">
                  <Icon name="bell" size={18} />
                </span>
                <strong>All caught up</strong>
                <p>
                  Shortlist or mark scholarships as Working in your Tracker to receive priority
                  deadline reminders here.
                </p>
              </div>
            ) : (
              visibleItems.map((item) => {
                const isUnread = !readIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`notif-item tone-${item.tone} ${isUnread ? "unread" : ""}`}
                    onClick={() => isUnread && onMarkRead(item.id)}
                  >
                    <span className={`notif-item-icon tone-${item.tone}`}>
                      <Icon name={item.icon} size={15} />
                    </span>

                    <div className="notif-item-body">
                      <div className="notif-item-meta">
                        <span className={`notif-tag tone-${item.tone}`}>{item.badge}</span>
                        <small>{formatRelativeTime(item.createdAt)}</small>
                        {isUnread && <i className="notif-dot" aria-label="Unread" />}
                      </div>
                      <strong>{item.title}</strong>
                      <p>{item.message}</p>
                      {item.action && (
                        <button
                          type="button"
                          className="notif-item-action"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAction(item.action!, item.id);
                            setOpen(false);
                          }}
                        >
                          {item.action.label} <Icon name="arrow" size={12} />
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      className="notif-dismiss"
                      aria-label="Dismiss notification"
                      title="Dismiss"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDismiss(item.id);
                      }}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ToastStack({
  toasts,
  onClose,
  onAction,
}: {
  toasts: AppNotification[];
  onClose: (id: string) => void;
  onAction: (action: NotificationAction, notifId: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-card tone-${toast.tone}`} role="status">
          <span className={`toast-icon tone-${toast.tone}`}>
            <Icon name={toast.icon} size={16} />
          </span>
          <div className="toast-copy">
            <span className={`notif-tag tone-${toast.tone}`}>{toast.badge}</span>
            <strong>{toast.title}</strong>
            <p>{toast.message}</p>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  onAction(toast.action!, toast.id);
                  onClose(toast.id);
                }}
              >
                {toast.action.label} <Icon name="arrow" size={12} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="Close notification"
            onClick={() => onClose(toast.id)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
