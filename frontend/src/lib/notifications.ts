import type { IconName } from "@/components/Icon";
import type {
  CapabilityName,
  DeadlineVerificationItem,
  JobStatusResponse,
  RagScholarshipMatch,
} from "@/types/api";

const VISIT_META_KEY = "ascend.visit_meta.v1";
const NOTIF_STATE_KEY = "ascend.notif_state.v1";
const MAX_STORED_EVENTS = 20;
const MAX_TRACKED_IDS = 120;

export type NotificationKind = "greeting" | "deadline" | "task" | "milestone";
export type NotificationTone = "plum" | "lemon" | "teal" | "amber" | "red";

export interface NotificationAction {
  label: string;
  tab?: "overview" | "tracker" | "study" | "career" | "local";
  trackerQuery?: string;
  capability?: { cap: CapabilityName; title: string };
}

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  tone: NotificationTone;
  icon: IconName;
  badge: string;
  title: string;
  message: string;
  createdAt: string;
  action?: NotificationAction;
  priority: number; // higher renders first in dropdown
}

export interface VisitMeta {
  firstVisitAt: string;
  lastVisitAt: string;
  visitCount: number;
  streakDays: number;
  lastVisitDayKey: string;
}

export interface VisitContext {
  isFirstVisit: boolean;
  daysSinceLastVisit: number;
  hoursSinceLastVisit: number;
  visitCount: number;
  streakDays: number;
  localHour: number;
  dayKey: string;
  personaBadge: string;
  personaIcon: IconName;
}

export interface StoredNotificationState {
  readIds: string[];
  dismissedIds: string[];
  events: AppNotification[];
}

const MONTH_NAMES: Record<number, string> = {
  1: "January",
  2: "February",
  3: "March",
  4: "April",
  5: "May",
  6: "June",
  7: "July",
  8: "August",
  9: "September",
  10: "October",
  11: "November",
  12: "December",
  13: "Rolling / Flexible",
};

const MONTH_MATCHERS: Array<[RegExp, number]> = [
  [/\bjan(?:uary)?\b/i, 1],
  [/\bfeb(?:ruary)?\b/i, 2],
  [/\bmar(?:ch)?\b/i, 3],
  [/\bapr(?:il)?\b/i, 4],
  [/\bmay\b/i, 5],
  [/\bjun(?:e)?\b/i, 6],
  [/\bjul(?:y)?\b/i, 7],
  [/\baug(?:ust)?\b/i, 8],
  [/\bsep(?:t(?:ember)?)?\b/i, 9],
  [/\boct(?:ober)?\b/i, 10],
  [/\bnov(?:ember)?\b/i, 11],
  [/\bdec(?:ember)?\b/i, 12],
];

let cachedSessionVisit: VisitContext | null = null;

function formatLocalDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function diffCalendarDays(fromDayKey: string, toDayKey: string): number {
  const [fy, fm, fd] = fromDayKey.split("-").map(Number);
  const [ty, tm, td] = toDayKey.split("-").map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return 0;
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.max(0, Math.round((toUtc - fromUtc) / 86_400_000));
}

function detectPersona(
  localHour: number,
  isFirstVisit: boolean,
  daysSinceLastVisit: number,
  streakDays: number,
): { badge: string; icon: IconName } {
  if (isFirstVisit) {
    if (localHour >= 22 || localHour < 5) return { badge: "Night Owl · First Visit", icon: "moon" };
    if (localHour >= 5 && localHour < 8) return { badge: "Early Start · First Visit", icon: "sun" };
    return { badge: "First Visit", icon: "sparkle" };
  }
  if (daysSinceLastVisit >= 3) {
    return { badge: "Welcome Back", icon: "sparkle" };
  }
  if (localHour >= 22 || localHour < 5) {
    return { badge: "Night Owl", icon: "moon" };
  }
  if (localHour >= 5 && localHour < 8) {
    return { badge: "Early Start", icon: "sun" };
  }
  if (streakDays >= 3) {
    return { badge: `${streakDays}-Day Streak`, icon: "award" };
  }
  if (localHour < 12) return { badge: "Morning Check-in", icon: "sun" };
  if (localHour < 17) return { badge: "Afternoon Focus", icon: "sun" };
  return { badge: "Evening Session", icon: "moon" };
}

