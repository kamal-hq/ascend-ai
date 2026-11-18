import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkHealth,
  createJob,
  deleteJob,
  getJob,
  listJobs,
  subscribeCapabilityStream,
  subscribeJobStream,
  triggerCapability,
} from "@/api/client";
import { CapabilityModal } from "@/components/CapabilityModal";
import { Icon, type IconName } from "@/components/Icon";
import { IntakeView, type EagerProgressState } from "@/components/IntakeView";
import { OverviewView } from "@/components/OverviewView";
import { getInitials, Sidebar } from "@/components/Sidebar";
import { CAPABILITY_GROUPS, StudioView } from "@/components/StudioView";
import type {
  CapabilityName,
  CapabilityStatus,
  HealthResponse,
  JobStatusResponse,
  JobSummary,
} from "@/types/api";

type WorkspaceTab = "overview" | "study" | "career" | "local";

const TABS: readonly [WorkspaceTab, string, IconName][] = [
  ["overview", "Overview", "grid"],
  ["study", "Study abroad & research", "book"],
  ["career", "Career & freelance", "briefcase"],
  ["local", "Local ecosystem", "globe"],
];

function findCapabilityTitle(cap: CapabilityName): string {
  for (const group of Object.values(CAPABILITY_GROUPS)) {
    const found = group.find((c) => c.id === cap);
    if (found) return found.title;
  }
  return cap;
}

