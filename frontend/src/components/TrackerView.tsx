import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import type {
  JobStatusResponse,
  RagScholarshipMatch,
  ScholarshipTrackerStatus,
  TrackerState,
  TrackerTaskItem,
} from "@/types/api";

const STATUS_OPTIONS: Array<{ value: ScholarshipTrackerStatus; label: string }> = [
  { value: "not_started", label: "Not started" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "working", label: "Working on it" },
  { value: "applied", label: "Applied" },
  { value: "awarded", label: "Awarded" },
  { value: "skipped", label: "Skipped" },
];

const MONTH_LABELS: Record<number, string> = {
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

const ACTIVE_STATUSES = new Set<ScholarshipTrackerStatus>([
  "shortlisted",
  "working",
  "applied",
  "awarded",
]);
const CHECKED_STATUSES = new Set<ScholarshipTrackerStatus>(["working", "applied", "awarded"]);

function getCycleMonthOrder(fromCurrentMonth: boolean): number[] {
  if (!fromCurrentMonth) {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  }
  const curMonth = new Date().getMonth() + 1;
  const order: number[] = [];
  for (let offset = 0; offset < 12; offset += 1) {
    order.push(((curMonth - 1 + offset) % 12) + 1);
  }
  order.push(13);
  return order;
}

export function TrackerView({
  job,
  isArchived = false,
  saveStatus,
  onLoadCatalog,
  onUpdateTracker,
}: {
  job: JobStatusResponse;
  isArchived?: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  onLoadCatalog: (jobId: string) => Promise<RagScholarshipMatch[]>;
  onUpdateTracker: (updater: (prev: TrackerState) => TrackerState) => void;
}) {
  const [layout, setLayout] = useState<"sheet" | "calendar">("sheet");
  const [catalog, setCatalog] = useState<RagScholarshipMatch[]>(
    () => job.results.rag_matches?.matches || [],
  );
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogNote, setCatalogNote] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<"relevance" | "cycle" | "tracked">("relevance");
  const [calendarFromNow, setCalendarFromNow] = useState(true);
  const [visibleCount, setVisibleCount] = useState(60);
  const [expandedMonths, setExpandedMonths] = useState<Record<number, boolean>>({});
  const [showTasksPanel, setShowTasksPanel] = useState(true);

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskTimeframe, setNewTaskTimeframe] = useState("");
  const [newTaskSchol, setNewTaskSchol] = useState("");

  useEffect(() => {
    let active = true;
    setLoadingCatalog(true);
    setCatalogNote(null);
    onLoadCatalog(job.job_id)
      .then((items) => {
        if (!active) return;
        if (items.length > 0) {
          setCatalog(items);
        } else {
          setCatalog(job.results.rag_matches?.matches || []);
        }
      })
      .catch(() => {
        if (!active) return;
        setCatalog(job.results.rag_matches?.matches || []);
        setCatalogNote("Showing cached top matches (connect backend to rank all 371 awards).");
      })
      .finally(() => {
        if (active) setLoadingCatalog(false);
      });
    return () => {
      active = false;
    };
  }, [job.job_id, job.results.rag_matches?.matches, onLoadCatalog]);

  const tracker: TrackerState = useMemo(
    () => ({
      scholarships: job.results.tracker?.scholarships || {},
      tasks: job.results.tracker?.tasks || [],
      roadmap_checked: job.results.tracker?.roadmap_checked || [],
    }),
    [job.results.tracker],
  );

  const profile = job.results.profile;
  const roadmapSteps = useMemo(() => {
    if (!profile) return [];
    if (profile.roadmap_steps && profile.roadmap_steps.length > 0) {
      return profile.roadmap_steps;
    }
    return (profile.improvement_roadmap || []).map((text, idx) => ({
      timeframe: `MONTH ${idx * 2 + 1}–${idx * 2 + 2}`,
      title: text.length > 72 ? `${text.slice(0, 69)}...` : text,
      detail: text,
    }));
  }, [profile]);

  const setScholarshipStatus = (name: string, status: ScholarshipTrackerStatus) => {
    if (isArchived) return;
    onUpdateTracker((prev) => ({
      ...prev,
      scholarships: {
        ...prev.scholarships,
        [name]: {
          comment: prev.scholarships[name]?.comment || "",
          status,
          updated_at: new Date().toISOString(),
        },
      },
    }));
  };

  const setScholarshipComment = (name: string, comment: string) => {
    if (isArchived) return;
    onUpdateTracker((prev) => ({
      ...prev,
      scholarships: {
        ...prev.scholarships,
        [name]: {
          status: prev.scholarships[name]?.status || "not_started",
          comment,
          updated_at: new Date().toISOString(),
        },
      },
    }));
  };

  const toggleWorkCheckbox = (name: string) => {
    const current = tracker.scholarships[name]?.status || "not_started";
    const next: ScholarshipTrackerStatus = CHECKED_STATUSES.has(current) ? "not_started" : "working";
    setScholarshipStatus(name, next);
  };

  const toggleRoadmapStep = (index: number) => {
    if (isArchived) return;
    onUpdateTracker((prev) => {
      const exists = prev.roadmap_checked.includes(index);
      return {
        ...prev,
        roadmap_checked: exists
          ? prev.roadmap_checked.filter((i) => i !== index)
          : [...prev.roadmap_checked, index],
      };
    });
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (isArchived || !newTaskTitle.trim()) return;
    const item: TrackerTaskItem = {
      id: `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title: newTaskTitle.trim(),
      timeframe: newTaskTimeframe.trim(),
      scholarship_name: newTaskSchol.trim(),
      done: false,
      created_at: new Date().toISOString(),
    };
    onUpdateTracker((prev) => ({
      ...prev,
      tasks: [item, ...prev.tasks],
    }));
    setNewTaskTitle("");
    setNewTaskTimeframe("");
    setNewTaskSchol("");
  };

  const toggleCustomTask = (id: string) => {
    if (isArchived) return;
    onUpdateTracker((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    }));
  };

  const deleteCustomTask = (id: string) => {
    if (isArchived) return;
    onUpdateTracker((prev) => ({
      ...prev,
      tasks: prev.tasks.filter((t) => t.id !== id),
    }));
  };

  const kpis = useMemo(() => {
    let activeCount = 0;
    let workingCount = 0;
    let appliedCount = 0;
    let notedCount = 0;
    for (const entry of Object.values(tracker.scholarships)) {
      if (ACTIVE_STATUSES.has(entry.status)) activeCount += 1;
      if (entry.status === "working") workingCount += 1;
      if (entry.status === "applied" || entry.status === "awarded") appliedCount += 1;
      if ((entry.comment || "").trim()) notedCount += 1;
    }
    const roadmapDone = roadmapSteps.filter((_, i) => tracker.roadmap_checked.includes(i)).length;
    const customDone = tracker.tasks.filter((t) => t.done).length;
    return {
      activeCount,
      workingCount,
      appliedCount,
      notedCount,
      tasksDone: roadmapDone + customDone,
      tasksTotal: roadmapSteps.length + tracker.tasks.length,
    };
  }, [roadmapSteps, tracker]);

  const cycleRankLookup = useMemo(() => {
    const order = getCycleMonthOrder(true);
    const map = new Map<number, number>();
    order.forEach((m, i) => map.set(m, i));
    return map;
  }, []);

  const filteredScholarships = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = catalog.filter((item) => {
      const entry = tracker.scholarships[item.name];
      const st = entry?.status || "not_started";
      const pct = item.match_score ?? 0;

      if (statusFilter === "active" && !ACTIVE_STATUSES.has(st)) return false;
      if (statusFilter === "high_fit" && pct < 75) return false;
      if (
        statusFilter !== "all" &&
        statusFilter !== "active" &&
        statusFilter !== "high_fit" &&
        st !== statusFilter
      ) {
        return false;
      }

      const mNum = item.deadline_month_num ?? 13;
      if (monthFilter !== "all" && String(mNum) !== monthFilter) return false;

      if (q) {
        const hay = `${item.name} ${item.country} ${item.fields} ${item.deadline_month} ${item.note} ${entry?.comment || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortMode === "cycle") {
      return [...list].sort((a, b) => {
        const ca = cycleRankLookup.get(a.deadline_month_num ?? 13) ?? 99;
        const cb = cycleRankLookup.get(b.deadline_month_num ?? 13) ?? 99;
        if (ca !== cb) return ca - cb;
        return (b.match_score ?? 0) - (a.match_score ?? 0);
      });
    }
    if (sortMode === "tracked") {
      return [...list].sort((a, b) => {
        const ea = tracker.scholarships[a.name];
        const eb = tracker.scholarships[b.name];
        const wa = (ea && ea.status !== "not_started") || ea?.comment ? 1 : 0;
        const wb = (eb && eb.status !== "not_started") || eb?.comment ? 1 : 0;
        if (wa !== wb) return wb - wa;
        return a.rank - b.rank;
      });
    }
    return list;
  }, [catalog, cycleRankLookup, monthFilter, search, sortMode, statusFilter, tracker.scholarships]);

  const calendarGroups = useMemo(() => {
    const order = getCycleMonthOrder(calendarFromNow);
    const byMonth = new Map<number, RagScholarshipMatch[]>();
    for (const m of order) byMonth.set(m, []);
    for (const item of filteredScholarships) {
      const m = item.deadline_month_num ?? 13;
      const bucket = byMonth.get(m) || byMonth.get(13)!;
      bucket.push(item);
    }
    return order
      .map((m) => ({
        monthNum: m,
        label: MONTH_LABELS[m] || "Rolling / Flexible",
        items: (byMonth.get(m) || []).sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0)),
      }))
      .filter((g) => g.items.length > 0);
  }, [calendarFromNow, filteredScholarships]);

  const sheetSlice = filteredScholarships.slice(0, visibleCount);
  const scholarshipOptions = useMemo(() => catalog.slice(0, 60).map((s) => s.name), [catalog]);

  return (
    <div className="page tracker-page">
      <div className="tracker-header">
        <div>
          <p className="eyebrow">All-in-one workspace · {catalog.length} scholarships ranked</p>
          <h1>Scholarship Tracker &amp; Deadline Calendar</h1>
          <p>
            Track open tasks, check off applications as you work, and save comments per scholarship.
            Changes save automatically on your device and carry into newer profile revisions.
          </p>
        </div>
        <div className="tracker-save-badge">
          {isArchived ? (
            <span className="pill">Read-only archive</span>
          ) : saveStatus === "saving" ? (
            <span className="pill saving">Saving progress…</span>
          ) : saveStatus === "error" ? (
            <span className="pill warn">Saved locally (sync pending)</span>
          ) : (
            <span className="pill saved">
              <Icon name="check" size={12} /> Auto-saved
            </span>
          )}
        </div>
      </div>

      <div className="tracker-kpis">
        <div className="kpi-card">
          <span>Ranked catalog</span>
          <strong>{catalog.length}</strong>
          <small>Sorted by your profile fit</small>
        </div>
        <div className="kpi-card">
          <span>In pipeline</span>
          <strong>{kpis.activeCount}</strong>
          <small>{kpis.workingCount} actively working</small>
        </div>
        <div className="kpi-card">
          <span>Submitted / Won</span>
          <strong>{kpis.appliedCount}</strong>
          <small>{kpis.notedCount} with your notes</small>
        </div>
        <div className="kpi-card">
          <span>Open tasks done</span>
          <strong>
            {kpis.tasksDone}/{kpis.tasksTotal}
          </strong>
          <small>Roadmap + custom items</small>
        </div>
      </div>

      {/* Unified Open Tasks & Roadmap Panel */}
      <section className="tracker-tasks-panel">
        <div className="tasks-panel-head">
          <div>
            <h2>Open Tasks &amp; Action Checklist</h2>
            <p>Synced with your 6-month profile roadmap — add custom application tasks below.</p>
          </div>
          <button
            type="button"
            className="boot-secondary"
            onClick={() => setShowTasksPanel((v) => !v)}
          >
            {showTasksPanel ? "Collapse tasks" : `Show tasks (${kpis.tasksTotal})`}
          </button>
        </div>

        {showTasksPanel && (
          <>
            {!isArchived && (
              <form className="task-add-row" onSubmit={handleAddTask}>
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Add an open task (e.g., Request LOR from Prof. Ali, Book IELTS)…"
                />
                <input
                  type="text"
                  value={newTaskTimeframe}
                  onChange={(e) => setNewTaskTimeframe(e.target.value)}
                  placeholder="When (e.g. Nov 2026)"
                />
                <select
                  value={newTaskSchol}
                  onChange={(e) => setNewTaskSchol(e.target.value)}
                  aria-label="Link to scholarship"
                >
                  <option value="">General / All scholarships</option>
                  {scholarshipOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <button type="submit" className="boot-primary" disabled={!newTaskTitle.trim()}>
                  <Icon name="plus" size={14} /> Add task
                </button>
              </form>
            )}

            <div className="unified-tasks-grid">
              {tracker.tasks.map((task) => (
                <div className={`unified-task ${task.done ? "done" : ""}`} key={task.id}>
                  <button
                    type="button"
                    className="task-check-btn"
                    disabled={isArchived}
                    onClick={() => toggleCustomTask(task.id)}
                  >
                    <i className={task.done ? "checked" : ""}>
                      {task.done && <Icon name="check" size={13} />}
                    </i>
                    <span>
                      <strong>{task.title}</strong>
                      <small>
                        {task.timeframe || "Flexible"}
                        {task.scholarship_name ? ` · ${task.scholarship_name}` : ""}
                      </small>
                    </span>
                  </button>
                  {!isArchived && (
                    <button
                      type="button"
                      className="task-del-btn"
                      onClick={() => deleteCustomTask(task.id)}
                      title="Delete task"
                    >
                      <Icon name="x" size={13} />
                    </button>
                  )}
                </div>
              ))}

              {roadmapSteps.map((step, idx) => {
                const done = tracker.roadmap_checked.includes(idx);
                return (
                  <div className={`unified-task ${done ? "done" : ""}`} key={`rm-${idx}`}>
                    <button
                      type="button"
                      className="task-check-btn"
                      disabled={isArchived}
                      onClick={() => toggleRoadmapStep(idx)}
                    >
                      <i className={done ? "checked" : ""}>
                        {done && <Icon name="check" size={13} />}
                      </i>
                      <span>
                        <strong>{step.title}</strong>
                        <small>AI Roadmap · {step.timeframe}</small>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* Toolbar */}
      <div className="tracker-toolbar">
        <div className="view-toggle" role="tablist" aria-label="Tracker layout">
          <button
            type="button"
            className={layout === "sheet" ? "active" : ""}
            onClick={() => setLayout("sheet")}
          >
            <Icon name="grid" size={14} /> Spreadsheet (Excel)
          </button>
          <button
            type="button"
            className={layout === "calendar" ? "active" : ""}
            onClick={() => setLayout("calendar")}
          >
            <Icon name="calendar" size={14} /> Calendar Timeline
          </button>
        </div>

        <input
          className="tracker-search"
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setVisibleCount(60);
          }}
          placeholder="Search scholarship, country, field, or note…"
        />

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setVisibleCount(60);
          }}
          aria-label="Filter by status"
        >
          <option value="all">All awards ({catalog.length})</option>
          <option value="active">Active pipeline ({kpis.activeCount})</option>
          <option value="working">Working on it ({kpis.workingCount})</option>
          <option value="shortlisted">Shortlisted</option>
          <option value="applied">Applied / Submitted</option>
          <option value="awarded">Awarded</option>
          <option value="high_fit">Best fit (75%+)</option>
        </select>

        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          aria-label="Filter by closing month"
        >
          <option value="all">All deadlines</option>
          {Object.entries(MONTH_LABELS).map(([num, label]) => (
            <option key={num} value={num}>
              {label}
            </option>
          ))}
        </select>

        {layout === "sheet" ? (
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as "relevance" | "cycle" | "tracked")}
            aria-label="Sort scholarships"
          >
            <option value="relevance">Sort: Most relevant first</option>
            <option value="cycle">Sort: Upcoming deadline</option>
            <option value="tracked">Sort: Your active &amp; noted first</option>
          </select>
        ) : (
          <button
            type="button"
            className="boot-secondary"
            onClick={() => setCalendarFromNow((v) => !v)}
          >
            {calendarFromNow ? "Order: Upcoming from today" : "Order: Jan → Dec"}
          </button>
        )}
      </div>

      {catalogNote && <p className="tracker-info-note">{catalogNote}</p>}

      {loadingCatalog && catalog.length <= 5 ? (
        <div className="tracker-loading">Ranking all 371 curated scholarships for your profile…</div>
      ) : layout === "sheet" ? (
        <>
          <div className="excel-table-wrap">
            <table className="excel-table">
              <thead>
                <tr>
                  <th className="col-check">Work</th>
                  <th className="col-fit">Fit</th>
                  <th className="col-name">Scholarship &amp; Program Details</th>
                  <th className="col-deadline">Deadline</th>
                  <th className="col-status">Status</th>
                  <th className="col-comment">Your Comment / Progress Note</th>
                </tr>
              </thead>
              <tbody>
                {sheetSlice.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="excel-empty">
                      No scholarships match your current search or filter.
                    </td>
                  </tr>
                ) : (
                  sheetSlice.map((item) => {
                    const entry = tracker.scholarships[item.name];
                    const status = entry?.status || "not_started";
                    const comment = entry?.comment || "";
                    const isChecked = CHECKED_STATUSES.has(status);
                    const pct = item.match_score ?? 65;

                    return (
                      <tr className={`excel-row st-${status}`} key={`${item.rank}-${item.name}`}>
                        <td className="col-check">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isArchived}
                            aria-label={`Mark ${item.name} as working`}
                            onChange={() => toggleWorkCheckbox(item.name)}
                          />
                        </td>
                        <td className="col-fit">
                          <span className="fit-rank">#{item.rank}</span>
                          <strong className={pct >= 80 ? "fit-high" : ""}>{pct}%</strong>
                        </td>
                        <td className="col-name">
                          <div className="schol-cell-head">
                            <strong>{item.name}</strong>
                            <span className="country-tag">
                              {item.country_code || "GL"} · {item.country}
                            </span>
                            {item.url && (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Official application portal"
                              >
                                Portal <Icon name="external" size={12} />
                              </a>
                            )}
                          </div>
                          <p className="schol-cell-sub">{item.fields}</p>
                          <small className="schol-cell-note">
                            GPA: {item.gpa_min || "Varies"} · Bond: {item.bond || "None"} ·{" "}
                            {item.note}
                          </small>
                        </td>
                        <td className="col-deadline">
                          <span className="deadline-bucket">{item.deadline_bucket || "Flexible"}</span>
                          <small>{item.deadline_month || "Check portal"}</small>
                        </td>
                        <td className="col-status">
                          <select
                            className={`status-select st-${status}`}
                            value={status}
                            disabled={isArchived}
                            onChange={(e) =>
                              setScholarshipStatus(
                                item.name,
                                e.target.value as ScholarshipTrackerStatus,
                              )
                            }
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="col-comment">
                          <input
                            type="text"
                            className="excel-comment-input"
                            value={comment}
                            disabled={isArchived}
                            placeholder={isArchived ? "Read-only" : "Add note, SOP status, LOR…"}
                            onChange={(e) => setScholarshipComment(item.name, e.target.value)}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {filteredScholarships.length > visibleCount && (
            <div className="excel-pager">
              <span>
                Showing {sheetSlice.length} of {filteredScholarships.length} scholarships
              </span>
              <div>
                <button
                  type="button"
                  className="boot-secondary"
                  onClick={() => setVisibleCount((c) => c + 60)}
                >
                  Load 60 more
                </button>
                <button
                  type="button"
                  className="boot-primary"
                  onClick={() => setVisibleCount(filteredScholarships.length)}
                >
                  Show all ({filteredScholarships.length})
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="calendar-grid">
          {calendarGroups.length === 0 ? (
            <div className="tracker-loading">No deadlines match the selected filters.</div>
          ) : (
            calendarGroups.map((group) => {
              const showAllMonth = Boolean(expandedMonths[group.monthNum]);
              const shown = showAllMonth ? group.items : group.items.slice(0, 8);
              const trackedInMonth = group.items.filter((s) =>
                ACTIVE_STATUSES.has(tracker.scholarships[s.name]?.status || "not_started"),
              ).length;

              return (
                <section className="month-card" key={group.monthNum}>
                  <header className="month-card-head">
                    <div>
                      <h3>{group.label}</h3>
                      <span>
                        {group.items.length}{" "}
                        {group.items.length === 1 ? "opportunity" : "opportunities"}
                        {trackedInMonth > 0 ? ` · ${trackedInMonth} tracked` : ""}
                      </span>
                    </div>
                  </header>

                  <div className="month-items">
                    {shown.map((item) => {
                      const entry = tracker.scholarships[item.name];
                      const status = entry?.status || "not_started";
                      const comment = entry?.comment || "";
                      const isChecked = CHECKED_STATUSES.has(status);
                      return (
                        <article className={`cal-item st-${status}`} key={`${item.rank}-${item.name}`}>
                          <div className="cal-item-top">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isArchived}
                              aria-label={`Mark ${item.name} as working`}
                              onChange={() => toggleWorkCheckbox(item.name)}
                            />
                            <div className="cal-item-title">
                              <strong>{item.name}</strong>
                              <small>
                                #{item.rank} · {item.match_score ?? 65}% fit · {item.country} ·{" "}
                                {item.deadline_month}
                              </small>
                            </div>
                            <select
                              className={`status-select st-${status}`}
                              value={status}
                              disabled={isArchived}
                              onChange={(e) =>
                                setScholarshipStatus(
                                  item.name,
                                  e.target.value as ScholarshipTrackerStatus,
                                )
                              }
                            >
                              {STATUS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="cal-item-bottom">
                            <input
                              type="text"
                              className="excel-comment-input"
                              value={comment}
                              disabled={isArchived}
                              placeholder={isArchived ? "Read-only" : "Add comment or reminder…"}
                              onChange={(e) => setScholarshipComment(item.name, e.target.value)}
                            />
                            {item.url && (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ext-link"
                              >
                                Portal <Icon name="external" size={12} />
                              </a>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  {group.items.length > 8 && (
                    <button
                      type="button"
                      className="month-more-btn"
                      onClick={() =>
                        setExpandedMonths((prev) => ({
                          ...prev,
                          [group.monthNum]: !prev[group.monthNum],
                        }))
                      }
                    >
                      {showAllMonth
                        ? "Show top 8 only"
                        : `Show all ${group.items.length} in ${group.label}`}
                    </button>
                  )}
                </section>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
