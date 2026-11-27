import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthApiError, authApi } from "../auth/api";
import { Field, Notice, PasswordField, useDocumentTitle, useErrorText } from "./shared";

export function ForgotPassword() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ text: string; tone: "warning" | "error" } | null>(null);
  useDocumentTitle(t("forgot.title"));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setFailure(null);
    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-panel card" aria-labelledby="forgot-heading">
        <h1 id="forgot-heading">{t("forgot.heading")}</h1>
        <p>{t("forgot.lead")}</p>
        {sent ? (
          <Notice tone="info">{t("forgot.sent")}</Notice>
        ) : (
          <form onSubmit={(event) => void submit(event)} noValidate className="auth-form">
            <Field label={t("login.email")} type="email" autoComplete="email" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} required />
            {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
            <button type="submit" className="button primary auth-submit" disabled={busy}>{t("forgot.submit")}</button>
          </form>
        )}
        <Link to="/login" className="text-button">{t("common.nav.login")}</Link>
      </section>
    </div>
  );
}

export function ResetPassword() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [params] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<{ text: string; tone: "warning" | "error" } | null>(null);
  useDocumentTitle(t("reset.title"));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (busy || !token || password.length < 12) return;
    setBusy(true);
    setFailure(null);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (error) {
      setFailure(error instanceof AuthApiError && error.code === "invalid_token" ? { text: t("verify.invalid"), tone: "warning" } : errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-panel card" aria-labelledby="reset-heading">
        <h1 id="reset-heading">{t("reset.heading")}</h1>
        {done ? (
          <>
            <Notice tone="success">{t("reset.done")}</Notice>
            <Link to="/login" className="button primary auth-submit">{t("common.nav.login")}</Link>
          </>
        ) : !token ? (
          <Notice tone="warning">{t("verify.missing")}</Notice>
        ) : (
          <>
            <p>{t("reset.lead")}</p>
            <form onSubmit={(event) => void submit(event)} noValidate className="auth-form">
              <PasswordField label={t("register.password")} value={password} onChange={setPassword} autoComplete="new-password" hint={t("register.passwordHint")} error={touched && password.length < 12 ? t("register.strength.short", { count: 12 - password.length }) : undefined} strength />
              {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
              <button type="submit" className="button primary auth-submit" disabled={busy}>{t("reset.submit")}</button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
