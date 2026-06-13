/**
 * Types du domaine OSS Pulse — contrat partagé avec l'API backend.
 * (anciennement src/mocks/types.ts ; désormais la source est /api/v1)
 */

// "other" + slugs futurs : le catalogue est dynamique (technos ajoutées par
// l'utilisateur), le type reste ouvert tout en gardant l'autocomplétion.
export type CategorySlug = "mobile" | "database" | "ai-model" | "embedded" | "web" | "other" | (string & {});
export type SourceId = "github" | "npm" | "pypi" | "huggingface" | "stackoverflow";
export type SubScoreKey = "adoption" | "activity" | "growth" | "community";
export type SignalSource = "survey" | "github-locations" | "trends";

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
  answeredRate: number; // 0..1
  releasesYear: number;
  hfDownloads?: number;
  hfLikes?: number;
}

export interface Tech {
  slug: string;
  name: string;
  category: CategorySlug;
  tagline: string;
  description: string;
  color: string;
  language: string;
  license: string;
  firstRelease: number;
  sources: SourceId[];
  score: number; // composite 0..100
  subScores: SubScores;
  deltas: SubScores; // 90-day change in points
  metrics: TechMetrics;
  /** Trajectoire 12 mois du composite — fournie par l'API pour les mini-courbes. */
  sparkline: number[];
  /** Ajoutée par l'utilisateur via la recherche globale (supprimable). */
  isCustom?: boolean;
}

/* ── Recherche globale ─────────────────────────────────────────────────── */

export interface SearchTechHit {
  slug: string;
  name: string;
  category: CategorySlug;
  color: string;
  score: number;
}

export interface SearchRepoHit {
  fullName: string;
  owner: string;
  repo: string;
  description: string | null;
  language: string | null;
  stars: number;
  suggestedCategory: CategorySlug;
  tracked: boolean;
}

export interface SearchResults {
  query: string;
  technologies: SearchTechHit[];
  repositories: SearchRepoHit[];
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

export interface SourceMeta {
  id: SourceId;
  name: string;
  color: string;
  measures: string;
  unit: string;
  coverage: CategorySlug[];
  freshness: string;
}

export interface CategoryMeta {
  slug: CategorySlug;
  name: string;
  blurb: string;
  color: string;
  icon: string;
}

export interface CaseStory {
  id: string;
  question: string;
  title: string;
  subtitle: string;
  category: CategorySlug;
  country?: string;
  techs: string[];
  accent: string;
  steps: { heading: string; body: string; chart: "ranking" | "trend" | "map" | "radar" | "sources" }[];
  verdict: string;
}

export interface SubScoreMetaEntry {
  key: SubScoreKey;
  label: string;
  weight: number;
  hint: string;
}

/* ── Formes des réponses analytiques ──────────────────────────────────── */

export interface CountryShare {
  iso2: string;
  geoName: string;
  name: string;
  flag: string;
  share: number;
  confidence: number;
}

export interface GeoDatum {
  iso2: string;
  name: string; // nom GeoJSON
  display: string;
  value: number;
  confidence?: number;
}

export interface TechGeo {
  slug: string;
  shares: CountryShare[];
  choropleth: GeoDatum[];
}

export interface SourceSeriesEntry {
  id: SourceId;
  name: string;
  color: string;
  unit: string;
  measures: string;
  freshness: string;
  values: number[];
}

export interface ForecastData {
  slug: string;
  months: string[];
  hist: number[];
  mid: number[];
  lo: number[];
  hi: number[];
  model: string; // "holt-damped-trend" (IA) | "deterministic" (fallback)
  params?: Record<string, number>;
}

export interface RaceFrame {
  month: string;
  rows: { slug: string; name: string; color: string; category: string; value: number }[];
}

export interface TreemapCategory {
  name: string;
  children: { name: string; value: number; slug: string }[];
}

export interface Bubble {
  slug: string;
  name: string;
  category: string;
  color: string;
  x: number;
  y: number;
  size: number;
  score: number;
}

export interface GlobeData {
  points: { lat: number; lng: number; name: string; flag: string; weight: number; density: number }[];
  arcs: { startLat: number; startLng: number; endLat: number; endLng: number }[];
}

export interface FlowData {
  slug: string;
  nodes: { name: string }[];
  links: { source: string; target: string; value: number }[];
}

export interface Headline {
  signalsIndexed: number;
  technologies: number;
  categories: number;
  countries: number;
  sources: number;
}

export interface Bootstrap {
  months: string[];
  headline: Headline;
  categories: (CategoryMeta & { technologies: Tech[] })[];
  countries: Country[];
  sources: SourceMeta[];
  cases: CaseStory[];
  subscoreMeta: SubScoreMetaEntry[];
}
