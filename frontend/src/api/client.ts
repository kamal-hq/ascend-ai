import { getClientId } from "@/lib/workspaceStore";
import type {
  CapabilityName,
  CapabilityStatus,
  HealthResponse,
  JobStatusResponse,
  JobSummary,
} from "@/types/api";

export const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("X-Client-Id", getClientId());
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) {
        detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      }
    } catch {
      // ignore non-JSON body
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function checkHealth(
  warmup = false,
  timeoutMs = 9000,
  externalSignal?: AbortSignal,
): Promise<HealthResponse> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const query = warmup ? "?warmup=true" : "";
    return await apiJson<HealthResponse>(`/health${query}`, { signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function wakeBackend(options?: {
  maxWaitMs?: number;
  attemptTimeoutMs?: number;
  retryDelayMs?: number;
  onAttempt?: (attempt: number, elapsedMs: number) => void;
  signal?: AbortSignal;
}): Promise<{ health: HealthResponse; elapsedMs: number; attempts: number }> {
  const maxWaitMs = options?.maxWaitMs ?? 75_000;
  const attemptTimeoutMs = options?.attemptTimeoutMs ?? 9_000;
  const retryDelayMs = options?.retryDelayMs ?? 2_000;
  const startedAt = Date.now();
  let attempt = 0;
  let lastError: Error | null = null;

  while (true) {
    if (options?.signal?.aborted) {
      throw new Error("Wake-up check cancelled");
    }
    attempt += 1;
    options?.onAttempt?.(attempt, Date.now() - startedAt);
    try {
      const health = await checkHealth(true, attemptTimeoutMs, options?.signal);
      if (health && health.status === "ok") {
        return { health, elapsedMs: Date.now() - startedAt, attempts: attempt };
      }
      lastError = new Error("Backend returned unexpected health state");
    } catch (err) {
      if (options?.signal?.aborted) {
        throw new Error("Wake-up check cancelled");
      }
      lastError = err instanceof Error ? err : new Error("Backend did not respond");
    }

    if (Date.now() - startedAt >= maxWaitMs) {
      throw lastError || new Error("Free-tier backend did not respond in time");
    }

    await new Promise<void>((resolve, reject) => {
      const waitTimer = window.setTimeout(() => {
        options?.signal?.removeEventListener("abort", onAbort);
        resolve();
      }, retryDelayMs);
      const onAbort = () => {
        window.clearTimeout(waitTimer);
        reject(new Error("Wake-up check cancelled"));
      };
      options?.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

export async function listJobs(
  limit = 20,
  offset = 0,
  seedDemo = false,
): Promise<JobSummary[]> {
  const seed = seedDemo ? "&seed_demo=true" : "";
  const res = await apiJson<{ jobs: JobSummary[] }>(
    `/jobs?limit=${limit}&offset=${offset}${seed}`,
  );
  return res.jobs;
}

export async function restoreJobs(
  jobs: JobStatusResponse[],
): Promise<Array<{ old_id: string; job_id: string }>> {
  if (jobs.length === 0) return [];
  const res = await apiJson<{ restored: Array<{ old_id: string; job_id: string }> }>(
    "/jobs/restore",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs }),
    },
  );
  return res.restored || [];
}

export function seedDemoJob(): Promise<{ seeded: boolean; job_id: string | null }> {
  return apiJson<{ seeded: boolean; job_id: string | null }>("/jobs/demo", {
    method: "POST",
  });
}

export function getJob(jobId: string): Promise<JobStatusResponse> {
  return apiJson<JobStatusResponse>(`/jobs/${encodeURIComponent(jobId)}`);
}

export function createJob(inputText: string): Promise<{ job_id: string; status: string }> {
  return apiJson<{ job_id: string; status: string }>("/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input_text: inputText }),
  });
}

export function deleteJob(jobId: string): Promise<{ deleted: boolean; job_id: string }> {
  return apiJson<{ deleted: boolean; job_id: string }>(`/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
}

export function triggerCapability(
  jobId: string,
  capability: CapabilityName,
  options?: { custom_notes?: string; sop_text?: string },
): Promise<{ job_id: string; capability: string; status: "queued" }> {
  return apiJson(`/jobs/${encodeURIComponent(jobId)}/capabilities/${capability}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: options ? JSON.stringify(options) : undefined,
  });
}

export async function parseCvPdf(file: File): Promise<{
  filename: string;
  page_count: number;
  char_count: number;
  text: string;
}> {
  const form = new FormData();
  form.append("file", file);
  return apiJson("/inputs/parse-cv", {
    method: "POST",
    body: form,
  });
}

export async function exportDocx(
  title: string,
  content: string,
  filename = "ascend-document.docx",
): Promise<void> {
  const res = await fetch(`${API_BASE}/export/docx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": getClientId(),
    },
    body: JSON.stringify({ title, content, filename }),
  });
  if (!res.ok) {
    throw new Error(`DOCX export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function subscribeJobStream(
  jobId: string,
  handlers: {
    onSlice?: (sliceName: string, payload: unknown) => void;
    onStatus?: (status: "completed" | "failed") => void;
    onError?: (errMsg: string) => void;
  },
): () => void {
  const clientId = encodeURIComponent(getClientId());
  const es = new EventSource(
    `${API_BASE}/jobs/${encodeURIComponent(jobId)}/stream?client_id=${clientId}`,
  );
  let closed = false;

  const cleanup = () => {
    if (!closed) {
      closed = true;
      es.close();
    }
  };

  es.addEventListener("result", (ev) => {
    try {
      const parsed = JSON.parse((ev as MessageEvent).data) as {
        module?: string;
        capability?: string;
        payload?: unknown;
      };
      const name = parsed.capability || parsed.module;
      if (name) {
        handlers.onSlice?.(name, parsed.payload);
      }
    } catch {
      // ignore parse errors
    }
  });

  es.addEventListener("status", (ev) => {
    try {
      const parsed = JSON.parse((ev as MessageEvent).data) as { status: "completed" | "failed" };
      handlers.onStatus?.(parsed.status);
    } catch {
      // ignore
    }
  });

  es.addEventListener("done", () => cleanup());

  es.addEventListener("error", (ev) => {
    const data = (ev as MessageEvent).data;
    if (data) {
      try {
        const parsed = JSON.parse(data) as { error?: string };
        handlers.onError?.(parsed.error || "Stream failed");
      } catch {
        handlers.onError?.("Stream failed");
      }
      cleanup();
    }
  });

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      cleanup();
    }
  };

  return cleanup;
}

export function subscribeCapabilityStream(
  jobId: string,
  capability: CapabilityName,
  handlers: {
    onStatus?: (status: CapabilityStatus) => void;
    onResult?: (payload: unknown) => void;
    onError?: (errMsg: string) => void;
  },
): () => void {
  const clientId = encodeURIComponent(getClientId());
  const es = new EventSource(
    `${API_BASE}/jobs/${encodeURIComponent(jobId)}/capabilities/${capability}/stream?client_id=${clientId}`,
  );
  let closed = false;

  const cleanup = () => {
    if (!closed) {
      closed = true;
      es.close();
    }
  };

  es.addEventListener("capability_status", (ev) => {
    try {
      const parsed = JSON.parse((ev as MessageEvent).data) as { status: CapabilityStatus };
      handlers.onStatus?.(parsed.status);
    } catch {
      // ignore
    }
  });

  es.addEventListener("result", (ev) => {
    try {
      const parsed = JSON.parse((ev as MessageEvent).data) as { payload: unknown };
      handlers.onResult?.(parsed.payload);
    } catch {
      // ignore
    }
  });

  es.addEventListener("error", (ev) => {
    const data = (ev as MessageEvent).data;
    if (data) {
      try {
        const parsed = JSON.parse(data) as { error?: string };
        handlers.onError?.(parsed.error || "Capability execution failed");
      } catch {
        handlers.onError?.("Capability execution failed");
      }
      cleanup();
    }
  });

  es.addEventListener("done", () => cleanup());

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      cleanup();
    }
  };

  return cleanup;
}
