import { useEffect, useId, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Info } from "lucide-react";
import { AuthApiError } from "../auth/api";

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · TalentFlow AI`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

const SYSTEM_CODES = new Set(["network", "service_not_configured", "email_unavailable"]);

/** Translated message and tone. Red is reserved for system errors; a person's mistake is amber. */
export function useErrorText() {
  const { t } = useTranslation();
  return (error: unknown): { text: string; tone: "warning" | "error" } => {
    if (!(error instanceof AuthApiError)) return { text: t("common.errors.generic"), tone: "error" };
    const tone = SYSTEM_CODES.has(error.code) || error.status >= 500 ? "error" : "warning";
    switch (error.code) {
      case "network":
        return { text: t("common.errors.network"), tone };
      case "too_many_attempts":
        return { text: t("common.errors.tooMany", { seconds: error.retryAfter ?? 60 }), tone };
      case "service_not_configured":
        return { text: t("common.errors.notConfigured"), tone };
      case "email_unavailable":
        return { text: t("common.errors.emailUnavailable"), tone };
      case "validation_error":
        return { text: t("common.errors.validation"), tone };
      default:
        return { text: tone === "error" ? t("common.errors.generic") : error.message, tone };
    }
  };
}

export function Notice({ tone, children }: { tone: "info" | "success" | "warning" | "error"; children: ReactNode }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  // Errors interrupt (alert); everything else is announced politely.
  return (
    <div className={`notice ${tone === "success" ? "success" : tone}`} role={tone === "error" || tone === "warning" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
}

export function Field({ label, hint, error, id, ...input }: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className="auth-field">
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} aria-invalid={error ? true : undefined} aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined} {...input} />
      {hint && <p id={hintId} className="auth-hint">{hint}</p>}
      {error && <p id={errorId} className="auth-error">{error}</p>}
    </div>
  );
}

export function PasswordField({ label, value, onChange, autoComplete, hint, error, strength = false }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string; hint?: string; error?: string; strength?: boolean }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const id = useId();
  const level = !value ? "empty" : value.length < 12 ? "short" : value.length < 16 ? "fair" : "strong";
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          maxLength={128}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hint ? `${id}-hint` : "", strength ? `${id}-strength` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined}
        />
        <button type="button" className="icon-button" aria-label={visible ? t("common.hide") : t("common.show")} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
          {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        </button>
      </div>
      {hint && <p id={`${id}-hint`} className="auth-hint">{hint}</p>}
      {strength && (
        <p id={`${id}-strength`} className={`password-strength ${level}`} aria-live="polite">
          {level === "empty" ? "" : t(`register.strength.${level}`, { count: Math.max(0, 12 - value.length) })}
        </p>
      )}
      {error && <p id={`${id}-error`} className="auth-error">{error}</p>}
    </div>
  );
}
