import { useParams, Link, Navigate } from "react-router-dom";
import { Smartphone, Database, BrainCircuit, Cpu, Globe, Wrench, ArrowLeft } from "lucide-react";
import { PageShell, PageHeader } from "@/components/layout/Layout";
import { Card, CardHeader, Badge } from "@/components/ui/primitives";
import { RankingTable } from "@/components/RankingTable";
import { ScoreRace } from "@/components/charts/blocks";
import { MultiLine } from "@/components/charts/lines";
import Choropleth from "@/components/charts/Choropleth";
import { useAppData } from "@/api/AppDataProvider";
import { endpoints } from "@/api/endpoints";
import { useApi } from "@/api/useApi";
import { ChartError, ChartLoader } from "@/components/ui/Async";

const ICONS: Record<string, any> = { Smartphone, Database, BrainCircuit, Cpu, Globe, Wrench };

export default function CategoryDetail() {
  const { slug = "" } = useParams();
  const { categoryBySlug, techsByCategory, SOURCES } = useAppData();
  const cat = categoryBySlug(slug);
  if (!cat) return <Navigate to="/categories" replace />;

  const Icon = ICONS[cat.icon] ?? Globe;
  const techs = techsByCategory(cat.slug);
  const coveringSources = SOURCES.filter((s) => s.coverage.includes(cat.slug));

  return (
    <PageShell>
      <Link to="/categories" className="mb-4 inline-flex items-center gap-1.5 text-xs text-mute transition-colors hover:text-ink">
        <ArrowLeft size={13} /> All categories
      </Link>

      <PageHeader
        eyebrow="Category"
        title={
          <span className="inline-flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl2" style={{ backgroundColor: cat.color + "1c", color: cat.color }}>
              <Icon size={21} strokeWidth={1.8} />
            </span>
            {cat.name}
          </span>
        }
        sub={cat.blurb}
        right={
          <div className="flex flex-wrap gap-1.5">
            {coveringSources.map((s) => (
              <Badge key={s.id} color={s.color}>{s.name}</Badge>
            ))}
          </div>
        }
      />

      {/* Main ranking with filters */}
      <RankingTable category={cat.slug} />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="The race, month by month" hint="Composite score, replayed over the last 12 months" />
          <ScoreRace category={cat.slug} height={300} />
        </Card>
        <Card className="p-5">
          <CardHeader title="Score trajectories" hint="Drag the brush below the chart to zoom a period" />
          <MultiLine
            height={300}
            series={techs.map((t) => ({ name: t.name, color: t.color, data: t.sparkline.map((v) => Math.round(v * 10) / 10) }))}
          />
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <CardHeader
          title="Where this category lives"
          hint="Relative share of category activity per country — click a country on the full map page to dig deeper"
        />
        <CategoryChoropleth slug={cat.slug} label={`${cat.name.toLowerCase()} activity`} />
      </Card>
    </PageShell>
  );
}

/** Choroplèthe de la catégorie — données /analytics/geo/category/:slug */
function CategoryChoropleth({ slug, label }: { slug: string; label: string }) {
  const { data, loading, error, reload } = useApi(`catgeo:${slug}`, () => endpoints.categoryGeo(slug));
  if (loading) return <ChartLoader height={400} />;
  if (error) return <ChartError error={error} retry={reload} height={400} />;
  return <Choropleth data={data!.choropleth} height={400} label={label} />;
}