export default function App() {
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [intakeMode, setIntakeMode] = useState(true);
  const [showAllHistory, setShowAllHistory] = useState(false);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [sessions, setSessions] = useState<JobSummary[]>([]);
  const [activeJob, setActiveJob] = useState<JobStatusResponse | null>(null);
  const [capLiveStates, setCapLiveStates] = useState<
    Record<string, { status: CapabilityStatus; error?: string }>
  >({});
  const [modalCap, setModalCap] = useState<{ cap: CapabilityName; title: string } | null>(null);

  const [eagerProgress, setEagerProgress] = useState<EagerProgressState>({
    active: false,
    jobId: null,
    contextDone: false,
    profileDone: false,
    ragDone: false,
    error: null,
  });

  const cleanupsRef = useRef<Array<() => void>>([]);

  const clearStreams = useCallback(() => {
    for (const stop of cleanupsRef.current) stop();
    cleanupsRef.current = [];
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const rows = await listJobs(30);
      setSessions(rows);
      return rows;
    } catch {
      return [];
    }
  }, []);

  const loadJob = useCallback(
    async (jobId: string) => {
      clearStreams();
      const snap = await getJob(jobId);
      setActiveJob(snap);
      setCapLiveStates({});
      setModalCap(null);
      if (snap.results.profile) {
        setIntakeMode(false);
        setTab("overview");
      }
      setSidebarOpen(false);
    },
    [clearStreams],
  );

  useEffect(() => {
    let mounted = true;
    const boot = async () => {
      try {
        const h = await checkHealth();
        if (mounted) setHealth(h);
      } catch {
        if (mounted) setHealth(null);
      }
      const rows = await refreshSessions();
      if (!mounted) return;
      const latestCompleted = rows.find((r) => r.status === "completed");
      if (latestCompleted) {
        try {
          await loadJob(latestCompleted.job_id);
        } catch {
          setIntakeMode(true);
        }
      } else {
        setIntakeMode(true);
      }
    };
    void boot();

    const timer = window.setInterval(async () => {
      try {
        const h = await checkHealth();
        setHealth(h);
      } catch {
        setHealth(null);
      }
    }, 30000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      clearStreams();
    };
  }, [clearStreams, loadJob, refreshSessions]);

  const handleAnalyze = async (inputText: string) => {
    clearStreams();
    try {
      const created = await createJob(inputText);
      const jobId = created.job_id;
      setEagerProgress({
        active: true,
        jobId,
        contextDone: false,
        profileDone: false,
        ragDone: false,
        error: null,
      });

      const stop = subscribeJobStream(jobId, {
        onSlice: (sliceName) => {
          setEagerProgress((prev) => ({
            ...prev,
            contextDone: prev.contextDone || sliceName === "context",
            profileDone: prev.profileDone || sliceName === "profile",
            ragDone: prev.ragDone || sliceName === "rag_matches",
          }));
        },
        onStatus: async (status) => {
          if (status === "completed") {
            await refreshSessions();
            await loadJob(jobId);
            setEagerProgress({
              active: false,
              jobId: null,
              contextDone: false,
              profileDone: false,
              ragDone: false,
              error: null,
            });
          } else {
            const snap = await getJob(jobId).catch(() => null);
            const errPayload = snap?.results?.eager_error as { error?: string } | undefined;
            setEagerProgress((prev) => ({
              ...prev,
              active: true,
              error: errPayload?.error || "Eager analysis failed. Check worker logs and try again.",
            }));
          }
        },
        onError: (errMsg) => {
          setEagerProgress((prev) => ({
            ...prev,
            error: errMsg,
          }));
        },
      });
      cleanupsRef.current.push(stop);
    } catch (err) {
      setEagerProgress({
        active: true,
        jobId: null,
        contextDone: false,
        profileDone: false,
        ragDone: false,
        error: err instanceof Error ? err.message : "Failed to submit job.",
      });
    }
  };

  const handleTriggerCapability = async (
    cap: CapabilityName,
    options?: { custom_notes?: string; sop_text?: string },
  ) => {
    if (!activeJob) return;
    const jobId = activeJob.job_id;

    setCapLiveStates((prev) => ({
      ...prev,
      [cap]: { status: "queued" },
    }));

    try {
      await triggerCapability(jobId, cap, options);
      const stop = subscribeCapabilityStream(jobId, cap, {
        onStatus: (status) => {
          setCapLiveStates((prev) => ({
            ...prev,
            [cap]: { status },
          }));
        },
        onResult: async () => {
          const snap = await getJob(jobId);
          setActiveJob(snap);
          setCapLiveStates((prev) => ({
            ...prev,
            [cap]: { status: "completed" },
          }));
        },
        onError: async (errMsg) => {
          const snap = await getJob(jobId).catch(() => null);
          if (snap) setActiveJob(snap);
          setCapLiveStates((prev) => ({
            ...prev,
            [cap]: { status: "failed", error: errMsg },
          }));
        },
      });
      cleanupsRef.current.push(stop);
    } catch (err) {
      setCapLiveStates((prev) => ({
        ...prev,
        [cap]: {
          status: "failed",
          error: err instanceof Error ? err.message : "Failed to trigger capability.",
        },
      }));
    }
  };

  const handleDeleteSession = async (jobId: string) => {
    try {
      await deleteJob(jobId);
      const updated = await refreshSessions();
      if (activeJob?.job_id === jobId) {
        const next = updated.find((r) => r.status === "completed");
        if (next) {
          await loadJob(next.job_id);
        } else {
          setActiveJob(null);
          setIntakeMode(true);
        }
      }
    } catch {
      // ignore transient delete errors
    }
  };

  const navigate = (next: WorkspaceTab) => {
    setTab(next);
    setIntakeMode(false);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const profile = activeJob?.results?.profile;
  const ragMatches = activeJob?.results?.rag_matches?.matches || [];
  const liveRate = activeJob?.results?.context?.live_rate || 278.5;

  return (
    <div className="app-shell">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNew={() => {
          setEagerProgress({
            active: false,
            jobId: null,
            contextDone: false,
            profileDone: false,
            ragDone: false,
            error: null,
          });
          setIntakeMode(true);
          setSidebarOpen(false);
        }}
        sessions={sessions}
        activeJobId={intakeMode ? null : activeJob?.job_id || null}
        onSelectSession={(jid) => void loadJob(jid)}
        onDeleteSession={(jid) => void handleDeleteSession(jid)}
        liveRate={liveRate}
        health={health}
        showAllHistory={showAllHistory}
        onToggleShowAll={() => setShowAllHistory((v) => !v)}
      />

      <main className="main-shell">
        <header className="topbar">
          <button
            className="menu-button"
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Icon name="menu" />
          </button>

          <div className="mobile-brand">
            <div className="brand-mark">
              <Icon name="arrow" size={17} />
            </div>
            <strong>Ascend AI</strong>
          </div>

          {!intakeMode && profile ? (
            <>
              <div className="student-context">
                <span className="avatar mini">{getInitials(profile.name)}</span>
                <div>
                  <strong>{profile.name}</strong>
                  <small>
                    {profile.target_program || "Graduate Study"} ·{" "}
                    {(profile.target_country || []).join(", ") || "Global"}
                  </small>
                </div>
                <Icon name="chevron" size={15} />
              </div>

              <nav className="top-tabs">
                {TABS.map(([id, label, icon]) => (
                  <button
                    className={tab === id ? "active" : ""}
                    key={id}
                    type="button"
                    onClick={() => navigate(id)}
                  >
                    <Icon name={icon} size={16} />
                    <span>{label}</span>
                  </button>
                ))}
              </nav>
            </>
          ) : (
            <div className="intake-top">
              <span>New analysis</span>
              {activeJob?.results?.profile && (
                <button type="button" onClick={() => setIntakeMode(false)}>
                  Back to dashboard
                </button>
              )}
            </div>
          )}

          <button
            className="profile-button"
            type="button"
            title="Start new profile analysis"
            onClick={() => setIntakeMode(true)}
          >
            <Icon name="user" size={17} />
          </button>
        </header>

        {intakeMode || !profile || !activeJob ? (
          <IntakeView onAnalyze={handleAnalyze} eagerProgress={eagerProgress} />
        ) : tab === "overview" ? (
          <OverviewView
            profile={profile}
            matches={ragMatches}
            onNavigate={(target) => navigate(target)}
          />
        ) : (
          <StudioView
            type={tab}
            job={activeJob}
            activeStates={capLiveStates}
            onTrigger={(cap, opts) => void handleTriggerCapability(cap, opts)}
            onOpenResult={(cap, title) => setModalCap({ cap, title })}
          />
        )}
      </main>

      {modalCap && activeJob && (
        <CapabilityModal
          capability={modalCap.cap}
          title={modalCap.title || findCapabilityTitle(modalCap.cap)}
          data={activeJob.results[modalCap.cap]}
          onClose={() => setModalCap(null)}
          onRegenerate={() => {
            const target = modalCap.cap;
            setModalCap(null);
            void handleTriggerCapability(target);
          }}
        />
      )}
    </div>
  );
}
