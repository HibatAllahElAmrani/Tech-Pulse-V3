import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type { SourceId, SubScores, Tech } from "@/api/types";
import { endpoints } from "@/api/endpoints";
import { useApi } from "@/api/useApi";
import { useAppData, compositeOf } from "@/api/AppDataProvider";
import { Sparkline } from "@/components/charts/lines";
import { Delta, ScoreRing, SubScoreBars } from "@/components/widgets";
import { Badge, Segmented, Select } from "@/components/ui/primitives";
import { SUBSCORE_COLORS } from "@/theme/tokens";
import { cn, fmt } from "@/lib/utils";

type Timeframe = "3m" | "6m" | "12m";

/**
 * Hook : sous-scores localisés pour une liste de technos.
 * GLOBAL → null (on garde les sous-scores globaux du bootstrap).
 * Pays   → batch Promise.all sur /technologies/:slug/subscores?country=XX
 *          (≤ 4 appels par catégorie).
 */
function useCountrySubScores(techs: Tech[], country: string) {
  const [map, setMap] = useState<Record<string, SubScores> | null>(null);
  const [loading, setLoading] = useState(false);
  const slugsKey = techs.map((t) => t.slug).join(",");

  useEffect(() => {
    if (country === "GLOBAL") {
      setMap(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(techs.map((t) => endpoints.techSubscores(t.slug, country)))
      .then((rows) => {
        if (cancelled) return;
        setMap(Object.fromEntries(rows.map((r) => [r.slug, r.subScores])));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setMap(null); // erreur → on retombe silencieusement sur le global
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugsKey, country]);

  return { map, loading };
}

/** Part locale d'une techno — chargée paresseusement à l'ouverture d'une ligne. */
function LocalShare({ slug, techName, country }: { slug: string; techName: string; country: string }) {
  const { COUNTRIES } = useAppData();
  const { data } = useApi(`geo:${slug}`, () => endpoints.techGeo(slug));
  const meta = COUNTRIES.find((c) => c.iso2 === country);
  const share = data?.shares.find((c) => c.iso2 === country)?.share ?? 0;
  return (
    <p className="text-xs text-mute">
      {meta?.flag} share of {techName}'s global activity:{" "}
      <span className="num text-ink">{data ? `${share}%` : "…"}</span>
    </p>
  );
}

export function RankingTable({ category, highlight }: { category: string; highlight?: string }) {
  const { COUNTRIES, SOURCES, techsByCategory } = useAppData();
  const [country, setCountry] = useState<string>("GLOBAL");
  const [timeframe, setTimeframe] = useState<Timeframe>("12m");
  const [enabledSources, setEnabledSources] = useState<Set<SourceId>>(new Set(SOURCES.map((s) => s.id)));
  const [open, setOpen] = useState<string | null>(null);

  const techs = techsByCategory(category);
  const { map: localSub, loading: localLoading } = useCountrySubScores(techs, country);

  const rows = useMemo(() => {
    return techs
      .map((t) => {
        const sub = country === "GLOBAL" || !localSub ? t.subScores : (localSub[t.slug] ?? t.subScores);
        // disabling a connector this tech relies on softly degrades its score
        const active = t.sources.filter((s) => enabledSources.has(s)).length;
        const coverage = active / t.sources.length;
        const score = Math.round(compositeOf(sub) * (0.7 + 0.3 * coverage));
        const spark = t.sparkline.slice(timeframe === "3m" ? 9 : timeframe === "6m" ? 6 : 0);
        const trend = Math.round((spark[spark.length - 1] - spark[0]) * 10) / 10;
        return { tech: t, sub, score, coverage, spark, trend };
      })
      .sort((a, b) => b.score - a.score);
  }, [techs, country, timeframe, enabledSources, localSub]);

  const toggleSource = (id: SourceId) =>
    setEnabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); } else next.add(id);
      return next;
    });

  return (
    <div className="card overflow-hidden">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 border-b border-edge px-5 py-4">
        <Select
          label="Country"
          value={country}
          onChange={setCountry}
          options={[{ id: "GLOBAL", label: "🌍 Global" }, ...COUNTRIES.map((c) => ({ id: c.iso2, label: `${c.flag} ${c.name}` }))]}
        />
        <Segmented
          value={timeframe}
          onChange={setTimeframe}
          options={[{ id: "3m", label: "3 mo" }, { id: "6m", label: "6 mo" }, { id: "12m", label: "12 mo" }]}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              onClick={() => toggleSource(s.id)}
              aria-pressed={enabledSources.has(s.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-200",
                enabledSources.has(s.id) ? "" : "opacity-35",
              )}
              style={{ color: s.color, borderColor: s.color + "55", backgroundColor: enabledSources.has(s.id) ? s.color + "14" : "transparent" }}
            >
              {s.name}
            </button>
          ))}
        </div>
        {localLoading && <span className="num text-[10px] text-mute">re-scoring for {country}…</span>}
      </div>

      {/* Header row */}
      <div className="hidden grid-cols-[2.5rem_1fr_7rem_6rem_5rem_4rem] gap-4 border-b border-edge px-5 py-2 text-[10px] uppercase tracking-[0.14em] text-mute md:grid">
        <span>#</span><span>Technology</span><span>12-mo trend</span><span>Δ {timeframe}</span><span>Coverage</span><span className="text-right">Score</span>
      </div>

      {/* Rows */}
      <ul>
        {rows.map(({ tech, sub, score, coverage, spark, trend }, i) => (
          <motion.li
            key={tech.slug}
            layout
            transition={{ duration: 0.3, ease: "easeOut" }}
            className={cn("border-b border-edge last:border-0", highlight === tech.slug && "bg-accent/5")}
          >
            <button
              className="grid w-full grid-cols-[2.5rem_1fr_4rem] items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-raised/60 md:grid-cols-[2.5rem_1fr_7rem_6rem_5rem_4rem]"
              onClick={() => setOpen(open === tech.slug ? null : tech.slug)}
              aria-expanded={open === tech.slug}
            >
              <span className={cn("num text-sm", i === 0 ? "font-bold text-accent" : "text-mute")}>{String(i + 1).padStart(2, "0")}</span>
              <span className="flex min-w-0 items-center gap-3">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tech.color }} />
                <span className="truncate">
                  <span className="font-medium text-ink">{tech.name}</span>
                  <span className="ml-2 hidden text-xs text-mute lg:inline">{tech.tagline}</span>
                </span>
              </span>
              <span className="hidden md:block"><Sparkline data={spark} color={tech.color} height={30} /></span>
              <span className="hidden md:block"><Delta value={trend} suffix=" pts" /></span>
              <span className="num hidden text-xs text-mute md:block">{Math.round(coverage * 100)}%</span>
              <span className="num text-right text-base font-semibold text-ink">{score}</span>
            </button>

            {open === tech.slug && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="grid gap-6 border-t border-edge bg-raised/40 px-5 py-5 md:grid-cols-[auto_1fr_1fr]">
                  <ScoreRing value={score} color={tech.color} />
                  <SubScoreBars
                    scores={[
                      { label: "Adoption", value: sub.adoption, delta: tech.deltas.adoption },
                      { label: "Activity", value: sub.activity, delta: tech.deltas.activity },
                      { label: "Growth", value: sub.growth, delta: tech.deltas.growth },
                      { label: "Community", value: sub.community, delta: tech.deltas.community },
                    ]}
                    colors={[SUBSCORE_COLORS.adoption, SUBSCORE_COLORS.activity, SUBSCORE_COLORS.growth, SUBSCORE_COLORS.community]}
                  />
                  <div className="flex flex-col justify-between gap-3 text-sm">
                    <div className="flex flex-wrap gap-1.5">
                      {tech.sources.map((s) => {
                        const meta = SOURCES.find((x) => x.id === s)!;
                        return <Badge key={s} color={meta.color}>{meta.name}</Badge>;
                      })}
                    </div>
                    {country !== "GLOBAL" && (
                      <LocalShare slug={tech.slug} techName={tech.name} country={country} />
                    )}
                    <Link to={`/tech/${tech.slug}`} className="text-sm font-medium text-accent transition-opacity hover:opacity-80">
                      Open full profile →
                    </Link>
                  </div>
                </div>
              </motion.div>
            )}
          </motion.li>
        ))}
      </ul>
      <p className="num px-5 py-3 text-[10px] text-mute">
        score = 0.35·adoption + 0.25·activity + 0.25·growth + 0.15·community — disabling connectors reduces coverage and confidence
      </p>
    </div>
  );
}

export function MetricStat({ label, value, mono = true }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="rounded-xl2 border border-edge bg-raised/50 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-mute">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold text-ink", mono && "num")}>{typeof value === "number" ? fmt(value) : value}</p>
    </div>
  );
}
