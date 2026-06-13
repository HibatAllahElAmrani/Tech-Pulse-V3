import { useMemo, useState } from "react";
import { useParams, Link, Navigate, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, GitFork, Star, Trash2, Users } from "lucide-react";
import { PageShell } from "@/components/layout/Layout";
import { Card, CardHeader, Badge, Tabs, Select, Button } from "@/components/ui/primitives";
import { ScoreRing, SubScoreBars, Delta } from "@/components/widgets";
import { MetricStat } from "@/components/RankingTable";
import { SubScoreRadar, MultiLine, ForecastChart, Sparkline } from "@/components/charts/lines";
import { ScoreSankey, ActivityCalendar } from "@/components/charts/blocks";
import Choropleth from "@/components/charts/Choropleth";
import { useAppData, SUBSCORE_META, compositeOf, getMonths } from "@/api/AppDataProvider";
import { endpoints } from "@/api/endpoints";
import { useApi } from "@/api/useApi";
import { ChartError, ChartLoader } from "@/components/ui/Async";
import type { CountryShare } from "@/api/types";
import { SUBSCORE_COLORS } from "@/theme/tokens";
import { fmt, pct } from "@/lib/utils";

type Tab = "overview" | "sources" | "geography" | "forecast" | "compare";

export default function TechDetail() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { techBySlug, categoryBySlug, refresh } = useAppData();
  const tech = techBySlug(slug);
  const [tab, setTab] = useState<Tab>("overview");
  const [removing, setRemoving] = useState(false);
  if (!tech) return <Navigate to="/categories" replace />;

  const cat = categoryBySlug(tech.category)!;

  const untrack = async () => {
    if (!window.confirm(`Retirer ${tech.name} du suivi ? Ses données collectées seront supprimées.`)) return;
    setRemoving(true);
    try {
      await endpoints.removeTechnology(tech.slug);
      await refresh();
      navigate("/categories");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <PageShell>
      <Link to={`/categories/${cat.slug}`} className="mb-4 inline-flex items-center gap-1.5 text-xs text-mute transition-colors hover:text-ink">
        <ArrowLeft size={13} /> {cat.name}
      </Link>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="flex flex-col justify-between gap-5 p-6 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{tech.name}</h1>
              <Badge color={cat.color}>{cat.name}</Badge>
              <Badge>{tech.license}</Badge>
              {tech.isCustom && (
                <button
                  onClick={untrack}
                  disabled={removing}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-400/30 px-2 py-0.5 text-xs text-rose-400 transition-colors hover:bg-rose-400/10"
                >
                  <Trash2 size={11} /> {removing ? "Removing…" : "Untrack"}
                </button>
              )}
            </div>
            <p className="text-sm text-mute">{tech.tagline}</p>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-mute">{tech.description}</p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-mute">
              <span className="inline-flex items-center gap-1.5"><Star size={13} /> <span className="num text-ink">{fmt(tech.metrics.stars)}</span> stars</span>
              <span className="inline-flex items-center gap-1.5"><GitFork size={13} /> <span className="num text-ink">{fmt(tech.metrics.forks)}</span> forks</span>
              <span className="inline-flex items-center gap-1.5"><Users size={13} /> <span className="num text-ink">{fmt(tech.metrics.contributors)}</span> contributors</span>
              <span>since <span className="num text-ink">{tech.firstRelease}</span></span>
              <span>{tech.language}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-5">
            <ScoreRing value={tech.score} size={116} color={tech.color} label="composite" />
            <div className="hidden w-40 sm:block">
              <Sparkline data={tech.sparkline} color={tech.color} height={44} />
              <p className="mt-1 text-right text-[11px] text-mute">12-month trajectory</p>
            </div>
          </div>
        </Card>
        <Card className="p-6">
          <CardHeader title="Sub-scores" hint="weighted into the composite" className="mb-3" />
          <SubScoreRadar
            height={210}
            showLegend={false}
            series={[{ name: tech.name, color: tech.color, values: tech.subScores }]}
          />
        </Card>
      </div>

      <Tabs<Tab>
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "sources", label: "Sources" },
          { id: "geography", label: "Geography" },
          { id: "forecast", label: "Forecast" },
          { id: "compare", label: "Compare" },
        ]}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {tab === "overview" && <Overview slug={tech.slug} />}
          {tab === "sources" && <Sources slug={tech.slug} />}
          {tab === "geography" && <Geography slug={tech.slug} />}
          {tab === "forecast" && <Forecast slug={tech.slug} />}
          {tab === "compare" && <CompareTab slug={tech.slug} />}
        </motion.div>
      </AnimatePresence>
    </PageShell>
  );
}

