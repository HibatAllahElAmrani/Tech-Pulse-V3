import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { PageShell, PageHeader } from "@/components/layout/Layout";
import { Card, Segmented, Badge } from "@/components/ui/primitives";
import Choropleth from "@/components/charts/Choropleth";
import { useAppData } from "@/api/AppDataProvider";
import { endpoints } from "@/api/endpoints";
import { useApi } from "@/api/useApi";
import { ChartError, ChartLoader } from "@/components/ui/Async";
import type { CategorySlug } from "@/api/types";

/**
 * Carte mondiale — signal unique et réel : la localisation déclarée des
 * contributeurs GitHub des repos suivis, résolue en pays. La confiance
 * affichée est le taux de profils effectivement localisés (mesuré, pas
 * estimé). Les anciennes lentilles « surveys » et « search trends » ont été
 * retirées : elles n'avaient pas de source réelle.
 */
export default function MapPage() {
  const { CATEGORIES, countryByIso } = useAppData();
  const [cat, setCat] = useState<CategorySlug>("mobile");
  const [picked, setPicked] = useState<string | null>(null);

  const geo = useApi(`signalgeo:${cat}`, () => endpoints.signalGeo(cat, "github-locations"));
  const data = useMemo(() => geo.data?.choropleth ?? [], [geo.data]);
  const catMeta = CATEGORIES.find((c) => c.slug === cat)!;
  const confidence = data.length > 0 ? Math.round(((data[0] as any).confidence ?? 0) * 100) : 0;

  const ranked = useMemo(() => [...data].sort((a, b) => b.value - a.value).slice(0, 10), [data]);
  const pickedRow = picked ? data.find((d) => d.name === picked) : null;

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="World view"
        title="The map"
        sub="Where each category's contributors actually are — aggregated from the declared locations of GitHub contributors on the tracked repositories."
        right={
          <Segmented<CategorySlug>
            value={cat}
            onChange={setCat}
            options={CATEGORIES.map((c) => ({ id: c.slug, label: c.name.split(" ")[0] }))}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card className="relative p-2 sm:p-4">
          {geo.loading && <ChartLoader height="min(64vh, 620px)" />}
          {geo.error && <ChartError error={geo.error} retry={geo.reload} height="min(64vh, 620px)" />}
          {!geo.loading && !geo.error && data.length === 0 && (
            <div className="flex h-[min(64vh,620px)] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-ink">No located contributors yet for this category</p>
              <p className="max-w-sm text-xs text-mute">
                Contributor locations are collected progressively from GitHub profiles — check back
                in a few minutes.
              </p>
            </div>
          )}
          {!geo.loading && !geo.error && data.length > 0 && (
            <Choropleth
              data={data}
              height="min(64vh, 620px)"
              roam
              zoom={1.2}
              label={`${catMeta.name.toLowerCase()} · contributor locations`}
              onCountryClick={(name) => setPicked(name)}
            />
          )}
          <div className="pointer-events-none absolute left-4 top-4 hidden max-w-xs sm:block">
            <Badge color={catMeta.color}>{catMeta.name}</Badge>
          </div>
        </Card>

        <div className="grid content-start gap-4">
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <Info size={14} className="text-accent" />
              <h3 className="text-sm font-semibold">GitHub contributor locations</h3>
              <span className="num ml-auto text-xs text-mute">located {confidence}%</span>
            </div>
            <p className="text-xs leading-relaxed text-mute">
              Declared profile locations of contributors on the tracked repositories, resolved to
              countries. The percentage above is the measured share of contributors whose profile
              declares a usable location.
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-edge">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${confidence}%` }}
              />
            </div>
          </Card>

          {pickedRow && (
            <Card className="p-5">
              <h3 className="mb-1 text-sm font-semibold">{pickedRow.display ?? pickedRow.name}</h3>
              <p className="text-xs text-mute">
                Relative activity <span className="num font-semibold text-ink">{pickedRow.value}</span> / 100
                · located share of contributors in this category
              </p>
            </Card>
          )}

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Top 10 countries</h3>
            <div className="space-y-1.5">
              {ranked.map((c, i) => {
                const meta = countryByIso((c as any).iso2);
                return (
                  <button
                    key={c.name}
                    onClick={() => setPicked(c.name)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left text-sm transition-colors ${
                      picked === c.name ? "bg-accent/10" : "hover:bg-raised"
                    }`}
                  >
                    <span className="num w-4 text-xs text-mute">{i + 1}</span>
                    <span className="text-base leading-none">{meta?.flag ?? "🌐"}</span>
                    <span className="min-w-0 flex-1 truncate">{(c as any).display ?? c.name}</span>
                    <span className="num font-semibold">{c.value}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 border-t border-edge pt-2 text-[11px] text-mute">
              Only contributors with a declared, recognisable location are counted — no
              extrapolation is applied to the rest.
            </p>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
