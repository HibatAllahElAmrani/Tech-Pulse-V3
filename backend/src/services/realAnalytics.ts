import type { Pool } from 'pg';
import type { Country, SourceId, SubScores, Tech } from './taxonomy.js';
import { compositeOf } from './taxonomy.js';

/* ──────────────────────────────────────────────────────────────────────────
 * Analytique 100 % data-driven — remplace les générateurs de scoring.ts.
 *
 * Sources : technology_monthly (scores mensuels matérialisés), source_monthly
 * (volumes par registre), commits_daily (GitHub), contributor_geo (pays des
 * contributeurs). Aucune valeur n'est inventée : un mois sans donnée est
 * complété par la valeur réelle connue la plus proche (forward/back-fill,
 * jamais de bruit synthétique), un pays sans contributeur localisé est absent.
 * ────────────────────────────────────────────────────────────────────────── */

const TECH_PROJECTS = `
  tech_projects AS (
    SELECT t.id AS technology_id, t.slug, p.id AS project_id
      FROM technologies t
      JOIN items i ON i.technology_id = t.id
      JOIN sources s ON s.id = i.source_id AND s.slug = 'github'
      JOIN projects p ON p.item_id = i.id
     WHERE t.is_ranked = TRUE
  )
`;

/** Forward-fill puis back-fill ; si tout est vide → valeur de repli. */
function fillSeries(values: (number | null)[], fallback: number): number[] {
  const out = [...values];
  let last: number | null = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i] == null) out[i] = last;
    else last = out[i];
  }
  let next: number | null = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] == null) out[i] = next;
    else next = out[i];
  }
  return out.map((v) => v ?? fallback);
}

/** Série de score 12 mois (alignée sur lastMonths(12)) pour un lot de technos. */
export async function monthlyScores(
  pg: Pool,
  techs: Tech[],
  monthKeys: string[]
): Promise<Map<string, number[]>> {
  if (techs.length === 0) return new Map();
  const { rows } = await pg.query(
    `SELECT t.slug, to_char(tm.month, 'YYYY-MM') AS ym, tm.score
       FROM technology_monthly tm
       JOIN technologies t ON t.id = tm.technology_id
      WHERE t.slug = ANY($1)`,
    [techs.map((t) => t.slug)]
  );
  const bySlug = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, new Map());
    bySlug.get(r.slug)!.set(r.ym, Number(r.score));
  }
  const out = new Map<string, number[]>();
  for (const t of techs) {
    const m = bySlug.get(t.slug);
    out.set(
      t.slug,
      fillSeries(monthKeys.map((k) => m?.get(k) ?? null), t.score)
    );
  }
  return out;
}

/** Volume mensuel réel par connecteur d'une techno (12 mois, 0 si non couvert). */
export async function sourceMonthlyVolumes(
  pg: Pool,
  slug: string,
  monthKeys: string[]
): Promise<Map<SourceId, number[]>> {
  const [registry, commits] = await Promise.all([
    pg.query(
      `SELECT s.slug AS source, to_char(sm.month, 'YYYY-MM') AS ym, SUM(sm.value) AS v
         FROM source_monthly sm
         JOIN items i ON i.id = sm.item_id
         JOIN sources s ON s.id = i.source_id
         JOIN technologies t ON t.id = i.technology_id
        WHERE t.slug = $1 AND sm.metric IN ('downloads', 'questions')
        GROUP BY 1, 2`,
      [slug]
    ),
    pg.query(
      `WITH ${TECH_PROJECTS}
       SELECT to_char(date_trunc('month', cd.day), 'YYYY-MM') AS ym, SUM(cd.commit_count) AS v
         FROM commits_daily cd
         JOIN tech_projects tp ON tp.project_id = cd.project_id
        WHERE tp.slug = $1
        GROUP BY 1`,
      [slug]
    ),
  ]);

  const bySource = new Map<SourceId, Map<string, number>>();
  for (const r of registry.rows) {
    const src = r.source as SourceId;
    if (!bySource.has(src)) bySource.set(src, new Map());
    bySource.get(src)!.set(r.ym, Number(r.v));
  }
  const gh = new Map<string, number>();
  for (const r of commits.rows) gh.set(r.ym, Number(r.v));
  bySource.set('github', gh);

  const out = new Map<SourceId, number[]>();
  for (const [src, m] of bySource) {
    out.set(src, monthKeys.map((k) => m.get(k) ?? 0));
  }
  return out;
}

/* ── Géographie (contributor_geo) ────────────────────────────────────── */

export interface CountryCount {
  iso2: string;
  located: number;
}

