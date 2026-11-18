import { useState } from "react";
import { Icon } from "@/components/Icon";
import type { CapabilityName, CapabilityStatus, JobStatusResponse } from "@/types/api";

export interface CapabilityDef {
  id: CapabilityName;
  icon: string;
  title: string;
  description: string;
  speed: string;
}

export const CAPABILITY_GROUPS: Record<"study" | "career" | "local", CapabilityDef[]> = {
  study: [
    {
      id: "sop_draft",
      icon: "✦",
      title: "Statement of Purpose Architect",
      description: "Build a publication-ready SOP tailored to your target program.",
      speed: "~5s Fast AI",
    },
    {
      id: "sop_review",
      icon: "◎",
      title: "Admissions Rubric Evaluator",
      description: "Score your SOP against a 25-point admissions rubric with fixes.",
      speed: "~4s Fast AI",
    },
    {
      id: "scholarship_analysis",
      icon: "◇",
      title: "Scholarship Fit & Gap Matrix",
      description: "Deep eligibility analysis, PKR estimates & gaps per matched scholarship.",
      speed: "~6s Fast AI",
    },
    {
      id: "deadline_verification",
      icon: "◷",
      title: "Live Deadline Auditor",
      description: "Verify current deadlines against official portals & web search.",
      speed: "~15s Web Search",
    },
    {
      id: "faculty_outreach",
      icon: "⌁",
      title: "Professor Matcher & Cold Email",
      description: "Find aligned faculty labs and compose thoughtful outreach.",
      speed: "~15s Research",
    },
    {
      id: "research_proposal",
      icon: "¶",
      title: "Research Proposal Studio",
      description: "Surface niche ArXiv trends & author a structured proposal.",
      speed: "~18s ArXiv",
    },
  ],
  career: [
    {
      id: "career_paths",
      icon: "↗",
      title: "Digital Career Mapper",
      description: "Discover five high-growth digital roles with PKR entry salaries.",
      speed: "~3s Fast AI",
    },
    {
      id: "learning_roadmap",
      icon: "▶",
      title: "12-Week Learning Syllabus",
      description: "Turn skill gaps into a weekly curriculum with verified YouTube links.",
      speed: "~15s YouTube",
    },
    {
      id: "freelance_pack",
      icon: "▱",
      title: "Upwork & Fiverr Launchpad",
      description: "Build your bio, PKR-priced gigs, and a 14-day portfolio sprint.",
      speed: "~5s Fast AI",
    },
    {
      id: "academia_vs_industry",
      icon: "⇄",
      title: "PhD vs Industry Strategist",
      description: "Compare paths, opportunity costs, and recommended universities.",
      speed: "~4s Fast AI",
    },
  ],
  local: [
    {
      id: "local_ecosystem",
      icon: "⌂",
      title: "Pakistan Startup, Grant & Community Hub",
      description: "Find incubators, Ignite/HEC grants, and communities aligned with your goals.",
      speed: "~15s Web Search",
    },
  ],
};

const STUDIO_HEADERS: Record<"study" | "career" | "local", [string, string, string]> = {
  study: [
    "Study abroad & research",
    "Turn your profile into a standout application",
    "Generate each asset independently. Your work stays saved as you move between tools.",
  ],
  career: [
    "Career & freelance",
    "Build a career path grounded in your strengths",
    "Explore roles, close skill gaps, and create a market-ready freelance presence.",
  ],
  local: [
    "Local ecosystem",
    "Connect with opportunities closer to home",
    "Find credible accelerators, grants, and active technology communities across Pakistan.",
  ],
};

