import { useEffect, useMemo, useRef, useState } from "react";
import EChart, { useChartPalette } from "./EChart";
import { endpoints } from "@/api/endpoints";
import { useApi } from "@/api/useApi";
import { useAppData } from "@/api/AppDataProvider";
import { ChartError, ChartLoader } from "@/components/ui/Async";
import { CATEGORY_COLORS, SOURCE_COLORS, SUBSCORE_COLORS, ACCENT } from "@/theme/tokens";
import { fmt } from "@/lib/utils";
import { Pause, Play } from "lucide-react";

/* ── Treemap: ecosystem download share ───────────────────────────────── */
export function EcosystemTreemap({ height = 380, onLeafClick }: { height?: number; onLeafClick?: (slug: string) => void }) {
  const p = useChartPalette();
  const { categoryBySlug } = useAppData();
  const { data: tree, loading, error, reload } = useApi("treemap", endpoints.treemap);
  const data = useMemo(
    () =>
      (tree?.tree ?? []).map((cat) => ({
        name: categoryBySlug(cat.name)?.name ?? cat.name,
        itemStyle: { color: CATEGORY_COLORS[cat.name] + (p.dark ? "26" : "33"), borderColor: "transparent" },
        upperLabel: { show: true, color: p.mute, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" },
        children: cat.children.map((t) => ({
          name: t.name,
          value: t.value,
          slug: t.slug,
          itemStyle: { color: CATEGORY_COLORS[cat.name], borderColor: p.surface, borderWidth: 2, gapWidth: 2 },
        })),
      })),
    [tree, categoryBySlug, p],
  );
  const option = useMemo(
    () => ({
      tooltip: {
        ...p.tooltip,
        formatter: (x: any) => `<b>${x.name}</b><br/>${fmt(x.value * 1000)} monthly downloads`,
      },
      series: [
        {
          type: "treemap" as const,
          data,
          roam: false,
          nodeClick: false as const,
          breadcrumb: { show: false },
          width: "100%",
          height: "100%",
          label: { color: "#0B0F1A", fontSize: 12, fontWeight: 600 },
          upperLabel: { show: true, height: 22 },
          levels: [
            { itemStyle: { gapWidth: 4, borderWidth: 0 } },
            { itemStyle: { gapWidth: 2 } },
          ],
        },
      ],
    }),
    [data, p],
  );
  if (loading) return <ChartLoader height={height} />;
  if (error) return <ChartError error={error} retry={reload} height={height} />;
  return <EChart option={option as any} height={height} onClick={onLeafClick ? (x) => x.data?.slug && onLeafClick(x.data.slug) : undefined} />;
}

/* ── Sankey: sources → sub-scores → composite ────────────────────────── */
export function ScoreSankey({ slug, height = 360 }: { slug: string; height?: number }) {
  const p = useChartPalette();
  const { data: flow, loading, error, reload } = useApi(`flow:${slug}`, () => endpoints.techFlow(slug));
  const nodes = flow?.nodes ?? [];
  const links = flow?.links ?? [];
  const colorOf = (name: string) => {
    const map: Record<string, string> = {
      GitHub: SOURCE_COLORS.github, npm: SOURCE_COLORS.npm, PyPI: SOURCE_COLORS.pypi,
      "Hugging Face": SOURCE_COLORS.huggingface, "Stack Overflow": SOURCE_COLORS.stackoverflow,
      Adoption: SUBSCORE_COLORS.adoption, Activity: SUBSCORE_COLORS.activity,
      Growth: SUBSCORE_COLORS.growth, Community: SUBSCORE_COLORS.community,
    };
    return map[name] ?? ACCENT;
  };
  const option = useMemo(
    () => ({
      tooltip: { trigger: "item" as const, ...p.tooltip },
      series: [
        {
          type: "sankey" as const,
          data: nodes.map((n) => ({ name: n.name, itemStyle: { color: colorOf(n.name), borderWidth: 0 } })),
          links,
          left: 8, right: 130, top: 12, bottom: 12,
          nodeWidth: 10,
          nodeGap: 14,
          lineStyle: { color: "gradient" as const, opacity: 0.25, curveness: 0.55 },
          label: { color: p.text, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" },
          emphasis: { focus: "adjacency" as const },
        },
      ],
    }),
    [nodes, links, p],
  );
  if (loading) return <ChartLoader height={height} />;
  if (error) return <ChartError error={error} retry={reload} height={height} />;
  return <EChart option={option as any} height={height} />;
}

/* ── Calendar heatmap: 6 months of activity ──────────────────────────── */
export function ActivityCalendar({ slug, color = ACCENT, height = 180 }: { slug: string; color?: string; height?: number }) {
  const p = useChartPalette();
  const { data: cal, loading, error, reload } = useApi(`calendar:${slug}`, () => endpoints.techCalendar(slug));
  const data = cal?.days ?? [];
  const max = Math.max(...data.map((d) => d[1]), 1);
  const range: [string, string] = data.length
    ? [data[0][0], data[data.length - 1][0]]
    : ["2026-01-01", "2026-06-10"];
  const option = useMemo(
    () => ({
      tooltip: { ...p.tooltip, formatter: (x: any) => `<b>${x.value[0]}</b><br/>${x.value[1]} commits` },
      visualMap: {
        show: false, min: 0, max,
        inRange: { color: [p.dark ? "#1A2133" : "#EDF0F7", color + "66", color] },
      },
      calendar: {
        range,
        left: 36, right: 8, top: 24, bottom: 4,
        cellSize: ["auto", 13],
        itemStyle: { color: "transparent", borderColor: p.surface, borderWidth: 3 },
        splitLine: { show: false },
        dayLabel: { color: p.mute, fontSize: 9, nameMap: ["S", "M", "T", "W", "T", "F", "S"] },
        monthLabel: { color: p.mute, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" },
        yearLabel: { show: false },
      },
      series: [{ type: "heatmap" as const, coordinateSystem: "calendar" as const, data }],
    }),
    [data, max, range, color, p],
  );
  if (loading) return <ChartLoader height={height} />;
  if (error) return <ChartError error={error} retry={reload} height={height} />;
  return <EChart option={option as any} height={height} />;
}

/* ── Bubble scatter: the landscape ───────────────────────────────────── */
export function LandscapeBubbles({ height = 420, onTechClick }: { height?: number; onTechClick?: (slug: string) => void }) {
  const p = useChartPalette();
  const { data: land, loading, error, reload } = useApi("landscape", endpoints.landscape);
  const bubbles = land?.bubbles ?? [];
  const option = useMemo(
    () => ({
      tooltip: {
        ...p.tooltip,
        formatter: (x: any) =>
          `<b>${x.data.name}</b><br/>growth ${x.data.value[0]} · adoption ${x.data.value[1]}<br/><span style="color:${p.mute}">community ${x.data.value[2]} · score ${x.data.score}</span>`,
      },
      grid: { left: 48, right: 24, top: 30, bottom: 44 },
      xAxis: {
        name: "growth →", nameLocation: "end" as const, nameTextStyle: { color: p.mute, fontSize: 10 },
        min: 30, max: 100, splitLine: { lineStyle: { color: p.split } },
        axisLabel: { color: p.mute, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" },
        axisLine: { lineStyle: { color: p.split } },
      },
      yAxis: {
        name: "adoption ↑", nameTextStyle: { color: p.mute, fontSize: 10 },
        min: 30, max: 100, splitLine: { lineStyle: { color: p.split } },
        axisLabel: { color: p.mute, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" },
      },
      series: [
        {
          type: "scatter" as const,
          data: bubbles.map((b) => ({
            name: b.name, slug: b.slug, score: b.score,
            value: [b.x, b.y, b.size],
            itemStyle: { color: b.color, opacity: 0.85, borderColor: p.surface, borderWidth: 1.5 },
            label: { show: true, position: "top" as const, color: p.mute, fontSize: 10, formatter: b.name },
          })),
          symbolSize: (v: number[]) => 8 + (v[2] / 100) * 34,
          emphasis: { scale: 1.15 },
        },
      ],
    }),
    [bubbles, p],
  );
  if (loading) return <ChartLoader height={height} />;
  if (error) return <ChartError error={error} retry={reload} height={height} />;
  return <EChart option={option as any} height={height} onClick={onTechClick ? (x) => x.data?.slug && onTechClick(x.data.slug) : undefined} />;
}

/* ── Bar chart race: 12 months of rankings ───────────────────────────── */
export function ScoreRace({ category, height = 360 }: { category?: string; height?: number }) {
  const p = useChartPalette();
  const { data: race, loading, error, reload } = useApi(`race:${category ?? "all"}`, () => endpoints.race(category));
  const frames = race?.frames ?? [];
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timer = useRef<number>();

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    timer.current = window.setInterval(() => setI((x) => (x + 1) % frames.length), 1300);
    return () => window.clearInterval(timer.current);
  }, [playing, frames.length]);

  const frame = frames[Math.min(i, Math.max(0, frames.length - 1))] ?? { month: "", rows: [] };
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      xAxis: { max: 100, splitLine: { lineStyle: { color: p.split } }, axisLabel: { show: false } },
      yAxis: {
        type: "category" as const,
        inverse: true,
        data: frame.rows.map((r) => r.name),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: p.text, fontSize: 12, fontWeight: 500 },
        animationDuration: 300, animationDurationUpdate: 300,
      },
      series: [
        {
          type: "bar" as const,
          realtimeSort: true,
          data: frame.rows.map((r) => ({ value: r.value, itemStyle: { color: r.color, borderRadius: [0, 6, 6, 0] } })),
          barWidth: 16,
          label: {
            show: true, position: "right" as const, valueAnimation: true,
            color: p.mute, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            formatter: (x: any) => x.value.toFixed(1),
          },
        },
      ],
      animationDuration: 0,
      animationDurationUpdate: 900,
      animationEasingUpdate: "cubicInOut" as const,
    }),
    [frame, p],
  );

  if (loading) return <ChartLoader height={height} />;
  if (error) return <ChartError error={error} retry={reload} height={height} />;
  return (
    <div>
      <EChart option={option as any} height={height} />
      <div className="flex items-center gap-3 px-1 pt-1">
        <button
          onClick={() => setPlaying((x) => !x)}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-edge bg-raised text-ink transition-colors hover:border-accent/50"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <input
          type="range" min={0} max={Math.max(0, frames.length - 1)} value={i}
          onChange={(e) => { setI(Number(e.target.value)); setPlaying(false); }}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-edge accent-accent"
          aria-label="Month"
        />
        <span className="num w-14 text-right text-xs text-mute">{frame.month}</span>
      </div>
    </div>
  );
}
