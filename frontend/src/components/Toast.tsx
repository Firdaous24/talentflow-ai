import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

type Tone = "info" | "success" | "error";
interface Toast { id: number; tone: Tone; message: string }
const ToastContext = createContext<((message: string, tone?: Tone) => void) | null>(null);
const icons = { info: Info, success: CheckCircle2, error: TriangleAlert };

/** Discreet, polite notifications. Errors stay until dismissed; others fade after a few seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);
  const notify = useCallback((message: string, tone: Tone = "info") => {
    const id = ++nextId.current;
    setToasts((current) => [...current.slice(-2), { id, tone, message }]);
    if (tone !== "error") timers.current.set(id, setTimeout(() => dismiss(id), 6000));
  }, [dismiss]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-region" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = icons[toast.tone];
          return (
            <div key={toast.id} className={`toast ${toast.tone}`}>
              <Icon size={18} aria-hidden="true" />
              <p>{toast.message}</p>
              <button type="button" className="icon-button" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}><X size={15} aria-hidden="true" /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
export function useToast() {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error("Missing toast provider");
  return notify;
}
