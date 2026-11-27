import { useState } from "react";
import { Icon } from "@/components/Icon";

export type LegalDoc = "privacy" | "terms";

const CONTACT_EMAIL = "muhammad.kamal.hq@gmail.com";
const EFFECTIVE_DATE = "November 27, 2026";

export function LegalView({
  doc,
  sessionCount,
  onSwitchDoc,
  onBack,
  onClearAllLocal,
}: {
  doc: LegalDoc;
  sessionCount: number;
  onSwitchDoc: (next: LegalDoc) => void;
  onBack: () => void;
  onClearAllLocal: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="page legal-page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Legal &amp; Compliance · Effective {EFFECTIVE_DATE}</p>
          <h1>{doc === "privacy" ? "Privacy Policy" : "Terms of Service"}</h1>
          <p>
            {doc === "privacy"
              ? "How Ascend AI handles your CV text, notes, browser storage, temporary server compute, and third-party AI processing."
              : "Acceptable use, AI advisory disclaimers, and service terms for using Ascend AI."}
          </p>
        </div>
        <button type="button" className="outline-button" onClick={onBack}>
          <Icon name="arrow" size={15} /> Back to workspace
        </button>
      </div>

      <div className="legal-tabs" role="tablist" aria-label="Legal documents">
        <button
          type="button"
          role="tab"
          aria-selected={doc === "privacy"}
          className={doc === "privacy" ? "active" : ""}
          onClick={() => onSwitchDoc("privacy")}
        >
          Privacy Policy
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={doc === "terms"}
          className={doc === "terms" ? "active" : ""}
          onClick={() => onSwitchDoc("terms")}
        >
          Terms of Service
        </button>
      </div>

      {doc === "privacy" ? (
        <article className="legal-card">
          <section className="legal-section">
            <h2>1. No User Accounts &amp; Browser-Only Isolation</h2>
            <p>
              Ascend AI operates without user accounts, passwords, or a permanent multi-user
              database. On your first visit, your browser generates a random workspace identifier
              (<code>ascend.client_id</code>) stored in <code>localStorage</code>.{" "}
              <strong>
                This random browser ID is the only mechanism separating one user&apos;s workspace
                data from another&apos;s.
              </strong>{" "}
              If you clear your browser storage, use private browsing, or switch devices without
              first saving a <code>.json</code> backup, you will lose access to your previously
              saved sessions.
            </p>
          </section>

          <section className="legal-section">
            <h2>2. Information We Process</h2>
            <ul>
              <li>
                <strong>Profile &amp; Application Inputs:</strong> Background notes, uploaded PDF CV
                text (extracted in memory up to 10 MB / 25 pages / 50,000 characters), custom SOP
                drafts, scholarship tracker statuses, notes/comments, and custom tasks you create.
                Uploaded CV files may contain personal contact details (such as your name, email
                address, phone number, or home address).
              </li>
              <li>
                <strong>Local Browser State:</strong> Saved analysis snapshots, random workspace ID,
                visit timestamps/streak counters, and notification read/dismiss state stored solely
                in your browser&apos;s <code>localStorage</code>.
              </li>
              <li>
                <strong>Operational Request Metadata:</strong> IP address (used strictly in memory
                for hourly rate limiting and standard Render/Vercel HTTP infrastructure logs).
              </li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>3. Third-Party Processors (Groq &amp; Public Discovery)</h2>
            <ul>
              <li>
                <strong>Groq (AI Inference — api.groq.com):</strong> When you analyze a profile,
                re-analyze, or generate any Studio capability, your{" "}
                <strong>CV text, profile notes, and SOP text are sent to Groq</strong> for AI
                processing. Because CV files may contain personal contact details, remove any
                sensitive details you prefer not to share with Groq before submitting.
              </li>
              <li>
                <strong>Public Search &amp; Reference Services:</strong> Optional on-demand features
                may send derived, non-identifying search queries (scrubbed of email addresses and
                phone numbers) to <strong>DuckDuckGo</strong>, <strong>ArXiv</strong>, and{" "}
                <strong>YouTube</strong>, fetch public scholarship portal webpages during Deadline
                Verification, and fetch daily USD-to-PKR exchange rates from{" "}
                <strong>Open ExchangeRate API (open.er-api.com)</strong>.
              </li>
              <li>
                <strong>Hosting &amp; Self-Hosted Fonts:</strong> Frontend assets are served via
                Vercel and API compute runs on Render. The <code>Lexend</code> typeface is
                self-hosted directly from this application; no third-party font CDN is contacted.
              </li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>4. Retention, Ephemeral Server Storage &amp; Shared 7-Day Cache</h2>
            <ul>
              <li>
                <strong>Your Device:</strong> Snapshots and preferences remain in your browser&apos;s{" "}
                <code>localStorage</code> until you delete individual sessions or clear your device
                history.
              </li>
              <li>
                <strong>Temporary Server Database:</strong> Active jobs are stored in a temporary
                SQLite database (<code>data/ascend.db</code>) on our free-tier Render instance only
                to execute live requests and SSE streams.{" "}
                <strong>Server data is temporary and resets automatically on container restarts,
                idle sleep, or redeploys.</strong>
              </li>
              <li>
                <strong>Shared Public Search Cache (7-Day TTL):</strong> A separate server cache (
                <code>data/cache.db</code>) stores <em>only</em> public web search, ArXiv, YouTube,
                scholarship portal text, and exchange-rate responses keyed by a SHA-256 query hash
                (no raw queries and no student job records or profile content are stored). Entries
                expire after <strong>7 days</strong> (24 hours for exchange rates), or sooner when
                the free-tier server restarts. No client can access another client&apos;s job
                content through this cache.
              </li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>5. Cookies &amp; Analytics</h2>
            <p>
              Ascend AI sets <strong>no advertising, tracking, or analytics cookies</strong> and
              loads no third-party analytics scripts. Browser <code>localStorage</code> is used
              solely to provide core local-first workspace persistence and notifications.
            </p>
          </section>

          <section className="legal-section">
            <h2>6. Children&apos;s Privacy</h2>
            <p>
              Ascend AI is intended for university and graduate applicants and is{" "}
              <strong>not directed at children under 13</strong>. We do not knowingly collect
              personal data from children under 13. If you believe a child under 13 submitted data,
              contact{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="legal-link">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>

          <section className="legal-section">
            <h2>7. Your Rights &amp; How to Delete Your Data</h2>
            <p>
              You can delete individual profile threads anytime from the sidebar, or wipe all
              locally stored workspace data and active server rows immediately below. For privacy
              questions or manual deletion requests regarding active server memory, email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="legal-link">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
            <div className="legal-delete-box">
              <div>
                <strong>Instant in-app data deletion</strong>
                <small>
                  Clears all {sessionCount} saved session(s), notifications, and local preferences
                  from this browser and deletes matching rows from active server memory.
                </small>
              </div>
              <button
                type="button"
                className={`boot-danger ${confirmClear ? "armed" : ""}`}
                onClick={() => {
                  if (!confirmClear) {
                    setConfirmClear(true);
                    return;
                  }
                  setConfirmClear(false);
                  onClearAllLocal();
                }}
              >
                {confirmClear ? "Confirm delete all data" : "Delete my workspace data"}
              </button>
            </div>
          </section>

          <p className="legal-footnote">
            Contact:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="legal-link">
              {CONTACT_EMAIL}
            </a>{" "}
            · Effective Date: {EFFECTIVE_DATE}. This policy describes actual application behavior
            for transparency and does not constitute formal legal advice.
          </p>
        </article>
      ) : (
        <article className="legal-card">
          <section className="legal-section">
            <h2>1. Acceptance &amp; Purpose</h2>
            <p>
              By using Ascend AI, you agree to these Terms of Service. Ascend AI is an independent
              educational side project that helps students organize scholarship applications, review
              profile gaps, and draft career/application materials using AI.
            </p>
          </section>

          <section className="legal-section">
            <h2>2. AI Advisory Disclaimer</h2>
            <p>
              All profile scores, eligibility notes, scholarship matches, salary ranges, SOP drafts,
              faculty suggestions, and deadline summaries are generated for informational assistance
              only. AI models and cached web lookups can be outdated or inaccurate.{" "}
              <strong>
                You are solely responsible for verifying deadlines, eligibility requirements, and
                application instructions on official university and scholarship portals before
                applying.
              </strong>
            </p>
          </section>

          <section className="legal-section">
            <h2>3. Acceptable Use</h2>
            <ul>
              <li>
                Do not upload sensitive government IDs, financial credentials, unlawful material, or
                another person&apos;s personal CV without their permission.
              </li>
              <li>
                Do not attempt to bypass rate limits, probe internal endpoints, automate bulk
                requests, or abuse the shared free-tier AI quota.
              </li>
              <li>
                Rate limits apply per IP address and workspace ID to keep the free service available
                to all students.
              </li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>4. Service Provided &ldquo;As Is&rdquo; &amp; Backups</h2>
            <p>
              Ascend AI is provided <strong>&ldquo;AS IS&rdquo;</strong> and{" "}
              <strong>&ldquo;AS AVAILABLE&rdquo;</strong> without warranties of any kind, express or
              implied, including accuracy, uptime, or fitness for a particular purpose. Because
              backend storage is ephemeral and browser storage can be cleared by your device, you
              should export a <code>.json</code> backup or <code>.docx</code> copy of any work you
              wish to preserve permanently.
            </p>
          </section>

          <section className="legal-section">
            <h2>5. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by applicable law, Ascend AI and its creator shall not
              be liable for any indirect, incidental, special, or consequential damages — including
              missed scholarship deadlines, rejected applications, or lost browser data — arising
              from your use of the service.
            </p>
          </section>

          <section className="legal-section">
            <h2>6. Ownership &amp; Attributions</h2>
            <p>
              You retain ownership of the CV text, notes, comments, and edits you enter. Open-source
              libraries powering Ascend AI (including React, Vite, FastAPI, Tailwind CSS, pdfplumber,
              python-docx, and the Lexend typeface under the SIL Open Font License) remain the
              property of their respective authors.
            </p>
          </section>

          <p className="legal-footnote">
            Questions or notices:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="legal-link">
              {CONTACT_EMAIL}
            </a>{" "}
            · Effective Date: {EFFECTIVE_DATE}. Provided for transparency; not formal legal advice.
          </p>
        </article>
      )}
    </div>
  );
}
