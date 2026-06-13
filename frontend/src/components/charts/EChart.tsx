import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { useTheme } from "@/theme/ThemeProvider";
import { PALETTE } from "@/theme/tokens";

export function useChartPalette() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return useMemo(
    () => ({
      dark,
      text: dark ? "#E5E7EB" : "#171E30",
      mute: dark ? "#94A3B8" : "#64748B",
      axis: dark ? "#94A3B8" : "#64748B",
      split: dark ? "rgba(148,163,184,0.10)" : "rgba(100,116,139,0.14)",
      surface: dark ? "#121826" : "#FFFFFF",
      edge: dark ? "#232C42" : "#E2E6F0",
      emptyGeo: dark ? "#1A2133" : "#EDF0F7",
      geoBorder: dark ? "#2A3450" : "#D6DCE8",
      tooltip: {
        backgroundColor: dark ? "#1A2133" : "#FFFFFF",
        borderColor: dark ? "#2A3450" : "#E2E6F0",
        textStyle: { color: dark ? "#E5E7EB" : "#171E30", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" },
        borderRadius: 10,
        padding: [8, 12],
        extraCssText: "box-shadow: 0 12px 32px -12px rgba(0,0,0,.5);",
      },
    }),
    [dark],
  );
}

export default function EChart({
  option,
  height = 320,
  onClick,
  className,
}: {
  option: EChartsOption;
  height?: number | string;
  onClick?: (params: any) => void;
  className?: string;
}) {
  const { theme } = useTheme();
  const merged: EChartsOption = useMemo(
    () => ({
      color: PALETTE,
      textStyle: { fontFamily: "Inter, system-ui, sans-serif" },
      animationDuration: 600,
      animationEasing: "cubicOut",
      ...option,
    }),
    [option],
  );
  return (
    <ReactECharts
      key={theme} // re-init on theme switch so colors refresh cleanly
      option={merged}
      notMerge
      lazyUpdate
      style={{ height, width: "100%" }}
      className={className}
      onEvents={onClick ? { click: onClick } : undefined}
    />
  );
}
