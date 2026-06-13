import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { cn, pct } from "@/lib/utils";
import { ACCENT } from "@/theme/tokens";

/* ── ScoreRing: the signature composite-score dial ───────────────────── */
export function ScoreRing({
  value, size = 92, stroke = 7, color = ACCENT, label = "score", className,
}: {
  value: number; size?: number; stroke?: number; color?: string; label?: string; className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(value));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-edge" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          stroke={color}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - animated / 100)}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)", filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num font-semibold leading-none" style={{ fontSize: size * 0.26 }}>{value}</span>
        <span className="text-[9px] uppercase tracking-[0.14em] text-mute">{label}</span>
      </div>
    </div>
  );
}

/* ── CountUp: animated counter for hero stats ────────────────────────── */
export function CountUp({ to, duration = 1600, format }: { to: number; duration?: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let raf: number;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration]);
  return <span ref={ref} className="num">{format ? format(v) : v.toLocaleString()}</span>;
}

/* ── Delta: signed change chip ───────────────────────────────────────── */
export function Delta({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  const up = value >= 0;
  return (
    <span className={cn("num inline-flex items-center gap-0.5 text-xs font-medium", up ? "text-emerald-400" : "text-rose-400", className)}>
      {up ? "▲" : "▼"} {pct(Math.abs(value) * (up ? 1 : -1)).replace("+", up ? "+" : "")}{suffix}
    </span>
  );
}

/* ── PulseDot: live indicator ────────────────────────────────────────── */
export function PulseDot({ color = ACCENT, className }: { color?: string; className?: string }) {
  return (
    <span className={cn("relative inline-flex h-2 w-2", className)}>
      <span className="absolute inline-flex h-full w-full animate-pulseDot rounded-full" style={{ backgroundColor: color }} />
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

/* ── SubScoreBars: compact horizontal sub-score readout ──────────────── */
export function SubScoreBars({
  scores, colors, className,
}: {
  scores: { label: string; value: number; delta?: number }[];
  colors: string[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {scores.map((s, i) => (
        <div key={s.label}>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-mute">{s.label}</span>
            <span className="flex items-baseline gap-2">
              {s.delta != null && <Delta value={s.delta} />}
              <span className="num font-semibold text-ink">{s.value}</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-edge">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{ width: `${s.value}%`, backgroundColor: colors[i % colors.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
