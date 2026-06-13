import { api } from "./client";
import type {
  Bootstrap, Bubble, FlowData, ForecastData, GeoDatum, GlobeData,
  RaceFrame, SearchResults, SignalSource, SourceSeriesEntry, SubScores, TechGeo, TreemapCategory,
} from "./types";

/**
 * Fonctions d'endpoint typées — un appel = une route backend.
 * Toutes retournent la forme exacte documentée par l'API /api/v1.
 */
export const endpoints = {
  bootstrap: () => api<Bootstrap>("/bootstrap"),

  techGeo: (slug: string) => api<TechGeo>(`/technologies/${slug}/geo`),

  techSubscores: (slug: string, country: string) =>
    api<{ slug: string; country: string | null; subScores: SubScores; score: number }>(
      `/technologies/${slug}/subscores?country=${encodeURIComponent(country)}`,
    ),

  techSourcesSeries: (slug: string) =>
    api<{ slug: string; months: string[]; sources: SourceSeriesEntry[] }>(
      `/technologies/${slug}/sources/series`,
    ),

  techForecast: (slug: string) => api<ForecastData>(`/technologies/${slug}/forecast`),

  techCalendar: (slug: string) =>
    api<{ slug: string; days: [string, number][] }>(`/technologies/${slug}/calendar`),

  techFlow: (slug: string) => api<FlowData>(`/technologies/${slug}/flow`),

  race: (category?: string) =>
    api<{ category: string | null; frames: RaceFrame[] }>(
      `/analytics/race${category ? `?category=${encodeURIComponent(category)}` : ""}`,
    ),

  treemap: () => api<{ tree: TreemapCategory[] }>("/analytics/treemap"),

  landscape: () => api<{ bubbles: Bubble[] }>("/analytics/landscape"),

  globe: () => api<GlobeData>("/analytics/globe"),

  categoryGeo: (slug: string) =>
    api<{ category: string; choropleth: GeoDatum[] }>(`/analytics/geo/category/${slug}`),

  signalGeo: (category: string, signal: SignalSource) =>
    api<{ category: string; signal: SignalSource; choropleth: GeoDatum[] }>(
      `/analytics/geo?category=${encodeURIComponent(category)}&signal=${signal}`,
    ),

  // ── Recherche globale + catalogue dynamique ──────────────────────────
  search: (q: string) => api<SearchResults>(`/search?q=${encodeURIComponent(q)}`),

  addTechnology: (owner: string, repo: string, category?: string) =>
    api<{ slug: string; name: string; category: string; message: string }>("/technologies", {
      method: "POST",
      body: JSON.stringify({ owner, repo, ...(category ? { category } : {}) }),
    }),

  removeTechnology: (slug: string) =>
    api<{ slug: string; message: string }>(`/technologies/${slug}`, { method: "DELETE" }),
};
