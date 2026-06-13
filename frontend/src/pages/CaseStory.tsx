import { useMemo } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { PageShell, PageHeader } from "@/components/layout/Layout";
import { Card, Badge } from "@/components/ui/primitives";
import { RankingTable } from "@/components/RankingTable";
import { SubScoreRadar, MultiLine } from "@/components/charts/lines";
import Choropleth from "@/components/charts/Choropleth";
import { useAppData } from "@/api/AppDataProvider";
import { endpoints } from "@/api/endpoints";
import { useApi } from "@/api/useApi";
import { ChartError, ChartLoader } from "@/components/ui/Async";
import type { CaseStory as CaseStoryT, Tech } from "@/api/types";

export default function CaseStory() {
  const { id = "" } = useParams();
  const { CASES, caseById, techBySlug, countryByIso } = useAppData();
  const story = caseById(id);
  if (!story) return <Navigate to="/cases/mobile-morocco" replace />;

  const techs = story.techs.map((s) => techBySlug(s)!);
  const winner = techs[0];
  const country = story.country ? countryByIso(story.country) : undefined;

  return (
    <PageShell>
      {/* Story switcher */}
      <div className="mb-6 flex flex-wrap gap-2">
        {CASES.map((c) => (
          <Link
            key={c.id}
            to={`/cases/${c.id}`}
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
            style={
              c.id === story.id
                ? { borderColor: c.accent + "88", backgroundColor: c.accent + "16", color: c.accent }
                : { borderColor: "rgb(var(--c-edge))" }
            }
          >
            <span className={c.id === story.id ? "" : "text-mute hover:text-ink"}>{c.title}</span>
          </Link>
        ))}
      </div>

      <PageHeader
        eyebrow={country ? `Case study · ${country.flag} ${country.name}` : "Case study"}
        title={story.question}
        sub={story.subtitle}
      />

      <div className="relative">
        {/* timeline rail */}
        <div className="absolute bottom-6 left-[15px] top-2 hidden w-px bg-edge sm:block" aria-hidden />

        <div className="space-y-8">
          {story.steps.map((step, i) => (
            <motion.section
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.4 }}
              className="relative sm:pl-12"
            >
              <span
                className="absolute left-0 top-1 hidden h-8 w-8 items-center justify-center rounded-full border border-edge bg-surface text-sm font-semibold sm:flex"
                style={{ color: story.accent }}
              >
                {i + 1}
              </span>
              <h2 className="mb-1 text-lg font-semibold tracking-tight">
                <span className="mr-2 text-mute sm:hidden">{i + 1}.</span>
                {step.heading}
              </h2>
              <p className="mb-4 max-w-2xl text-sm leading-relaxed text-mute">{step.body}</p>
              <StepChart chart={step.chart} story={story} techs={techs} />
            </motion.section>
          ))}
        </div>
      </div>

      {/* Verdict */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.4 }}
        className="mt-10"
      >
        <Card className="border-l-4 p-6" style={{ borderLeftColor: story.accent }}>
          <div className="mb-2 flex items-center gap-2">
            <CheckCircle2 size={18} style={{ color: story.accent }} />
            <span className="eyebrow" style={{ color: story.accent }}>Verdict</span>
          </div>
          <p className="max-w-2xl text-base leading-relaxed">{story.verdict}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              to={`/tech/${winner.slug}`}
              className="inline-flex items-center gap-1.5 rounded-xl2 bg-accent px-4 py-2 text-sm font-medium text-white transition-transform hover:scale-[1.02]"
            >
              Open {winner.name}'s profile <ArrowRight size={15} />
            </Link>
            <Link
              to={`/compare?techs=${story.techs.join(",")}`}
              className="inline-flex items-center gap-1.5 rounded-xl2 border border-edge px-4 py-2 text-sm font-medium text-mute transition-colors hover:text-ink"
            >
              Compare all {techs.length}
            </Link>
          </div>
        </Card>
      </motion.div>

      {/* Next story */}
      <NextStory currentId={story.id} />
    </PageShell>
  );
}

function StepChart({ chart, story, techs }: { chart: string; story: CaseStoryT; techs: Tech[] }) {

  if (chart === "ranking") return <RankingTable category={story.category} highlight={techs[0].slug} />;

  if (chart === "trend")
    return (
      <Card className="p-5">
        <MultiLine
          height={300}
          brush={false}
          series={techs.map((t) => ({ name: t.name, color: t.color, data: t.sparkline.map((v) => Math.round(v * 10) / 10) }))}
        />
      </Card>
    );

  if (chart === "map") return <StepMap tech={techs[0]} />;

  if (chart === "radar")
    return (
      <Card className="p-5">
        <SubScoreRadar
          height={330}
          series={techs.map((t) => ({ name: t.name, color: t.color, values: t.subScores }))}
        />
      </Card>
    );

  // sources
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {techs.slice(0, 2).map((t) => (
        <StepSources key={t.slug} tech={t} />
      ))}
    </div>
  );
}

/** Carte choroplèthe d'une étape — /technologies/:slug/geo */
function StepMap({ tech }: { tech: Tech }) {
  const { data, loading, error, reload } = useApi(`geo:${tech.slug}`, () => endpoints.techGeo(tech.slug));
  return (
    <Card className="p-5">
      {loading && <ChartLoader height={380} />}
      {error && <ChartError error={error} retry={reload} height={380} />}
      {data && <Choropleth data={data.choropleth} height={380} label={`${tech.name} activity`} />}
    </Card>
  );
}

/** Volumes par connecteur d'une étape — /technologies/:slug/sources/series */
function StepSources({ tech }: { tech: Tech }) {
  const { sourceById } = useAppData();
  const { data, loading, error, reload } = useApi(`srcseries:${tech.slug}`, () => endpoints.techSourcesSeries(tech.slug));
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tech.color }} />
        <h3 className="text-sm font-semibold">{tech.name}</h3>
        <span className="ml-auto flex gap-1.5">
          {tech.sources.map((s) => (
            <Badge key={s} color={sourceById(s).color}>{sourceById(s).name}</Badge>
          ))}
        </span>
      </div>
      {loading && <ChartLoader height={200} />}
      {error && <ChartError error={error} retry={reload} height={200} />}
      {data && (
        <MultiLine
          height={200}
          brush={false}
          yName="signal volume"
          months={data.months}
          series={data.sources.slice(0, 3).map((src) => ({ name: src.name, color: src.color, data: src.values }))}
        />
      )}
    </Card>
  );
}

function NextStory({ currentId }: { currentId: string }) {
  const { CASES } = useAppData();
  const idx = CASES.findIndex((c) => c.id === currentId);
  const next = CASES[(idx + 1) % CASES.length];
  return (
    <Link to={`/cases/${next.id}`} className="mt-8 block">
      <Card className="hover-raise flex items-center justify-between p-5">
        <div>
          <p className="eyebrow mb-1" style={{ color: next.accent }}>Next story</p>
          <p className="font-medium">{next.question}</p>
        </div>
        <ArrowRight size={18} className="shrink-0 text-mute" />
      </Card>
    </Link>
  );
}
