import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  checkHealth,
  createJob,
  deleteJob,
  deleteThread,
  getJob,
  listJobs,
  restoreJobs,
  seedDemoJob,
  subscribeCapabilityStream,
  subscribeJobStream,
  triggerCapability,
  wakeBackend,
} from "@/api/client";
import { CapabilityModal } from "@/components/CapabilityModal";
import { Icon, type IconName } from "@/components/Icon";
import { IntakeView, type EagerProgressState } from "@/components/IntakeView";
import { OverviewView } from "@/components/OverviewView";
import { PrivacyModal } from "@/components/PrivacyModal";
import { ReanalyzeModal } from "@/components/ReanalyzeModal";
import { getInitials, Sidebar } from "@/components/Sidebar";
import { CAPABILITY_GROUPS, StudioView } from "@/components/StudioView";
import {
  SystemBootOverlay,
  type BootCheckState,
} from "@/components/SystemBootOverlay";
import {
  clearAllLocalSnapshots,
  deleteLocalThread,
  exportWorkspaceFile,
  getClientId,
  getLocalThreadRevisions,
  isDemoInitialized,
  listLocalSummaries,
  loadLocalSnapshots,
  markDemoInitialized,
  mergeImportedWorkspace,
  pruneLocalThreadAfterVersion,
  remapLocalJobId,
  saveLocalSnapshot,
} from "@/lib/workspaceStore";
import type {
  CapabilityName,
  CapabilityStatus,
  HealthResponse,
  JobRevisionInfo,
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
  const [sessions, setSessions] = useState<JobSummary[]>(() => listLocalSummaries());
  const [activeJob, setActiveJob] = useState<JobStatusResponse | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);
  const [reanalyzeProgress, setReanalyzeProgress] = useState<EagerProgressState>({
    active: false,
    jobId: null,
    contextDone: false,
    profileDone: false,
    ragDone: false,
    error: null,
  });
  const clientId = getClientId();
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

  const [bootState, setBootState] = useState<BootCheckState>({
    visible: true,
    phase: "waking",
    attempt: 1,
    elapsedSec: 0,
    health: null,
    error: null,
    manualInspect: false,
  });

  const cleanupsRef = useRef<Array<() => void>>([]);
  const bootAbortRef = useRef<AbortController | null>(null);
  const bootAutoCloseRef = useRef<number | null>(null);
  const activeJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeJobIdRef.current = activeJob?.job_id ?? null;
  }, [activeJob]);

  const clearStreams = useCallback(() => {
    for (const stop of cleanupsRef.current) stop();
    cleanupsRef.current = [];
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const rows = await listJobs(30, 0, false);
      setSessions(rows);
      return rows;
    } catch {
      const local = listLocalSummaries();
      setSessions(local);
      return local;
    }
  }, []);

  const loadJob = useCallback(
    async (jobId: string) => {
      clearStreams();
      const localMap = loadLocalSnapshots();
      let snap: JobStatusResponse;
      try {
        snap = await getJob(jobId);
      } catch (err) {
        const fallback = localMap[jobId];
        if (!fallback) throw err;
        try {
          const restored = await restoreJobs([fallback]);
          const mappedId = restored[0]?.job_id || jobId;
          if (mappedId !== jobId) remapLocalJobId(jobId, mappedId);
          snap = await getJob(mappedId);
        } catch {
          snap = fallback;
        }
      }
      saveLocalSnapshot(snap);
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

  const dismissBootOverlay = useCallback(() => {
    bootAbortRef.current?.abort();
    bootAbortRef.current = null;
    if (bootAutoCloseRef.current !== null) {
      window.clearTimeout(bootAutoCloseRef.current);
      bootAutoCloseRef.current = null;
    }
    setBootState((prev) => ({ ...prev, visible: false }));
  }, []);

  const runBootCheck = useCallback(
    async (manualInspect = false) => {
      bootAbortRef.current?.abort();
      if (bootAutoCloseRef.current !== null) {
        window.clearTimeout(bootAutoCloseRef.current);
        bootAutoCloseRef.current = null;
      }

      const controller = new AbortController();
      bootAbortRef.current = controller;
      const startedAt = Date.now();
      let latestAttempt = 1;

      setBootState({
        visible: true,
        phase: "waking",
        attempt: 1,
        elapsedSec: 0,
        health: null,
        error: null,
        manualInspect,
      });

      const elapsedTimer = window.setInterval(() => {
        if (!controller.signal.aborted) {
          setBootState((prev) => ({
            ...prev,
            elapsedSec: (Date.now() - startedAt) / 1000,
          }));
        }
      }, 400);

      try {
        const initialSnapshots = Object.values(loadLocalSnapshots()).sort(
          (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
        );
        if (initialSnapshots.length > 0 && !activeJobIdRef.current) {
          setActiveJob(initialSnapshots[0]);
          setIntakeMode(false);
        }

        const res = await wakeBackend({
          maxWaitMs: 75_000,
          attemptTimeoutMs: 9_000,
          retryDelayMs: 2_000,
          signal: controller.signal,
          onAttempt: (attempt, elapsedMs) => {
            latestAttempt = attempt;
            setBootState((prev) => ({
              ...prev,
              attempt,
              elapsedSec: elapsedMs / 1000,
            }));
          },
        });

        window.clearInterval(elapsedTimer);
        if (controller.signal.aborted) return;

        setHealth(res.health);

        const localMap = loadLocalSnapshots();
        const localList = Object.values(localMap);
        const shouldAutoSeedDemo = localList.length === 0 && !isDemoInitialized();

        const serverRows = await listJobs(30, 0, shouldAutoSeedDemo);
        if (controller.signal.aborted) return;

        const serverIds = new Set(serverRows.map((r) => r.job_id));
        const missingOnServer = localList.filter((j) => !serverIds.has(j.job_id));
        let syncedRows = serverRows;

        if (missingOnServer.length > 0) {
          try {
            const orderedMissing = [...missingOnServer].sort(
              (a, b) => (a.version ?? 1) - (b.version ?? 1),
            );
            const remapped = await restoreJobs(orderedMissing);
            for (const item of remapped) {
              if (item.old_id && item.job_id && (item.old_id !== item.job_id || item.thread_id)) {
                remapLocalJobId(item.old_id, item.job_id, item.thread_id);
                if (activeJobIdRef.current === item.old_id) {
                  activeJobIdRef.current = item.job_id;
                }
              }
            }
            syncedRows = await listJobs(30, 0, false);
          } catch {
            // Keep browser-cached sessions visible if restore fails
          }
        }

        markDemoInitialized();
        setSessions(syncedRows.length > 0 ? syncedRows : listLocalSummaries());
        if (controller.signal.aborted) return;

        const targetId =
          (activeJobIdRef.current && syncedRows.some((r) => r.job_id === activeJobIdRef.current)
            ? activeJobIdRef.current
            : syncedRows.find((r) => r.status === "completed")?.job_id) || null;

        if (targetId) {
          try {
            await loadJob(targetId);
          } catch {
            setIntakeMode(true);
          }
        } else if (!activeJobIdRef.current) {
          setIntakeMode(true);
        }

        setBootState({
          visible: true,
          phase: "ready",
          attempt: res.attempts,
          elapsedSec: Math.max(0.1, res.elapsedMs / 1000),
          health: res.health,
          error: null,
          manualInspect,
        });

        if (!manualInspect) {
          bootAutoCloseRef.current = window.setTimeout(() => {
            setBootState((prev) => ({ ...prev, visible: false }));
          }, 900);
        }
      } catch (err) {
        window.clearInterval(elapsedTimer);
        if (controller.signal.aborted) return;
        setHealth(null);
        setBootState({
          visible: true,
          phase: "error",
          attempt: latestAttempt,
          elapsedSec: (Date.now() - startedAt) / 1000,
          health: null,
          error:
            err instanceof Error
              ? err.message
              : "Backend server did not respond in time.",
          manualInspect,
        });
      }
    },
    [loadJob, refreshSessions],
  );

  useEffect(() => {
    void runBootCheck(false);

    const timer = window.setInterval(async () => {
      try {
        const h = await checkHealth(false, 6000);
        setHealth(h);
      } catch {
        setHealth(null);
      }
    }, 30000);

    return () => {
      bootAbortRef.current?.abort();
      if (bootAutoCloseRef.current !== null) {
        window.clearTimeout(bootAutoCloseRef.current);
      }
      window.clearInterval(timer);
      clearStreams();
    };
  }, [clearStreams, runBootCheck]);

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
    let targetJobId = activeJob.job_id;

    setCapLiveStates((prev) => ({
      ...prev,
      [cap]: { status: "queued" },
    }));

    try {
      try {
        await triggerCapability(targetJobId, cap, options);
      } catch (err) {
        const isMissing = err instanceof ApiError && err.status === 404;
        const fallback = loadLocalSnapshots()[targetJobId] || activeJob;
        if (!isMissing || !fallback) throw err;

        // Free-tier backend slept/reset mid-session — silently restore snapshot and retry once
        const remapped = await restoreJobs([fallback]);
        const mappedId = remapped[0]?.job_id || targetJobId;
        if (mappedId !== targetJobId) {
          remapLocalJobId(targetJobId, mappedId);
          activeJobIdRef.current = mappedId;
          setActiveJob((prev) =>
            prev && prev.job_id === targetJobId ? { ...prev, job_id: mappedId } : prev,
          );
          targetJobId = mappedId;
        }
        await refreshSessions();
        await triggerCapability(targetJobId, cap, options);
      }

      const stop = subscribeCapabilityStream(targetJobId, cap, {
        onStatus: (status) => {
          setCapLiveStates((prev) => ({
            ...prev,
            [cap]: { status },
          }));
        },
        onResult: async () => {
          const snap = await getJob(targetJobId);
          saveLocalSnapshot(snap);
          setActiveJob(snap);
          setCapLiveStates((prev) => ({
            ...prev,
            [cap]: { status: "completed" },
          }));
        },
        onError: async (errMsg) => {
          const snap = await getJob(targetJobId).catch(() => null);
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

  const handleDeleteSession = async (threadId: string, fallbackJobId: string) => {
    deleteLocalThread(threadId);
    try {
      await deleteThread(threadId);
    } catch {
      try {
        await deleteJob(fallbackJobId);
      } catch {
        // ignore if already wiped on free server
      }
    }
    const updated = await refreshSessions();
    const curTid = activeJob?.thread_id || activeJob?.job_id;
    if (curTid === threadId || activeJob?.job_id === fallbackJobId) {
      const next = updated.find((r) => r.status === "completed");
      if (next) {
        await loadJob(next.job_id);
      } else {
        setActiveJob(null);
        setIntakeMode(true);
      }
    }
  };

  const handleReanalyze = async (updatedText: string) => {
    if (!activeJob) return;
    clearStreams();
    const baseThreadId = activeJob.thread_id || activeJob.job_id;
    const baseVer = activeJob.version ?? 1;
    const localRevsForThread = Object.values(loadLocalSnapshots()).filter(
      (j) => (j.thread_id || j.job_id) === baseThreadId,
    );
    const revVersions = [
      ...localRevsForThread.map((j) => j.version ?? 1),
      ...(activeJob.revisions || []).map((r) => r.version),
      baseVer,
    ];
    const highestVer = Math.max(...revVersions);
    const baseVersionParam = baseVer < highestVer ? baseVer : undefined;

    try {
      let targetThreadId = baseThreadId;
      let created: { job_id: string; status: string };
      try {
        created = await createJob(updatedText, {
          thread_id: targetThreadId,
          ...(baseVersionParam !== undefined ? { base_version: baseVersionParam } : {}),
        });
      } catch (err) {
        const missingThread = err instanceof ApiError && err.status === 404;
        if (!missingThread || localRevsForThread.length === 0) throw err;

        const restored = await restoreJobs(
          localRevsForThread.sort((a, b) => (a.version ?? 1) - (b.version ?? 1)),
        );
        for (const r of restored) {
          if (r.old_id && r.job_id) {
            remapLocalJobId(r.old_id, r.job_id, r.thread_id);
          }
        }
        targetThreadId = restored[0]?.thread_id || targetThreadId;
        created = await createJob(updatedText, {
          thread_id: targetThreadId,
          ...(baseVersionParam !== undefined ? { base_version: baseVersionParam } : {}),
        });
      }

      const newJobId = created.job_id;
      setReanalyzeProgress({
        active: true,
        jobId: newJobId,
        contextDone: false,
        profileDone: false,
        ragDone: false,
        error: null,
      });

      const stop = subscribeJobStream(newJobId, {
        onSlice: (sliceName) => {
          setReanalyzeProgress((prev) => ({
            ...prev,
            contextDone: prev.contextDone || sliceName === "context",
            profileDone: prev.profileDone || sliceName === "profile",
            ragDone: prev.ragDone || sliceName === "rag_matches",
          }));
        },
        onStatus: async (status) => {
          if (status === "completed") {
            if (baseVersionParam !== undefined) {
              pruneLocalThreadAfterVersion(targetThreadId, baseVersionParam, newJobId);
            }
            await refreshSessions();
            await loadJob(newJobId);
            setReanalyzeProgress({
              active: false,
              jobId: null,
              contextDone: false,
              profileDone: false,
              ragDone: false,
              error: null,
            });
            setReanalyzeOpen(false);
          } else {
            const snap = await getJob(newJobId).catch(() => null);
            const errPayload = snap?.results?.eager_error as { error?: string } | undefined;
            setReanalyzeProgress((prev) => ({
              ...prev,
              active: false,
              error: errPayload?.error || "Re-analysis failed. Previous versions were preserved.",
            }));
          }
        },
        onError: (errMsg) => {
          setReanalyzeProgress((prev) => ({
            ...prev,
            active: false,
            error: errMsg,
          }));
        },
      });
      cleanupsRef.current.push(stop);
    } catch (err) {
      setReanalyzeProgress({
        active: false,
        jobId: null,
        contextDone: false,
        profileDone: false,
        ragDone: false,
        error: err instanceof Error ? err.message : "Failed to start re-analysis.",
      });
    }
  };

  const handleExportWorkspace = () => {
    const count = exportWorkspaceFile();
    setWorkspaceNotice(count > 0 ? `Saved ${count} session(s)` : "No completed sessions to save");
    window.setTimeout(() => setWorkspaceNotice(null), 2600);
  };

  const handleImportWorkspace = async (file?: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = mergeImportedWorkspace(text);
      if (imported.length === 0) {
        setWorkspaceNotice("No valid sessions in file");
        window.setTimeout(() => setWorkspaceNotice(null), 3000);
        return;
      }
      let targetId = imported[0].job_id;
      try {
        const orderedImport = [...imported].sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
        const remapped = await restoreJobs(orderedImport);
        for (const item of remapped) {
          if (item.old_id && item.job_id && (item.old_id !== item.job_id || item.thread_id)) {
            remapLocalJobId(item.old_id, item.job_id, item.thread_id);
            if (item.old_id === targetId) targetId = item.job_id;
          }
        }
      } catch {
        // imported sessions still saved locally even offline
      }
      await refreshSessions();
      await loadJob(targetId);
      setWorkspaceNotice(`Appended ${imported.length} session(s)`);
      window.setTimeout(() => setWorkspaceNotice(null), 3000);
    } catch {
      setWorkspaceNotice("Invalid workspace JSON file");
      window.setTimeout(() => setWorkspaceNotice(null), 3000);
    }
  };

  const handleLoadDemo = async () => {
    try {
      const res = await seedDemoJob();
      await refreshSessions();
      if (res.job_id) {
        await loadJob(res.job_id);
      }
    } catch {
      setWorkspaceNotice("Connect to backend to load demo");
      window.setTimeout(() => setWorkspaceNotice(null), 2600);
    }
  };

  const handleClearAllLocal = async () => {
    clearStreams();
    const existingIds = sessions.map((s) => s.job_id);
    clearAllLocalSnapshots();
    setSessions([]);
    setActiveJob(null);
    setIntakeMode(true);
    setWorkspaceNotice("Device history cleared");
    window.setTimeout(() => setWorkspaceNotice(null), 2600);
    await Promise.allSettled(existingIds.map((id) => deleteJob(id)));
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

  const activeThreadId = activeJob?.thread_id || activeJob?.job_id || "";
  const localRevs = activeThreadId ? getLocalThreadRevisions(activeThreadId) : [];
  const serverRevs = activeJob?.revisions || [];
  const revMap = new Map<string, JobRevisionInfo>();
  for (const r of [...localRevs, ...serverRevs]) {
    revMap.set(r.job_id, r);
  }
  const revisions = Array.from(revMap.values()).sort((a, b) => a.version - b.version);
  const currentRevIdx = revisions.findIndex((r) => r.job_id === activeJob?.job_id);
  const currentVersion =
    activeJob?.version ?? (currentRevIdx >= 0 ? revisions[currentRevIdx].version : 1);
  const latestRevision = revisions[revisions.length - 1] || null;
  const latestVersion = latestRevision?.version ?? currentVersion;
  const isLatest =
    !latestRevision ||
    activeJob?.job_id === latestRevision.job_id ||
    currentVersion >= latestVersion;
  const prevRevision = currentRevIdx > 0 ? revisions[currentRevIdx - 1] : null;
  const nextRevision =
    currentRevIdx >= 0 && currentRevIdx < revisions.length - 1 ? revisions[currentRevIdx + 1] : null;

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
        activeThreadId={intakeMode ? null : activeThreadId || null}
        onSelectSession={(jid) => void loadJob(jid)}
        onDeleteSession={(tid, jid) => void handleDeleteSession(tid, jid)}
        liveRate={liveRate}
        health={health}
        clientId={clientId}
        workspaceNotice={workspaceNotice}
        onExportWorkspace={handleExportWorkspace}
        onImportWorkspace={(f) => void handleImportWorkspace(f)}
        onLoadDemo={() => void handleLoadDemo()}
        onOpenPrivacy={() => {
          setSidebarOpen(false);
          setPrivacyOpen(true);
        }}
        onOpenHealthCheck={() => {
          setSidebarOpen(false);
          void runBootCheck(true);
        }}
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

        {!intakeMode && profile && activeJob && (
          <>
            <div className="revision-bar">
              <div className="revision-nav">
                <button
                  type="button"
                  className="rev-step-btn"
                  disabled={!prevRevision}
                  onClick={() => prevRevision && void loadJob(prevRevision.job_id)}
                  title="View previous analysis"
                >
                  ← Prev
                </button>

                <div className="rev-pills">
                  {revisions.length > 0 ? (
                    revisions.map((rev) => {
                      const active = rev.job_id === activeJob.job_id;
                      const revLatest = rev.job_id === latestRevision?.job_id;
                      return (
                        <button
                          key={rev.job_id}
                          type="button"
                          className={`rev-pill ${active ? "active" : ""}`}
                          onClick={() => !active && void loadJob(rev.job_id)}
                          title={`${rev.student_name || "Analysis"} · Score ${rev.score ?? "—"}`}
                        >
                          v{rev.version}
                          {rev.score !== null && rev.score !== undefined ? ` (${rev.score})` : ""}
                          {revLatest ? " · Latest" : ""}
                        </button>
                      );
                    })
                  ) : (
                    <span className="rev-pill active">v{currentVersion} · Latest</span>
                  )}
                </div>

                <button
                  type="button"
                  className="rev-step-btn"
                  disabled={!nextRevision}
                  onClick={() => nextRevision && void loadJob(nextRevision.job_id)}
                  title="View next analysis"
                >
                  Next →
                </button>
              </div>

              <button
                type="button"
                className="reanalyze-btn"
                onClick={() => setReanalyzeOpen(true)}
              >
                <Icon name="refresh" size={14} />{" "}
                {isLatest ? "Re-analyze" : `Re-analyze from v${currentVersion}`}
              </button>
            </div>

            {!isLatest && latestRevision && (
              <div className="archive-banner" role="status">
                <div className="archive-banner-copy">
                  <Icon name="alert" size={17} />
                  <div>
                    <strong>
                      Viewing older analysis v{currentVersion} (Read-only archive)
                    </strong>
                    <p>
                      Only <b>Latest (v{latestVersion})</b> can run new capabilities. Re-analyzing
                      from v{currentVersion} will delete all newer versions (v{currentVersion + 1}
                      {latestVersion > currentVersion + 1 ? `–v${latestVersion}` : ""}) and make the
                      new analysis Latest.
                    </p>
                  </div>
                </div>
                <div className="archive-banner-actions">
                  <button
                    type="button"
                    className="boot-secondary"
                    onClick={() => setReanalyzeOpen(true)}
                  >
                    Re-analyze from v{currentVersion}
                  </button>
                  <button
                    type="button"
                    className="boot-primary"
                    onClick={() => void loadJob(latestRevision.job_id)}
                  >
                    Jump to Latest (v{latestVersion})
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {intakeMode || !profile || !activeJob ? (
          <IntakeView
            onAnalyze={handleAnalyze}
            eagerProgress={eagerProgress}
            onOpenPrivacy={() => setPrivacyOpen(true)}
          />
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
            isArchived={!isLatest}
            latestVersion={latestVersion}
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
          isArchived={!isLatest}
          onClose={() => setModalCap(null)}
          onRegenerate={() => {
            const target = modalCap.cap;
            setModalCap(null);
            void handleTriggerCapability(target);
          }}
        />
      )}

      <SystemBootOverlay
        boot={bootState}
        onRetry={() => void runBootCheck(Boolean(bootState.manualInspect))}
        onDismiss={dismissBootOverlay}
      />

      <PrivacyModal
        open={privacyOpen}
        clientId={clientId}
        sessionCount={sessions.length}
        onClose={() => setPrivacyOpen(false)}
        onExportBackup={handleExportWorkspace}
        onClearAllLocal={() => void handleClearAllLocal()}
      />

      {activeJob && (
        <ReanalyzeModal
          open={reanalyzeOpen}
          studentName={activeJob.student_name || profile?.name || "Student"}
          baseVersion={currentVersion}
          latestVersion={latestVersion}
          initialText={activeJob.source_text || profile?.summary || ""}
          progress={reanalyzeProgress}
          onSubmit={handleReanalyze}
          onClose={() => {
            setReanalyzeOpen(false);
            setReanalyzeProgress({
              active: false,
              jobId: null,
              contextDone: false,
              profileDone: false,
              ragDone: false,
              error: null,
            });
          }}
        />
      )}
    </div>
  );
}
