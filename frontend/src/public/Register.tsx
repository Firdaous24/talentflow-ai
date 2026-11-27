import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Check, MailCheck, UserRound } from "lucide-react";
import { authApi } from "../auth/api";
import type { Locale } from "../auth/api";
import { currentLanguage } from "../i18n";
import { Field, Notice, PasswordField, useDocumentTitle, useErrorText } from "./shared";

const ROLES = [
  { id: "candidate", icon: UserRound },
  { id: "recruiter", icon: BriefcaseBusiness },
] as const;

export function RoleChoice() {
  const { t } = useTranslation();
  useDocumentTitle(t("roles.title"));
  return (
    <div className="auth-page wide">
      <div className="auth-heading">
        <span className="eyebrow">{t("roles.eyebrow")}</span>
        <h1>{t("roles.heading")}</h1>
        <p>{t("roles.lead")}</p>
      </div>
      <ul className="role-grid">
        {ROLES.map(({ id, icon: Icon }) => {
          const points = t(`roles.${id}.points`, { returnObjects: true }) as string[];
          return (
            <li key={id}>
              <Link to={`/register/${id}`} className="role-card card">
                <span className="role-icon"><Icon size={24} aria-hidden="true" /></span>
                <span className="role-name">{t(`roles.${id}.name`)}</span>
                <ul className="role-points">
                  {points.map((point) => <li key={point}><Check size={15} aria-hidden="true" />{point}</li>)}
                </ul>
                <span className="role-choose" aria-hidden="true">{t("roles.choose")}<ArrowRight size={15} /></span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="auth-switch">{t("roles.haveAccount")} <Link to="/login" className="text-button">{t("common.nav.login")}</Link></p>
    </div>
  );
}

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function Register() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const { role } = useParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [locale, setLocale] = useState<Locale>(currentLanguage());
  const [accepted, setAccepted] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [failure, setFailure] = useState<{ text: string; tone: "warning" | "error" } | null>(null);
  useDocumentTitle(t("register.title"));
  if (role !== "candidate" && role !== "recruiter") return <Navigate to="/register" replace />;

  const emailError = touched && !EMAIL_PATTERN.test(email.trim()) ? t("common.errors.validation") : undefined;
  const passwordError = touched && password.length < 12 ? t("register.strength.short", { count: 12 - password.length }) : undefined;
  const termsError = touched && !accepted ? t("register.termsRequired") : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    setFailure(null);
    if (!EMAIL_PATTERN.test(email.trim()) || password.length < 12 || !accepted || busy) return;
    setBusy(true);
    try {
      await authApi.register({ email: email.trim(), password, role: role as "candidate" | "recruiter", locale, accept_terms: true, marketing });
      setSentTo(email.trim());
      setPassword("");
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!sentTo) return;
    try {
      await authApi.resendVerification(sentTo);
      setResent(true);
    } catch (error) {
      setFailure(errorText(error));
    }
  }

  if (sentTo) {
    return (
      <div className="auth-page">
        <section className="auth-panel card" aria-labelledby="sent-heading">
          <span className="auth-symbol"><MailCheck size={26} aria-hidden="true" /></span>
          <h1 id="sent-heading">{t("register.sentTitle")}</h1>
          <p>{t("register.sentBody", { email: sentTo })}</p>
          <p className="auth-hint">{t("register.localMail")}</p>
          {resent && <Notice tone="info">{t("register.resent")}</Notice>}
          {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
          <div className="auth-actions">
            <button type="button" className="button secondary" onClick={() => void resend()}>{t("register.resend")}</button>
            <Link to="/login" className="button primary">{t("register.toLogin")}</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <Link to="/register" className="back-link"><ArrowLeft size={15} aria-hidden="true" />{t("register.changeRole")}</Link>
      <section className="auth-panel card" aria-labelledby="register-heading">
        <span className="eyebrow">{t("register.eyebrow")}</span>
        <h1 id="register-heading">{t(`register.heading.${role}`)}</h1>
        <form onSubmit={(event) => void submit(event)} noValidate className="auth-form">
          <Field label={t("register.email")} type="email" autoComplete="email" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} error={emailError} required />
          <PasswordField label={t("register.password")} value={password} onChange={setPassword} autoComplete="new-password" hint={t("register.passwordHint")} error={passwordError} strength />
          <div className="auth-field">
            <label htmlFor="register-locale">{t("register.locale")}</label>
            <select id="register-locale" value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
              <option value="fr">{t("common.language.fr")}</option>
              <option value="en">{t("common.language.en")}</option>
            </select>
          </div>
          <fieldset className="consent-group">
            <label className="check">
              <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} aria-invalid={termsError ? true : undefined} aria-describedby={termsError ? "terms-error" : undefined} />
              <span><Trans i18nKey="register.terms" components={{ terms: <Link to="/legal/terms" target="_blank" rel="noopener" />, privacy: <Link to="/legal/privacy" target="_blank" rel="noopener" /> }} /></span>
            </label>
            {termsError && <p id="terms-error" className="auth-error">{termsError}</p>}
            <label className="check">
              <input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} />
              <span>{t("register.marketing")}</span>
            </label>
          </fieldset>
          {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
          <button type="submit" className={`button primary auth-submit${busy ? " is-busy" : ""}`} disabled={busy}>
            {busy && <span className="busy-dot" aria-hidden="true" />}
            {busy ? t("register.submitting") : t("register.submit")}
          </button>
        </form>
      </section>
      <p className="auth-switch">{t("roles.haveAccount")} <Link to="/login" className="text-button">{t("common.nav.login")}</Link></p>
    </div>
  );
}
