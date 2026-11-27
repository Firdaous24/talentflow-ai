import { Activity, Layers3, Monitor, Moon, Palette, RefreshCw, ShieldCheck, Sun } from "lucide-react";
import { setThemePreference, useTheme } from "../theme/theme";
import type { ThemePreference } from "../theme/theme";

const themeOptions: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];
import { API_BASE_URL } from "../api";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { useSession } from "../session";

export function Settings() {
  const { connection, healthError, checkHealth } = useSession();
  const { preference } = useTheme();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">APPLICATION INFORMATION</span>
          <h1>Settings</h1>
          <p>
            Connection details and the current capabilities of your workspace.
          </p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="card">
          <h2>
            <Activity size={20} />
            Backend connection
          </h2>
          <ConnectionBadge />
          <p>
            The health endpoint checks API liveness. It does not test database
            readiness.
          </p>
          {healthError && (
            <div className="notice error" role="alert">
              {healthError}
            </div>
          )}
          <dl className="info-list">
            <div>
              <dt>API base URL</dt>
              <dd>{API_BASE_URL || "Same origin (local /api proxy)"}</dd>
            </div>
            <div>
              <dt>Health endpoint</dt>
              <dd>GET /api/v1/health</dd>
            </div>
            <div>
              <dt>CV parsing</dt>
              <dd>POST /api/v1/candidates/parse</dd>
            </div>
            <div>
              <dt>Job analysis</dt>
              <dd>POST /api/v1/jobs/analyze</dd>
            </div>
            <div>
              <dt>Evidence comparison</dt>
              <dd>POST /api/v1/jobs/compare</dd>
            </div>
          </dl>
          <button
            className="button secondary"
            disabled={connection === "checking"}
            onClick={() => void checkHealth()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Check connection
          </button>
        </section>
        <section className="card settings-appearance">
          <h2>
            <Palette size={20} />
            Appearance
          </h2>
          <p>
            Warm paper or deep slate. System follows your device; a choice is
            remembered in this browser only after you make it.
          </p>
          <div className="segmented" role="group" aria-label="Theme">
            {themeOptions.map(({ value, label, Icon }) => (
              <button key={value} type="button" aria-pressed={preference === value} onClick={() => setThemePreference(value)}>
                <Icon size={16} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>
            <Layers3 size={20} />
            About TalentFlow AI
          </h2>
          <p>
            A recruitment intelligence portfolio project with a working PDF
            extraction and reviewed job-evidence workflow.
          </p>
          <dl className="info-list">
            <div>
              <dt>Version</dt>
              <dd>0.10.0</dd>
            </div>
            <div>
              <dt>Extraction engine</dt>
              <dd>deterministic-v2 · optional consent-gated model</dd>
            </div>
            <div>
              <dt>Accepted documents</dt>
              <dd>Text-based PDF · 5 MiB · 10 pages</dd>
            </div>
            <div>
              <dt>Profile storage</dt>
              <dd>Current session only</dd>
            </div>
            <div>
              <dt>Authentication</dt>
              <dd>Not implemented</dd>
            </div>
          </dl>
        </section>
      </div>
      <div className="notice info">
        <ShieldCheck size={20} />
        <div>
          <strong>Privacy and current limits</strong>
          <p>
            PDF files go to the TalentFlow backend; extraction stays local by
            default. Optional model assistance sends extracted text to the
            displayed provider only with per-upload consent. Profiles remain in
            memory, without browser storage or database persistence. Job
            comparison uses qualification evidence and session review
            assertions; these are not authenticated approvals. Agent checkpoints are
            bounded backend memory, expire automatically and do not survive a backend restart. OCR is planned.
          </p>
        </div>
      </div>
    </>
  );
}