/** Contributeurs localisés par pays pour un lot de technos (slugs). */
export async function geoCounts(
  pg: Pool,
  slugs: string[]
): Promise<{ counts: CountryCount[]; located: number; total: number }> {
  const { rows } = await pg.query(
    `WITH ${TECH_PROJECTS},
     contribs AS (
       SELECT DISTINCT c.login
         FROM contributors c
         JOIN tech_projects tp ON tp.project_id = c.project_id
        WHERE tp.slug = ANY($1)
     )
     SELECT g.iso2, COUNT(*) AS n,
            (SELECT COUNT(*) FROM contribs) AS total
       FROM contribs cb
       JOIN contributor_geo g ON g.login = cb.login AND g.iso2 IS NOT NULL
      GROUP BY g.iso2
      ORDER BY n DESC`,
    [slugs]
  );
  const counts = rows.map((r) => ({ iso2: r.iso2 as string, located: Number(r.n) }));
  const located = counts.reduce((s, c) => s + c.located, 0);
  const total = rows.length > 0 ? Number(rows[0].total) : 0;
  return { counts, located, total };
}

export interface ShareRow {
  iso2: string;
  geoName: string;
  name: string;
  flag: string;
  share: number;
  confidence: number;
}

/** Parts par pays (somme ≈ 100) + confiance = taux de localisation observé. */
export function toShares(
  counts: CountryCount[],
  located: number,
  total: number,
  countries: Country[]
): ShareRow[] {
  if (located === 0) return [];
  const confidence = total > 0 ? Math.round((located / total) * 100) / 100 : 0;
  return counts
    .map((c) => {
      const meta = countries.find((x) => x.iso2 === c.iso2);
      if (!meta) return null;
      return {
        iso2: c.iso2,
        geoName: meta.geoName,
        name: meta.name,
        flag: meta.flag,
        share: Math.round((c.located / located) * 1000) / 10,
        confidence,
      };
    })
    .filter((x): x is ShareRow => x !== null)
    .sort((a, b) => b.share - a.share);
}

export interface GeoDatum {
  iso2: string;
  name: string;
  display: string;
  value: number;
}

/** Choroplèthe normalisée 0..100 depuis des comptages pays. */
export function toChoropleth(counts: CountryCount[], countries: Country[]): GeoDatum[] {
  const max = Math.max(1, ...counts.map((c) => c.located));
  return counts
    .map((c) => {
      const meta = countries.find((x) => x.iso2 === c.iso2);
      if (!meta) return null;
      return {
        iso2: c.iso2,
        name: meta.geoName,
        display: meta.name,
        value: Math.round((c.located / max) * 1000) / 10,
      };
    })
    .filter((x): x is GeoDatum => x !== null);
}

/** Points + arcs du globe : densité = contributeurs localisés par pays. */
export async function globeData(pg: Pool, countries: Country[]) {
  const { counts } = await geoCounts(
    pg,
    (await pg.query<{ slug: string }>(`SELECT slug FROM technologies WHERE is_ranked`)).rows.map(
      (r) => r.slug
    )
  );
  const byIso = new Map(counts.map((c) => [c.iso2, c.located]));
  const points = countries
    .filter((c) => (byIso.get(c.iso2) ?? 0) > 0)
    .map((c) => ({
      lat: c.lat,
      lng: c.lng,
      name: c.name,
      flag: c.flag,
      weight: byIso.get(c.iso2)!,
      density: byIso.get(c.iso2)!,
    }));
  // Arcs : du pays nº1 vers les suivants — flux déterministe dérivé des données.
  const top = [...points].sort((a, b) => b.weight - a.weight).slice(0, 8);
  const arcs =
    top.length > 1
      ? top.slice(1).map((p) => ({
          startLat: top[0].lat,
          startLng: top[0].lng,
          endLat: p.lat,
          endLng: p.lng,
        }))
      : [];
  return { points, arcs };
}

/** Sous-scores locaux : adoption/community modulés par la part pays observée. */
export async function countrySubScoresReal(
  pg: Pool,
  tech: Tech,
  iso2: string
): Promise<SubScores> {
  const { counts, located } = await geoCounts(pg, [tech.slug]);
  if (located === 0) return tech.subScores;
  const mean = located / counts.length;
  const mine = counts.find((c) => c.iso2 === iso2)?.located ?? 0;
  // Facteur borné [0.7, 1.3] : sur-/sous-représentation réelle du pays.
  const factor = Math.max(0.7, Math.min(1.3, mine > 0 ? mine / mean : 0.7));
  const t = (v: number) => Math.round(Math.max(5, Math.min(99, v * factor)));
  return {
    adoption: t(tech.subScores.adoption),
    activity: tech.subScores.activity, // signaux globaux, pas de déclinaison pays
    growth: tech.subScores.growth,
    community: t(tech.subScores.community),
  };
}

