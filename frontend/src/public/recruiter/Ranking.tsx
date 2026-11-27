import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { EyeOff, Info, Link2, UserRound, X } from "lucide-react";
import { AuthApiError } from "../../auth/api";
import { Badge, Skeleton } from "../../components/ui";
import { Notice } from "../shared";
import { Criterion } from "../candidate/Coverage";
import { formatDate } from "../candidate/shared";
import type { Failure } from "../candidate/shared";
import { recruiterApi } from "./api";
import type { Counts, MatchDetail, Ranking, RankingEntry, RevealReason } from "./api";

/**
 * Anonymous ranking by documentary coverage. The order comes from the API
 * (strict lexicographic key, ties grouped in arrival order); this view adds no
 * position number, score, percentage or gauge. Every count opens its evidence.
 */
type Filter = "all" | "required" | "preferred" | "needs_review";
const REASONS: RevealReason[] = ["interview_scheduled", "reference_check", "candidate_request", "other"];

export function useRecruiterError() {
  const { t, i18n } = useTranslation();
  return (error: unknown): Failure => {
    if (error instanceof AuthApiError) {
      for (const space of ["recruiter.errors", "applications.errors", "candidate.errors"]) {
        if (i18n.exists(`${space}.${error.code}`)) return { text: t(`${space}.${error.code}`), tone: error.status >= 500 ? "error" : "warning" };
      }
      if (error.code === "too_many_attempts") return { text: t("common.errors.tooMany", { seconds: error.retryAfter ?? 60 }), tone: "warning" };
      if (error.code === "validation_error") return { text: t("common.errors.validation"), tone: "warning" };
      if (error.code === "network") return { text: t("common.errors.network"), tone: "error" };
    }
    return { text: t("common.errors.generic"), tone: "error" };
  };
}

function CountButtons({ counts, alias, onOpen }: { counts: Counts; alias: number; onOpen: (filter: Filter) => void }) {
  const { t } = useTranslation();
  const parts: { id: Filter; value: string; label: string }[] = [
    { id: "required", value: `${counts.required_documented}/${counts.required_total}`, label: t("recruiter.ranking.required") },
    { id: "preferred", value: `${counts.preferred_documented}/${counts.preferred_total}`, label: t("recruiter.ranking.preferred") },
    { id: "needs_review", value: String(counts.needs_review), label: t("recruiter.ranking.needsReview") },
  ];
  return (
    <span className="coverage-count ranking-counts" role="group" aria-label={t("recruiter.ranking.alias", { alias })}>
      {parts.map((part, index) => (
        <span key={part.id} className="coverage-count-part">
          {index > 0 && <span aria-hidden="true" className="coverage-sep"> · </span>}
          <button type="button" aria-label={t("recruiter.ranking.open", { value: part.value, label: part.label })} onClick={() => onOpen(part.id)}>
            <strong>{part.value}</strong> {part.label}
          </button>
        </span>
      ))}
    </span>
  );
}

function Row({ entry, onOpen }: { entry: RankingEntry; onOpen: (entry: RankingEntry, filter: Filter) => void }) {
  const { t } = useTranslation();
  return (
    <li className="ranking-row">
      <span className="ranking-alias">{t("recruiter.ranking.alias", { alias: entry.alias })}</span>
      <CountButtons counts={entry.counts} alias={entry.alias} onOpen={(filter) => onOpen(entry, filter)} />
      <span className="ranking-badges">
        <Badge tone="neutral">{t(`recruiter.ranking.source.${entry.source}`)}</Badge>
        {entry.identity_revealed && <Badge tone="violet">{t("recruiter.ranking.revealed")}</Badge>}
      </span>
    </li>
  );
}

