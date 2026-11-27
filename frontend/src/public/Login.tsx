import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthApiError, authApi } from "../auth/api";
import { useAuth } from "../auth/AuthContext";
import { Field, Notice, PasswordField, useDocumentTitle, useErrorText } from "./shared";

export function Login() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const { state, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const [failure, setFailure] = useState<{ text: string; tone: "warning" | "error" } | null>(null);
  useDocumentTitle(t("login.title"));
  const signedOut = (location.state as { signedOut?: boolean } | null)?.signedOut;
  if (state.status === "authenticated" && !busy) return <Navigate to="/account" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setFailure(null);
    setUnverified(false);
    setResent(false);
    try {
      await login(email.trim(), password);
      navigate("/account", { replace: true });
    } catch (error) {
      setBusy(false);
      if (error instanceof AuthApiError && error.code === "invalid_credentials") setFailure({ text: t("login.invalid"), tone: "warning" });
      else if (error instanceof AuthApiError && error.code === "email_not_verified") {
        setUnverified(true);
        setFailure({ text: t("login.unverified"), tone: "warning" });
      } else setFailure(errorText(error));
    }
  }

  async function resend() {
    try {
      await authApi.resendVerification(email.trim());
      setResent(true);
    } catch (error) {
      setFailure(errorText(error));
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-panel card" aria-labelledby="login-heading">
        <h1 id="login-heading">{t("login.heading")}</h1>
        <p>{t("login.lead")}</p>
        {signedOut && !failure && <Notice tone="info">{t("login.signedOut")}</Notice>}
        <form onSubmit={(event) => void submit(event)} noValidate className="auth-form">
          <Field label={t("login.email")} type="email" autoComplete="username" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} required />
          <PasswordField label={t("login.password")} value={password} onChange={setPassword} autoComplete="current-password" />
          {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
          {unverified && (resent ? <Notice tone="info">{t("register.resent")}</Notice> : <button type="button" className="text-button" onClick={() => void resend()}>{t("login.resend")}</button>)}
          <button type="submit" className={`button primary auth-submit${busy ? " is-busy" : ""}`} disabled={busy}>
            {busy && <span className="busy-dot" aria-hidden="true" />}
            {busy ? t("login.submitting") : t("login.submit")}
          </button>
        </form>
        <Link to="/forgot-password" className="text-button">{t("login.forgot")}</Link>
      </section>
      <p className="auth-switch">{t("login.noAccount")} <Link to="/register" className="text-button">{t("common.nav.register")}</Link></p>
    </div>
  );
}