/* ── Compositions servies telles quelles ─────────────────────────────── */

/** Sankey sources → sous-scores → composite, pondéré par volumes réels. */
export function scoreFlowReal(tech: Tech) {
  const m = tech.metrics;
  const vol: Partial<Record<SourceId, number>> = {
    github: m.commitsMonthly * 2 + m.stars / 100,
    npm: m.downloadsMonthly,
    pypi: m.downloadsMonthly * 0.3,
    huggingface: m.hfDownloads ?? 0,
    stackoverflow: m.questionsMonthly * 2,
  };
  // Quels connecteurs alimentent réellement quel axe.
  const feeds: Record<string, SourceId[]> = {
    Adoption: ['npm', 'pypi', 'huggingface', 'github'],
    Activity: ['github'],
    Growth: ['github', 'npm'],
    Community: ['stackoverflow', 'github', 'huggingface'],
  };
  const weights: Record<string, number> = { Adoption: 0.35, Activity: 0.25, Growth: 0.25, Community: 0.15 };
  const subVals: Record<string, number> = {
    Adoption: tech.subScores.adoption,
    Activity: tech.subScores.activity,
    Growth: tech.subScores.growth,
    Community: tech.subScores.community,
  };
  const srcName: Record<SourceId, string> = {
    github: 'GitHub', npm: 'npm', pypi: 'PyPI', huggingface: 'Hugging Face', stackoverflow: 'Stack Overflow',
  };

  const links: { source: string; target: string; value: number }[] = [];
  for (const sub of Object.keys(feeds)) {
    const feeding = feeds[sub].filter((s) => tech.sources.includes(s) && (vol[s] ?? 0) > 0);
    const totalVol = feeding.reduce((acc, s) => acc + Math.log1p(vol[s]!), 0);
    for (const s of feeding) {
      const share = totalVol > 0 ? Math.log1p(vol[s]!) / totalVol : 1 / feeding.length;
      const v = Math.round(subVals[sub] * weights[sub] * share * 10) / 10;
      if (v >= 0.5) links.push({ source: srcName[s], target: sub, value: v });
    }
  }
  for (const sub of Object.keys(weights)) {
    links.push({
      source: sub,
      target: `Composite ${tech.score}`,
      value: Math.round(subVals[sub] * weights[sub] * 10) / 10,
    });
  }
  const nodes = [...new Set(links.flatMap((l) => [l.source, l.target]))].map((name) => ({ name }));
  return { nodes, links };
}

/** Treemap : volume réel (downloads sinon stars) par techno, groupé par catégorie. */
export function ecosystemTreemapReal(techs: Tech[]) {
  const cats = new Map<string, { name: string; children: { name: string; value: number; slug: string }[] }>();
  for (const t of techs) {
    if (!cats.has(t.category)) cats.set(t.category, { name: t.category, children: [] });
    const value = Math.max(1, Math.round(Math.max(t.metrics.downloadsMonthly / 1000, t.metrics.stars / 100)));
    cats.get(t.category)!.children.push({ name: t.name, value, slug: t.slug });
  }
  return [...cats.values()];
}

/** Bulles growth × adoption (taille = community) — lecture directe des subscores réels. */
export function landscapeBubblesReal(techs: Tech[]) {
  return techs.map((t) => ({
    slug: t.slug,
    name: t.name,
    category: t.category,
    color: t.color,
    x: t.subScores.growth,
    y: t.subScores.adoption,
    size: t.subScores.community,
    score: t.score,
  }));
}

/** Frames du bar-chart-race depuis les scores mensuels matérialisés. */
export function raceFramesReal(
  techs: Tech[],
  series: Map<string, number[]>,
  monthLabels: string[]
) {
  return monthLabels.map((month, i) => ({
    month,
    rows: techs
      .map((t) => ({
        slug: t.slug,
        name: t.name,
        color: t.color,
        category: t.category,
        value: series.get(t.slug)?.[i] ?? t.score,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8),
  }));
}

/** Compteur "signaux indexés" réel : lignes collectées toutes sources. */
export async function realSignalCount(pg: Pool): Promise<number> {
  const { rows } = await pg.query(`
    SELECT (SELECT COUNT(*) FROM metrics_snapshots)
         + (SELECT COUNT(*) FROM commits_daily)
         + (SELECT COUNT(*) FROM source_monthly)
         + (SELECT COUNT(*) FROM contributors)
         + (SELECT COUNT(*) FROM contributor_geo WHERE resolved) AS n
  `);
  return Number(rows[0].n);
}

export { compositeOf };
