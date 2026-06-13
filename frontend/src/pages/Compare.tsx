import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { GitCompareArrows, X } from "lucide-react";
import { PageShell, PageHeader } from "@/components/layout/Layout";
import { Card, CardHeader } from "@/components/ui/primitives";
import { SubScoreRadar, MultiLine } from "@/components/charts/lines";
import { Delta } from "@/components/widgets";
import { useAppData, SUBSCORE_META } from "@/api/AppDataProvider";
import { cn } from "@/lib/utils";

const MAX = 5;

export default function Compare() {
  const { CATEGORIES, TECHNOLOGIES, techBySlug, categoryBySlug } = useAppData();
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState<string>("all");

  // Sélection 100 % pilotée par l'utilisateur (URL) — aucun défaut.
  const slugs = useMemo(
    () =>
      (params.get("techs") ?? "")
        .split(",")
        .filter((s) => s && techBySlug(s))
        .slice(0, MAX),
    [params, techBySlug],
  );

  const techs = slugs.map((s) => techBySlug(s)!);
  const set = (next: string[]) =>
    setParams(next.length > 0 ? { techs: next.join(",") } : {}, { replace: true });

  const toggle = (slug: string) => {
    if (slugs.includes(slug)) set(slugs.filter((s) => s !== slug));
    else if (slugs.length < MAX) set([...slugs, slug]);
  };

  const pool = TECHNOLOGIES.filter(
    (t) => !slugs.includes(t.slug) && (category === "all" || t.category === category),
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Compare"
        title="Side by side"
        sub={`Filter by category, then pick up to ${MAX} technologies. Scores stay comparable because they're built the same way.`}
      />

      {/* ── Picker ──────────────────────────────────────────────────── */}
      <Card className="mb-6 p-4">
        {/* Filtre catégorie */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-mute">Category:</span>
          {[{ slug: "all", name: "All", color: "" }, ...CATEGORIES].map((c) => (
            <button
              key={c.slug}
              onClick={() => setCategory(c.slug)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                category === c.slug
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-edge text-mute hover:border-accent/40 hover:text-ink",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Sélection courante */}
        <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-3">
          {techs.length === 0 ? (
            <span className="px-1 py-1 text-xs text-mute">
              No technology selected — pick from the list below.
            </span>
          ) : (
            techs.map((t) => (
              <button
                key={t.slug}
                onClick={() => toggle(t.slug)}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
                style={{ borderColor: t.color + "66", backgroundColor: t.color + "14", color: t.color }}
                title="Remove"
              >
                {t.name}
                <X size={12} />
              </button>
            ))
          )}
          {techs.length > 0 && slugs.length < MAX && (
            <span className="px-1 text-xs text-mute">+ up to {MAX - slugs.length} more</span>
          )}
        </div>

        {/* Pool filtré par catégorie */}
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-edge pt-3">
          {pool.length === 0 ? (
            <span className="px-1 text-xs text-mute">
              {category === "all"
                ? "Everything is already selected."
                : "No more technologies in this category — add some from the search bar."}
            </span>
          ) : (
            pool.map((t) => (
              <button
                key={t.slug}
                onClick={() => toggle(t.slug)}
                disabled={slugs.length >= MAX}
                className={cn(
                  "rounded-full border border-edge px-2.5 py-1 text-xs text-mute transition-colors",
                  slugs.length >= MAX ? "opacity-40" : "hover:border-accent/50 hover:text-ink",
                )}
              >
                {t.name}
              </button>
            ))
          )}
        </div>
      </Card>

      {/* ── Contenu — uniquement les choix de l'utilisateur ─────────── */}
      {techs.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <GitCompareArrows size={22} />
          </span>
          <h3 className="font-semibold text-ink">Nothing to compare yet</h3>
          <p className="max-w-sm text-sm text-mute">
            Choose a category above, then select 2 to {MAX} technologies to see their radar
            profiles, 12-month trajectories and sub-score breakdown side by side.
          </p>
        </Card>
      ) : (
        <>
          {techs.length === 1 && (
            <p className="mb-4 text-xs text-mute">
              Select at least one more technology for a meaningful comparison.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
            <Card className="p-5">
              <CardHeader title="Sub-score profiles" />
              <SubScoreRadar
                height={340}
                series={techs.map((t) => ({ name: t.name, color: t.color, values: t.subScores }))}
              />
            </Card>
            <Card className="p-5">
              <CardHeader title="Composite score, 12 months" hint="drag the brush to zoom" />
              <MultiLine
                height={340}
                series={techs.map((t) => ({
                  name: t.name,
                  color: t.color,
                  data: t.sparkline.map((v) => Math.round(v * 10) / 10),
                }))}
              />
            </Card>
          </div>

          {/* Sub-score table */}
          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-mute">
                  <th className="px-5 py-3 font-medium">Technology</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  {SUBSCORE_META.map((m) => (
                    <th key={m.key} className="px-4 py-3 text-right font-medium" title={m.hint}>
                      {m.label} <span className="normal-case">·{Math.round(m.weight * 100)}%</span>
                    </th>
                  ))}
                  <th className="px-5 py-3 text-right font-medium">Composite</th>
                </tr>
              </thead>
              <tbody>
                {techs
                  .slice()
                  .sort((a, b) => b.score - a.score)
                  .map((t, i) => {
                    const best = i === 0 && techs.length > 1;
                    return (
                      <tr key={t.slug} className="border-b border-edge/60 last:border-0">
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center gap-2 font-medium">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                            {t.name}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-mute">
                          {categoryBySlug(t.category)?.name ?? t.category}
                        </td>
                        {SUBSCORE_META.map((m) => {
                          const isMax =
                            techs.length > 1 &&
                            t.subScores[m.key] === Math.max(...techs.map((x) => x.subScores[m.key]));
                          return (
                            <td key={m.key} className={cn("num px-4 py-3.5 text-right", isMax && "font-semibold text-ink")}>
                              {t.subScores[m.key]}
                              <span className="ml-2 inline-block w-10 text-left"><Delta value={t.deltas[m.key]} /></span>
                            </td>
                          );
                        })}
                        <td className={cn("num px-5 py-3.5 text-right text-base font-semibold", best && "text-accent")}>
                          {t.score}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <p className="border-t border-edge px-5 py-3 text-[11px] text-mute">
              composite = 0.35·adoption + 0.25·activity + 0.25·growth + 0.15·community — deltas are 90-day changes. Bold = best in selection.
            </p>
          </Card>
        </>
      )}
    </PageShell>
  );
}
