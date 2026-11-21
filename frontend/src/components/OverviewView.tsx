import { useState } from "react";
import { exportDocx } from "@/api/client";
import { Icon } from "@/components/Icon";
import { getInitials } from "@/components/Sidebar";
import type { ProfileResult, RagScholarshipMatch } from "@/types/api";

function ScoreRing({ score }: { score: number }) {
  const safe = Math.max(0, Math.min(100, Math.round(score || 0)));
  return (
    <div className="score-ring" style={{ "--score": safe } as React.CSSProperties}>
      <div>
        <strong>{safe}</strong>
        <span>/100</span>
      </div>
    </div>
  );
}

function deriveStrengthLabel(score: number, existing?: string): string {
  if (existing) return existing;
  if (score >= 80) return "Strong";
  if (score >= 65) return "Competitive";
  if (score >= 50) return "Developing";
  return "Needs Focus";
}

function parseMatchPct(item: RagScholarshipMatch): number {
  if (typeof item.match_score === "number" && item.match_score > 0) {
    return Math.min(99, Math.max(1, Math.round(item.match_score)));
  }
  const num = parseFloat(String(item.similarity_match || "70").replace("%", ""));
  if (Number.isNaN(num) || num <= 0) return 65;
  return Math.min(99, Math.max(1, Math.round(num)));
}

