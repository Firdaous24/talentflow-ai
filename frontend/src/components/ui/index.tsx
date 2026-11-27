/** Design-system primitives. Styling lives in theme/base.css and theme/layout.css. */
import { useEffect, useRef } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, CircleDashed, CircleHelp, Layers, Minus } from "lucide-react";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

type ButtonVariant = "primary" | "secondary" | "ghost";
export function Button({ variant = "secondary", className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={cx("button", variant, className)} {...props} />;
}

export function Card({ className, as: Element = "section", ...props }: HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" }) {
  return <Element className={cx("card", className)} {...props} />;
}

type BadgeTone = "neutral" | "green" | "amber" | "violet";
export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cx("badge", tone, className)} {...props} />;
}

export type EvidenceStatus = "documented" | "needs_review" | "not_documented" | "environment" | "neutral" | "accent";
const statusIcons = { documented: Check, needs_review: CircleHelp, not_documented: Minus, environment: Layers, neutral: CircleDashed, accent: Check };
/** Status with an icon and text, never colour alone. "Not documented" is neutral: an absence, not a failure. */
export function StatusPill({ status, children, className }: { status: EvidenceStatus; children: ReactNode; className?: string }) {
  const Icon = statusIcons[status];
  return <span className={cx("status-pill", status, className)}><Icon aria-hidden="true" strokeWidth={2.25} />{children}</span>;
}

export type StepStatus = "todo" | "current" | "done" | "blocked";
export interface StepItem { id: string; label: string; status: StepStatus; to: string; description: string }
const stepStatusText: Record<StepStatus, string> = { todo: "to do", current: "in progress", done: "done", blocked: "blocked" };
/** A clickable progress trail. Each link announces its position, label and state. */
export function Stepper({ steps, label }: { steps: StepItem[]; label: string }) {
  const container = useRef<HTMLElement>(null);
  const currentIndex = steps.findIndex((step) => step.status === "current" || step.status === "blocked");
  useEffect(() => {
    // Keep the active step visible on narrow screens without moving the page vertically.
    const nav = container.current;
    const item = nav?.querySelectorAll("li")[currentIndex];
    if (!nav || !item || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = Math.max(0, item.offsetLeft - (nav.clientWidth - item.clientWidth) / 2);
  }, [currentIndex]);
  return (
    <nav className="stepper" aria-label={label} ref={container}>
      <ol>
        {steps.map((step, index) => (
          <li key={step.id} className={cx("stepper-item", step.status)}>
            <Link
              to={step.to}
              aria-label={`Step ${index + 1} of ${steps.length}, ${step.description}: ${stepStatusText[step.status]}`}
              aria-current={step.status === "current" ? "step" : undefined}
            >
              <span className="stepper-marker" aria-hidden="true">
                {step.status === "done" ? <Check size={13} strokeWidth={2.75} /> : step.status === "blocked" ? <AlertTriangle size={12} strokeWidth={2.5} /> : index + 1}
              </span>
              <span className="stepper-label" aria-hidden="true">{step.label}</span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Skeleton({ width = "100%", height = 14, className }: { width?: number | string; height?: number | string; className?: string }) {
  return <span className={cx("skeleton", className)} style={{ width, height }} aria-hidden="true" />;
}

/** Hand-drawn empty-state art: a dossier with an empty evidence slip. */
export function EmptyArt({ variant = "dossier" }: { variant?: "dossier" | "graph" }) {
  if (variant === "graph")
    return (
      <svg className="ui-empty-art" viewBox="0 0 120 64" fill="none" aria-hidden="true">
        <path d="M14 32h22M50 32h20M84 32h22" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 4" strokeLinecap="round" />
        <circle cx="10" cy="32" r="6" stroke="currentColor" strokeWidth="1.5" />
        <rect x="38" y="22" width="12" height="20" rx="4" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="77" cy="32" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M74 32l2.2 2.2L80.5 30" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="104" y="24" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  return (
    <svg className="ui-empty-art" viewBox="0 0 120 92" fill="none" aria-hidden="true">
      <path d="M18 20h30l8 8h46a4 4 0 0 1 4 4v48a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V24a4 4 0 0 1 4-4Z" stroke="currentColor" strokeWidth="1.5" />
      <rect x="34" y="40" width="52" height="30" rx="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3.5" />
      <path d="M42 50h24M42 58h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ title, children, action, art = "dossier" }: { title: string; children: ReactNode; action?: ReactNode; art?: "dossier" | "graph" }) {
  return (
    <div className="ui-empty">
      <EmptyArt variant={art} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
