import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ClipboardList, Trash2, X } from "lucide-react";
import { AuthApiError } from "../../auth/api";
import { Badge, Skeleton, StatusPill } from "../../components/ui";
import type { RequirementCategory, RequirementClassification, ReviewedRequirement } from "../../jobTypes";
import { Notice, useDocumentTitle } from "../shared";
import { candidateApi } from "./api";
import type { CoverageReport, Gap, TargetDetail, TargetSummary } from "./api";
import { CoverageView, GapsView } from "./Coverage";
import { formatDate, useCandidateError } from "./shared";
import type { Failure } from "./shared";

const CATEGORIES: RequirementCategory[] = ["technical_skill", "experience", "education", "certification", "language", "other"];
const CLASSIFICATIONS: RequirementClassification[] = ["required", "preferred", "unspecified"];

export function OffersPage() {
  const { t, i18n } = useTranslation();
  const toFailure = useCandidateError();
  const navigate = useNavigate();
  const textId = useId();
  useDocumentTitle(t("candidate.offers.title"));
  const [targets, setTargets] = useState<TargetSummary[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  useEffect(() => {
    candidateApi.targets().then(setTargets).catch((error) => setFailure(toFailure(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || text.trim().length < 30) return;
    setBusy(true);
    setFailure(null);
    try {
      const created = await candidateApi.createTarget(text);
      navigate(`/account/offers/${created.id}`);
    } catch (error) {
      setFailure(toFailure(error));
      setBusy(false);
    }
  }

  return (
    <div className="candidate-page">
      <div className="page-heading">
        <div>
          <h2 className="candidate-title">{t("candidate.offers.title")}</h2>
          <p>{t("candidate.offers.lead")}</p>
        </div>
      </div>
      <div className="account-grid">
        <section className="card account-card" aria-labelledby="offer-paste-heading">
          <h2 id="offer-paste-heading"><ClipboardList size={19} aria-hidden="true" />{t("candidate.offers.analyze")}</h2>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <div className="auth-field">
              <label htmlFor={textId}>{t("candidate.offers.paste")}</label>
              <textarea id={textId} rows={10} value={text} maxLength={30000} aria-describedby={`${textId}-hint`} onChange={(event) => setText(event.target.value)} />
              <p id={`${textId}-hint`} className="auth-hint">{t("candidate.offers.pasteHint")}</p>
            </div>
            {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
            <button type="submit" className="button primary" disabled={busy || text.trim().length < 30} aria-busy={busy}>{busy ? t("candidate.offers.analyzing") : t("candidate.offers.analyze")}</button>
          </form>
        </section>
        <section className="card account-card" aria-labelledby="offer-list-heading">
          <h2 id="offer-list-heading">{t("candidate.offers.listTitle")}</h2>
          {targets === null ? (
            <Skeleton width="70%" />
          ) : targets.length === 0 ? (
            <p>{t("candidate.offers.empty")}</p>
          ) : (
            <ul className="offer-list" aria-label={t("candidate.offers.listTitle")}>
              {targets.map((target) => (
                <li key={target.id}>
                  <Link to={`/account/offers/${target.id}`}>{target.title || t("candidate.offers.untitled")}</Link>
                  <span className="subtle">{formatDate(target.created_at, i18n.language)} · {t("candidate.offers.criteria", { count: target.requirement_count })}</span>
                  <StatusPill status={target.criteria_confirmed_at ? "documented" : "neutral"}>{target.criteria_confirmed_at ? t("candidate.offers.confirmed") : t("candidate.offers.toReview")}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Criteria({ target, onChange }: { target: TargetDetail; onChange: (next: TargetDetail) => void }) {
  const { t, i18n } = useTranslation();
  const toFailure = useCandidateError();
  const [draft, setDraft] = useState<ReviewedRequirement[]>(target.requirements);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"saved" | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const origins = Object.fromEntries(target.analysis.requirements.map((item) => [item.id, item.origin]));
  const edit = (id: string, patch: Partial<ReviewedRequirement>) => {
    setDraft((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setDirty(true);
    setMessage(null);
  };

  async function run(action: "save" | "confirm") {
    setBusy(true);
    setFailure(null);
    setMessage(null);
    try {
      const next = action === "save" ? await candidateApi.saveRequirements(target.id, draft) : await candidateApi.confirmRequirements(target.id);
      setDraft(next.requirements);
      setDirty(false);
      if (action === "save") setMessage("saved");
      onChange(next);
    } catch (error) {
      setFailure(toFailure(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card account-card" aria-labelledby="criteria-heading">
      <h2 id="criteria-heading">{t("candidate.offer.criteriaTitle")}</h2>
      <p>{t("candidate.offer.criteriaLead")}</p>
      {draft.length === 0 && <Notice tone="info">{t("candidate.offer.noRequirements")}</Notice>}
      <ol className="criteria-list">
        {draft.map((item) => (
          <li key={item.id} className="criteria-row">
            <span className="criteria-id">{item.id}</span>
            <div className="criteria-fields">
              <input aria-label={t("candidate.offer.text", { id: item.id })} value={item.text} maxLength={2000} onChange={(event) => edit(item.id, { text: event.target.value })} />
              <select aria-label={t("candidate.offer.category", { id: item.id })} value={item.category} onChange={(event) => edit(item.id, { category: event.target.value as RequirementCategory })}>
                {CATEGORIES.map((category) => <option key={category} value={category}>{t(`candidate.offer.categories.${category}`)}</option>)}
              </select>
              <select aria-label={t("candidate.offer.classification", { id: item.id })} value={item.classification} onChange={(event) => edit(item.id, { classification: event.target.value as RequirementClassification })}>
                {CLASSIFICATIONS.map((classification) => <option key={classification} value={classification}>{t(`candidate.offer.classifications.${classification}`)}</option>)}
              </select>
              {origins[item.id] === "technical_environment" && <Badge tone="violet">{t("candidate.offer.environment")}</Badge>}
            </div>
            <button type="button" className="icon-button" aria-label={t("candidate.offer.remove", { id: item.id })} disabled={draft.length <= 1} onClick={() => { setDraft((current) => current.filter((entry) => entry.id !== item.id)); setDirty(true); }}>
              <X size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      <p className="subtle">{target.criteria_confirmed_at ? t("candidate.offer.confirmedAt", { date: formatDate(target.criteria_confirmed_at, i18n.language) }) : t("candidate.offer.notConfirmed")} {t("candidate.offer.editClears")}</p>
      <div className="criteria-actions">
        <button type="button" className="button secondary" disabled={!dirty || busy || draft.length === 0} onClick={() => void run("save")}>{t("candidate.offer.save")}</button>
        <button type="button" className="button primary" disabled={dirty || busy || draft.length === 0 || !!target.criteria_confirmed_at} onClick={() => void run("confirm")}>{t("candidate.offer.confirm")}</button>
      </div>
      {message && <Notice tone="success">{t("candidate.offer.saved")}</Notice>}
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
    </section>
  );
}

export function OfferPage() {
  const { t } = useTranslation();
  const toFailure = useCandidateError();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const [target, setTarget] = useState<TargetDetail | null>(null);
  const [report, setReport] = useState<{ coverage: CoverageReport; gaps: Gap[] } | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  useDocumentTitle(target?.title || t("candidate.offers.title"));

  useEffect(() => {
    let active = true;
    candidateApi.target(id).then((value) => active && setTarget(value)).catch((error) => active && setFailure(toFailure(error)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const confirmedAt = target?.criteria_confirmed_at ?? null;
  useEffect(() => {
    if (!target) return;
    let active = true;
    setReport(null);
    setBlocked(null);
    Promise.all([candidateApi.coverage(target.id), candidateApi.gaps(target.id)])
      .then(([coverage, gaps]) => active && setReport({ coverage, gaps: gaps.gaps }))
      .catch((error) => {
        if (!active) return;
        if (error instanceof AuthApiError && error.status === 409 && ["cv_missing", "cv_review_required", "criteria_review_required"].includes(error.code)) setBlocked(error.code);
        else setFailure(toFailure(error));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, confirmedAt]);

  async function remove() {
    if (!target) return;
    try {
      await candidateApi.deleteTarget(target.id);
      navigate("/account/offers");
    } catch (error) {
      setFailure(toFailure(error));
    }
  }

  return (
    <div className="candidate-page">
      <Link to="/account/offers" className="back-link"><ArrowLeft size={15} aria-hidden="true" />{t("candidate.offers.back")}</Link>
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
      {!target ? (
        !failure && <div className="card account-card skeleton-stack" aria-busy="true"><Skeleton width="50%" height={26} /><Skeleton width="85%" /></div>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <h2 className="candidate-title">{target.title || t("candidate.offers.untitled")}</h2>
            </div>
            <button type="button" className="button ghost" onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" />{t("candidate.offer.deleteOffer")}</button>
          </div>
          <details className="card account-card offer-source">
            <summary>{t("candidate.offer.source")}</summary>
            <pre>{target.source_text}</pre>
          </details>
          <Criteria key={target.id} target={target} onChange={setTarget} />
          {blocked && (
            <Notice tone="info">
              {t(`candidate.blocked.${blocked}`)}{" "}
              {blocked !== "criteria_review_required" && <Link to="/account/cv">{t("candidate.blocked.toCv")}</Link>}
            </Notice>
          )}
          {report && (
            <>
              <CoverageView report={report.coverage} source={target.source_text} />
              <GapsView gaps={report.gaps} />
            </>
          )}
        </>
      )}
    </div>
  );
}
