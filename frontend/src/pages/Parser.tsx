import { useRef, useState, useEffect } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import {
  UploadCloud,
  FileText,
  ArrowRight,
  LoaderCircle,
  X,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { api, validatePdf } from "../api";
import { useSession } from "../session";
import type { SessionCandidate, ExtractionConfig } from "../types";
import { ReviewProfile } from "../components/ReviewProfile";

export function Parser() {
  const { addCandidate } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<SessionCandidate | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const selectionVersion = useRef(0);
  const blocked = busy || validating;
  const [config, setConfig] = useState<ExtractionConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    api
      .extractionConfig()
      .then(setConfig)
      .catch(() =>
        setConfigError(
          "Unable to check optional provider configuration. Local extraction remains available.",
        ),
      );
  }, []);
  async function selectFile(selected?: File) {
    if (!selected || busy) return;
    const version = ++selectionVersion.current;
    setValidating(true);
    setError(null);
    setFile(null);
    setResult(null);
    setConsent(false);
    try {
      const validation = await validatePdf(selected);
      if (version !== selectionVersion.current) return;
      if (validation) setError(validation);
      else setFile(selected);
    } catch {
      if (version === selectionVersion.current)
        setError("Unable to read this file. Please choose another PDF.");
    } finally {
      if (version === selectionVersion.current) setValidating(false);
    }
  }
  function change(event: ChangeEvent<HTMLInputElement>) {
    void selectFile(event.target.files?.[0]);
    event.target.value = "";
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (blocked) return;
    if (event.dataTransfer.files.length !== 1) {
      setFile(null);
      setResult(null);
      setError("Choose one PDF at a time.");
      return;
    }
    void selectFile(event.dataTransfer.files[0]);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || blocked) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await api.parse(file, consent && !!config?.available);
      setResult(addCandidate(response, file.name));
      setFile(null);
      setConsent(false);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Parsing failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setResult(null);
    setFile(null);
    setError(null);
    input.current?.focus();
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DOCUMENT INTELLIGENCE</span>
          <h1>CV Parser</h1>
          <p>Turn a PDF into a structured candidate profile.</p>
        </div>
        <span className="badge violet">
          <FileText size={14} />
          PDF extraction
        </span>
      </div>
      {result ? (
        <>
          <div className="success-bar" role="status">
            <span>
              <CheckCircle2 size={18} />
              Profile extracted from {result.filename}
            </span>
            <button className="button secondary" onClick={reset}>
              Upload another CV
              <UploadCloud size={16} />
            </button>
          </div>
          <ReviewProfile entry={result} />
        </>
      ) : (
        <div className="parser-grid">
          <section className="card upload-card">
            <div className="section-heading">
              <div className="icon-box">
                <UploadCloud size={20} />
              </div>
              <div>
                <h2>Upload a candidate CV</h2>
                <p>Start with one text-based PDF.</p>
              </div>
              <span className="step-number">01</span>
            </div>
            <form onSubmit={submit} aria-label="Parse CV">
              <div
                className={`dropzone ${dragging ? "dragging" : ""} ${blocked ? "disabled" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!blocked) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={drop}
              >
                <div className="upload-symbol">
                  <UploadCloud size={32} strokeWidth={1.5} />
                </div>
                <h3>Drag & drop your CV here</h3>
                <p>or choose a file from your device</p>
                <label
                  className={`button secondary file-label ${blocked ? "disabled" : ""}`}
                  htmlFor="cv-file"
                >
                  Browse files
                  <ArrowRight size={15} />
                </label>
                <input
                  ref={input}
                  id="cv-file"
                  type="file"
                  accept=".pdf,application/pdf"
                  className="sr-only file-input"
                  onChange={change}
                  disabled={blocked}
                  aria-describedby="file-help"
                />
                <span id="file-help" className="upload-limits">
                  PDF only · Up to 5 MiB · Maximum 10 pages
                </span>
              </div>
              {file && (
                <div className="selected-file">
                  <div className="icon-box">
                    <FileText size={20} />
                  </div>
                  <div>
                    <strong>{file.name}</strong>
                    <span>
                      {(file.size / 1024).toFixed(1)} KiB · Ready to parse
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remove selected file"
                    disabled={blocked}
                    onClick={() => setFile(null)}
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
              {error && (
                <div className="notice error" role="alert">
                  {error}
                </div>
              )}
              <button
                type="submit"
                className="button primary parse-button"
                disabled={!file || blocked}
              >
                {blocked ? (
                  <>
                    <LoaderCircle size={18} className="spin" />
                    {busy ? "Extracting candidate profile…" : "Checking PDF…"}
                  </>
                ) : (
                  <>
                    Parse CV
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
              <div className="provider-choice">
                <strong>Local extraction by default · French & English</strong>
                {config?.available ? (
                  <>
                    <p>
                      Optional model provider: {config.destination} ·{" "}
                      {config.model}. Provider connectivity is tested only if
                      you request model extraction.
                    </p>
                    <label className="consent-label">
                      <input
                        type="checkbox"
                        checked={consent}
                        disabled={blocked}
                        onChange={(event) => setConsent(event.target.checked)}
                      />
                      For this upload, I consent to sending extracted CV text to
                      this provider for model-assisted extraction. The provider
                      may retain text under its own policy.
                    </label>
                  </>
                ) : (
                  <p>
                    {configError ??
                      (config
                        ? "Optional model extraction is not configured. No content leaves the local backend."
                        : "Checking optional provider configuration… Local parsing is available.")}
                  </p>
                )}
              </div>
              {busy && (
                <p role="status" className="subtle text-center">
                  Reading your document. This may take a moment.
                </p>
              )}
            </form>
            <p className="privacy-note">
              <ShieldCheck size={16} />
              PDF sent to your TalentFlow backend. Profiles stay in this
              session; optional model text transmission requires separate
              consent.
            </p>
          </section>
          <aside className="parser-aside">
            <section className="card">
              <span className="eyebrow">FROM DOCUMENT TO PROFILE</span>
              <h2>
                Less manual entry.
                <br />
                More useful context.
              </h2>
              <p>Review supported fields in a clear, organized profile.</p>
              <ol className="process-list">
                <li>
                  <span>1</span>
                  <div>
                    <strong>Choose your document</strong>
                    <p>Use a PDF with selectable text.</p>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Extract supported fields</strong>
                    <p>Contact details, skills, experience and more.</p>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Review the result</strong>
                    <p>Check warnings and missing information.</p>
                  </div>
                </li>
              </ol>
            </section>
            <section className="notice info">
              <FileText size={20} />
              <div>
                <strong>A transparent starting point</strong>
                <p>
                  The current parser uses deterministic rules. Scanned PDFs need
                  OCR, which is planned. Results are partial and should always
                  be reviewed.
                </p>
              </div>
            </section>
            <p className="subtle">
              Profiles are available only during this browser session.
              Refreshing clears them.
            </p>
          </aside>
        </div>
      )}
    </>
  );
}
