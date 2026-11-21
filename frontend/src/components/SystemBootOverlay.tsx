import { Icon } from "@/components/Icon";
import type { HealthResponse } from "@/types/api";

export interface BootCheckState {
  visible: boolean;
  phase: "waking" | "ready" | "error";
  attempt: number;
  elapsedSec: number;
  health: HealthResponse | null;
  error: string | null;
  manualInspect?: boolean;
}

function StepStateIcon({
  state,
}: {
  state: "pending" | "ok" | "warn" | "fail";
}) {
  if (state === "ok") {
    return (
      <span className="boot-step-badge ok">
        <Icon name="check" size={13} />
      </span>
    );
  }
  if (state === "warn" || state === "fail") {
    return (
      <span className={`boot-step-badge ${state}`}>
        <Icon name="alert" size={13} />
      </span>
    );
  }
  return <span className="boot-step-spinner" aria-hidden="true" />;
}

export function SystemBootOverlay({
  boot,
  onRetry,
  onDismiss,
}: {
  boot: BootCheckState;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (!boot.visible) return null;

  const checks = boot.health?.checks;
  const isReady = boot.phase === "ready" && Boolean(boot.health);
  const isError = boot.phase === "error";

  const apiState = isReady ? "ok" : isError ? "fail" : "pending";
  const dbState = !isReady
    ? isError
      ? "fail"
      : "pending"
    : checks?.database !== false
      ? "ok"
      : "warn";
  const ragState = !isReady
    ? isError
      ? "fail"
      : "pending"
    : (checks?.scholarships_loaded ?? 0) > 0
      ? "ok"
      : "warn";
  const aiState = !isReady
    ? isError
      ? "fail"
      : "pending"
    : checks?.ai_configured !== false
      ? "ok"
      : "warn";

  const workerModeLabel =
    boot.health?.execution_mode === "rq" && (boot.health?.workers_active ?? 0) > 0
      ? `RQ worker online (${boot.health.workers_active})`
      : "Async thread worker ready";

  return (
    <div className="system-boot-backdrop" role="dialog" aria-modal="true" aria-label="System health check">
      <div className="system-boot-card">
        <div className="system-boot-head">
          <div className="system-boot-brand">
            <span className="brand-mark">
              <Icon name="sparkle" size={16} />
            </span>
            <div>
              <span className="boot-eyebrow">FREE-TIER PRE-FLIGHT CHECK</span>
              <h2>
                {isReady
                  ? "All systems online"
                  : isError
                    ? "Backend did not respond"
                    : "Waking up Ascend AI services"}
              </h2>
            </div>
          </div>

          <span className={`boot-pill ${boot.phase}`}>
            {isReady
              ? `Ready in ${boot.elapsedSec.toFixed(1)}s`
              : isError
                ? "Unreachable"
                : `Attempt ${Math.max(1, boot.attempt)} · ${Math.floor(boot.elapsedSec)}s`}
          </span>
        </div>

        <p className="boot-subtitle">
          {isReady
            ? "Warm-up checks passed across the API gateway, database, and curated scholarship index."
            : isError
              ? boot.error ||
                "Free-tier services may still be starting up, or the backend URL is offline."
              : "Free-tier backend instances sleep after idle periods. Sending warm-up probes now — cold starts typically take 25–50 seconds."}
        </p>

        <div className="boot-steps">
          <div className="boot-step">
            <StepStateIcon state={apiState} />
            <div>
              <strong>API Gateway &amp; Worker Runtime</strong>
              <small>
                {isReady
                  ? workerModeLabel
                  : isError
                    ? "Could not reach /health endpoint"
                    : "Sending HTTP wake-up probe…"}
              </small>
            </div>
          </div>

          <div className="boot-step">
            <StepStateIcon state={dbState} />
            <div>
              <strong>Your Browser Workspace &amp; Session Store</strong>
              <small>
                {isReady
                  ? `Saved automatically on your device · ${boot.health?.jobs_count ?? 0} isolated session(s)`
                  : isError
                    ? "Pending API connection"
                    : "Syncing device storage & private workspace…"}
              </small>
            </div>
          </div>

          <div className="boot-step">
            <StepStateIcon state={ragState} />
            <div>
              <strong>Scholarship Knowledge Base</strong>
              <small>
                {isReady
                  ? `${checks?.scholarships_loaded ?? 371} curated awards indexed in RAM`
                  : isError
                    ? "Pending API connection"
                    : "Warming BM25 scholarship matcher…"}
              </small>
            </div>
          </div>

          <div className="boot-step">
            <StepStateIcon state={aiState} />
            <div>
              <strong>Groq AI Engine &amp; Cache</strong>
              <small>
                {isReady
                  ? checks?.ai_configured === false
                    ? "Warning: GROQ_API_KEY is not configured on backend"
                    : "API key verified · free-tier models (120b + 20b) ready"
                  : isError
                    ? "Pending API connection"
                    : "Checking AI runtime & 7-day search cache…"}
              </small>
            </div>
          </div>
        </div>

        <p className="boot-privacy-strip">
          <strong>Privacy:</strong> Your profiles, SOPs, and generated results live automatically
          inside this browser&apos;s storage (never shared across visitors). Use{" "}
          <strong>Save backup</strong> anytime to transfer between devices.
        </p>

        <div className="boot-actions">
          {isError ? (
            <>
              <button type="button" className="boot-primary" onClick={onRetry}>
                <Icon name="refresh" size={15} /> Retry wake-up
              </button>
              <button type="button" className="boot-secondary" onClick={onDismiss}>
                Continue in offline view
              </button>
            </>
          ) : isReady ? (
            <button type="button" className="boot-primary" onClick={onDismiss}>
              {boot.manualInspect ? "Close" : "Enter workspace"} <Icon name="arrow" size={15} />
            </button>
          ) : (
            <button type="button" className="boot-secondary" onClick={onDismiss}>
              Skip wait &amp; open UI
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
