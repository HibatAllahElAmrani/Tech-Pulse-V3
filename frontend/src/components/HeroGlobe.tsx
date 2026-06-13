import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import worldJson from "@/assets/world.json";
import { endpoints } from "@/api/endpoints";
import { useApi } from "@/api/useApi";
import { useAppData } from "@/api/AppDataProvider";
import { useTheme } from "@/theme/ThemeProvider";

export default function HeroGlobe({ height = 520 }: { height?: number }) {
  const { COUNTRIES } = useAppData();
  const { data: globe } = useApi("globe", endpoints.globe);
  const weightByGeoName = useMemo(() => new Map(COUNTRIES.map((c) => [c.geoName, c.devWeight])), [COUNTRIES]);
  const ref = useRef<GlobeMethods>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(520);
  const { theme } = useTheme();
  const dark = theme === "dark";

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    g.controls().autoRotate = true;
    g.controls().autoRotateSpeed = 0.55;
    g.controls().enableZoom = false;
    g.pointOfView({ lat: 24, lng: -8, altitude: 1.9 }, 0);
  }, []);

  const points = useMemo(() => globe?.points ?? [], [globe]);
  const arcs = useMemo(() => globe?.arcs ?? [], [globe]);
  const hexPolygons = useMemo(() => (worldJson as any).features, []);

  const globeMaterial = useMemo(
    () =>
      new THREE.MeshPhongMaterial({
        color: dark ? "#0E1322" : "#E8EBF4",
        transparent: true,
        opacity: 0.96,
      }),
    [dark],
  );

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }} aria-hidden>
      <Globe
        ref={ref}
        width={width}
        height={height}
        backgroundColor="rgba(0,0,0,0)"
        globeMaterial={globeMaterial}
        showAtmosphere
        atmosphereColor="#7C5CFF"
        atmosphereAltitude={0.18}
        hexPolygonsData={hexPolygons}
        hexPolygonResolution={3}
        hexPolygonMargin={0.55}
        hexPolygonUseDots
        hexPolygonColor={(d: any) => {
          const w = weightByGeoName.get(d.properties?.name) ?? 0;
          if (w > 60) return "#B9A6FF";
          if (w > 25) return "#7C5CFF";
          if (w > 0) return dark ? "#5B4AB8" : "#9E8CF0";
          return dark ? "#28304A" : "#C9CFDF";
        }}
        pointsData={points}
        pointLat="lat"
        pointLng="lng"
        pointColor={() => "#22D3EE"}
        pointAltitude={(d: any) => 0.015 + (d.weight / 100) * 0.16}
        pointRadius={0.32}
        arcsData={arcs}
        arcColor={() => ["#7C5CFF", "#22D3EE"]}
        arcDashLength={0.45}
        arcDashGap={1.6}
        arcDashAnimateTime={3400}
        arcStroke={0.45}
        arcAltitudeAutoScale={0.36}
      />
      {/* soft fade into the page */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-bg to-transparent" />
    </div>
  );
}
