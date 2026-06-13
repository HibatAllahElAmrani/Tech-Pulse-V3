import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ── Button ──────────────────────────────────────────────────────────── */
type ButtonVariant = "primary" | "secondary" | "ghost";
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl2 font-medium transition-all duration-200",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-accent text-white shadow-[0_4px_16px_-4px_rgb(124_92_255/0.6)] hover:brightness-110",
        variant === "secondary" && "border border-edge bg-surface text-ink hover:border-accent/50 hover:bg-raised",
        variant === "ghost" && "text-mute hover:bg-raised hover:text-ink",
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

/* ── Card ────────────────────────────────────────────────────────────── */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}

export function CardHeader({ title, hint, right, className }: { title: ReactNode; hint?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-5 pt-5", className)}>
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-mute">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

/* ── Badge ───────────────────────────────────────────────────────────── */
export function Badge({ className, color, children }: { className?: string; color?: string; children: ReactNode }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", className)}
      style={color ? { color, borderColor: color + "55", backgroundColor: color + "14" } : undefined}
    >
      {children}
    </span>
  );
}

/* ── Tabs ────────────────────────────────────────────────────────────── */
export function Tabs<T extends string>({
  tabs, value, onChange, className,
}: {
  tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void; className?: string;
}) {
  return (
    <div className={cn("flex gap-1 overflow-x-auto border-b border-edge", className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors duration-200",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
            value === t.id ? "text-ink" : "text-mute hover:text-ink",
          )}
        >
          {t.label}
          {value === t.id && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  );
}

/* ── Segmented control ───────────────────────────────────────────────── */
export function Segmented<T extends string>({
  options, value, onChange, className,
}: {
  options: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void; className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-xl2 border border-edge bg-surface p-1", className)} role="group">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200",
            value === o.id ? "bg-accent text-white shadow-sm" : "text-mute hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Select (native, styled) ─────────────────────────────────────────── */
export function Select<T extends string>({
  options, value, onChange, className, label,
}: {
  options: { id: T; label: string }[]; value: T; onChange: (t: T) => void; className?: string; label?: string;
}) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-xs text-mute", className)}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-8 cursor-pointer rounded-lg border border-edge bg-surface px-2 text-xs font-medium text-ink transition-colors hover:border-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
