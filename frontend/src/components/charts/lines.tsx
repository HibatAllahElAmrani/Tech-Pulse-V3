import { useMemo } from "react";
import EChart, { useChartPalette } from "./EChart";
import { getMonths } from "@/api/AppDataProvider";
import { ACCENT } from "@/theme/tokens";

/* ── Radar of sub-scores, 1..5 techs ─────────────────────────────────── */
export function SubScoreRadar({
  series,
  height = 300,
  showLegend = true,
}: {
  series: { name: string; color: string; values: { adoption: number; activity: number; growth: number; community: number } }[];
  height?: number;
  showLegend?: boolean;
}) {
  const p = useChartPalette();
  const option = useMemo(
    () => ({
      tooltip: { trigger: "item" as const, ...p.tooltip },
      legend: showLegend
        ? { bottom: 0, textStyle: { color: p.mute, fontSize: 11 }, icon: "circle", itemWidth: 8, itemGap: 16 }
        : { show: false },
      radar: {
        indicator: [
          { name: "Adoption", max: 100 },
          { name: "Activity", max: 100 },
          { name: "Growth", max: 100 },
          { name: "Community", max: 100 },
        ],
        radius: "68%",
        center: ["50%", showLegend ? "46%" : "50%"],
        axisName: { color: p.mute, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" },
        splitArea: { areaStyle: { color: ["transparent"] } },
        splitLine: { lineStyle: { color: p.split } },
        axisLine: { lineStyle: { color: p.split } },
      },
      series: [
        {
          type: "radar" as const,
          data: series.map((s) => ({
            name: s.name,
            value: [s.values.adoption, s.values.activity, s.values.growth, s.values.community],
            itemStyle: { color: s.color },
            lineStyle: { color: s.color, width: 2 },
            areaStyle: { color: s.color, opacity: 0.14 },
            symbolSize: 4,
          })),
        },
      ],
    }),
    [series, p, showLegend],
  );
  return <EChart option={option as any} height={height} />;
}

/* ── Tiny sparkline ──────────────────────────────────────────────────── */
export function Sparkline({ data, color = ACCENT, height = 36 }: { data: number[]; color?: string; height?: number }) {
  const option = useMemo(
    () => ({
      grid: { left: 0, right: 0, top: 4, bottom: 0 },
      xAxis: { type: "category" as const, show: false, data: data.map((_, i) => i) },
      yAxis: { type: "value" as const, show: false, min: Math.min(...data) * 0.97, max: Math.max(...data) * 1.03 },
      series: [
        {
          type: "line" as const,
          data,
          smooth: true,
          symbol: "none",
          lineStyle: { color, width: 1.8 },
          areaStyle: {
            color: {
              type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: color + "55" },
                { offset: 1, color: color + "00" },
              ],
            },
          },
          animationDuration: 800,
        },
      ],
    }),
    [data, color],
  );
  return <EChart option={option as any} height={height} />;
}

