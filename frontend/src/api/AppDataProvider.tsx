import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { endpoints } from "./endpoints";
import { ApiError } from "./client";
import type {
  Bootstrap, CaseStory, CategoryMeta, Country, SourceMeta, SubScores, Tech,
} from "./types";

/**
 * Fournisseur de données d'application.
 *
 * Charge GET /bootstrap une fois au démarrage, puis expose la taxonomie et
 * des helpers de lookup portant LES MÊMES NOMS que l'ancienne couche de
 * mocks (techBySlug, techsByCategory, countryByIso, …). Ce mimétisme est
 * volontaire : il minimise le diff dans les pages — seule la provenance des
 * données change (API réelle au lieu de constantes locales).
 */

/* Pondérations du composite : constantes mathématiques du produit, dupliquées
   côté client pour le rendu hors-ligne des libellés ; la version serveur
   reste disponible via bootstrap.subscoreMeta. */
export const SUBSCORE_META = [
  { key: "adoption", label: "Adoption", weight: 0.35, hint: "Downloads, installs and dependents across registries" },
  { key: "activity", label: "Activity", weight: 0.25, hint: "Commit cadence, releases and maintainer responsiveness" },
  { key: "growth", label: "Growth", weight: 0.25, hint: "90-day momentum vs. the category baseline" },
  { key: "community", label: "Community", weight: 0.15, hint: "Contributors, Q&A volume and answer rate" },
] as const;

export const compositeOf = (s: SubScores): number =>
  Math.round(s.adoption * 0.35 + s.activity * 0.25 + s.growth * 0.25 + s.community * 0.15);

/* Mois affichés par les axes — alimentés par l'API au bootstrap.
   Singleton module pour que les composants charts y accèdent sans prop. */
let MONTHS_RUNTIME: string[] = [];
export const getMonths = (): string[] => MONTHS_RUNTIME;

export interface AppData {
  headline: Bootstrap["headline"];
  months: string[];
  CATEGORIES: CategoryMeta[];
  TECHNOLOGIES: Tech[];
  COUNTRIES: Country[];
  SOURCES: SourceMeta[];
  CASES: CaseStory[];
  techBySlug: (slug: string) => Tech | undefined;
  techsByCategory: (category: string) => Tech[];
  categoryBySlug: (slug: string) => CategoryMeta | undefined;
  countryByIso: (iso2: string) => Country;
  sourceById: (id: string) => SourceMeta;
  caseById: (id: string) => CaseStory | undefined;
  /** Recharge le bootstrap (après ajout/suppression d'une technologie). */
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppData must be used within <AppDataProvider>");
  return v;
}

function Splash({ error, retry }: { error: ApiError | null; retry: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg text-ink">
      <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
        OSS Pulse
      </div>
      {error ? (
        <div className="max-w-sm text-center">
          <p className="text-sm text-mute">
            Impossible de joindre l'API ({error.message}). Vérifie que le backend tourne sur{" "}
            <code className="rounded bg-raised px-1.5 py-0.5 text-xs">/api/v1</code>.
          </p>
          <button
            onClick={retry}
            className="mt-4 rounded-xl2 bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            Réessayer
          </button>
        </div>
      ) : (
        <p className="text-sm text-mute">Chargement des classements…</p>
      )}
    </div>
  );
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    endpoints
      .bootstrap()
      .then((b) => {
        if (cancelled) return;
        MONTHS_RUNTIME = b.months;
        setBoot(b);
      })
      .catch((e: ApiError) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  if (!boot) return <Splash error={error} retry={() => setTick((t) => t + 1)} />;

  const TECHNOLOGIES = boot.categories.flatMap((c) => c.technologies);
  const value: AppData = {
    headline: boot.headline,
    months: boot.months,
    CATEGORIES: boot.categories.map(({ technologies: _t, ...meta }) => meta),
    TECHNOLOGIES,
    COUNTRIES: boot.countries,
    SOURCES: boot.sources,
    CASES: boot.cases,
    techBySlug: (slug) => TECHNOLOGIES.find((t) => t.slug === slug),
    techsByCategory: (category) =>
      boot.categories.find((c) => c.slug === category)?.technologies ?? [],
    categoryBySlug: (slug) => boot.categories.find((c) => c.slug === slug),
    countryByIso: (iso2) => boot.countries.find((c) => c.iso2 === iso2)!,
    sourceById: (id) => boot.sources.find((s) => s.id === id)!,
    caseById: (id) => boot.cases.find((c) => c.id === id),
    refresh: async () => {
      const b = await endpoints.bootstrap();
      MONTHS_RUNTIME = b.months;
      setBoot(b);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
