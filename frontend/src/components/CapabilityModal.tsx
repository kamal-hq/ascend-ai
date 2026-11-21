import { useState } from "react";
import { exportDocx } from "@/api/client";
import { Icon } from "@/components/Icon";
import type {
  AcademiaVsIndustryResult,
  CapabilityName,
  CareerPathsResult,
  DeadlineVerificationResult,
  FacultyOutreachResult,
  FreelancePackResult,
  LearningRoadmapResult,
  LocalEcosystemResult,
  ResearchProposalResult,
  ScholarshipAnalysisResult,
  SopDraftResult,
  SopReviewResult,
} from "@/types/api";

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="drawer-action"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : label}
    </button>
  );
}

export function CapabilityModal({
  capability,
  title,
  data,
  isArchived = false,
  onClose,
  onRegenerate,
}: {
  capability: CapabilityName;
  title: string;
  data: unknown;
  isArchived?: boolean;
  onClose: () => void;
  onRegenerate: () => void;
}) {
  const [downloading, setDownloading] = useState(false);

  const handleDocx = async (docTitle: string, content: string, filename: string) => {
    setDownloading(true);
    try {
      await exportDocx(docTitle, content, filename);
    } finally {
      setDownloading(false);
    }
  };

  const renderBody = () => {
    if (!data || typeof data !== "object") {
      return <p className="drawer-empty">No structured output available.</p>;
    }

    if (capability === "sop_draft") {
      const d = data as SopDraftResult;
      const fullText = d.full_text || (d.paragraphs || []).join("\n\n");
      return (
        <div className="drawer-sections">
          <div className="drawer-toolbar">
            <span className="pill">{d.word_count} words</span>
            <span className="pill">{d.target_context}</span>
            <div className="toolbar-right">
              <CopyBtn text={fullText} label="Copy SOP" />
              <button
                type="button"
                className="drawer-action primary"
                disabled={downloading}
                onClick={() =>
                  void handleDocx(
                    d.title || "Statement of Purpose",
                    fullText,
                    "statement-of-purpose.docx",
                  )
                }
              >
                <Icon name="download" size={14} /> {downloading ? "Exporting…" : "Download .docx"}
              </button>
            </div>
          </div>
          {d.key_themes?.length > 0 && (
            <div className="chip-row">
              {d.key_themes.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          )}
          <div className="essay-surface">
            <h3>{d.title}</h3>
            {(d.paragraphs?.length ? d.paragraphs : fullText.split("\n\n")).map((p, idx) => (
              <p key={idx}>{p}</p>
            ))}
          </div>
        </div>
      );
    }

    if (capability === "sop_review") {
      const d = data as SopReviewResult;
      return (
        <div className="drawer-sections">
          <div className="score-banner">
            <div>
              <span>ADMISSIONS RUBRIC SCORE</span>
              <strong>
                {d.total_score} <em>/ {d.max_score || 25}</em>
              </strong>
            </div>
            <p>{d.summary}</p>
          </div>
          <div className="criteria-list">
            {(d.criteria || []).map((c) => (
              <div className="criterion-row" key={c.name}>
                <div className="criterion-head">
                  <strong>{c.name}</strong>
                  <span>
                    {c.score}/{c.max_score}
                  </span>
                </div>
                <div className="criterion-bar">
                  <i style={{ width: `${Math.min(100, (c.score / (c.max_score || 5)) * 100)}%` }} />
                </div>
                <p>{c.comment}</p>
              </div>
            ))}
          </div>
          <div className="tips-block">
            <h4>3 High-Impact Revisions</h4>
            {(d.revision_tips || []).map((tip, i) => (
              <div className="tip-card" key={i}>
                <strong>
                  {i + 1}. {tip.title}
                </strong>
                <p>{tip.action}</p>
                {tip.example_fix && <blockquote>{tip.example_fix}</blockquote>}
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (capability === "scholarship_analysis") {
      const d = data as ScholarshipAnalysisResult;
      return (
        <div className="drawer-sections">
          <div className="drawer-callout">
            <span className="pill">1 USD = Rs. {Number(d.exchange_rate_used || 278.5).toFixed(2)}</span>
            <p>{d.overall_summary}</p>
          </div>
          <div className="subcards">
            {(d.analyses || []).map((item) => (
              <article className="subcard" key={item.scholarship_name}>
                <div className="subcard-head">
                  <div>
                    <strong>
                      #{item.rank} {item.scholarship_name}
                    </strong>
                    <small>{item.country}</small>
                  </div>
                  <span className={`status-pill ${item.eligibility_status.toLowerCase()}`}>
                    {item.eligibility_status}
                  </span>
                </div>
                <p>{item.fit_rationale}</p>
                <p className="meta-line">
                  <b>PKR Value:</b> {item.stipend_pkr_estimate}
                </p>
                {item.missing_gaps?.length > 0 && (
                  <p className="meta-line warn">
                    <b>Missing Gaps:</b> {item.missing_gaps.join(" · ")}
                  </p>
                )}
                <p className="meta-line">
                  <b>Next Action:</b> {item.next_action}
                </p>
              </article>
            ))}
          </div>
        </div>
      );
    }

    if (capability === "deadline_verification") {
      const d = data as DeadlineVerificationResult;
      return (
        <div className="drawer-sections">
          <p className="drawer-callout">{d.summary}</p>
          <div className="subcards">
            {(d.verifications || []).map((v) => (
              <article className="subcard" key={v.scholarship_name}>
                <div className="subcard-head">
                  <div>
                    <strong>{v.scholarship_name}</strong>
                    <small>Verified Deadline: {v.verified_deadline}</small>
                  </div>
                  <span className={`status-pill ${v.cycle_status.toLowerCase()}`}>
                    {v.cycle_status}
                  </span>
                </div>
                <p>{v.source_snippet}</p>
                {v.checked_note && <p className="meta-line">{v.checked_note}</p>}
                {v.source_url && (
                  <a href={v.source_url} target="_blank" rel="noopener noreferrer" className="ext-link">
                    Verify official source <Icon name="external" size={13} />
                  </a>
                )}
              </article>
            ))}
          </div>
        </div>
      );
    }

    if (capability === "faculty_outreach") {
      const d = data as FacultyOutreachResult;
      const emailFull = `Subject: ${d.cold_email?.subject || ""}\n\n${d.cold_email?.body || ""}`;
      return (
        <div className="drawer-sections">
          <div className="subcards">
            {(d.professors || []).map((prof) => (
              <article className="subcard" key={prof.name}>
                <div className="subcard-head">
                  <div>
                    <strong>{prof.name}</strong>
                    <small>
                      {prof.university} {prof.department ? `· ${prof.department}` : ""}
                    </small>
                  </div>
                  {prof.lab_name && <span className="pill">{prof.lab_name}</span>}
                </div>
                <p>{prof.research_focus}</p>
                <p className="meta-line">
                  <b>Why you match:</b> {prof.relevance_to_student}
                </p>
              </article>
            ))}
          </div>
          {d.cold_email && (
            <div className="email-box">
              <div className="drawer-toolbar">
                <strong>Cold Email Draft ({d.cold_email.word_count} words)</strong>
                <CopyBtn text={emailFull} label="Copy Email" />
              </div>
              <p className="email-subject">
                <b>Subject:</b> {d.cold_email.subject}
              </p>
              <pre className="email-body">{d.cold_email.body}</pre>
            </div>
          )}
        </div>
      );
    }

    if (capability === "research_proposal") {
      const d = data as ResearchProposalResult;
      const fullProposal = [
        d.title,
        `Introduction\n${d.introduction}`,
        `Objectives\n${(d.objectives || []).map((o, i) => `${i + 1}. ${o}`).join("\n")}`,
        `Literature Gap\n${d.literature_gap}`,
        `Methodology\n${d.methodology}`,
        `Expected Contributions\n${(d.expected_contributions || []).map((c) => `- ${c}`).join("\n")}`,
      ].join("\n\n");
      return (
        <div className="drawer-sections">
          <div className="drawer-toolbar">
            <span className="pill">ArXiv-Grounded Proposal</span>
            <div className="toolbar-right">
              <CopyBtn text={fullProposal} label="Copy Text" />
              <button
                type="button"
                className="drawer-action primary"
                disabled={downloading}
                onClick={() => void handleDocx(d.title, fullProposal, "research-proposal.docx")}
              >
                <Icon name="download" size={14} /> {downloading ? "Exporting…" : "Download .docx"}
              </button>
            </div>
          </div>
          {d.trends?.length > 0 && (
            <div className="subcards">
              {d.trends.map((tr) => (
                <article className="subcard" key={tr.domain}>
                  <strong>{tr.domain}</strong>
                  <p>{tr.explanation}</p>
                  <p className="meta-line">{tr.relevance}</p>
                </article>
              ))}
            </div>
          )}
          <div className="essay-surface">
            <h3>{d.title}</h3>
            <h4>1. Introduction</h4>
            <p>{d.introduction}</p>
            <h4>2. Research Objectives</h4>
            <ul>
              {(d.objectives || []).map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
            <h4>3. Literature Gap</h4>
            <p>{d.literature_gap}</p>
            <h4>4. Methodology</h4>
            <p>{d.methodology}</p>
            <h4>5. Expected Contributions</h4>
            <ul>
              {(d.expected_contributions || []).map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
            {d.timeline?.length > 0 && (
              <>
                <h4>6. Timeline</h4>
                <div className="timeline-table">
                  {d.timeline.map((row, idx) => (
                    <div key={idx}>
                      <b>{row.phase}</b>
                      <span>{row.duration}</span>
                      <p>{row.milestone}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      );
    }

    if (capability === "career_paths") {
      const d = data as CareerPathsResult;
      return (
        <div className="drawer-sections">
          <p className="drawer-callout">{d.summary}</p>
          <div className="subcards">
            {(d.roles || []).map((role) => (
              <article className="subcard" key={role.title}>
                <div className="subcard-head">
                  <strong>{role.title}</strong>
                  <span className="pill mono">{role.entry_pkr_monthly} PKR/mo</span>
                </div>
                <p>{role.match_reason}</p>
                <div className="chip-row">
                  {(role.required_skills || []).map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
                {role.skill_gaps?.length > 0 && (
                  <p className="meta-line warn">
                    <b>Gaps to close:</b> {role.skill_gaps.join(", ")}
                  </p>
                )}
              </article>
            ))}
          </div>
        </div>
      );
    }

    if (capability === "learning_roadmap") {
      const d = data as LearningRoadmapResult;
      return (
        <div className="drawer-sections">
          <div className="drawer-toolbar">
            <span className="pill">{d.target_field}</span>
            <span className="pill">Level: {d.skill_level}</span>
          </div>
          <div className="subcards">
            {(d.weeks || []).map((w) => (
              <article className="subcard" key={w.week_number}>
                <div className="subcard-head">
                  <strong>
                    Week {w.week_number}: {w.topic}
                  </strong>
                  <span className="pill">{w.duration_hours_est}</span>
                </div>
                <p>{w.milestone}</p>
                {w.video_url && (
                  <a href={w.video_url} target="_blank" rel="noopener noreferrer" className="ext-link">
                    ▶ {w.video_title || w.video_url} <Icon name="external" size={13} />
                  </a>
                )}
              </article>
            ))}
          </div>
        </div>
      );
    }

    if (capability === "freelance_pack") {
      const d = data as FreelancePackResult;
      return (
        <div className="drawer-sections">
          <div className="email-box">
            <div className="drawer-toolbar">
              <strong>Upwork Profile Bio ({d.upwork_bio_word_count} words)</strong>
              <CopyBtn text={d.upwork_bio} label="Copy Bio" />
            </div>
            <p className="bio-text">{d.upwork_bio}</p>
          </div>
          <div className="subcards">
            {(d.fiverr_gigs || []).map((gig) => (
              <article className="subcard" key={gig.title}>
                <div className="subcard-head">
                  <strong>{gig.title}</strong>
                  <span className="pill mono">{gig.starting_price_pkr}</span>
                </div>
                <ul className="compact-list">
                  {(gig.deliverables || []).map((del, i) => (
                    <li key={i}>{del}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          {d.portfolio_project && (
            <article className="subcard highlight">
              <strong>14-Day Portfolio Sprint: {d.portfolio_project.title}</strong>
              <p>{d.portfolio_project.problem_statement}</p>
              <div className="chip-row">
                {(d.portfolio_project.tech_stack || []).map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <ul className="compact-list">
                {(d.portfolio_project.milestones || []).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </article>
          )}
        </div>
      );
    }

    if (capability === "academia_vs_industry") {
      const d = data as AcademiaVsIndustryResult;
      return (
        <div className="drawer-sections">
          <div className="drawer-callout">
            <span className="pill">Verdict: {d.verdict}</span>
            <p>{d.analysis_summary}</p>
          </div>
          <div className="two-col">
            <article className="subcard">
              <strong>Academia / PhD Track</strong>
              <p>{d.academia_pros_cons}</p>
            </article>
            <article className="subcard">
              <strong>Industry Track</strong>
              <p>{d.industry_pros_cons}</p>
            </article>
          </div>
          <div className="subcards">
            {(d.recommended_universities || []).map((u) => (
              <article className="subcard" key={u.name}>
                <div className="subcard-head">
                  <strong>{u.name}</strong>
                  <span className="pill">{u.country}</span>
                </div>
                <p className="meta-line">
                  <b>Program:</b> {u.program}
                </p>
                <p>{u.why_fit}</p>
              </article>
            ))}
          </div>
        </div>
      );
    }

    if (capability === "local_ecosystem") {
      const d = data as LocalEcosystemResult;
      return (
        <div className="drawer-sections">
          <p className="drawer-callout">{d.summary}</p>
          <h4>Incubators &amp; Accelerators</h4>
          <div className="subcards">
            {(d.incubators || []).map((inc) => (
              <article className="subcard" key={inc.name}>
                <div className="subcard-head">
                  <strong>{inc.name}</strong>
                  <span className="pill">{inc.city}</span>
                </div>
                <p>{inc.why_fit}</p>
                {inc.url && (
                  <a href={inc.url} target="_blank" rel="noopener noreferrer" className="ext-link">
                    Portal <Icon name="external" size={13} />
                  </a>
                )}
              </article>
            ))}
          </div>
          <h4>Funding Grants</h4>
          <div className="subcards">
            {(d.grants || []).map((g) => (
              <article className="subcard" key={g.name}>
                <div className="subcard-head">
                  <strong>{g.name}</strong>
                  <span className="pill">{g.provider}</span>
                </div>
                <p>{g.funding_focus}</p>
                {g.url && (
                  <a href={g.url} target="_blank" rel="noopener noreferrer" className="ext-link">
                    Details <Icon name="external" size={13} />
                  </a>
                )}
              </article>
            ))}
          </div>
          <h4>Active Tech Communities</h4>
          <div className="subcards">
            {(d.communities || []).map((c) => (
              <article className="subcard" key={c.name}>
                <div className="subcard-head">
                  <strong>{c.name}</strong>
                  <span className="pill">{c.platform_or_city}</span>
                </div>
                <p>{c.focus}</p>
              </article>
            ))}
          </div>
        </div>
      );
    }

    return <pre className="email-body">{JSON.stringify(data, null, 2)}</pre>;
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <section className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <p className="eyebrow">Capability Output</p>
            <h2>{title}</h2>
          </div>
          <div className="drawer-header-actions">
            {isArchived ? (
              <span className="pill">Read-only archive</span>
            ) : (
              <button type="button" className="drawer-action" onClick={onRegenerate}>
                <Icon name="refresh" size={14} /> Regenerate
              </button>
            )}
            <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </div>
        </header>
        <div className="drawer-body">{renderBody()}</div>
      </section>
    </div>
  );
}
