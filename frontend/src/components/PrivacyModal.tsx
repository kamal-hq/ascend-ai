import { useState } from "react";
import { Icon } from "@/components/Icon";

export function PrivacyModal({
  open,
  clientId,
  sessionCount,
  onClose,
  onExportBackup,
  onClearAllLocal,
}: {
  open: boolean;
  clientId: string;
  sessionCount: number;
  onClose: () => void;
  onExportBackup: () => void;
  onClearAllLocal: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);

  if (!open) return null;

  return (
    <div
      className="system-boot-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Privacy and local storage details"
      onClick={() => {
        setConfirmClear(false);
        onClose();
      }}
    >
      <div className="system-boot-card" onClick={(e) => e.stopPropagation()}>
        <div className="system-boot-head">
          <div className="system-boot-brand">
            <span className="brand-mark">
              <Icon name="user" size={16} />
            </span>
            <div>
              <span className="boot-eyebrow">PRIVACY &amp; LOCAL-FIRST STORAGE</span>
              <h2>Your data stays on your device</h2>
            </div>
          </div>
          <span className="boot-pill ready">#{clientId.slice(-6)}</span>
        </div>

        <p className="boot-subtitle">
          Ascend AI runs as a zero-account side project — your workspace is automatically stored in
          this browser rather than a shared central user database.
        </p>

        <div className="boot-steps">
          <div className="boot-step">
            <span className="boot-step-badge ok">
              <Icon name="check" size={13} />
            </span>
            <div>
              <strong>Saved automatically in this browser</strong>
              <small>
                Completed analyses and generated SOPs, roadmaps, and matches ({sessionCount} saved)
                stay in localStorage on your device across refreshes and visits.
              </small>
            </div>
          </div>

          <div className="boot-step">
            <span className="boot-step-badge ok">
              <Icon name="refresh" size={13} />
            </span>
            <div>
              <strong>Isolated &amp; temporary backend compute</strong>
              <small>
                Active AI requests are isolated to your browser ID, processed via Groq AI, and
                automatically re-synced if the free-tier server sleeps between actions.
              </small>
            </div>
          </div>

          <div className="boot-step">
            <span className="boot-step-badge ok">
              <Icon name="download" size={13} />
            </span>
            <div>
              <strong>Portable backups &amp; instant deletion</strong>
              <small>
                Export a .json backup to move to another browser or device, or delete sessions
                anytime to remove them from both your browser and active server memory.
              </small>
            </div>
          </div>
        </div>

        <div className="boot-actions privacy-actions">
          {sessionCount > 0 && (
            <button
              type="button"
              className={`boot-danger ${confirmClear ? "armed" : ""}`}
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true);
                  return;
                }
                setConfirmClear(false);
                onClearAllLocal();
                onClose();
              }}
            >
              {confirmClear ? "Confirm clear all local data" : "Clear device history"}
            </button>
          )}
          <div className="privacy-right-actions">
            <button type="button" className="boot-secondary" onClick={onExportBackup}>
              <Icon name="download" size={14} /> Save backup
            </button>
            <button
              type="button"
              className="boot-primary"
              onClick={() => {
                setConfirmClear(false);
                onClose();
              }}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