function RevealForm({ onReveal }: { onReveal: (reason: RevealReason, note: string) => Promise<void> }) {
  const { t } = useTranslation();
  const reasonId = useId();
  const noteId = useId();
  const [reason, setReason] = useState<RevealReason>("interview_scheduled");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || note.trim().length < 5) return;
    setBusy(true);
    try {
      await onReveal(reason, note.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form reveal-form" onSubmit={(event) => void submit(event)} aria-labelledby={`${reasonId}-title`}>
      <h4 id={`${reasonId}-title`}><EyeOff size={16} aria-hidden="true" />{t("recruiter.reveal.title")}</h4>
      <p className="subtle">{t("recruiter.reveal.lead")}</p>
      <div className="auth-field">
        <label htmlFor={reasonId}>{t("recruiter.reveal.reason")}</label>
        <select id={reasonId} value={reason} onChange={(event) => setReason(event.target.value as RevealReason)}>
          {REASONS.map((item) => <option key={item} value={item}>{t(`recruiter.reveal.reasons.${item}`)}</option>)}
        </select>
      </div>
      <div className="auth-field">
        <label htmlFor={noteId}>{t("recruiter.reveal.note")}</label>
        <textarea id={noteId} rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
      <button type="submit" className="button secondary" disabled={busy || note.trim().length < 5}>{t("recruiter.reveal.submit")}</button>
    </form>
  );
}

function Invite({ org, profileId }: { org: string; profileId: string }) {
  const { t, i18n } = useTranslation();
  const toFailure = useRecruiterError();
  const [link, setLink] = useState<{ url: string; expires_at: string } | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  async function create() {
    setFailure(null);
    try {
      setLink(await recruiterApi(org).invitation(profileId));
    } catch (error) {
      setFailure(toFailure(error));
    }
  }
  return (
    <div className="invite">
      <button type="button" className="button ghost" onClick={() => void create()}><Link2 size={15} aria-hidden="true" />{t("recruiter.review.invite")}</button>
      <p className="subtle">{t("recruiter.review.inviteHint")}</p>
      {link && (
        <div className="auth-field">
          <label htmlFor={`invite-${profileId}`}>{t("recruiter.review.inviteUrl", { date: formatDate(link.expires_at, i18n.language) })}</label>
          <input id={`invite-${profileId}`} readOnly value={link.url} onFocus={(event) => event.target.select()} />
        </div>
      )}
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
    </div>
  );
}

function EvidencePanel({ org, matchId, filter, setFilter, onClose, onRevealed }: { org: string; matchId: string; filter: Filter; setFilter: (filter: Filter) => void; onClose: () => void; onRevealed: () => void }) {
  const { t, i18n } = useTranslation();
  const toFailure = useRecruiterError();
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    setDetail(null);
    recruiterApi(org).match(matchId).then((value) => {
      if (!active) return;
      setDetail(value);
      requestAnimationFrame(() => heading.current?.focus());
    }).catch((error) => active && setFailure(toFailure(error)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, matchId]);

  async function reveal(reason: RevealReason, note: string) {
    setFailure(null);
    try {
      setDetail(await recruiterApi(org).reveal(matchId, reason, note));
      onRevealed();
    } catch (error) {
      setFailure(toFailure(error));
    }
  }

  const counted = detail?.comparisons.filter((item) => item.origin === "qualification") ?? [];
  const shown = counted.filter((item) => filter === "all" || (filter === "needs_review" ? item.status === "needs_review" : item.classification === filter));
  return (
    <section className="card account-card evidence-panel" aria-labelledby="evidence-heading">
      <div className="evidence-panel-head">
        <h3 id="evidence-heading" ref={heading} tabIndex={-1}>{detail ? t("recruiter.evidence.title", { alias: detail.alias }) : t("common.loading")}</h3>
        <button type="button" className="icon-button" aria-label={t("recruiter.evidence.close")} onClick={onClose}><X size={17} aria-hidden="true" /></button>
      </div>
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
      {!detail ? (
        !failure && <div className="skeleton-stack"><Skeleton width="60%" /><Skeleton width="85%" /></div>
      ) : (
        <>
          <CountButtons counts={detail.counts} alias={detail.alias} onOpen={setFilter} />
          {filter !== "all" && (
            <p className="subtle" role="status">
              {t("recruiter.evidence.filtered", { count: shown.length })} ·{" "}
              <button type="button" className="link-button" onClick={() => setFilter("all")}>{t("recruiter.evidence.showAll")}</button>
            </p>
          )}
          <div className="coverage-list">
            {shown.map((item) => <Criterion key={item.requirement_id} item={item} source={detail.job_source_text} cvLabel={t("recruiter.evidence.cvSide")} />)}
          </div>
          {detail.identity ? (
            <div className="identity-card" role="group" aria-label={t("recruiter.reveal.identity")}>
              <h4><UserRound size={16} aria-hidden="true" />{t("recruiter.reveal.identity")}</h4>
              <dl>
                <dt>{t("recruiter.reveal.name")}</dt><dd>{detail.identity.full_name ?? "—"}</dd>
                <dt>{t("recruiter.reveal.email")}</dt><dd>{detail.identity.email ?? "—"}</dd>
                <dt>{t("recruiter.reveal.phone")}</dt><dd>{detail.identity.phone ?? "—"}</dd>
                <dt>{t("recruiter.reveal.links")}</dt><dd>{[detail.identity.linkedin_url, detail.identity.github_url].filter(Boolean).join(" · ") || "—"}</dd>
              </dl>
              {detail.identity_revealed_at && detail.reveal_reason && (
                <p className="subtle">{t("recruiter.reveal.done", { date: formatDate(detail.identity_revealed_at, i18n.language), reason: t(`recruiter.reveal.reasons.${detail.reveal_reason}`) })}</p>
              )}
            </div>
          ) : (
            <RevealForm onReveal={reveal} />
          )}
          {detail.imported_profile_id && <Invite org={org} profileId={detail.imported_profile_id} />}
        </>
      )}
    </section>
  );
}