/* ── Overview ──────────────────────────────────────────────────────── */
function Overview({ slug }: { slug: string }) {
  const { techBySlug } = useAppData();
  const tech = techBySlug(slug)!;
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="How the score is built" hint="raw signals → sub-scores → composite" />
          <ScoreSankey slug={slug} height={330} />
        </Card>
        <Card className="p-5">
          <CardHeader title="Sub-score detail" hint="with 90-day deltas" />
          <SubScoreBars
            className="mt-2"
            colors={SUBSCORE_META.map((m) => SUBSCORE_COLORS[m.key])}
            scores={SUBSCORE_META.map((m) => ({
              label: `${m.label} · weight ${Math.round(m.weight * 100)}%`,
              value: tech.subScores[m.key],
              delta: tech.deltas[m.key],
            }))}
          />
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-edge pt-4 sm:grid-cols-3">
            <MetricStat label="Downloads / mo" value={fmt(tech.metrics.downloadsMonthly)} />
            <MetricStat label="Commits / mo" value={fmt(tech.metrics.commitsMonthly)} />
            <MetricStat label="Questions / mo" value={fmt(tech.metrics.questionsMonthly)} />
            <MetricStat label="Answered" value={pct(tech.metrics.answeredRate)} />
            <MetricStat label="Releases / yr" value={tech.metrics.releasesYear} />
            {tech.metrics.hfDownloads != null && <MetricStat label="HF downloads" value={fmt(tech.metrics.hfDownloads)} />}
          </div>
        </Card>
      </div>
      <Card className="p-5">
        <CardHeader title="Maintainer pulse" hint="daily activity over the last 26 weeks" />
        <ActivityCalendar slug={slug} color={tech.color} />
      </Card>
    </div>
  );
}

/* ── Sources ───────────────────────────────────────────────────────── */
function Sources({ slug }: { slug: string }) {
  const { data, loading, error, reload } = useApi(`srcseries:${slug}`, () => endpoints.techSourcesSeries(slug));
  if (loading) return <ChartLoader height={420} />;
  if (error) return <ChartError error={error} retry={reload} height={420} />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {data!.sources.map((src) => {
        const values = src.values;
        const last = values[values.length - 1];
        const prev = values[values.length - 2] || last;
        const delta = prev ? ((last - prev) / prev) * 100 : 0;
        return (
          <Card key={src.id} className="p-5">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: src.color }} />
                  <h3 className="font-semibold">{src.name}</h3>
                  <span className="text-[11px] text-mute">{src.freshness}</span>
                </div>
                <p className="mt-1 text-xs text-mute">{src.measures}</p>
              </div>
              <div className="text-right">
                <div className="num text-lg font-semibold">{fmt(last)}</div>
                <div className="flex items-center justify-end gap-1 text-[11px] text-mute">
                  <Delta value={Math.round(delta * 10) / 10} suffix="%" /> vs last month
                </div>
              </div>
            </div>
            <MultiLine
              height={190}
              brush={false}
              yName={src.unit}
              months={data!.months}
              series={[{ name: src.name, color: src.color, data: values }]}
            />
          </Card>
        );
      })}
    </div>
  );
}