export function StudioView({
  type,
  job,
  activeStates,
  onTrigger,
  onOpenResult,
}: {
  type: "study" | "career" | "local";
  job: JobStatusResponse;
  activeStates: Record<string, { status: CapabilityStatus; error?: string }>;
  onTrigger: (cap: CapabilityName, options?: { custom_notes?: string; sop_text?: string }) => void;
  onOpenResult: (cap: CapabilityName, title: string) => void;
}) {
  const [showCustomSop, setShowCustomSop] = useState(false);
  const [customSopText, setCustomSopText] = useState("");
  const cards = CAPABILITY_GROUPS[type];
  const [eyebrow, heading, subtitle] = STUDIO_HEADERS[type];

  const hasSopDraft =
    activeStates["sop_draft"]?.status === "completed" ||
    job.capability_states["sop_draft"]?.status === "completed" ||
    Boolean(job.results.sop_draft);

  return (
    <div className="page">
      <div className="studio-header">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{heading}</h1>
        <p>{subtitle}</p>
      </div>

      <div className={`capability-grid ${type === "local" ? "single" : ""}`}>
        {cards.map((card) => {
          const live = activeStates[card.id];
          const dbState = job.capability_states[card.id];
          const hasResult = Boolean(job.results[card.id]);
          const status: CapabilityStatus =
            live?.status ||
            (dbState?.status as CapabilityStatus | undefined) ||
            (hasResult ? "completed" : "not_started");
          const errorMsg = live?.error || dbState?.error_message || "";

          const isReviewBlocked = card.id === "sop_review" && !hasSopDraft && !customSopText.trim();

          return (
            <article className={`capability-card ${status}`} key={card.id}>
              <div className="cap-top">
                <span>{card.icon}</span>
                <small>{card.speed}</small>
              </div>
              <h2>{card.title}</h2>
              <p>{card.description}</p>

              {card.id === "sop_review" && (
                <div className="sop-review-hint">
                  <button
                    type="button"
                    className="link-subtle"
                    onClick={() => setShowCustomSop((v) => !v)}
                  >
                    {showCustomSop
                      ? "Hide custom SOP box"
                      : hasSopDraft
                        ? "Score generated SOP or paste custom text"
                        : "Paste custom SOP text to score"}
                  </button>
                  {showCustomSop && (
                    <textarea
                      className="mini-textarea"
                      rows={4}
                      value={customSopText}
                      onChange={(e) => setCustomSopText(e.target.value)}
                      placeholder="Paste your SOP draft here to evaluate it against the 25-point rubric..."
                    />
                  )}
                </div>
              )}

              {status === "queued" || status === "running" ? (
                <div className="generating">
                  <i />
                  <span>
                    <b>{status === "queued" ? "Queued in worker" : "Working on it"}</b>
                    {status === "queued"
                      ? "Waiting for worker slot..."
                      : "Searching sources & structuring output..."}
                  </span>
                </div>
              ) : status === "completed" ? (
                <div className="complete-row">
                  <span>
                    <Icon name="check" size={14} /> Ready to review
                  </span>
                  <button type="button" onClick={() => onOpenResult(card.id, card.title)}>
                    Open result <Icon name="arrow" size={15} />
                  </button>
                </div>
              ) : status === "failed" ? (
                <div className="failed-row">
                  <span>{errorMsg || "Execution failed"}</span>
                  <button
                    type="button"
                    className="generate-button"
                    onClick={() =>
                      onTrigger(
                        card.id,
                        card.id === "sop_review" && customSopText.trim()
                          ? { sop_text: customSopText }
                          : undefined,
                      )
                    }
                  >
                    <Icon name="refresh" size={15} /> Retry
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="generate-button"
                  disabled={isReviewBlocked}
                  title={
                    isReviewBlocked
                      ? "Generate an SOP draft first or paste custom SOP text above"
                      : undefined
                  }
                  onClick={() =>
                    onTrigger(
                      card.id,
                      card.id === "sop_review" && customSopText.trim()
                        ? { sop_text: customSopText }
                        : undefined,
                    )
                  }
                >
                  <Icon name="sparkle" size={16} />{" "}
                  {isReviewBlocked ? "Draft or paste SOP first" : "Generate"}
                </button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
