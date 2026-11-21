import { useRef, useState } from "react";
import { parseCvPdf } from "@/api/client";
import { Icon } from "@/components/Icon";

const SAMPLE_PROFILE =
  "Sara Ahmed — BS Software Engineering, NUST Islamabad (2025), CGPA 3.58. " +
  "1 year experience as Junior Machine Learning Engineer (internship + part-time) building " +
  "medical image classifiers and Python/FastAPI microservices. Led Women in Computing chapter (120 members). " +
  "Targeting fully funded MS Artificial Intelligence programs in Germany and the UK (DAAD EPOS, Chevening, Erasmus Mundus). " +
  "Long-term goal: Healthcare AI research and engineering leadership.";

export interface EagerProgressState {
  active: boolean;
  jobId: string | null;
  contextDone: boolean;
  profileDone: boolean;
  ragDone: boolean;
  error: string | null;
}

export function IntakeView({
  onAnalyze,
  eagerProgress,
  onOpenPrivacy,
}: {
  onAnalyze: (inputText: string) => Promise<void>;
  eagerProgress: EagerProgressState;
  onOpenPrivacy: () => void;
}) {
  const [method, setMethod] = useState<"notes" | "cv">("notes");
  const [text, setText] = useState("");
  const [cvBusy, setCvBusy] = useState(false);
  const [cvNotice, setCvNotice] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCvFile = async (file: File | undefined) => {
    if (!file) return;
    setCvBusy(true);
    setNotice(null);
    try {
      const res = await parseCvPdf(file);
      setText(res.text);
      setCvNotice(`${res.filename} · ${res.page_count} page(s) · ${res.char_count} chars extracted`);
      setMethod("notes");
      setNotice({
        kind: "ok",
        message: `Parsed ${res.filename}. Review or edit your extracted CV text below, then click Analyze.`,
      });
    } catch (err) {
      setNotice({
        kind: "err",
        message: err instanceof Error ? err.message : "Could not parse PDF.",
      });
    } finally {
      setCvBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (!text.trim()) {
      setNotice({ kind: "err", message: "Provide your background notes or upload a PDF CV first." });
      return;
    }
    setNotice(null);
    await onAnalyze(text);
  };

  return (
    <div className="page intake-page">
      <div className="intake-hero">
        <div className="intake-badge">
          <Icon name="sparkle" size={16} /> AI-POWERED OPPORTUNITY ANALYSIS
        </div>
        <h1>
          Your ambition deserves
          <br />
          <em>a clearer path.</em>
        </h1>
        <p>
          Share your background or upload a CV to get a focused profile score, gap analysis,
          six-month roadmap, and matched scholarships in seconds.
        </p>
      </div>

      <section className="intake-card">
        <div className="method-tabs">
          {(
            [
              ["notes", "Write or paste"],
              ["cv", "Upload CV (PDF)"],
            ] as const
          ).map(([id, label]) => (
            <button
              className={method === id ? "active" : ""}
              onClick={() => setMethod(id)}
              key={id}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        {notice && (
          <div className={`inline-banner ${notice.kind}`}>
            <Icon name={notice.kind === "ok" ? "check" : "alert"} size={15} />
            <span>{notice.message}</span>
          </div>
        )}

        {method === "notes" && (
          <>
            <div className="textarea-label">
              <label>Your academic and career background</label>
              <button
                type="button"
                onClick={() => {
                  setText(SAMPLE_PROFILE);
                  setNotice(null);
                }}
              >
                <Icon name="sparkle" size={14} /> Load sample profile
              </button>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Include your degree, university, CGPA, skills, experience, target programs, countries, and long-term goals…"
              disabled={eagerProgress.active}
            />
            <div className="input-hint">
              <span>
                {text.length} characters {cvNotice ? `(${cvNotice})` : ""}
              </span>
              <span>Tip: more context creates sharper recommendations.</span>
            </div>
          </>
        )}

        {method === "cv" && (
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void handleCvFile(e.dataTransfer.files?.[0]);
            }}
          >
            <div>
              <Icon name="book" size={25} />
            </div>
            <strong>{cvBusy ? "Extracting CV text…" : "Drop your CV here, or browse"}</strong>
            <p>PDF up to 10MB · Extracted text opens for review before analysis</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onChange={(e) => void handleCvFile(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={cvBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              {cvBusy ? "Parsing…" : "Choose PDF"}
            </button>
          </div>
        )}

        {eagerProgress.active ? (
          <div className="eager-stepper">
            <div className="stepper-head">
              <strong>Analyzing Profile &amp; Matching Scholarships</strong>
              <span>Live SSE progress · job {eagerProgress.jobId?.slice(0, 8)}</span>
            </div>
            <div className="stepper-items">
              <div className={eagerProgress.contextDone ? "done" : "pending"}>
                <i /> Fetching live USD → PKR exchange rate
              </div>
              <div className={eagerProgress.profileDone ? "done" : "pending"}>
                <i /> Extracting profile score, critical gaps &amp; 6-month roadmap
              </div>
              <div className={eagerProgress.ragDone ? "done" : "pending"}>
                <i /> Matching against 370+ curated international scholarships
              </div>
            </div>
            {eagerProgress.error && <p className="stepper-error">{eagerProgress.error}</p>}
          </div>
        ) : (
          <button
            className="analyze-button"
            type="button"
            onClick={() => void handleSubmit()}
          >
            Analyze profile &amp; match scholarships <Icon name="arrow" />
          </button>
        )}

        <div className="privacy-note">
          <span>Private &amp; on-device</span>Your CV insights, matches, and SOPs save automatically
          in this browser — never in a shared database.{" "}
          <button type="button" className="privacy-link-btn" onClick={onOpenPrivacy}>
            How data works
          </button>
        </div>
      </section>

      <div className="intake-benefits">
        <div>
          <span>01</span>
          <strong>Profile score</strong>
          <p>See where you stand today.</p>
        </div>
        <div>
          <span>02</span>
          <strong>Priority roadmap</strong>
          <p>Know what to improve next.</p>
        </div>
        <div>
          <span>03</span>
          <strong>Scholarship match</strong>
          <p>Focus on your best-fit options.</p>
        </div>
      </div>
    </div>
  );
}