export function OverviewView({
  profile,
  matches,
  checkedSteps: externalChecked,
  isArchived = false,
  onToggleStep,
  onNavigate,
}: {
  profile: ProfileResult;
  matches: RagScholarshipMatch[];
  checkedSteps?: number[];
  isArchived?: boolean;
  onToggleStep?: (index: number) => void;
  onNavigate: (tab: "tracker" | "study" | "career" | "local") => void;
}) {
  const [localChecked, setLocalChecked] = useState<Record<number, boolean>>({});
  const [exporting, setExporting] = useState(false);

  const isStepChecked = (idx: number): boolean =>
    externalChecked ? externalChecked.includes(idx) : Boolean(localChecked[idx]);

  const toggleStep = (idx: number) => {
    if (isArchived) return;
    if (onToggleStep) {
      onToggleStep(idx);
    } else {
      setLocalChecked((prev) => ({ ...prev, [idx]: !prev[idx] }));
    }
  };

  const score = profile.profile_strength_score ?? 50;
  const strengthLabel = deriveStrengthLabel(score, profile.strength_label);

  const chips = Array.from(
    new Set([
      ...(profile.research_interests || []),
      ...(profile.special_skills || []),
      ...(profile.key_strengths || []),
    ]),
  ).slice(0, 8);

  const gapList =
    profile.gap_items && profile.gap_items.length > 0
      ? profile.gap_items
      : profile.gap_analysis
        ? [{ title: "Profile competitiveness gap", detail: profile.gap_analysis, severity: "HIGH IMPACT" as const }]
        : [];

  const roadmapList =
    profile.roadmap_steps && profile.roadmap_steps.length > 0
      ? profile.roadmap_steps
      : (profile.improvement_roadmap || []).map((text, idx) => ({
          timeframe: `MONTH ${idx * 2 + 1}–${idx * 2 + 2}`,
          title: text.length > 72 ? `${text.slice(0, 69)}...` : text,
          detail: text,
        }));

  const completedCount = roadmapList.filter((_, idx) => isStepChecked(idx)).length;

  const handleExportReport = async () => {
    setExporting(true);
    try {
      const lines = [
        `Candidate: ${profile.name}`,
        `Current Degree: ${profile.degree} — ${profile.university} ${profile.graduation_year}`,
        `Target: ${profile.target_program} (${(profile.target_country || []).join(", ")})`,
        `Profile Strength Score: ${score}/100 (${strengthLabel})`,
        "",
        `Summary:\n${profile.summary || ""}`,
        "",
        `Critical Gap Analysis:\n${profile.gap_analysis || ""}`,
        "",
        "6-Month Improvement Roadmap:",
        ...roadmapList.map((s, i) => `${i + 1}. [${s.timeframe}] ${s.title} — ${s.detail}`),
        "",
        "Top Matched Scholarships:",
        ...matches.map(
          (m) => `#${m.rank} ${m.name} (${m.country}) — ${parseMatchPct(m)}% match | Deadline: ${m.deadline_month} | ${m.url}`,
        ),
      ].join("\n\n");
      await exportDocx(
        `Ascend AI Profile Report — ${profile.name}`,
        lines,
        `${profile.name.toLowerCase().replace(/\s+/g, "-")}-report.docx`,
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Profile overview</p>
          <h1>Your opportunity dashboard</h1>
          <p>Understand where you stand, what to improve, and which opportunities fit you best.</p>
        </div>
        <button className="outline-button" onClick={() => void handleExportReport()} disabled={exporting}>
          <Icon name="download" size={16} /> {exporting ? "Exporting…" : "Export report"}
        </button>
      </div>

      <section className="profile-card">
        <div className="profile-main">
          <div className="profile-label">
            <span>{getInitials(profile.name)}</span>
            <div>
              <p>STUDENT PROFILE</p>
              <h2>{profile.name}</h2>
            </div>
          </div>
          <p className="profile-summary">
            {profile.summary ||
              profile.career_goal ||
              "Structured academic and career intelligence extracted from your submitted background."}
          </p>
          <div className="profile-meta">
            <div>
              <span>Current</span>
              <strong>{profile.degree || "Undergraduate"}</strong>
              <small>
                {[profile.university, profile.graduation_year].filter(Boolean).join(" · ") || "Institution not specified"}
              </small>
            </div>
            <div>
              <span>Target</span>
              <strong>{profile.target_program || "Graduate Program"}</strong>
              <small>{(profile.target_country || []).join(" · ") || "Global"}</small>
            </div>
            <div>
              <span>CGPA</span>
              <strong className="mono">{profile.cgpa || "Not provided"}</strong>
              <small>{profile.is_research_track ? "Research Track" : "Applied / Coursework Track"}</small>
            </div>
          </div>
          {chips.length > 0 && (
            <div className="chip-row">
              {chips.map((chip) => (
                <span key={chip}>{chip}</span>
              ))}
            </div>
          )}
        </div>
        <div className="score-panel">
          <span>PROFILE STRENGTH</span>
          <ScoreRing score={score} />
          <strong>{strengthLabel}</strong>
          <p>Global scholarship readiness</p>
          <div className="score-progress">
            <i style={{ width: `${score}%` }} />
          </div>
          <small>Action plan can raise score +10–15 pts</small>
        </div>
      </section>

      <div className="diagnostic-grid">
        <section className="diagnostic gap-card">
          <div className="section-heading">
            <div className="section-icon danger">!</div>
            <div>
              <span>PRIORITY AREAS</span>
              <h3>Critical gap analysis</h3>
            </div>
            <b>{gapList.length} gap{gapList.length === 1 ? "" : "s"}</b>
          </div>
          <div className="gap-list">
            {gapList.map((gap, idx) => (
              <div key={`${gap.title}-${idx}`}>
                <i />
                <p>
                  <strong>{gap.title}</strong>
                  <span>{gap.detail}</span>
                </p>
                <small>{gap.severity}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="diagnostic roadmap-card">
          <div className="section-heading">
            <div className="section-icon success">
              <Icon name="target" size={18} />
            </div>
            <div>
              <span>NEXT 6 MONTHS</span>
              <h3>Your improvement roadmap</h3>
            </div>
            <b>
              {completedCount}/{roadmapList.length}
            </b>
          </div>
          <div className="roadmap-list">
            {roadmapList.map((step, index) => {
              const checked = isStepChecked(index);
              return (
                <button
                  type="button"
                  key={`${step.title}-${index}`}
                  disabled={isArchived}
                  onClick={() => toggleStep(index)}
                >
                  <i className={checked ? "checked" : ""}>
                    {checked && <Icon name="check" size={14} />}
                  </i>
                  <span>
                    <small>{step.timeframe}</small>
                    <strong>{step.title}</strong>
                    <p>{step.detail}</p>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <section className="matches-section">
        <div className="matches-heading">
          <div>
            <p className="eyebrow">Recommended for you</p>
            <h2>Your top scholarship matches</h2>
            <p>Ranked from 370+ curated international opportunities using field alignment, GPA fit, and funding scope.</p>
          </div>
          <div className="matches-actions">
            <button type="button" onClick={() => onNavigate("tracker")}>
              Open full 371 tracker <Icon name="calendar" size={15} />
            </button>
            <button type="button" onClick={() => onNavigate("study")}>
              Open capability studio <Icon name="arrow" size={16} />
            </button>
          </div>
        </div>

        <div className="scholarship-list">
          {matches.map((item) => {
            const pct = parseMatchPct(item);
            const noBond = (item.bond || "").toLowerCase() === "none";
            const flagCode = item.country_code || item.country.slice(0, 2).toUpperCase();
            return (
              <article className="scholarship-card" key={`${item.rank}-${item.name}`}>
                <div className="rank">#{item.rank}</div>
                <div className="flag">{flagCode}</div>
                <div className="scholarship-info">
                  <div>
                    <h3>{item.name}</h3>
                    <span>{item.country}</span>
                  </div>
                  <p>{item.note}</p>
                  <div className="scholarship-meta">
                    <span>
                      <Icon name="clock" size={14} /> {item.deadline_month || "Annual"}
                    </span>
                    <span>GPA {item.gpa_min || "Varies"}</span>
                    <span className={noBond ? "green" : ""}>
                      {noBond ? "No bond" : item.bond}
                    </span>
                  </div>
                </div>
                <div className="match-score">
                  <span>PROFILE MATCH</span>
                  <strong>{pct}%</strong>
                  <div>
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="portal-link"
                    >
                      Official portal <Icon name="external" size={14} />
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <div className="studio-cta">
          <div className="cta-icon">
            <Icon name="sparkle" />
          </div>
          <div>
            <strong>Go deeper than the shortlist</strong>
            <p>
              Generate a tailored SOP, verify live deadlines, discover aligned professors, or map
              your career roadmap on demand.
            </p>
          </div>
          <button type="button" onClick={() => onNavigate("study")}>
            Open study abroad studio <Icon name="arrow" size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}
