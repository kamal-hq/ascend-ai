import type { JobRevisionInfo, JobStatusResponse, JobSummary } from "@/types/api";

const CLIENT_ID_KEY = "ascend.client_id";
const WORKSPACE_KEY = "ascend.workspace.v1";
const DEMO_INIT_KEY = "ascend.demo_init";
const MAX_LOCAL_SESSIONS = 25;

let ephemeralClientId: string | null = null;

function generateClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `usr_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `usr_${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`;
}

export function getClientId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY)?.trim();
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) {
      return existing;
    }
    const created = generateClientId();
    window.localStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    if (!ephemeralClientId) {
      ephemeralClientId = generateClientId();
    }
    return ephemeralClientId;
  }
}

export function isDemoInitialized(): boolean {
  try {
    return window.localStorage.getItem(DEMO_INIT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markDemoInitialized(): void {
  try {
    window.localStorage.setItem(DEMO_INIT_KEY, "1");
  } catch {
    // ignore storage errors
  }
}

export function loadLocalSnapshots(): Record<string, JobStatusResponse> {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, JobStatusResponse>;
  } catch {
    return {};
  }
}

function writeLocalSnapshots(map: Record<string, JobStatusResponse>): void {
  const entries = Object.values(map)
    .sort((a, b) => Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at))
    .slice(0, MAX_LOCAL_SESSIONS);

  const trimmed: Record<string, JobStatusResponse> = {};
  for (const item of entries) {
    if (item?.job_id) {
      trimmed[item.job_id] = item;
    }
  }
  try {
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(trimmed));
  } catch {
    // Drop oldest entries if quota is tight
    const compact = entries.slice(0, 8);
    const fallback: Record<string, JobStatusResponse> = {};
    for (const item of compact) {
      if (item?.job_id) fallback[item.job_id] = item;
    }
    try {
      window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(fallback));
    } catch {
      // ignore unavailable storage
    }
  }
}

export function saveLocalSnapshot(job: JobStatusResponse): void {
  if (!job?.job_id || job.status !== "completed" || !job.results?.profile) {
    return;
  }
  const map = loadLocalSnapshots();
  const prev = map[job.job_id];
  map[job.job_id] = {
    ...prev,
    ...job,
    results: {
      ...(prev?.results || {}),
      ...(job.results || {}),
    },
    capability_states: {
      ...(prev?.capability_states || {}),
      ...(job.capability_states || {}),
    },
  };
  writeLocalSnapshots(map);
}

export function deleteLocalSnapshot(jobId: string): void {
  const map = loadLocalSnapshots();
  if (jobId in map) {
    delete map[jobId];
    writeLocalSnapshots(map);
  }
}

export function deleteLocalThread(threadId: string): void {
  if (!threadId) return;
  const map = loadLocalSnapshots();
  let changed = false;
  for (const [id, snap] of Object.entries(map)) {
    if ((snap.thread_id || snap.job_id) === threadId) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) writeLocalSnapshots(map);
}

export function pruneLocalThreadAfterVersion(
  threadId: string,
  baseVersion: number,
  keepJobId: string,
): void {
  if (!threadId) return;
  const map = loadLocalSnapshots();
  let changed = false;
  for (const [id, snap] of Object.entries(map)) {
    const tid = snap.thread_id || snap.job_id;
    const ver = snap.version ?? 1;
    if (tid === threadId && ver > baseVersion && id !== keepJobId) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) writeLocalSnapshots(map);
}

export function getLocalThreadRevisions(threadId: string): JobRevisionInfo[] {
  if (!threadId) return [];
  return Object.values(loadLocalSnapshots())
    .filter((j) => (j.thread_id || j.job_id) === threadId)
    .sort((a, b) => (a.version ?? 1) - (b.version ?? 1))
    .map((j) => ({
      job_id: j.job_id,
      version: j.version ?? 1,
      score: j.score ?? j.results?.profile?.profile_strength_score ?? null,
      student_name: j.student_name || j.results?.profile?.name || "",
      target_program: j.target_program || j.results?.profile?.target_program || "",
      created_at: j.created_at,
    }));
}

export function remapLocalJobId(oldId: string, newId: string, newThreadId?: string): void {
  if (!oldId || !newId) return;
  const map = loadLocalSnapshots();
  const existing = map[oldId];
  if (!existing) return;
  if (oldId !== newId) delete map[oldId];
  map[newId] = {
    ...existing,
    job_id: newId,
    thread_id: newThreadId || (existing.thread_id === oldId ? newId : existing.thread_id),
  };
  writeLocalSnapshots(map);
}

export function listLocalSummaries(): JobSummary[] {
  return Object.values(loadLocalSnapshots())
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((j) => ({
      job_id: j.job_id,
      thread_id: j.thread_id || j.job_id,
      version: j.version ?? 1,
      status: j.status,
      student_name: j.student_name || j.results?.profile?.name || "",
      target_program: j.target_program || j.results?.profile?.target_program || "",
      score: j.score ?? j.results?.profile?.profile_strength_score ?? null,
      input_preview: j.results?.profile?.summary || "",
      created_at: j.created_at,
      updated_at: j.updated_at,
    }));
}

export function exportWorkspaceFile(): number {
  const jobs = Object.values(loadLocalSnapshots()).sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const payload = {
    app: "Ascend AI v3",
    version: 1,
    client_id: getClientId(),
    exported_at: new Date().toISOString(),
    jobs,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `ascend-workspace-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return jobs.length;
}

export function mergeImportedWorkspace(rawJson: string): JobStatusResponse[] {
  const parsed = JSON.parse(rawJson) as unknown;
  let candidateList: unknown[] = [];
  if (Array.isArray(parsed)) {
    candidateList = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.jobs)) {
      candidateList = obj.jobs;
    } else if (obj.job_id && obj.results) {
      candidateList = [obj];
    }
  }

  const imported: JobStatusResponse[] = [];
  for (const item of candidateList) {
    if (!item || typeof item !== "object") continue;
    const snap = item as JobStatusResponse;
    if (!snap.job_id || !snap.results?.profile) continue;
    const normalized: JobStatusResponse = {
      ...snap,
      status: "completed",
      created_at: snap.created_at || new Date().toISOString(),
      updated_at: snap.updated_at || new Date().toISOString(),
      capability_states: snap.capability_states || {},
    };
    saveLocalSnapshot(normalized);
    imported.push(normalized);
  }
  return imported;
}

export function clearAllLocalSnapshots(): void {
  try {
    window.localStorage.removeItem(WORKSPACE_KEY);
    window.localStorage.setItem(DEMO_INIT_KEY, "1");
  } catch {
    // ignore storage errors
  }
}
