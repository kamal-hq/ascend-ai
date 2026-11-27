import { useEffect, useRef, useState } from "react";
import { parseCvPdf } from "@/api/client";
import { Icon } from "@/components/Icon";
import type { EagerProgressState } from "@/components/IntakeView";

export function ReanalyzeModal({
  open,
  studentName,
  baseVersion,
  latestVersion,
  initialText,
  progress,
  onSubmit,
  onClose,
}: {
  open: boolean;
  studentName: string;
  baseVersion: number;
  latestVersion: number;
  initialText: string;
  progress: EagerProgressState;
  onSubmit: (updatedText: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [cvBusy, setCvBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [cvNotice, setCvNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const isFromOlder = baseVersion < latestVersion;

  useEffect(() => {
    if (open) {
      setText(initialText);
      setConfirmOverwrite(false);
      setLocalError(null);
      setCvNotice(null);
    }
  }, [open, initialText, baseVersion]);

  if (!open) return null;

  const handlePdf = async (file: File | undefined) => {
    if (!file) return;
    setCvBusy(true);
    setLocalError(null);
    try {
      const parsed = await parseCvPdf(file);
      setText(parsed.text);
      setCvNotice(`Loaded ${parsed.filename} (${parsed.char_count} chars)`);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not parse PDF file.");
    } finally {
      setCvBusy(false);
    }
  };

  const handleRun = async () => {
    if (text.trim().length < 25) {
      setLocalError("Please provide at least ~25 characters of updated profile context.");
      return;
    }
    if (isFromOlder && !confirmOverwrite) {
      setLocalError("Please confirm replacing newer revisions before starting.");
      return;
    }
    setLocalError(null);
    await onSubmit(text.trim());
  };

  return (
    <div
      className="system-boot-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Re-analyze profile"
      onClick={() => {
        if (!progress.active) onClose();
      }}
    >
      <div className="system-boot-card reanalyze-card" onClick={(e) => e.stopPropagation()}>
        <div className="system-boot-head">
          <div className="system-boot-brand">
            <span className="brand-mark">
              <Icon name="refresh" size={16} />
            </span>
            <div>
              <span className="boot-eyebrow">PROFILE RE-ANALYSIS</span>
              <h2>
                {isFromOlder
                  ? `Re-analyze ${studentName || "profile"} from v${baseVersion}`
                  : `Update & re-analyze ${studentName || "profile"}`}
              </h2>
            </div>
          </div>
          <span className={`boot-pill ${isFromOlder ? "error" : "waking"}`}>
            {isFromOlder ? `Replaces v${baseVersion + 1}+` : `Creates v${latestVersion + 1}`}
          </span>
        </div>

        {isFromOlder ? (
          <div className="reanalyze-warn-box">
            <Icon name="alert" size={16} />
            <div>
              <strong>Newer revisions will be deleted</strong>
              <p>
                You are viewing older revision <b>v{baseVersion}</b> while <b>v{latestVersion}</b>{" "}
                is Latest. Starting a new analysis from v{baseVersion} will{" "}
                <b>permanently delete all revisions newer than v{baseVersion}</b> once the new run
                succeeds, making your new analysis the Latest workspace.
              </p>
            </div>
          </div>
        ) : (
          <p className="boot-subtitle">
            Update your skills, test scores, publications, or upload a newer CV PDF. Your current{" "}
            <b>v{baseVersion}</b> snapshot stays archived in Revision History so you can compare
            progress anytime.
          </p>
        )}

        <div className="reanalyze-tools">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf"
            hidden
            onChange={(e) => void handlePdf(e.target.files?.[0])}
          />
          <button
            type="button"
            className="boot-secondary"
            disabled={cvBusy || progress.active}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" size={14} /> {cvBusy ? "Extracting PDF…" : "Upload updated CV (PDF)"}
          </button>
          {cvNotice && <span className="reanalyze-cv-note">{cvNotice}</span>}
        </div>

        <textarea
          className="reanalyze-textarea"
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={progress.active}
          placeholder="Update your profile notes, newly added projects, IELTS/GRE scores, or CV text…"
        />
        <p className="groq-disclosure">
          Submitted CV text, profile notes, and SOP drafts are sent to Groq for AI processing, and
          uploaded PDF CVs may contain contact details.
        </p>

        {isFromOlder && (
          <label className="reanalyze-confirm-check">
            <input
              type="checkbox"
              checked={confirmOverwrite}
              disabled={progress.active}
              onChange={(e) => setConfirmOverwrite(e.target.checked)}
            />
            <span>
              I understand newer revisions after v{baseVersion} (through v{latestVersion}) will be
              deleted and the new run will become Latest.
            </span>
          </label>
        )}

        {(localError || progress.error) && (
          <p className="stepper-error">{localError || progress.error}</p>
        )}

        {progress.active ? (
          <div className="eager-stepper">
            <div className="stepper-head">
              <strong>Re-analyzing Profile &amp; Re-ranking Matches</strong>
              <span>Live SSE progress · {progress.jobId?.slice(0, 8)}</span>
            </div>
            <div className="stepper-items">
              <div className={progress.contextDone ? "done" : "pending"}>
                <i /> Fetching live USD → PKR exchange rate
              </div>
              <div className={progress.profileDone ? "done" : "pending"}>
                <i /> Extracting updated score, gaps &amp; 6-month roadmap
              </div>
              <div className={progress.ragDone ? "done" : "pending"}>
                <i /> Re-matching against 370+ curated international scholarships
              </div>
            </div>
          </div>
        ) : (
          <div className="boot-actions">
            <button type="button" className="boot-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={isFromOlder ? "boot-danger armed" : "boot-primary"}
              disabled={isFromOlder && !confirmOverwrite}
              onClick={() => void handleRun()}
            >
              <Icon name="refresh" size={14} />{" "}
              {isFromOlder
                ? `Delete newer & run v${baseVersion + 1}`
                : `Run re-analysis (v${latestVersion + 1})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