/* ── Multi-series line with brush/zoom ───────────────────────────────── */
export function MultiLine({
  series,
  months = getMonths(),
  height = 340,
  yName = "composite score",
  brush = true,
  yMin,
  yMax,
}: {
  series: { name: string; color: string; data: number[] }[];
  months?: string[];
  height?: number;
  yName?: string;
  brush?: boolean;
  yMin?: number;
  yMax?: number;
}) {
  const p = useChartPalette();
  const option = useMemo(
    () => ({
      tooltip: { trigger: "axis" as const, ...p.tooltip },
      legend: { top: 0, right: 0, textStyle: { color: p.mute, fontSize: 11 }, icon: "circle", itemWidth: 8 },
      grid: { left: 42, right: 16, top: 36, bottom: brush ? 64 : 28 },
      xAxis: {
        type: "category" as const,
        data: months,
        axisLine: { lineStyle: { color: p.split } },
        axisLabel: { color: p.mute, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" },
        axisTick: { show: false },
        boundaryGap: false,
      },
      yAxis: {
        type: "value" as const,
        name: yName,
        nameTextStyle: { color: p.mute, fontSize: 10, align: "left" as const },
        min: yMin,
        max: yMax,
        splitLine: { lineStyle: { color: p.split } },
        axisLabel: { color: p.mute, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" },
      },
      dataZoom: brush
        ? [
            { type: "inside" as const },
            {
              type: "slider" as const,
              height: 22,
              bottom: 8,
              borderColor: p.edge,
              backgroundColor: "transparent",
              fillerColor: "rgba(124,92,255,0.12)",
              handleStyle: { color: ACCENT },
              moveHandleStyle: { color: ACCENT },
              dataBackground: { lineStyle: { color: p.split }, areaStyle: { color: p.split } },
              textStyle: { color: p.mute, fontSize: 9 },
            },
          ]
        : undefined,
      series: series.map((s) => ({
        name: s.name,
        type: "line" as const,
        data: s.data,
        smooth: true,
        symbol: "circle",
        symbolSize: 4,
        showSymbol: false,
        lineStyle: { color: s.color, width: 2.2 },
        itemStyle: { color: s.color },
        emphasis: { focus: "series" as const },
      })),
    }),
    [series, months, p, yName, brush, yMin, yMax],
  );
  return <EChart option={option as any} height={height} />;
}

/* ── Forecast line with confidence band ──────────────────────────────── */
export function ForecastChart({
  months, hist, mid, lo, hi, color = ACCENT, height = 340,
}: {
  months: string[]; hist: number[]; mid: number[]; lo: number[]; hi: number[]; color?: string; height?: number;
}) {
  const p = useChartPalette();
  const option = useMemo(() => {
    const histPadded = [...hist, ...Array(mid.length).fill(null)];
    const bridge = Array(hist.length - 1).fill(null);
    const midPadded = [...bridge, hist[hist.length - 1], ...mid];
    const loPadded = [...bridge, hist[hist.length - 1], ...lo];
    const bandPadded = [...Array(hist.length).fill(0), ...hi.map((h, i) => Math.round((h - lo[i]) * 10) / 10)];
    return {
      tooltip: {
        trigger: "axis" as const, ...p.tooltip,
        formatter: (ps: any[]) => {
          const m = ps[0]?.axisValue;
          const lines = ps
            .filter((x) => x.seriesName !== "band" && x.value != null)
            .map((x) => `${x.marker} ${x.seriesName}: <b>${x.value}</b>`);
          return `<b>${m}</b><br/>${lines.join("<br/>")}`;
        },
      },
      grid: { left: 42, right: 16, top: 28, bottom: 28 },
      xAxis: {
        type: "category" as const, data: months, boundaryGap: false,
        axisLine: { lineStyle: { color: p.split } },
        axisLabel: { color: p.mute, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const, scale: true,
        splitLine: { lineStyle: { color: p.split } },
        axisLabel: { color: p.mute, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" },
      },
      series: [
        { name: "lower", type: "line" as const, data: loPadded, stack: "band", symbol: "none", lineStyle: { width: 0 }, silent: true, tooltip: { show: false } },
        {
          name: "band", type: "line" as const, data: bandPadded, stack: "band", symbol: "none",
          lineStyle: { width: 0 }, areaStyle: { color, opacity: 0.13 }, silent: true, tooltip: { show: false },
        },
        {
          name: "observed", type: "line" as const, data: histPadded, smooth: true, symbol: "none",
          lineStyle: { color, width: 2.4 }, itemStyle: { color },
        },
        {
          name: "forecast", type: "line" as const, data: midPadded, smooth: true, symbol: "none",
          lineStyle: { color, width: 2, type: "dashed" as const }, itemStyle: { color },
        },
      ],
      markLine: undefined,
    };
  }, [months, hist, mid, lo, hi, color, p]);
  return <EChart option={option as any} height={height} />;
}
