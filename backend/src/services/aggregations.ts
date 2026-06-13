import type { Pool } from 'pg';

/* ──────────────────────────────────────────────────────────────────────────
 * Agrégations TimescaleDB — la couche RÉELLE qui remplace progressivement
 * les générateurs de scoring.ts (pattern strangler documenté là-bas).
 *
 * Chemin de jointure : technologies → items (technology_id, source github)
 * → projects (item_id) → metrics_snapshots / commits_daily / contributors.
 * Toutes les fonctions retournent des structures vides quand la collecte n'a
 * pas encore produit de données : l'appelant garde alors le générateur
 * déterministe comme fallback, sans changer la forme des réponses.
 * ────────────────────────────────────────────────────────────────────────── */

const TECH_PROJECTS_CTE = `
  tech_projects AS (
    SELECT t.id AS technology_id, t.slug, p.id AS project_id
      FROM technologies t
      JOIN items i ON i.technology_id = t.id
      JOIN sources s ON s.id = i.source_id AND s.slug = 'github'
      JOIN projects p ON p.item_id = i.id
     WHERE t.is_ranked = TRUE
  )
`;

export interface TechAggregate {
  technologyId: number;
  slug: string;
  projectCount: number;
  stars: number;
  forks: number;
  openIssues: number;
  openPrs: number;
  /** Total contributeurs (compteur Link GitHub) — 0 si pas encore collecté. */
  contributors: number;
  /** Somme des commits des 30 derniers jours (commits_daily). */
  commits30d: number;
  /** Fenêtre observée pour la croissance des stars. */
  firstStars: number | null;
  lastStars: number | null;
  windowHours: number;
}

/** Agrégats GitHub réels par technologie classée (une ligne par techno avec données). */
export async function fetchTechAggregates(pg: Pool): Promise<TechAggregate[]> {
  const { rows } = await pg.query(`
    WITH ${TECH_PROJECTS_CTE},
    latest AS (
      SELECT DISTINCT ON (m.project_id)
             m.project_id, m.time, m.stars, m.forks, m.open_issues, m.open_prs, m.contributors_30d
        FROM metrics_snapshots m
        JOIN tech_projects tp ON tp.project_id = m.project_id
       ORDER BY m.project_id, m.time DESC
    ),
    earliest AS (
      SELECT DISTINCT ON (m.project_id) m.project_id, m.time, m.stars
        FROM metrics_snapshots m
        JOIN tech_projects tp ON tp.project_id = m.project_id
       ORDER BY m.project_id, m.time ASC
    ),
    commits AS (
      SELECT tp.technology_id, SUM(cd.commit_count)::bigint AS commits_30d
        FROM commits_daily cd
        JOIN tech_projects tp ON tp.project_id = cd.project_id
       WHERE cd.day >= CURRENT_DATE - 30
       GROUP BY tp.technology_id
    ),
    -- Le compteur total de contributeurs n'est posé que par les passes basse
    -- fréquence ; les snapshots intermédiaires portent 0 → MAX par projet.
    contrib AS (
      SELECT tp.technology_id, SUM(mx.c)::bigint AS contributors
        FROM (
          SELECT m.project_id, MAX(m.contributors_30d) AS c
            FROM metrics_snapshots m
           GROUP BY m.project_id
        ) mx
        JOIN tech_projects tp ON tp.project_id = mx.project_id
       GROUP BY tp.technology_id
    )
    SELECT tp.technology_id,
           tp.slug,
           COUNT(l.project_id)::int                 AS project_count,
           COALESCE(SUM(l.stars), 0)::bigint        AS stars,
           COALESCE(SUM(l.forks), 0)::bigint        AS forks,
           COALESCE(SUM(l.open_issues), 0)::bigint  AS open_issues,
           COALESCE(SUM(l.open_prs), 0)::bigint     AS open_prs,
           COALESCE(MAX(ct.contributors), 0)::bigint AS contributors,
           COALESCE(MAX(c.commits_30d), 0)::bigint  AS commits_30d,
           SUM(e.stars)::bigint                     AS first_stars,
           EXTRACT(EPOCH FROM (MAX(l.time) - MIN(e.time))) / 3600.0 AS window_hours
      FROM tech_projects tp
      JOIN latest l   ON l.project_id = tp.project_id
      JOIN earliest e ON e.project_id = tp.project_id
      LEFT JOIN commits c ON c.technology_id = tp.technology_id
      LEFT JOIN contrib ct ON ct.technology_id = tp.technology_id
     GROUP BY tp.technology_id, tp.slug
  `);

  return rows.map((r) => ({
    technologyId: Number(r.technology_id),
    slug: r.slug,
    projectCount: Number(r.project_count),
    stars: Number(r.stars),
    forks: Number(r.forks),
    openIssues: Number(r.open_issues),
    openPrs: Number(r.open_prs),
    contributors: Number(r.contributors),
    commits30d: Number(r.commits_30d),
    firstStars: r.first_stars == null ? null : Number(r.first_stars),
    lastStars: Number(r.stars),
    windowHours: Number(r.window_hours ?? 0),
  }));
}

/** Volume mensuel de commits d'une techno : Map "YYYY-MM" → total. */
export async function monthlyCommitTotals(pg: Pool, slug: string): Promise<Map<string, number>> {
  const { rows } = await pg.query(
    `
    WITH ${TECH_PROJECTS_CTE}
    SELECT to_char(date_trunc('month', cd.day), 'YYYY-MM') AS ym,
           SUM(cd.commit_count)::bigint AS total
      FROM commits_daily cd
      JOIN tech_projects tp ON tp.project_id = cd.project_id
     WHERE tp.slug = $1
     GROUP BY 1
    `,
    [slug]
  );
  return new Map(rows.map((r) => [r.ym as string, Number(r.total)]));
}

/** Commits quotidiens réels d'une techno : Map "YYYY-MM-DD" → total. */
export async function dailyCommitTotals(
  pg: Pool,
  slug: string,
  sinceDays = 182
): Promise<Map<string, number>> {
  const { rows } = await pg.query(
    `
    WITH ${TECH_PROJECTS_CTE}
    SELECT to_char(cd.day, 'YYYY-MM-DD') AS d,
           SUM(cd.commit_count)::bigint AS total
      FROM commits_daily cd
      JOIN tech_projects tp ON tp.project_id = cd.project_id
     WHERE tp.slug = $1
       AND cd.day >= CURRENT_DATE - $2::int
     GROUP BY 1
    `,
    [slug, sinceDays]
  );
  return new Map(rows.map((r) => [r.d as string, Number(r.total)]));
}

/** Premier jour couvert par la collecte commits_daily d'une techno (ou null). */
export async function collectionStartDay(pg: Pool, slug: string): Promise<string | null> {
  const { rows } = await pg.query(
    `
    WITH ${TECH_PROJECTS_CTE}
    SELECT to_char(MIN(cd.day), 'YYYY-MM-DD') AS first_day
      FROM commits_daily cd
      JOIN tech_projects tp ON tp.project_id = cd.project_id
     WHERE tp.slug = $1
    `,
    [slug]
  );
  return rows[0]?.first_day ?? null;
}