/* ── Geography ─────────────────────────────────────────────────────── */
function Geography({ slug }: { slug: string }) {
  const { techBySlug } = useAppData();
  const tech = techBySlug(slug)!;
  const { data: geo, loading, error, reload } = useApi(`geo:${slug}`, () => endpoints.techGeo(slug));
  const shares = geo?.shares ?? [];
  const top = shares.slice(0, 8);
  const [selected, setSelected] = useState<CountryShare | null>(null);
  const sel = selected ?? top[0] ?? null;

  const local = useApi(
    `csub:${slug}:${sel?.iso2 ?? "-"}`,
    () => endpoints.techSubscores(slug, sel!.iso2),
    Boolean(sel),
  );
  const localSub = local.data?.subScores ?? tech.subScores;
  const localScore = local.data?.score ?? tech.score;

  if (loading) return <ChartLoader height={480} />;
  if (error) return <ChartError error={error} retry={reload} height={480} />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_330px]">
      <Card className="p-5">
        <CardHeader title="Activity by country" hint="hover for share & confidence — click a country to inspect" />
        <Choropleth
          data={geo!.choropleth.map((g) => ({ ...g, confidence: shares.find((s) => s.geoName === g.name)?.confidence }))}
          height={440}
          label={`${tech.name} activity`}
          onCountryClick={(name) => {
            const hit = shares.find((s) => s.geoName === name);
            if (hit) setSelected(hit);
          }}
        />
      </Card>
      <div className="grid gap-4">
        <Card className="p-5">
          <CardHeader title="Top countries" hint="share of global signals" />
          <div className="space-y-2">
            {top.map((c, i) => (
              <button
                key={c.iso2}
                onClick={() => setSelected(c)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                  sel?.iso2 === c.iso2 ? "bg-accent/10" : "hover:bg-raised"
                }`}
              >
                <span className="num w-4 text-xs text-mute">{i + 1}</span>
                <span className="text-base leading-none">{c.flag}</span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="num font-semibold">{c.share}%</span>
              </button>
            ))}
          </div>
        </Card>
        {sel && (
          <Card className="p-5">
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  {sel.flag} {tech.name} in {sel.name}
                </span>
              }
              hint={`signal confidence ${Math.round(sel.confidence * 100)}%`}
            />
            <div className="flex items-center gap-4">
              <ScoreRing value={localScore} size={84} color={tech.color} label="local" />
              <div className="flex-1">
                <SubScoreBars
                  colors={SUBSCORE_META.map((m) => SUBSCORE_COLORS[m.key])}
                  scores={SUBSCORE_META.map((m) => ({ label: m.label, value: localSub[m.key] }))}
                />
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ── Forecast ──────────────────────────────────────────────────────── */
function Forecast({ slug }: { slug: string }) {
  const { techBySlug } = useAppData();
  const tech = techBySlug(slug)!;
  const { data: fc, loading, error, reload } = useApi(`forecast:${slug}`, () => endpoints.techForecast(slug));
  if (loading) return <ChartLoader height={460} />;
  if (error) return <ChartError error={error} retry={reload} height={460} />;
  const end = fc!.mid[fc!.mid.length - 1];
  const drift = Math.round((end - fc!.hist[11]) * 10) / 10;
  const isAi = fc!.model !== "deterministic";
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <Card className="p-5">
        <CardHeader
          title="6-month projection"
          hint="dashed = projected median, shaded = confidence band"
          right={
            <Badge color={isAi ? "#34D399" : "#FB923C"}>
              {isAi ? `AI · ${fc!.model}` : "fallback · deterministic"}
            </Badge>
          }
        />
        <ForecastChart
          months={fc!.months}
          hist={fc!.hist.map((v) => Math.round(v * 10) / 10)}
          mid={fc!.mid}
          lo={fc!.lo}
          hi={fc!.hi}
          color={tech.color}
          height={400}
        />
      </Card>
      <div className="grid content-start gap-4">
        <Card className="p-5">
          <CardHeader title="Reading it" />
          <div className="space-y-3 text-sm text-mute">
            <p>
              Median projection puts <span className="font-medium text-ink">{tech.name}</span> at{" "}
              <span className="num font-semibold text-ink">{end}</span> by Nov 2026 — a drift of{" "}
              <Delta value={drift} /> points from today.
            </p>
            <p>
              The band widens from ±{Math.round((fc!.hi[0] - fc!.lo[0]) / 2 * 10) / 10} to ±
              {Math.round((fc!.hi[5] - fc!.lo[5]) / 2 * 10) / 10} points: forecasts decay fast in OSS, treat month 6 as a direction, not a number.
            </p>
            <p>
              {isAi
                ? "Projection computed by the AI service (Holt damped-trend, parameters fitted on the 12-month history)."
                : "AI service unreachable — showing the deterministic baseline projection."}
            </p>
          </div>
        </Card>
        <Card className="p-5">
          <MetricStat label="Today" value={tech.score} />
          <div className="my-3 border-t border-edge" />
          <MetricStat label="Median, Nov 2026" value={end} />
          <div className="my-3 border-t border-edge" />
          <MetricStat label="Range, Nov 2026" value={`${fc!.lo[5]} – ${fc!.hi[5]}`} />
        </Card>
      </div>
    </div>
  );
}

/* ── Compare tab (quick, links to full /compare) ───────────────────── */
function CompareTab({ slug }: { slug: string }) {
  const { TECHNOLOGIES, techBySlug, techsByCategory } = useAppData();
  const tech = techBySlug(slug)!;
  const sameCategory = techsByCategory(tech.category).filter((t) => t.slug !== slug);
  // Techno seule dans sa catégorie (ex. ajout custom dans "Other & Tools") :
  // on propose le reste du catalogue — les scores restent comparables.
  const siblings =
    sameCategory.length > 0 ? sameCategory : TECHNOLOGIES.filter((t) => t.slug !== slug);
  const [otherSlug, setOtherSlug] = useState(siblings[0]?.slug ?? "");
  const other = techBySlug(otherSlug);
  const navigate = useNavigate();

  if (!other) {
    return (
      <Card className="p-8 text-center text-sm text-mute">
        Nothing to compare against yet — add another technology from the search bar.
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <CardHeader
          title="Head to head"
          right={
            <Select
              label="against"
              value={otherSlug}
              onChange={setOtherSlug}
              options={siblings.map((t) => ({ id: t.slug, label: t.name }))}
            />
          }
        />
        <SubScoreRadar
          height={320}
          series={[
            { name: tech.name, color: tech.color, values: tech.subScores },
            { name: other.name, color: other.color, values: other.subScores },
          ]}
        />
      </Card>
      <Card className="p-5">
        <CardHeader title="Composite over time" />
        <MultiLine
          height={280}
          brush={false}
          months={getMonths()}
          series={[
            { name: tech.name, color: tech.color, data: tech.sparkline.map((v) => Math.round(v * 10) / 10) },
            { name: other.name, color: other.color, data: other.sparkline.map((v) => Math.round(v * 10) / 10) },
          ]}
        />
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => navigate(`/compare?techs=${tech.slug},${other.slug}`)}>
            Full comparison <ArrowRight size={14} className="ml-1.5 inline" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
