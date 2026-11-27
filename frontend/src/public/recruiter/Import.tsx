import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FileStack, ListChecks, Trash2 } from "lucide-react";
import { Skeleton } from "../../components/ui";
import { Notice } from "../shared";
import { formatDate } from "../candidate/shared";
import type { Failure } from "../candidate/shared";
import { recruiterApi } from "./api";
import type { ImportBatch, ReviewItem } from "./api";
import { useRecruiterError } from "./Ranking";

const MAX_FILES = 200;

/**
 * Bulk import: the attestation is required before any file leaves the browser.
 * Files go one by one (5 MiB each); the worker parses them in the background,
 * so the page only follows the batch progress.
 */
export function ImportCard({ org, jobId, onProgress }: { org: string; jobId: string; onProgress: () => void }) {
  const { t, i18n } = useTranslation();
  const toFailure = useRecruiterError();
  const inputId = useId();
  const form = useRef<HTMLFormElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [attested, setAttested] = useState(false);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const api = recruiterApi(org);

  const refresh = useCallback(async () => {
    const list = await recruiterApi(org).imports(jobId);
    setBatches(list);
    return list;
  }, [org, jobId]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const poll = () =>
      refresh().then((list) => {
        if (!active) return;
        const busy = list.some((batch) => batch.progress.queued + batch.progress.parsing > 0);
        onProgress();
        if (busy) timer = window.setTimeout(poll, 1500);
      }).catch((error) => active && setFailure(toFailure(error)));
    void poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, sending === null]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!attested || !files.length || files.length > MAX_FILES || sending) return;
    setFailure(null);
    setSending({ done: 0, total: files.length });
    try {
      const batch = await api.createImport(jobId, files.length);
      for (const [index, file] of files.entries()) {
        await api.uploadFile(batch.id, file);
        setSending({ done: index + 1, total: files.length });
      }
      form.current?.reset();
      setFiles([]);
      setAttested(false);
    } catch (error) {
      setFailure(toFailure(error));
    } finally {
      setSending(null);
    }
  }

  return (
    <section className="card account-card" aria-labelledby="import-heading">
      <h2 id="import-heading"><FileStack size={19} aria-hidden="true" />{t("recruiter.import.title")}</h2>
      <p>{t("recruiter.import.lead")}</p>
      <form ref={form} className="auth-form" onSubmit={(event) => void submit(event)}>
        <div className="auth-field">
          <label htmlFor={inputId}>{t("recruiter.import.files")}</label>
          <input id={inputId} type="file" multiple accept="application/pdf,.pdf" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
          {files.length > 0 && <p className="auth-hint">{t("recruiter.import.selected", { count: files.length })}</p>}
          {files.length > MAX_FILES && <p className="auth-error">{t("recruiter.import.tooMany")}</p>}
        </div>
        <label className="check attestation">
          <input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} aria-describedby={`${inputId}-attest`} />
          <span>{t("recruiter.import.attestation")}</span>
        </label>
        <p id={`${inputId}-attest`} className="auth-hint">{t("recruiter.import.attestationHint")} {t("recruiter.import.retention")}</p>
        {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
        <button type="submit" className="button primary" disabled={!attested || !files.length || files.length > MAX_FILES || !!sending} aria-busy={!!sending}>
          {sending ? t("recruiter.import.uploading", sending) : t("recruiter.import.submit", { count: Math.max(files.length, 1) })}
        </button>
      </form>
      <h3>{t("recruiter.import.batchesTitle")}</h3>
      {batches === null ? (
        <Skeleton width="60%" />
      ) : (
        <ul className="batch-list" aria-label={t("recruiter.import.batchesTitle")}>
          {batches.map((batch) => (
            <li key={batch.id}>
              <span>{t("recruiter.import.batch", { date: formatDate(batch.created_at, i18n.language), uploaded: batch.uploaded, count: batch.file_count, attested: formatDate(batch.attested_at, i18n.language), expires: formatDate(batch.expires_at, i18n.language) })}</span>
              <span className="batch-progress" role="status">
                {(["parsed", "queued", "parsing", "failed", "duplicate"] as const).filter((key) => batch.progress[key]).map((key) => `${batch.progress[key]} ${t(`recruiter.import.progress.${key}`)}`).join(" · ")}
              </span>
              {batch.failures.length > 0 && (
                <ul className="batch-failures">
                  {batch.failures.map((item) => (
                    <li key={item.position}>{t("recruiter.import.failure", { position: item.position, reason: item.status === "duplicate" ? t("recruiter.import.duplicate") : i18n.exists(`candidate.errors.${item.error_code}`) ? t(`candidate.errors.${item.error_code}`) : t("recruiter.errors.processing_error") })}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Qualifications({ item }: { item: ReviewItem }) {
  const { t } = useTranslation();
  const q = item.qualifications;
  const rows: [string, string[]][] = [
    ["skills", q.technical_skills.map((skill) => skill.name)],
    ["education", q.education.map((entry) => [entry.degree, entry.field_of_study].filter(Boolean).join(" · "))],
    ["experience", q.experience.map((entry) => entry.job_title ?? "").filter(Boolean)],
    ["projects", q.projects.map((entry) => entry.name ?? "").filter(Boolean)],
    ["languages", q.languages.map((entry) => [entry.name, entry.proficiency].filter(Boolean).join(" · "))],
    ["certifications", q.certifications.map((entry) => entry.name)],
  ];
  return (
    <dl className="qualification-list">
      {rows.map(([key, values]) => (
        <div key={key}>
          <dt>{t(`recruiter.review.${key}`)}</dt>
          <dd>{values.filter(Boolean).join(", ") || t("recruiter.review.none")}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReviewCard({ org, item, onDone }: { org: string; item: ReviewItem; onDone: () => void }) {
  const { t } = useTranslation();
  const toFailure = useRecruiterError();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const label = t("recruiter.review.item", { position: item.position });

  async function run(action: "confirm" | "remove") {
    setBusy(true);
    setFailure(null);
    try {
      if (action === "confirm") await recruiterApi(org).confirmProfile(item.profile_id);
      else await recruiterApi(org).deleteProfile(item.profile_id);
      onDone();
    } catch (error) {
      setFailure(toFailure(error));
      setBusy(false);
    }
  }

  return (
    <li className="review-card" aria-label={label}>
      <h3>{label}</h3>
      <Qualifications item={item} />
      {item.warnings.length > 0 && (
        <details className="review-warnings">
          <summary>{t("recruiter.review.warnings")} ({item.warnings.length})</summary>
          <ul>{item.warnings.map((warning, index) => <li key={index} lang="en">{warning}</li>)}</ul>
        </details>
      )}
      <label className="check">
        <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
        <span>{t("recruiter.review.acknowledge")}</span>
      </label>
      <div className="criteria-actions">
        <button type="button" className="button primary" disabled={!acknowledged || busy} onClick={() => void run("confirm")}>{t("recruiter.review.confirm")}</button>
        <button type="button" className="button ghost" disabled={busy} onClick={() => void run("remove")}><Trash2 size={15} aria-hidden="true" />{t("recruiter.review.remove")}</button>
      </div>
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
    </li>
  );
}

export function ReviewQueue({ org, jobId, refreshKey, onChange }: { org: string; jobId: string; refreshKey: number; onChange: () => void }) {
  const { t } = useTranslation();
  const toFailure = useRecruiterError();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    recruiterApi(org).reviewQueue(jobId).then((value) => active && setItems(value)).catch((error) => active && setFailure(toFailure(error)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, jobId, refreshKey, reload]);

  return (
    <section className="card account-card" aria-labelledby="review-heading">
      <h2 id="review-heading"><ListChecks size={19} aria-hidden="true" />{t("recruiter.review.title")}</h2>
      <p>{t("recruiter.review.lead")}</p>
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
      {items === null ? (
        !failure && <Skeleton width="60%" />
      ) : items.length === 0 ? (
        <p>{t("recruiter.review.empty")}</p>
      ) : (
        <ul className="review-list">
          {items.map((item) => <ReviewCard key={item.profile_id} org={org} item={item} onDone={() => { setReload((value) => value + 1); onChange(); }} />)}
        </ul>
      )}
    </section>
  );
}