export function getSessionVisitContext(): VisitContext {
  if (cachedSessionVisit) return cachedSessionVisit;

  const now = new Date();
  const nowIso = now.toISOString();
  const todayKey = formatLocalDayKey(now);
  const localHour = now.getHours();

  let prev: VisitMeta | null = null;
  try {
    const raw = window.localStorage.getItem(VISIT_META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<VisitMeta>;
      if (parsed && typeof parsed.visitCount === "number" && parsed.lastVisitAt) {
        prev = {
          firstVisitAt: parsed.firstVisitAt || parsed.lastVisitAt,
          lastVisitAt: parsed.lastVisitAt,
          visitCount: parsed.visitCount,
          streakDays: parsed.streakDays || 1,
          lastVisitDayKey: parsed.lastVisitDayKey || formatLocalDayKey(new Date(parsed.lastVisitAt)),
        };
      }
    }
  } catch {
    prev = null;
  }

  let context: VisitContext;
  let nextMeta: VisitMeta;

  if (!prev) {
    const persona = detectPersona(localHour, true, 0, 1);
    nextMeta = {
      firstVisitAt: nowIso,
      lastVisitAt: nowIso,
      visitCount: 1,
      streakDays: 1,
      lastVisitDayKey: todayKey,
    };
    context = {
      isFirstVisit: true,
      daysSinceLastVisit: 0,
      hoursSinceLastVisit: 0,
      visitCount: 1,
      streakDays: 1,
      localHour,
      dayKey: todayKey,
      personaBadge: persona.badge,
      personaIcon: persona.icon,
    };
  } else {
    const daysSince = diffCalendarDays(prev.lastVisitDayKey, todayKey);
    const hoursSince = Math.max(0, (now.getTime() - Date.parse(prev.lastVisitAt)) / 3_600_000);
    const nextStreak =
      daysSince === 0 ? Math.max(1, prev.streakDays) : daysSince === 1 ? prev.streakDays + 1 : 1;
    const nextCount = prev.visitCount + 1;
    const persona = detectPersona(localHour, false, daysSince, nextStreak);

    nextMeta = {
      firstVisitAt: prev.firstVisitAt,
      lastVisitAt: nowIso,
      visitCount: nextCount,
      streakDays: nextStreak,
      lastVisitDayKey: todayKey,
    };
    context = {
      isFirstVisit: false,
      daysSinceLastVisit: daysSince,
      hoursSinceLastVisit: hoursSince,
      visitCount: nextCount,
      streakDays: nextStreak,
      localHour,
      dayKey: todayKey,
      personaBadge: persona.badge,
      personaIcon: persona.icon,
    };
  }

  try {
    window.localStorage.setItem(VISIT_META_KEY, JSON.stringify(nextMeta));
  } catch {
    // ignore private browsing storage limits
  }

  cachedSessionVisit = context;
  return context;
}

export function loadNotificationState(): StoredNotificationState {
  try {
    const raw = window.localStorage.getItem(NOTIF_STATE_KEY);
    if (!raw) return { readIds: [], dismissedIds: [], events: [] };
    const parsed = JSON.parse(raw) as Partial<StoredNotificationState>;
    return {
      readIds: Array.isArray(parsed.readIds) ? parsed.readIds.slice(-MAX_TRACKED_IDS) : [],
      dismissedIds: Array.isArray(parsed.dismissedIds)
        ? parsed.dismissedIds.slice(-MAX_TRACKED_IDS)
        : [],
      events: Array.isArray(parsed.events) ? parsed.events.slice(0, MAX_STORED_EVENTS) : [],
    };
  } catch {
    return { readIds: [], dismissedIds: [], events: [] };
  }
}

