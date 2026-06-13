import type { Pool } from 'pg';

/* ──────────────────────────────────────────────────────────────────────────
 * Formes de données = CONTRAT FRONTEND (frontend/src/mocks/types.ts).
 * Le backend sérialise en camelCase pour matcher les types du frontend.
 * ────────────────────────────────────────────────────────────────────────── */

export type SourceId = 'github' | 'huggingface' | 'npm' | 'pypi' | 'stackoverflow';
export type SignalSource = 'survey' | 'github-locations' | 'trends';

export interface SubScores {
  adoption: number;
  activity: number;
  growth: number;
  community: number;
}

export interface TechMetrics {
  stars: number;
  forks: number;
  contributors: number;
  commitsMonthly: number;
  downloadsMonthly: number;
  questionsMonthly: number;
  answeredRate: number;
  releasesYear: number;
  hfDownloads?: number;
  hfLikes?: number;
}

export interface Tech {
  slug: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  color: string;
  language: string;
  license: string;
  firstRelease: number;
  sources: SourceId[];
  score: number;
  subScores: SubScores;
  deltas: SubScores;
  metrics: TechMetrics;
  /** Ajoutée par l'utilisateur via la recherche (supprimable), vs seedée. */
  isCustom?: boolean;
}

export interface Country {
  iso2: string;
  name: string;
  geoName: string;
  flag: string;
  lat: number;
  lng: number;
  devWeight: number;
  region: string;
}

export interface CategoryMeta {
  slug: string;
  name: string;
  blurb: string;
  color: string;
  icon: string;
}

export interface SourceMeta {
  id: SourceId;
  name: string;
  color: string;
  measures: string;
  unit: string;
  coverage: string[];
  freshness: string;
}

export interface CaseStory {
  id: string;
  question: string;
  title: string;
  subtitle: string;
  category: string;
  country?: string;
  techs: string[];
  accent: string;
  steps: { heading: string; body: string; chart: string }[];
  verdict: string;
}

/** Pondérations du score composite — identiques au frontend (35/25/25/15). */
export const SUBSCORE_META = [
  { key: 'adoption', label: 'Adoption', weight: 0.35, hint: 'Downloads, installs and dependents across registries' },
  { key: 'activity', label: 'Activity', weight: 0.25, hint: 'Commit cadence, releases and maintainer responsiveness' },
  { key: 'growth', label: 'Growth', weight: 0.25, hint: '90-day momentum vs. the category baseline' },
  { key: 'community', label: 'Community', weight: 0.15, hint: 'Contributors, Q&A volume and answer rate' },
] as const;

