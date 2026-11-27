import { lazy, Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, LogOut, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { AuthApiError, authApi } from "../auth/api";
import type { Account, CandidateOverview, Consents, Locale, Organization } from "../auth/api";
import { useAuth } from "../auth/AuthContext";
import { Skeleton } from "../components/ui";
import { setLanguage } from "../i18n";
import { CandidateHome, CandidateNav, DataPanel } from "./candidate/Home";
import { Field, Notice, PasswordField, useDocumentTitle, useErrorText } from "./shared";
import "./candidate/candidate.css";

type Failure = { text: string; tone: "warning" | "error" } | null;

// The CV and job-post pages load on demand: the public pages and the demo stay light.
const CvPage = lazy(() => import("./candidate/CvPage").then((module) => ({ default: module.CvPage })));
const OffersPage = lazy(() => import("./candidate/Offers").then((module) => ({ default: module.OffersPage })));
const OfferPage = lazy(() => import("./candidate/Offers").then((module) => ({ default: module.OfferPage })));
const JobsPage = lazy(() => import("./recruiter/Jobs").then((module) => ({ default: module.JobsPage })));
const JobPage = lazy(() => import("./recruiter/Jobs").then((module) => ({ default: module.JobPage })));

function RecruiterNav() {
  const { t } = useTranslation();
  return (
    <nav className="candidate-nav" aria-label={t("recruiter.nav.label")}>
      <NavLink to="/account" end>{t("recruiter.nav.overview")}</NavLink>
      <NavLink to="/account/jobs">{t("recruiter.nav.jobs")}</NavLink>
    </nav>
  );
}

function formatDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(value));
}