export function saveNotificationState(state: StoredNotificationState): void {
  try {
    const trimmed: StoredNotificationState = {
      readIds: state.readIds.slice(-MAX_TRACKED_IDS),
      dismissedIds: state.dismissedIds.slice(-MAX_TRACKED_IDS),
      events: state.events.slice(0, MAX_STORED_EVENTS),
    };
    window.localStorage.setItem(NOTIF_STATE_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore storage quota errors
  }
}

export function clearNotificationStorage(): void {
  try {
    window.localStorage.removeItem(NOTIF_STATE_KEY);
    window.localStorage.removeItem(VISIT_META_KEY);
  } catch {
    // ignore
  }
  cachedSessionVisit = null;
}

function getFirstName(rawName?: string | null): string | null {
  if (!rawName) return null;
  const clean = rawName.trim();
  if (!clean || /^student$/i.test(clean) || /^new analysis$/i.test(clean)) return null;
  const first = clean.split(/\s+/)[0].replace(/[^A-Za-z0-9'-]/g, "");
  return first.length >= 2 ? first : null;
}

export function parseDeadlineMonthNum(deadlineMonth?: string, explicitNum?: number): number {
  if (typeof explicitNum === "number" && explicitNum >= 1 && explicitNum <= 13) {
    return explicitNum;
  }
  const text = (deadlineMonth || "").trim();
  if (!text || /rolling|varies|open all|year[- ]round|multiple/i.test(text)) return 13;
  for (const [re, num] of MONTH_MATCHERS) {
    if (re.test(text)) return num;
  }
  return 13;
}

export function buildGreetingNotification(
  visit: VisitContext,
  studentName?: string | null,
  stats?: {
    hasActiveProfile: boolean;
    urgentDeadlines: number;
    trackedCount: number;
    openTasksCount: number;
  },
): AppNotification {
  const firstName = getFirstName(studentName);
  const nameSuffix = firstName ? `, ${firstName}` : "";
  const isNightOwl = visit.localHour >= 22 || visit.localHour < 5;
  const isEarlyBird = visit.localHour >= 5 && visit.localHour < 8;
  const isMorning = visit.localHour >= 8 && visit.localHour < 12;
  const isAfternoon = visit.localHour >= 12 && visit.localHour < 17;

  let title: string;
  let message: string;
  let tone: NotificationTone = "plum";
  let icon: IconName = visit.personaIcon;

  if (visit.isFirstVisit) {
    tone = isEarlyBird ? "lemon" : "plum";
    if (isNightOwl) {
      title = "Night owl mode — Welcome to Ascend AI";
      message =
        "Burning the midnight oil on your future? Share your CV or notes to map your profile across 370+ scholarships.";
    } else if (isEarlyBird) {
      title = "Early start — Welcome to Ascend AI";
      message =
        "Up ahead of the rush! Paste your background or upload a PDF CV to get your personalized scholarship roadmap.";
    } else {
      title = "Welcome to Ascend AI";
      message =
        "Your private, on-device scholarship & career workspace. Analyze your profile to unlock tailored matches and deadline tracking.";
    }
  } else if (visit.daysSinceLastVisit >= 3) {
    tone = "lemon";
    icon = "sparkle";
    title = `Welcome back${nameSuffix}! Good to see you again`;
    message = `It's been ${visit.daysSinceLastVisit} days since your last visit. Your saved analyses and tracker progress are right where you left them.`;
  } else if (isNightOwl) {
    tone = "plum";
    icon = "moon";
    title = firstName ? `Night owl session, ${firstName}` : "Burning the midnight oil?";
    message =
      visit.streakDays >= 2
        ? `Late-night focus hits different (${visit.streakDays}-day streak). Knock out one scholarship step before calling it a night.`
        : "Late-night focus hits different. Your scholarship tracker and drafts are queued up and auto-saving locally.";
  } else if (isEarlyBird) {
    tone = "lemon";
    icon = "sun";
    title = firstName ? `Early start, ${firstName}!` : "Early bird mode!";
    message =
      visit.streakDays >= 2
        ? `Starting strong before 8 AM — ${visit.streakDays} days in a row! Great momentum on your applications.`
        : "Starting strong before 8 AM. Getting ahead on applications early makes all the difference.";
  } else if (isMorning) {
    tone = "teal";
    icon = "sun";
    title = `Good morning${nameSuffix}!`;
    message =
      visit.streakDays >= 3
        ? `Welcome back — ${visit.streakDays}-day streak going strong! Let's keep your pipeline moving.`
        : "Welcome back! Ready to check off one roadmap step or review an upcoming scholarship?";
  } else if (isAfternoon) {
    tone = "plum";
    icon = "sparkle";
    title = `Welcome back${nameSuffix}!`;
    message =
      visit.streakDays >= 3
        ? `${visit.streakDays}-day streak active! Great time for a quick scholarship check-in.`
        : "Great time for a quick scholarship check-in. Everything stays auto-saved on this device.";
  } else {
    tone = "plum";
    icon = "moon";
    title = `Good evening${nameSuffix}!`;
    message =
      visit.streakDays >= 3
        ? `Wrapping up day ${visit.streakDays} of your streak strong. Your saved tracker & studio drafts are ready.`
        : "Wrapping up the day strong. Review your upcoming deadlines or generate a fresh Studio draft.";
  }

  const nudges: string[] = [];
  if (stats?.urgentDeadlines && stats.urgentDeadlines > 0) {
    nudges.push(
      `${stats.urgentDeadlines} upcoming deadline${stats.urgentDeadlines === 1 ? "" : "s"} soon`,
    );
  }
  if (stats?.openTasksCount && stats.openTasksCount > 0) {
    nudges.push(`${stats.openTasksCount} open task${stats.openTasksCount === 1 ? "" : "s"}`);
  }
  if (nudges.length > 0) {
    message = `${message} (${nudges.join(" · ")}).`;
  }

  return {
    id: `greet:${visit.dayKey}:${visit.visitCount}`,
    kind: "greeting",
    tone,
    icon,
    badge: visit.personaBadge,
    title,
    message,
    createdAt: new Date().toISOString(),
    action: stats?.hasActiveProfile
      ? {
          label: stats.urgentDeadlines > 0 ? "Check deadlines" : "Open tracker",
          tab: "tracker",
        }
      : undefined,
    priority: 95,
  };
}

export function buildDeadlineNotifications(
  job: JobStatusResponse | null,
  catalog: RagScholarshipMatch[],
): { items: AppNotification[]; urgentCount: number; trackedCount: number; openTasksCount: number } {
  if (!job || !job.results?.profile) {
    return { items: [], urgentCount: 0, trackedCount: 0, openTasksCount: 0 };
  }

  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const ymKey = `${now.getFullYear()}-${String(curMonth).padStart(2, "0")}`;

  const ragMatches = job.results.rag_matches?.matches || [];
  const byName = new Map<string, RagScholarshipMatch>();
  for (const item of [...catalog, ...ragMatches]) {
    if (item?.name) byName.set(item.name, item);
  }

  const verifiedMap = new Map<string, DeadlineVerificationItem>();
  for (const v of job.results.deadline_verification?.verifications || []) {
    if (v?.scholarship_name) verifiedMap.set(v.scholarship_name.toLowerCase(), v);
  }

  const tracker = job.results.tracker;
  const trackerMap = tracker?.scholarships || {};

  // Priority A2: Tracked scholarships (Working / Shortlisted) first; fallback to top matched scholarships.
  const trackedEntries = Object.entries(trackerMap)
    .filter(([, entry]) => entry.status === "working" || entry.status === "shortlisted")
    .sort(([, a], [, b]) => {
      if (a.status === b.status) return 0;
      return a.status === "working" ? -1 : 1;
    });

  const usingTracked = trackedEntries.length > 0;
  interface Candidate {
    name: string;
    country: string;
    deadlineMonth: string;
    monthNum: number;
    statusLabel: string;
    matchScore?: number;
    verified?: DeadlineVerificationItem;
  }

  const candidates: Candidate[] = [];
  if (usingTracked) {
    for (const [name, entry] of trackedEntries) {
      const meta = byName.get(name);
      const monthNum = parseDeadlineMonthNum(meta?.deadline_month, meta?.deadline_month_num);
      candidates.push({
        name,
        country: meta?.country || "",
        deadlineMonth: meta?.deadline_month || MONTH_NAMES[monthNum] || "Check cycle",
        monthNum,
        statusLabel: entry.status === "working" ? "Working on it" : "Shortlisted",
        matchScore: meta?.match_score,
        verified: verifiedMap.get(name.toLowerCase()),
      });
    }
  } else {
    for (const match of ragMatches.slice(0, 5)) {
      const monthNum = parseDeadlineMonthNum(match.deadline_month, match.deadline_month_num);
      candidates.push({
        name: match.name,
        country: match.country,
        deadlineMonth: match.deadline_month || MONTH_NAMES[monthNum] || "Check cycle",
        monthNum,
        statusLabel: "Top match",
        matchScore: match.match_score,
        verified: verifiedMap.get(match.name.toLowerCase()),
      });
    }
  }

  const scored = candidates.map((c) => {
    const monthsAway = c.monthNum >= 1 && c.monthNum <= 12 ? (c.monthNum - curMonth + 12) % 12 : 99;
    return { ...c, monthsAway };
  });

  scored.sort((a, b) => {
    if (a.monthsAway !== b.monthsAway) return a.monthsAway - b.monthsAway;
    return (b.matchScore ?? 0) - (a.matchScore ?? 0);
  });

  const items: AppNotification[] = [];
  let urgentCount = 0;

  const soonCandidates = scored.filter(
    (c) => c.monthsAway <= 2 || c.verified?.cycle_status === "Open",
  );
  const selected = soonCandidates.length > 0 ? soonCandidates.slice(0, 4) : scored.slice(0, 2);

  for (const c of selected) {
    const verifiedLine = c.verified
      ? ` · Live check: ${c.verified.cycle_status} (${c.verified.verified_deadline})`
      : "";
    const countryPart = c.country ? ` (${c.country})` : "";

    let badge: string;
    let tone: NotificationTone;
    let title: string;
    let priority: number;

    if (c.monthsAway === 0) {
      urgentCount += 1;
      badge = "Due This Month";
      tone = "red";
      title = `${c.name} deadline is this month`;
      priority = 120;
    } else if (c.monthsAway === 1) {
      urgentCount += 1;
      badge = "Next Month";
      tone = "amber";
      title = `${c.name} closes next month`;
      priority = 110;
    } else if (c.monthsAway === 2) {
      badge = "In 2 Months";
      tone = "plum";
      title = `${c.name} opens/closes in ${MONTH_NAMES[c.monthNum]}`;
      priority = 90;
    } else if (c.verified?.cycle_status === "Open") {
      urgentCount += 1;
      badge = "Cycle Open";
      tone = "teal";
      title = `${c.name} cycle is currently open`;
      priority = 105;
    } else if (c.monthNum === 13) {
      badge = "Rolling Cycle";
      tone = "teal";
      title = `${c.name} accepts rolling applications`;
      priority = 70;
    } else {
      badge = `Cycle · ${MONTH_NAMES[c.monthNum]}`;
      tone = "plum";
      title = `Next up: ${c.name} (${MONTH_NAMES[c.monthNum]})`;
      priority = 75;
    }

    items.push({
      id: `deadline:${job.job_id}:${c.name}:${ymKey}`,
      kind: "deadline",
      tone,
      icon: c.monthsAway <= 1 ? "clock" : "calendar",
      badge,
      title,
      message: `${c.statusLabel}${countryPart} · Usual window: ${c.deadlineMonth}${verifiedLine}`,
      createdAt: now.toISOString(),
      action: {
        label: "Open in Tracker",
        tab: "tracker",
        trackerQuery: c.name,
      },
      priority,
    });
  }

  // Open custom tasks reminder (if the student has unchecked tasks)
  const openCustomTasks = (tracker?.tasks || []).filter((t) => !t.done);
  const roadmapTotal =
    job.results.profile.roadmap_steps?.length ||
    job.results.profile.improvement_roadmap?.length ||
    0;
  const roadmapCheckedCount = (tracker?.roadmap_checked || []).length;
  const openRoadmapCount = Math.max(0, roadmapTotal - roadmapCheckedCount);
  const openTasksCount = openCustomTasks.length + openRoadmapCount;

  if (openCustomTasks.length > 0) {
    const first = openCustomTasks[0];
    const extra = openCustomTasks.length > 1 ? ` + ${openCustomTasks.length - 1} more` : "";
    items.push({
      id: `tasks:${job.job_id}:${openCustomTasks.length}:${first.id}`,
      kind: "task",
      tone: "plum",
      icon: "target",
      badge: `${openCustomTasks.length} Open Task${openCustomTasks.length === 1 ? "" : "s"}`,
      title: `${first.title}${extra}`,
      message: [
        first.timeframe ? `Target: ${first.timeframe}` : null,
        first.scholarship_name ? `For ${first.scholarship_name}` : null,
        "Check off progress inside your Tracker.",
      ]
        .filter(Boolean)
        .join(" · "),
      createdAt: first.created_at || now.toISOString(),
      action: {
        label: "View tasks",
        tab: "tracker",
      },
      priority: 85,
    });
  }

  return {
    items,
    urgentCount,
    trackedCount: trackedEntries.length,
    openTasksCount,
  };
}

export function createMilestoneNotification(params: {
  idKey: string;
  badge: string;
  title: string;
  message: string;
  tone?: NotificationTone;
  icon?: IconName;
  action?: NotificationAction;
}): AppNotification {
  return {
    id: `milestone:${params.idKey}:${Date.now().toString(36)}`,
    kind: "milestone",
    tone: params.tone || "teal",
    icon: params.icon || "award",
    badge: params.badge,
    title: params.title,
    message: params.message,
    createdAt: new Date().toISOString(),
    action: params.action,
    priority: 100,
  };
}

export function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (Number.isNaN(diffSec) || diffSec < 45) return "Just now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
