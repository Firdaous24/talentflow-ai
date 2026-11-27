import { Link, NavLink, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layers3 } from "lucide-react";
import { AuthProvider, useAuth } from "../auth/AuthContext";
import { ThemeToggle } from "../components/ThemeToggle";
import { LANGUAGES, currentLanguage, setLanguage } from "../i18n";
import { AccountSpace } from "./AccountSpace";
import { Claim } from "./Claim";
import { ForgotPassword, ResetPassword } from "./Password";
import { Legal } from "./Legal";
import { Login } from "./Login";
import { Register, RoleChoice } from "./Register";
import { VerifyEmail } from "./VerifyEmail";
import { Welcome } from "./Welcome";
import "./public.css";

/** Paths served by the public shell; every other path stays in the demo workbench. */
export const PUBLIC_PATHS = ["/welcome", "/register", "/login", "/verify-email", "/forgot-password", "/reset-password", "/account", "/legal", "/claim"];

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function LanguageSwitch() {
  const { t } = useTranslation();
  const active = currentLanguage();
  return (
    <div className="segmented language-switch" role="group" aria-label={t("common.language.label")}>
      {LANGUAGES.map((language) => (
        <button key={language} type="button" lang={language} aria-pressed={active === language} aria-label={t(`common.language.${language}`)} onClick={() => setLanguage(language)}>
          {language.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function Header() {
  const { t } = useTranslation();
  const { state } = useAuth();
  return (
    <header className="public-header">
      <Link to="/welcome" className="brand" aria-label={t("common.nav.home")}>
        <span className="brand-icon"><Layers3 size={23} aria-hidden="true" /></span>
        <span aria-hidden="true">TalentFlow<span className="brand-ai"> AI</span><small>{t("common.brandTagline")}</small></span>
      </Link>
      <nav className="public-nav" aria-label={t("common.nav.label")}>
        <NavLink to="/" end className="public-nav-link">{t("common.nav.demo")}</NavLink>
        {state.status === "authenticated" ? (
          <Link to="/account" className="button primary">{t("common.nav.account")}</Link>
        ) : (
          <>
            <NavLink to="/login" className="public-nav-link">{t("common.nav.login")}</NavLink>
            <Link to="/register" className="button primary">{t("common.nav.register")}</Link>
          </>
        )}
      </nav>
      <div className="public-tools">
        <LanguageSwitch />
        <ThemeToggle labels={{ dark: t("common.theme.toDark"), light: t("common.theme.toLight") }} />
      </div>
    </header>
  );
}

function Shell() {
  const { t } = useTranslation();
  return (
    <div className="public" lang={currentLanguage()}>
      <div className="demo-banner" role="note">
        <strong>{t("common.demoBanner")}</strong>
        <span>{t("common.demoBannerDetail")}</span>
      </div>
      <Header />
      <main id="public-main" className="public-main">
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/register" element={<RoleChoice />} />
          <Route path="/register/:role" element={<Register />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/account/*" element={<AccountSpace />} />
          <Route path="/legal/:page" element={<Legal />} />
          <Route path="/claim" element={<Claim />} />
        </Routes>
      </main>
      <footer className="public-footer">
        <p>{t("common.footer.market")}</p>
        <nav aria-label={t("common.footer.legal")}>
          <Link to="/legal/terms">{t("common.footer.terms")}</Link>
          <Link to="/legal/privacy">{t("common.footer.privacy")}</Link>
        </nav>
      </footer>
    </div>
  );
}

export function PublicApp() {
  // Re-render on language change through useTranslation inside Shell.
  useTranslation();
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