export function RankingView({ org, jobId, refreshKey }: { org: string; jobId: string; refreshKey: number }) {
  const { t } = useTranslation();
  const toFailure = useRecruiterError();
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const [open, setOpen] = useState<{ matchId: string; filter: Filter } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = () =>
      recruiterApi(org).ranking(jobId).then((value) => {
        if (!active) return;
        setRanking(value);
        setFailure(null);
        // Pending comparisons are computed by the worker: check again shortly.
        if (value.pending) timer = window.setTimeout(load, 1500);
      }).catch((error) => active && setFailure(toFailure(error)));
    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, jobId, refreshKey, reload]);

  return (
    <section className="card account-card ranking" aria-labelledby="ranking-heading">
      <h2 id="ranking-heading">{t("recruiter.ranking.title")}</h2>
      <p className="subtle">{t("recruiter.ranking.sortKey")}</p>
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
      {!ranking ? (
        !failure && <Skeleton width="70%" />
      ) : (
        <>
          {(ranking.pending > 0 || ranking.to_review > 0) && (
            <p className="subtle" role="status">
              {[ranking.pending ? t("recruiter.ranking.pending", { count: ranking.pending }) : "", ranking.to_review ? t("recruiter.ranking.toReview", { count: ranking.to_review }) : ""].filter(Boolean).join(" · ")}
            </p>
          )}
          {ranking.groups.length === 0 ? (
            <p>{t("recruiter.ranking.empty")}</p>
          ) : (
            <ol className="ranking-groups" aria-label={t("recruiter.ranking.list")}>
              {ranking.groups.map((group) => (
                <li key={`${group.required_documented}-${group.preferred_documented}-${group.needs_review}`} className="ranking-group">
                  {group.entries.length > 1 && <p className="ranking-tie">{t("recruiter.ranking.group")}</p>}
                  <ul>{group.entries.map((entry) => <Row key={entry.match_id} entry={entry} onOpen={(item, filter) => setOpen({ matchId: item.match_id, filter })} />)}</ul>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <div className="ranking-notice" role="note">
        <Info size={16} aria-hidden="true" />
        <div>
          <strong>{t("recruiter.ranking.notice")}</strong>
          <span>{t("recruiter.ranking.noAction")}</span>
        </div>
      </div>
      {open && (
        <EvidencePanel
          key={open.matchId}
          org={org}
          matchId={open.matchId}
          filter={open.filter}
          setFilter={(filter) => setOpen({ ...open, filter })}
          onClose={() => setOpen(null)}
          onRevealed={() => setReload((value) => value + 1)}
        />
      )}
    </section>
  );
}