function CandidatePanel({ consents, onConsents }: { consents: Consents | null; onConsents: (value: Consents) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [overview, setOverview] = useState<CandidateOverview | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  useEffect(() => {
    let active = true;
    authApi.candidateOverview().then((value) => active && setOverview(value)).catch((error) => active && setFailure(errorText(error)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const visible = consents?.consents.find((item) => item.purpose === "recruiter_visibility")?.granted ?? overview?.recruiter_visibility ?? false;

  async function toggle(next: boolean) {
    setFailure(null);
    try {
      onConsents(await authApi.setConsent("recruiter_visibility", next));
    } catch (error) {
      setFailure(errorText(error));
    }
  }

  return (
    <>
      <CandidateHome overview={overview} />
      <section className="card account-card" aria-labelledby="visibility-heading">
        <h2 id="visibility-heading"><UsersRound size={19} aria-hidden="true" />{t("account.candidate.visibilityTitle")}</h2>
        <p>{t("account.candidate.visibilityBody")}</p>
        <label className="switch">
          <input type="checkbox" role="switch" checked={visible} disabled={!consents} onChange={(event) => void toggle(event.target.checked)} />
          <span>{visible ? t("account.candidate.visibilityOn") : t("account.candidate.visibilityOff")}</span>
        </label>
        {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
      </section>
    </>
  );
}

function RecruiterPanel({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  useEffect(() => {
    let active = true;
    authApi.organizations().then((value) => active && setOrganizations(value)).catch((error) => active && setFailure(errorText(error)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || name.trim().length < 2) return;
    setBusy(true);
    setFailure(null);
    try {
      const created = await authApi.createOrganization(name.trim());
      setOrganizations((current) => [...(current ?? []), created]);
      setName("");
      onCreated();
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card account-card" aria-labelledby="org-heading">
      <h2 id="org-heading"><Building2 size={19} aria-hidden="true" />{t("account.recruiter.orgTitle")}</h2>
      {organizations === null ? (
        <Skeleton width="70%" />
      ) : organizations.length ? (
        <ul className="org-list" aria-label={t("account.recruiter.orgTitle")}>
          {organizations.map((organization) => (
            <li key={organization.id}>
              <strong>{organization.name}</strong>
              <span className="badge neutral">{t(`account.recruiter.${organization.org_role}`)}</span>
              <span className="subtle">{t("account.recruiter.members", { count: organization.member_count })}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("account.recruiter.orgEmpty")}</p>
      )}
      {organizations !== null && organizations.length === 0 && (
        <form className="auth-form inline-form" onSubmit={(event) => void create(event)}>
          <Field label={t("account.recruiter.orgName")} value={name} minLength={2} maxLength={120} onChange={(event) => setName(event.target.value)} />
          <button type="submit" className="button primary" disabled={busy || name.trim().length < 2}>{t("account.recruiter.orgCreate")}</button>
        </form>
      )}
      <p className="subtle">{t("account.recruiter.next")}</p>
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
    </section>
  );
}

function ConsentsPanel({ consents, onConsents }: { consents: Consents | null; onConsents: (value: Consents) => void }) {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const [failure, setFailure] = useState<Failure>(null);
  const byPurpose = Object.fromEntries((consents?.consents ?? []).map((item) => [item.purpose, item]));
  const describe = (purpose: "processing" | "marketing") => {
    const item = byPurpose[purpose];
    return item?.granted && item.granted_at ? t("account.granted", { date: formatDate(item.granted_at, i18n.language), version: item.policy_version }) : t("account.notGranted");
  };

  async function toggleMarketing(next: boolean) {
    setFailure(null);
    try {
      onConsents(await authApi.setConsent("marketing", next));
    } catch (error) {
      setFailure(errorText(error));
    }
  }

  return (
    <section className="card account-card" aria-labelledby="consents-heading">
      <h2 id="consents-heading"><ShieldCheck size={19} aria-hidden="true" />{t("account.consentsTitle")}</h2>
      <p>{t("account.consentsLead")}</p>
      {consents ? (
        <ul className="consent-list">
          <li>
            <div><strong>{t("account.processing")}</strong><span className="subtle">{describe("processing")}</span><span className="subtle">{t("account.processingNote")}</span></div>
          </li>
          <li>
            <div><strong id="marketing-label">{t("account.marketing")}</strong><span className="subtle">{describe("marketing")}</span></div>
            <input type="checkbox" role="switch" aria-labelledby="marketing-label" checked={!!byPurpose.marketing?.granted} onChange={(event) => void toggleMarketing(event.target.checked)} />
          </li>
        </ul>
      ) : (
        <div className="skeleton-stack"><Skeleton width="90%" /><Skeleton width="60%" /></div>
      )}
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
    </section>
  );
}

function PreferencesPanel({ account, onAccount }: { account: Account; onAccount: (value: Account) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  async function change(locale: Locale) {
    setSaved(false);
    setFailure(null);
    try {
      onAccount(await authApi.updateLocale(locale));
      setLanguage(locale);
      setSaved(true);
    } catch (error) {
      setFailure(errorText(error));
    }
  }

  return (
    <section className="card account-card" aria-labelledby="preferences-heading">
      <h2 id="preferences-heading">{t("account.preferencesTitle")}</h2>
      <div className="auth-field">
        <label htmlFor="account-locale">{t("account.language")}</label>
        <select id="account-locale" value={account.locale} onChange={(event) => void change(event.target.value as Locale)}>
          <option value="fr">{t("common.language.fr")}</option>
          <option value="en">{t("common.language.en")}</option>
        </select>
      </div>
      {saved && <Notice tone="success">{t("account.saved")}</Notice>}
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
    </section>
  );
}

function DeletePanel() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const { deleteAccount } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setFailure(null);
    try {
      await deleteAccount(password);
    } catch (error) {
      setBusy(false);
      setFailure(error instanceof AuthApiError && error.code === "reauthentication_failed" ? { text: t("account.deleteWrong"), tone: "warning" } : errorText(error));
    }
  }

  return (
    <section className="card account-card danger-zone" aria-labelledby="delete-heading">
      <h2 id="delete-heading"><Trash2 size={19} aria-hidden="true" />{t("account.deleteTitle")}</h2>
      <p>{t("account.deleteBody")}</p>
      <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
        <PasswordField label={t("account.deletePassword")} value={password} onChange={setPassword} autoComplete="current-password" />
        {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
        <button type="submit" className="button secondary" disabled={busy || !password}>{t("account.deleteConfirm")}</button>
      </form>
    </section>
  );
}

export function AccountSpace() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const { state, logout, setAccount } = useAuth();
  const [consents, setConsents] = useState<Consents | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  useDocumentTitle(t("account.title"));
  const authenticated = state.status === "authenticated";
  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    authApi.consents().then((value) => active && setConsents(value)).catch((error) => active && setFailure(errorText(error)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  if (state.status === "loading") return <div className="auth-page wide skeleton-stack" aria-busy="true"><Skeleton width="40%" height={34} /><Skeleton width="70%" /><Skeleton width="55%" /></div>;
  if (state.status === "anonymous") {
    if (state.reason === "deleted") return <Navigate to="/welcome" replace state={{ deleted: true }} />;
    return <Navigate to="/login" replace state={state.reason === "signed_out" ? { signedOut: true } : undefined} />;
  }
  if (state.status === "unavailable") return <div className="auth-page"><Notice tone={errorText(state.error).tone}>{errorText(state.error).text}</Notice></div>;
  const { account } = state;

  async function signOut() {
    await logout().catch(() => undefined);
  }

  return (
    <div className="account-page">
      <div className="page-heading account-heading">
        <div>
          <span className="eyebrow">{t(`account.eyebrow.${account.role}`)}</span>
          <h1>{t("account.heading")}</h1>
          <p>{t("account.signedInAs", { email: account.email })}</p>
        </div>
        <button type="button" className="button secondary" onClick={() => void signOut()}><LogOut size={16} aria-hidden="true" />{t("account.logout")}</button>
      </div>
      {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
      {account.role === "candidate" && <CandidateNav />}
      {account.role === "recruiter" && <RecruiterNav />}
      <Suspense fallback={<div className="card account-card skeleton-stack" aria-busy="true"><Skeleton width="40%" height={24} /><Skeleton width="75%" /></div>}>
      <Routes>
        <Route
          index
          element={
            <div className="account-grid">
              {account.role === "candidate" && <CandidatePanel consents={consents} onConsents={setConsents} />}
              {account.role === "recruiter" && <RecruiterPanel onCreated={() => void authApi.me().then(setAccount).catch(() => undefined)} />}
              <ConsentsPanel consents={consents} onConsents={setConsents} />
              <PreferencesPanel account={account} onAccount={setAccount} />
              <DataPanel />
              <DeletePanel />
            </div>
          }
        />
        {account.role === "candidate" && (
          <>
            <Route path="cv" element={<CvPage />} />
            <Route path="offers" element={<OffersPage />} />
            <Route path="offers/:id" element={<OfferPage />} />
          </>
        )}
        {account.role === "recruiter" && (
          <>
            <Route path="jobs" element={<JobsPage org={account.organizations[0]?.id ?? null} />} />
            <Route path="jobs/:id" element={<JobPage org={account.organizations[0]?.id ?? null} />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/account" replace />} />
      </Routes>
      </Suspense>
    </div>
  );
}
