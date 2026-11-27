import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Download, FileUp, GitCompareArrows, History as HistoryIcon } from "lucide-react";
import { API_BASE_URL } from "../../api";
import { authApi } from "../../auth/api";
import type { CVVersionSummary } from "../../auth/api";
import { Badge, Skeleton } from "../../components/ui";
import type { CandidateProfile } from "../../types";
import { Notice, useDocumentTitle } from "../shared";
import { candidateApi } from "./api";
import type { CVDiff, CVVersionDetail } from "./api";
import { ProfileEditor, normalizeProfile } from "./ProfileEditor";
import { formatDate, useCandidateError, VersionStatus } from "./shared";
import type { Failure } from "./shared";

function UploadCard({ originalAvailable, onUploaded }: { originalAvailable: boolean; onUploaded: (version: CVVersionDetail) => void }) {
  const { t } = useTranslation();
  const toFailure = useCandidateError();
  const inputId = useId();
  const form = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const [done, setDone] = useState<number | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setFailure(null);
    setDone(null);
    try {
      const version = await candidateApi.upload(file, originalAvailable && keepOriginal);
      setDone(version.number);
      setFile(null);
      form.current?.reset();
      onUploaded(version);
    } catch (error) {
      setFailure(toFailure(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card account-card" aria-labelledby="cv-upload-heading">
      <h2 id="cv-upload-heading"><FileUp size={19} aria-hidden="true" />{t("candidate.cv.uploadTitle")}</h2>
      <form ref={form} className="auth-form" onSubmit={(event) => void submit(event)}>
        <div className="auth-field">
          <label htmlFor={inputId}>{t("candidate.cv.file")}</label>
          <input id={inputId} type="file" accept="application/pdf,.pdf" aria-describedby={`${inputId}-hint`} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <p id={`${inputId}-hint`} className="auth-hint">{t("candidate.cv.fileHint")}</p>
        </div>
        {originalAvailable ? (
          <label className="check">
            <input type="checkbox" checked={keepOriginal} onChange={(event) => setKeepOriginal(event.target.checked)} />
            <span>{t("candidate.cv.keepOriginal")}</span>
          </label>
        ) : (
          <p className="subtle">{t("candidate.cv.originalOff")}</p>
        )}
        {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
        {done !== null && <Notice tone="success">{t("candidate.cv.uploaded", { number: done })}</Notice>}
        <button type="submit" className="button primary" disabled={!file || busy} aria-busy={busy}>{busy ? t("candidate.cv.uploading") : t("candidate.cv.upload")}</button>
      </form>
    </section>
  );
}

function VersionHistory({ versions, selected, onSelect }: { versions: CVVersionSummary[] | null; selected: string | null; onSelect: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  return (
    <section className="card account-card" aria-labelledby="cv-history-heading">
      <h2 id="cv-history-heading"><HistoryIcon size={19} aria-hidden="true" />{t("candidate.cv.historyTitle")}</h2>
      {versions === null ? (
        <Skeleton width="70%" />
      ) : versions.length === 0 ? (
        <p>{t("candidate.cv.historyEmpty")}</p>
      ) : (
        <ol className="version-list" aria-label={t("candidate.cv.historyTitle")}>
          {versions.map((version) => (
            <li key={version.id} aria-current={version.id === selected ? "true" : undefined}>
              <div className="version-main">
                <strong>{t("candidate.cv.version", { number: version.number })}</strong>
                {version.current && <Badge tone="violet">{t("candidate.cv.current")}</Badge>}
                <VersionStatus status={version.status} />
              </div>
              <span className="subtle">
                {t("candidate.cv.created", { date: formatDate(version.created_at, i18n.language) })} · {t("candidate.cv.pages", { count: version.page_count })}
                {version.has_original && <> · {t("candidate.cv.originalKept")}</>}
              </span>
              <button type="button" className="button ghost" aria-pressed={version.id === selected} onClick={() => onSelect(version.id)}>{t("candidate.cv.open", { number: version.number })}</button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Review({ detail, onSaved }: { detail: CVVersionDetail; onSaved: (detail: CVVersionDetail) => void }) {
  const { t } = useTranslation();
  const toFailure = useCandidateError();
  const [draft, setDraft] = useState<CandidateProfile>(detail.reviewed_profile ?? detail.parsed.candidate);
  const [dirty, setDirty] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"saved" | "confirmed" | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const readOnly = !detail.current;
  const warnings = detail.parsed.parsing_metadata.warnings;

  async function run(action: "save" | "confirm") {
    setBusy(true);
    setFailure(null);
    setMessage(null);
    try {
      const next = action === "save" ? await candidateApi.review(detail.id, normalizeProfile(draft)) : await candidateApi.confirm(detail.id);
      if (action === "save") {
        setDraft(next.reviewed_profile ?? next.parsed.candidate);
        setDirty(false);
        setAcknowledged(false);
      }
      setMessage(action === "save" ? "saved" : "confirmed");
      onSaved(next);
    } catch (error) {
      setFailure(toFailure(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card account-card cv-review" aria-labelledby="cv-review-heading">
      <div className="cv-review-head">
        <h2 id="cv-review-heading">{t("candidate.cv.reviewTitle", { number: detail.number })}</h2>
        <VersionStatus status={detail.status} />
      </div>
      {readOnly && <Notice tone="info">{t("candidate.cv.readOnly")}</Notice>}
      {detail.has_original && (
        <a className="button ghost" href={`${API_BASE_URL}/api/v2/me/cv/versions/${detail.id}/original`} download>
          <Download size={15} aria-hidden="true" />
          {t("candidate.cv.downloadOriginal")}
        </a>
      )}
      <div className="cv-warnings">
        <h3>{t("candidate.cv.warningsTitle")}</h3>
        <p className="subtle">{t("candidate.cv.warningsNote")}</p>
        {warnings.length ? (
          <ul>{warnings.map((warning, index) => <li key={index} lang="en">{warning}</li>)}</ul>
        ) : (
          <p>{t("candidate.cv.warningsNone")}</p>
        )}
      </div>
      <ProfileEditor value={draft} readOnly={readOnly} onChange={(next) => { setDraft(next); setDirty(true); setMessage(null); }} />
      {!readOnly && (
        <div className="cv-review-actions">
          <p className="subtle">{t("candidate.cv.editClears")}</p>
          {dirty && <p className="cv-unsaved" role="status">{t("candidate.cv.unsaved")}</p>}
          <button type="button" className="button secondary" disabled={!dirty || busy} onClick={() => void run("save")}>{t("candidate.cv.save")}</button>
          <label className="check">
            <input type="checkbox" checked={acknowledged} disabled={dirty} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>{t("candidate.cv.acknowledge")}</span>
          </label>
          <button type="button" className="button primary" disabled={!acknowledged || dirty || busy || detail.status === "confirmed"} onClick={() => void run("confirm")}>{t("candidate.cv.confirm")}</button>
          {message && <Notice tone="success">{t(message === "saved" ? "candidate.cv.saved" : "candidate.cv.confirmed")}</Notice>}
          {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
        </div>
      )}
    </section>
  );
}

function Diff({ versions }: { versions: CVVersionSummary[] }) {
  const { t } = useTranslation();
  const toFailure = useCandidateError();
  const [from, setFrom] = useState(versions[1]?.id ?? "");
  const [to, setTo] = useState(versions[0]?.id ?? "");
  const [result, setResult] = useState<CVDiff | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const fromId = useId();
  const toId = useId();

  async function compare(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    try {
      setResult(await candidateApi.diff(from, to));
    } catch (error) {
      setFailure(toFailure(error));
    }
  }

  const changed = result ? result.fields.length + result.sections.reduce((total, section) => total + section.added.length + section.removed.length, 0) : 0;
  return (
    <section className="card account-card" aria-labelledby="cv-diff-heading">
      <h2 id="cv-diff-heading"><GitCompareArrows size={19} aria-hidden="true" />{t("candidate.cv.diffTitle")}</h2>
      {versions.length < 2 ? (
        <p>{t("candidate.cv.diffNeedsTwo")}</p>
      ) : (
        <form className="auth-form diff-form" onSubmit={(event) => void compare(event)}>
          <div className="auth-field">
            <label htmlFor={fromId}>{t("candidate.cv.diffFrom")}</label>
            <select id={fromId} value={from} onChange={(event) => setFrom(event.target.value)}>
              {versions.map((version) => <option key={version.id} value={version.id}>{t("candidate.cv.version", { number: version.number })}</option>)}
            </select>
          </div>
          <div className="auth-field">
            <label htmlFor={toId}>{t("candidate.cv.diffTo")}</label>
            <select id={toId} value={to} onChange={(event) => setTo(event.target.value)}>
              {versions.map((version) => <option key={version.id} value={version.id}>{t("candidate.cv.version", { number: version.number })}</option>)}
            </select>
          </div>
          <button type="submit" className="button secondary">{t("candidate.cv.diffRun")}</button>
        </form>
      )}
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
      {result && (
        <div className="diff-result" aria-live="polite">
          <h3>{t("candidate.cv.diffHeading", { from: result.from_version.number, to: result.to_version.number })}</h3>
          {changed === 0 && <p>{t("candidate.cv.diffNone")}</p>}
          {result.fields.length > 0 && (
            <div className="diff-section">
              <h4>{t("candidate.cv.diffFields")}</h4>
              <ul>{result.fields.map((field) => <li key={field.field}>{t(`candidate.profile.${field.field}`)} · {t(`candidate.cv.fieldChange.${field.change}`)}</li>)}</ul>
            </div>
          )}
          {result.sections.filter((section) => section.added.length || section.removed.length).map((section) => (
            <div key={section.section} className="diff-section" aria-label={t(`candidate.profile.sections.${section.section}`)} role="group">
              <h4>{t(`candidate.profile.sections.${section.section}`)}</h4>
              <ul>
                {section.added.map((label, index) => <li key={`a${index}`} className="diff-added"><span className="diff-sign">{t("candidate.cv.diffAdded")}</span> {label}</li>)}
                {section.removed.map((label, index) => <li key={`r${index}`} className="diff-removed"><span className="diff-sign">{t("candidate.cv.diffRemoved")}</span> {label}</li>)}
              </ul>
              <p className="subtle">{t("candidate.cv.diffUnchanged", { count: section.unchanged })}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function CvPage() {
  const { t } = useTranslation();
  const toFailure = useCandidateError();
  const location = useLocation();
  useDocumentTitle(t("candidate.cv.title"));
  const [versions, setVersions] = useState<CVVersionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CVVersionDetail | null>(null);
  const [originalAvailable, setOriginalAvailable] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  // Only the history list is refreshed in the background; the open review is
  // replaced explicitly (open, upload, save), so typing is never interrupted.
  const refreshList = useCallback(async () => {
    const list = await candidateApi.versions();
    setVersions(list);
    return list;
  }, []);
  const latestOpen = useRef<string | null>(null);
  const open = useCallback(async (id: string) => {
    latestOpen.current = id;
    setSelected(id);
    setDetail(null);
    try {
      const value = await candidateApi.version(id);
      if (latestOpen.current === id) setDetail(value);
    } catch (error) {
      setFailure(toFailure(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshList()
      .then((list) => list[0] && open(list[0].id))
      .catch((error) => setFailure(toFailure(error)));
    authApi.candidateOverview().then((overview) => setOriginalAvailable(overview.original_storage_available)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const show = (version: CVVersionDetail) => {
    latestOpen.current = version.id;
    setSelected(version.id);
    setDetail(version);
    refreshList().catch((error) => setFailure(toFailure(error)));
  };

  useEffect(() => {
    // A gap link points at a CV section: bring it into view once the review is shown.
    if (!detail || !location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  }, [detail, location.hash]);

  return (
    <div className="candidate-page">
      <div className="page-heading">
        <div>
          <h2 className="candidate-title">{t("candidate.cv.title")}</h2>
          <p>{t("candidate.cv.lead")}</p>
        </div>
      </div>
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
      <div className="account-grid">
        <UploadCard originalAvailable={originalAvailable} onUploaded={show} />
        <VersionHistory versions={versions} selected={selected} onSelect={(id) => void open(id)} />
      </div>
      {detail ? (
        <Review key={`review-${detail.id}`} detail={detail} onSaved={show} />
      ) : (
        selected && <div className="card account-card skeleton-stack" aria-busy="true"><Skeleton width="40%" height={24} /><Skeleton width="80%" /><Skeleton width="65%" /></div>
      )}
      {versions && versions.length > 0 && <Diff key={`diff-${versions.map((version) => version.id).join()}`} versions={versions} />}
    </div>
  );
}
