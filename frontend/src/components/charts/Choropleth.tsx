import * as echarts from "echarts";
import { useMemo } from "react";
import EChart, { useChartPalette } from "./EChart";
import worldJson from "@/assets/world.json";
import { ACCENT } from "@/theme/tokens";

let registered = false;
function ensureWorld() {
  if (!registered) {
    echarts.registerMap("world", worldJson as any);
    registered = true;
  }
}

export interface GeoDatum {
  name: string; // GeoJSON country name
  display?: string;
  value: number;
  confidence?: number;
}

export default function Choropleth({
  data,
  height = 420,
  label = "share of activity",
  roam = false,
  zoom = 1.15,
  center,
  showVisualMap = true,
  onCountryClick,
}: {
  data: GeoDatum[];
  height?: number | string;
  label?: string;
  roam?: boolean;
  zoom?: number;
  center?: [number, number];
  showVisualMap?: boolean;
  onCountryClick?: (name: string) => void;
}) {
  ensureWorld();
  const p = useChartPalette();

  const option = useMemo(
    () => ({
      tooltip: {
        trigger: "item" as const,
        ...p.tooltip,
        formatter: (params: any) => {
          const d = data.find((x) => x.name === params.name);
          if (!d) return `${params.name}<br/><span style="color:${p.mute}">no signal</span>`;
          const conf = d.confidence != null ? `<br/><span style="color:${p.mute}">confidence ${d.confidence.toFixed(2)}</span>` : "";
          return `<b>${d.display ?? d.name}</b><br/>${d.value} ${label}${conf}`;
        },
      },
      visualMap: {
        show: showVisualMap,
        min: 0,
        max: Math.max(...data.map((d) => d.value), 1),
        left: 8,
        bottom: 8,
        text: ["high", "low"],
        textStyle: { color: p.mute, fontSize: 10 },
        inRange: { color: [p.dark ? "#1E2640" : "#E4E0FF", "#5B43C9", ACCENT, "#B9A6FF"] },
        calculable: false,
        itemWidth: 10,
        itemHeight: 90,
      },
      series: [
        {
          type: "map" as const,
          map: "world",
          roam,
          zoom,
          center,
          data,
          itemStyle: {
            areaColor: p.emptyGeo,
            borderColor: p.geoBorder,
            borderWidth: 0.6,
          },
          emphasis: {
            label: { show: false },
            itemStyle: { areaColor: "#9F86FF", borderColor: ACCENT },
          },
          select: { disabled: true },
          label: { show: false },
        },
      ],
    }),
    [data, p, label, roam, zoom, center, showVisualMap],
  );

  return (
    <EChart
      option={option as any}
      height={height}
      onClick={onCountryClick ? (params) => onCountryClick(params.name) : undefined}
    />
  );
}