export function compositeOf(s: SubScores): number {
  return Math.round(s.adoption * 0.35 + s.activity * 0.25 + s.growth * 0.25 + s.community * 0.15);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Service taxonomie : lit la base et expose les formes frontend.
 * Cache mémoire avec TTL court — les données changent par migration/worker.
 * ────────────────────────────────────────────────────────────────────────── */

const CACHE_TTL_MS = 60_000;

interface Snapshot {
  technologies: Tech[]; // ordonnées par rank_position (= ordre du tableau frontend)
  countries: Country[]; // ordonnées par position (= ordre du tableau frontend)
  categories: CategoryMeta[];
  sources: SourceMeta[];
  cases: CaseStory[];
}

export class TaxonomyService {
  private cache: { at: number; data: Snapshot } | null = null;
  private inflight: Promise<Snapshot> | null = null;

  constructor(private readonly pg: Pool) {}

  /** Invalide le cache (à appeler après une écriture). */
  invalidate(): void {
    this.cache = null;
  }

  async snapshot(): Promise<Snapshot> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.data;
    if (this.inflight) return this.inflight;
    this.inflight = this.load()
      .then((data) => {
        this.cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  async technologies(): Promise<Tech[]> {
    return (await this.snapshot()).technologies;
  }

  async techBySlug(slug: string): Promise<Tech | undefined> {
    return (await this.snapshot()).technologies.find((t) => t.slug === slug);
  }

  async techsByCategory(category: string): Promise<Tech[]> {
    const all = await this.technologies();
    return all.filter((t) => t.category === category).sort((a, b) => b.score - a.score);
  }

  async countries(): Promise<Country[]> {
    return (await this.snapshot()).countries;
  }

  async countryByIso(iso2: string): Promise<Country | undefined> {
    return (await this.snapshot()).countries.find((c) => c.iso2 === iso2);
  }

  async categories(): Promise<CategoryMeta[]> {
    return (await this.snapshot()).categories;
  }

  async categoryBySlug(slug: string): Promise<CategoryMeta | undefined> {
    return (await this.snapshot()).categories.find((c) => c.slug === slug);
  }

  async sources(): Promise<SourceMeta[]> {
    return (await this.snapshot()).sources;
  }

  async cases(): Promise<CaseStory[]> {
    return (await this.snapshot()).cases;
  }

  async caseById(id: string): Promise<CaseStory | undefined> {
    return (await this.snapshot()).cases.find((c) => c.id === id);
  }

  /* ── Chargement SQL ──────────────────────────────────────────────────── */

  private async load(): Promise<Snapshot> {
    const [techRows, countryRows, categoryRows, sourceRows, caseRows] = await Promise.all([
      this.pg.query(`
        SELECT t.slug, t.name, t.tagline, t.description, t.color,
               t.primary_language AS language, t.license, t.first_release,
               t.is_custom,
               c.slug AS category,
               ss.adoption, ss.activity, ss.growth, ss.community,
               ss.delta_adoption, ss.delta_activity, ss.delta_growth, ss.delta_community,
               tm.stars, tm.forks, tm.contributors, tm.commits_monthly, tm.downloads_monthly,
               tm.questions_monthly, tm.answered_rate, tm.releases_year, tm.hf_downloads, tm.hf_likes,
               COALESCE(
                 (SELECT array_agg(s.slug ORDER BY s.id)
                    FROM technology_sources ts JOIN sources s ON s.id = ts.source_id
                   WHERE ts.technology_id = t.id),
                 '{}'
               ) AS sources
          FROM technologies t
          JOIN technology_subscores ss ON ss.technology_id = t.id
          JOIN technology_metrics tm   ON tm.technology_id = t.id
          JOIN technology_categories tc ON tc.technology_id = t.id
          JOIN categories c ON c.id = tc.category_id
         WHERE t.is_ranked = TRUE
         ORDER BY t.rank_position ASC
      `),
      this.pg.query(`
        SELECT iso2, name, geo_name, flag, lat, lng, dev_weight, region
          FROM countries ORDER BY position ASC
      `),
      this.pg.query(`
        SELECT slug, name, blurb, color, icon
          FROM categories
         ORDER BY position ASC
      `),
      this.pg.query(`
        SELECT slug, label, color, measures, unit, coverage, freshness
          FROM sources ORDER BY id ASC
      `),
      this.pg.query(`
        SELECT id, question, title, subtitle, category_slug, country_iso2,
               techs, accent, steps, verdict
          FROM case_stories ORDER BY position ASC
      `),
    ]);

    const technologies: Tech[] = techRows.rows.map((r) => {
      const subScores: SubScores = {
        adoption: Number(r.adoption),
        activity: Number(r.activity),
        growth: Number(r.growth),
        community: Number(r.community),
      };
      const tech: Tech = {
        slug: r.slug,
        name: r.name,
        category: r.category,
        tagline: r.tagline ?? '',
        description: r.description ?? '',
        color: r.color ?? '#7C5CFF',
        language: r.language ?? '',
        license: r.license ?? '',
        firstRelease: Number(r.first_release ?? 0),
        sources: (r.sources ?? []) as SourceId[],
        subScores,
        deltas: {
          adoption: Number(r.delta_adoption),
          activity: Number(r.delta_activity),
          growth: Number(r.delta_growth),
          community: Number(r.delta_community),
        },
        metrics: {
          stars: Number(r.stars),
          forks: Number(r.forks),
          contributors: Number(r.contributors),
          commitsMonthly: Number(r.commits_monthly),
          downloadsMonthly: Number(r.downloads_monthly),
          questionsMonthly: Number(r.questions_monthly),
          answeredRate: Number(r.answered_rate),
          releasesYear: Number(r.releases_year),
          ...(r.hf_downloads != null ? { hfDownloads: Number(r.hf_downloads) } : {}),
          ...(r.hf_likes != null ? { hfLikes: Number(r.hf_likes) } : {}),
        },
        score: compositeOf(subScores),
        ...(r.is_custom ? { isCustom: true } : {}),
      };
      return tech;
    });

    const countries: Country[] = countryRows.rows.map((r) => ({
      iso2: r.iso2,
      name: r.name,
      geoName: r.geo_name,
      flag: r.flag,
      lat: Number(r.lat),
      lng: Number(r.lng),
      devWeight: Number(r.dev_weight),
      region: r.region,
    }));

    const categories: CategoryMeta[] = categoryRows.rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      blurb: r.blurb ?? '',
      color: r.color ?? '#7C5CFF',
      icon: r.icon ?? 'Globe',
    }));

    const sources: SourceMeta[] = sourceRows.rows.map((r) => ({
      id: r.slug as SourceId,
      name: r.label,
      color: r.color ?? '#7C5CFF',
      measures: r.measures ?? '',
      unit: r.unit ?? '',
      coverage: r.coverage ?? [],
      freshness: r.freshness ?? '',
    }));

    const cases: CaseStory[] = caseRows.rows.map((r) => ({
      id: r.id,
      question: r.question,
      title: r.title,
      subtitle: r.subtitle,
      category: r.category_slug,
      ...(r.country_iso2 ? { country: r.country_iso2 } : {}),
      techs: r.techs ?? [],
      accent: r.accent,
      steps: r.steps ?? [],
      verdict: r.verdict,
    }));

    return { technologies, countries, categories, sources, cases };
  }
}
