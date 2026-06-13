import type { FastifyInstance } from 'fastify';
import {
  npmMonthlyDownloads,
  npmLastMonth,
  pypiMonthlyDownloads,
  pypiLastMonth,
  hfModelStats,
  soQuestionCount,
  soAnsweredRate,
  locationToIso2,
} from '../services/connectors.js';
import { getDefaultGitHubService } from '../services/github.js';

/**
 * Cycle de collecte multi-sources — le cœur du 100 % data-driven.
 *
 *   1. Registres : npm (backfill 12 mois réels) · PyPI (~6 mois) · Hugging
 *      Face (instantané) · Stack Overflow (comptages mensuels, budget de
 *      quota) · releases GitHub → `source_monthly` + `technology_metrics`.
 *   2. Géo : localisations déclarées des contributeurs GitHub → pays
 *      (`contributor_geo`), par lots pour ménager le quota.
 *   3. Sous-scores : les 4 axes recalculés exclusivement depuis les signaux
 *      collectés (échelles log absolues, documentées sur place).
 *   4. Scores mensuels matérialisés (`technology_monthly`) : le composite de
 *      chaque mois est recalculé avec les signaux RÉELS de ce mois
 *      (downloads, questions, commits) — c'est lui qui alimente sparklines,
 *      séries et bar-chart-race.
 */

/** Échelle log absolue → 5..99 (ref ≈ 99). */
const logScore = (value: number, ref: number): number =>
  value <= 0 ? 5 : Math.max(5, Math.min(99, Math.round((Math.log1p(value) / Math.log1p(ref)) * 99)));

const clamp = (v: number, lo = 5, hi = 99) => Math.max(lo, Math.min(hi, Math.round(v)));

/* Références de normalisation (valeur ≈ score 99). Documentées et stables. */
const REF = {
  downloads: 100_000_000, // react ≈ 112 M dl/mois
  stars: 300_000,
  activity: 10_000, // 2·commits/30j + 30·releases/an
  community: 100_000, // 30·contributeurs + 2·questions/mois
};

interface SourceItem {
  itemId: string;
  externalId: string;
  source: string;
  technologyId: number;
  slug: string;
}

async function loadItems(fastify: FastifyInstance): Promise<SourceItem[]> {
  const { rows } = await fastify.pg.query(`
    SELECT i.id AS item_id, i.external_id, s.slug AS source, t.id AS technology_id, t.slug
      FROM items i
      JOIN sources s ON s.id = i.source_id
      JOIN technologies t ON t.id = i.technology_id AND t.is_ranked = TRUE
  `);
  return rows.map((r) => ({
    itemId: r.item_id,
    externalId: r.external_id,
    source: r.source,
    technologyId: Number(r.technology_id),
    slug: r.slug,
  }));
}

async function upsertMonthly(
  fastify: FastifyInstance,
  itemId: string,
  metric: string,
  month: string, // 'YYYY-MM'
  value: number
): Promise<void> {
  await fastify.pg.query(
    `INSERT INTO source_monthly (month, item_id, metric, value)
     VALUES (($1 || '-01')::date, $2, $3, $4)
     ON CONFLICT (item_id, metric, month)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [month, itemId, metric, value]
  );
}

const currentYm = () => new Date().toISOString().slice(0, 7);

/** Les 12 derniers mois en 'YYYY-MM' (chronologique, mois courant inclus). */
function last12Ym(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/* ── 1. Registres ─────────────────────────────────────────────────────── */

export async function refreshRegistries(fastify: FastifyInstance, soBudget = 50): Promise<void> {
  const items = await loadItems(fastify);
  const gh = getDefaultGitHubService();
  let soCalls = 0;

  for (const it of items) {
    try {
      if (it.source === 'npm') {
        const hist = await npmMonthlyDownloads(it.externalId);
        for (const [month, v] of hist) await upsertMonthly(fastify, it.itemId, 'downloads', month, v);
        const last30 = await npmLastMonth(it.externalId);
        if (last30 !== null) await upsertMonthly(fastify, it.itemId, 'downloads_30d', currentYm(), last30);
      } else if (it.source === 'pypi') {
        const hist = await pypiMonthlyDownloads(it.externalId);
        for (const [month, v] of hist) await upsertMonthly(fastify, it.itemId, 'downloads', month, v);
        const last30 = await pypiLastMonth(it.externalId);
        if (last30 !== null) await upsertMonthly(fastify, it.itemId, 'downloads_30d', currentYm(), last30);
      } else if (it.source === 'huggingface') {
        const stats = await hfModelStats(it.externalId);
        if (stats) {
          await upsertMonthly(fastify, it.itemId, 'downloads_30d', currentYm(), stats.downloads);
          await upsertMonthly(fastify, it.itemId, 'downloads', currentYm(), stats.downloads);
          await upsertMonthly(fastify, it.itemId, 'likes', currentYm(), stats.likes);
        }
      } else if (it.source === 'stackoverflow') {
        // Backfill des mois manquants + rafraîchissement du mois courant,
        // sous budget (quota anonyme Stack Exchange : 300 req/jour).
        const { rows } = await fastify.pg.query(
          `SELECT to_char(month, 'YYYY-MM') AS ym FROM source_monthly
            WHERE item_id = $1 AND metric = 'questions'`,
          [it.itemId]
        );
        const have = new Set(rows.map((r) => r.ym));
        for (const month of last12Ym()) {
          if (soCalls >= soBudget) break;
          if (have.has(month) && month !== currentYm()) continue;
          const from = Math.floor(new Date(`${month}-01T00:00:00Z`).getTime() / 1000);
          const d = new Date(`${month}-01T00:00:00Z`);
          const to = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000);
          const count = await soQuestionCount(it.externalId, from, to);
          soCalls++;
          if (count !== null) await upsertMonthly(fastify, it.itemId, 'questions', month, count);
          await new Promise((r) => setTimeout(r, 200));
        }
        if (soCalls + 2 <= soBudget) {
          const rate = await soAnsweredRate(it.externalId);
          soCalls += 2;
          if (rate !== null) await upsertMonthly(fastify, it.itemId, 'answered_rate', currentYm(), rate);
        }
      } else if (it.source === 'github') {
        const releases = await gh.getReleasesLastYear(...(it.externalId.split('/') as [string, string]));
        await upsertMonthly(fastify, it.itemId, 'releases_year', currentYm(), releases);
      }
    } catch (err) {
      fastify.log.warn({ item: it.externalId, source: it.source, err }, 'Connecteur en échec (non bloquant)');
    }
  }
  fastify.log.info({ items: items.length, soCalls }, '🔌 Registres rafraîchis');
}

/* ── 2. Géo contributeurs ─────────────────────────────────────────────── */

export async function refreshContributorGeo(fastify: FastifyInstance, budget = 150): Promise<void> {
  const gh = getDefaultGitHubService();
  const { rows } = await fastify.pg.query<{ login: string }>(
    `SELECT DISTINCT c.login
       FROM contributors c
       JOIN projects p ON p.id = c.project_id
       JOIN items i ON i.id = p.item_id
       JOIN technologies t ON t.id = i.technology_id AND t.is_ranked = TRUE
       LEFT JOIN contributor_geo g ON g.login = c.login
      WHERE g.login IS NULL
      ORDER BY c.login
      LIMIT $1`,
    [budget]
  );

  let located = 0;
  for (const { login } of rows) {
    try {
      const location = await gh.getUserLocation(login);
      const iso2 = locationToIso2(location);
      if (iso2) located++;
      await fastify.pg.query(
        `INSERT INTO contributor_geo (login, location_raw, iso2, resolved)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (login) DO UPDATE
           SET location_raw = EXCLUDED.location_raw, iso2 = EXCLUDED.iso2, updated_at = NOW()`,
        [login, location, iso2]
      );
    } catch (err) {
      fastify.log.warn({ login, err }, 'Localisation contributeur en échec');
      break; // quota probable : on réessaiera au prochain cycle
    }
  }
  if (rows.length > 0) {
    fastify.log.info({ lookups: rows.length, located }, '🌍 Géo contributeurs rafraîchie');
  }
}

/* ── 3 + 4. Sous-scores et scores mensuels ────────────────────────────── */

interface TechSignals {
  technologyId: number;
  stars: number;
  contributors: number;
  commits30: number;
  downloads30: number;
  questionsMonth: number;
  answeredRate: number | null;
  releasesYear: number;
  hfDownloads: number | null;
  hfLikes: number | null;
  starGrowthMonthlyPct: number | null;
  downloadsMoMPct: number | null;
}

async function loadSignals(fastify: FastifyInstance): Promise<TechSignals[]> {
  const { rows } = await fastify.pg.query(`
    WITH tech_items AS (
      SELECT t.id AS technology_id, i.id AS item_id, s.slug AS source
        FROM technologies t
        JOIN items i ON i.technology_id = t.id
        JOIN sources s ON s.id = i.source_id
       WHERE t.is_ranked = TRUE
    ),
    cur AS (SELECT date_trunc('month', NOW())::date AS m),
    dl30 AS (
      SELECT ti.technology_id, SUM(sm.value) AS v
        FROM source_monthly sm JOIN tech_items ti ON ti.item_id = sm.item_id, cur
       WHERE sm.metric = 'downloads_30d' AND sm.month = cur.m
       GROUP BY ti.technology_id
    ),
    qs AS (
      SELECT ti.technology_id, SUM(sm.value) AS v
        FROM source_monthly sm JOIN tech_items ti ON ti.item_id = sm.item_id, cur
       WHERE sm.metric = 'questions'
         AND sm.month = (cur.m - INTERVAL '1 month')::date
       GROUP BY ti.technology_id
    ),
    ar AS (
      SELECT ti.technology_id, AVG(sm.value) AS v
        FROM source_monthly sm JOIN tech_items ti ON ti.item_id = sm.item_id, cur
       WHERE sm.metric = 'answered_rate' AND sm.month = cur.m
       GROUP BY ti.technology_id
    ),
    rel AS (
      SELECT ti.technology_id, SUM(sm.value) AS v
        FROM source_monthly sm JOIN tech_items ti ON ti.item_id = sm.item_id, cur
       WHERE sm.metric = 'releases_year' AND sm.month = cur.m
       GROUP BY ti.technology_id
    ),
    hf AS (
      SELECT ti.technology_id,
             SUM(sm.value) FILTER (WHERE sm.metric = 'downloads_30d') AS dl,
             SUM(sm.value) FILTER (WHERE sm.metric = 'likes') AS likes
        FROM source_monthly sm
        JOIN tech_items ti ON ti.item_id = sm.item_id AND ti.source = 'huggingface', cur
       WHERE sm.month = cur.m
       GROUP BY ti.technology_id
    ),
    -- Croissance downloads : dernier mois complet vs précédent.
    dlgrowth AS (
      SELECT technology_id,
             CASE WHEN prev > 0 THEN ROUND(((last - prev) / prev * 100)::numeric, 1) END AS pct
        FROM (
          SELECT ti.technology_id,
                 SUM(sm.value) FILTER (WHERE sm.month = (cur.m - INTERVAL '1 month')::date) AS last,
                 SUM(sm.value) FILTER (WHERE sm.month = (cur.m - INTERVAL '2 month')::date) AS prev
            FROM source_monthly sm JOIN tech_items ti ON ti.item_id = sm.item_id, cur
           WHERE sm.metric = 'downloads'
           GROUP BY ti.technology_id
        ) x
    ),
    commits AS (
      SELECT i.technology_id, SUM(cd.commit_count) AS v
        FROM commits_daily cd
        JOIN projects p ON p.id = cd.project_id
        JOIN items i ON i.id = p.item_id AND i.technology_id IS NOT NULL
       WHERE cd.day >= CURRENT_DATE - 30
       GROUP BY i.technology_id
    ),
    stargrowth AS (
      SELECT i.technology_id,
             CASE WHEN MIN(e.stars) > 0 AND EXTRACT(EPOCH FROM (MAX(l.time) - MIN(e.time))) >= 172800
                  THEN ROUND((((SUM(DISTINCT l.stars) - SUM(DISTINCT e.stars))::numeric / NULLIF(SUM(DISTINCT e.stars),0)) * 100
                       * 730 / (EXTRACT(EPOCH FROM (MAX(l.time) - MIN(e.time))) / 3600))::numeric, 1)
             END AS pct
        FROM projects p
        JOIN items i ON i.id = p.item_id AND i.technology_id IS NOT NULL
        JOIN LATERAL (SELECT m.time, m.stars FROM metrics_snapshots m WHERE m.project_id = p.id ORDER BY m.time DESC LIMIT 1) l ON TRUE
        JOIN LATERAL (SELECT m.time, m.stars FROM metrics_snapshots m WHERE m.project_id = p.id ORDER BY m.time ASC  LIMIT 1) e ON TRUE
       GROUP BY i.technology_id
    )
    SELECT t.id AS technology_id,
           tm.stars, tm.contributors,
           COALESCE(c.v, 0)  AS commits30,
           COALESCE(d.v, 0)  AS downloads30,
           COALESCE(q.v, 0)  AS questions_month,
           ar.v              AS answered_rate,
           COALESCE(r.v, 0)  AS releases_year,
           hf.dl             AS hf_downloads,
           hf.likes          AS hf_likes,
           sg.pct            AS star_growth_pct,
           dg.pct            AS dl_growth_pct
      FROM technologies t
      JOIN technology_metrics tm ON tm.technology_id = t.id
      LEFT JOIN commits c   ON c.technology_id = t.id
      LEFT JOIN dl30 d      ON d.technology_id = t.id
      LEFT JOIN qs q        ON q.technology_id = t.id
      LEFT JOIN ar          ON ar.technology_id = t.id
      LEFT JOIN rel r       ON r.technology_id = t.id
      LEFT JOIN hf          ON hf.technology_id = t.id
      LEFT JOIN stargrowth sg ON sg.technology_id = t.id
      LEFT JOIN dlgrowth dg ON dg.technology_id = t.id
     WHERE t.is_ranked = TRUE
  `);

  return rows.map((r) => ({
    technologyId: Number(r.technology_id),
    stars: Number(r.stars),
    contributors: Number(r.contributors),
    commits30: Number(r.commits30),
    downloads30: Number(r.downloads30),
    questionsMonth: Number(r.questions_month),
    answeredRate: r.answered_rate == null ? null : Number(r.answered_rate),
    releasesYear: Number(r.releases_year),
    hfDownloads: r.hf_downloads == null ? null : Number(r.hf_downloads),
    hfLikes: r.hf_likes == null ? null : Number(r.hf_likes),
    starGrowthMonthlyPct: r.star_growth_pct == null ? null : Number(r.star_growth_pct),
    downloadsMoMPct: r.dl_growth_pct == null ? null : Number(r.dl_growth_pct),
  }));
}

export async function computeSubscores(fastify: FastifyInstance): Promise<void> {
  const signals = await loadSignals(fastify);

  for (const s of signals) {
    // adoption : downloads réels ; pour les technos sans registre (GitHub
    // seul, ex. kubernetes), les stars restent un proxy d'adoption réel.
    const adoption = Math.max(
      logScore(s.downloads30 + (s.hfDownloads ?? 0), REF.downloads),
      logScore(s.stars, REF.stars)
    );
    const activity = logScore(s.commits30 * 2 + s.releasesYear * 30, REF.activity);
    const community = logScore(
      s.contributors * 30 + s.questionsMonth * 2 + (s.hfLikes ?? 0),
      REF.community
    );
    const starPct = s.starGrowthMonthlyPct ?? 0;
    const dlPct = Math.max(-30, Math.min(30, s.downloadsMoMPct ?? 0));
    const growth = clamp(50 + starPct * 8 + dlPct * 0.8);

    await fastify.pg.query(
      `UPDATE technology_subscores
          SET adoption = $2, activity = $3, growth = $4, community = $5,
              delta_adoption = $6, delta_growth = $7, updated_at = NOW()
        WHERE technology_id = $1`,
      [s.technologyId, adoption, activity, growth, community,
       Math.max(-99, Math.min(99, dlPct)), Math.max(-99, Math.min(99, starPct))]
    );

    await fastify.pg.query(
      `UPDATE technology_metrics
          SET downloads_monthly = $2, questions_monthly = $3,
              answered_rate = COALESCE($4, answered_rate),
              releases_year = $5, hf_downloads = $6, hf_likes = $7,
              updated_at = NOW()
        WHERE technology_id = $1`,
      [s.technologyId, Math.round(s.downloads30), Math.round(s.questionsMonth),
       s.answeredRate, Math.round(s.releasesYear), s.hfDownloads, s.hfLikes]
    );
  }
  fastify.log.info({ technologies: signals.length }, '🧮 Sous-scores recalculés (signaux réels)');
}

export async function materializeMonthlyScores(fastify: FastifyInstance): Promise<void> {
  // Composite mensuel : adoption/community/activity du MOIS quand le signal
  // mensuel existe (downloads, questions, commits), valeur courante sinon.
  await fastify.pg.query(`
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', NOW()) - INTERVAL '11 months',
        date_trunc('month', NOW()), '1 month'
      )::date AS m
    ),
    tech_items AS (
      SELECT t.id AS technology_id, i.id AS item_id
        FROM technologies t JOIN items i ON i.technology_id = t.id
       WHERE t.is_ranked = TRUE
    ),
    dl AS (
      SELECT ti.technology_id, sm.month, SUM(sm.value) AS v
        FROM source_monthly sm JOIN tech_items ti ON ti.item_id = sm.item_id
       WHERE sm.metric = 'downloads' GROUP BY 1, 2
    ),
    q AS (
      SELECT ti.technology_id, sm.month, SUM(sm.value) AS v
        FROM source_monthly sm JOIN tech_items ti ON ti.item_id = sm.item_id
       WHERE sm.metric = 'questions' GROUP BY 1, 2
    ),
    cm AS (
      SELECT i.technology_id, date_trunc('month', cd.day)::date AS month, SUM(cd.commit_count) AS v
        FROM commits_daily cd
        JOIN projects p ON p.id = cd.project_id
        JOIN items i ON i.id = p.item_id AND i.technology_id IS NOT NULL
       GROUP BY 1, 2
    ),
    scored AS (
      SELECT t.id AS technology_id, months.m AS month,
        ROUND((
          0.35 * GREATEST(
            CASE WHEN dl.v IS NULL OR dl.v <= 0 THEN 5
                 ELSE LEAST(99, GREATEST(5, ln(1 + dl.v) / ln(1 + 100000000.0) * 99)) END,
            CASE WHEN tm.stars <= 0 THEN 5
                 ELSE LEAST(99, GREATEST(5, ln(1 + tm.stars) / ln(1 + 300000.0) * 99)) END
          )
          + 0.25 * CASE
              WHEN cm.v IS NOT NULL AND cm.v > 0
                THEN LEAST(99, GREATEST(5, ln(1 + cm.v * 2 + tm.releases_year * 30) / ln(1 + 10000.0) * 99))
              ELSE ss.activity END
          + 0.25 * ss.growth
          + 0.15 * CASE
              WHEN q.v IS NOT NULL
                THEN LEAST(99, GREATEST(5, ln(1 + tm.contributors * 30 + q.v * 2) / ln(1 + 100000.0) * 99))
              ELSE ss.community END
        )::numeric, 1) AS score
      FROM technologies t
      JOIN technology_metrics tm ON tm.technology_id = t.id
      JOIN technology_subscores ss ON ss.technology_id = t.id
      CROSS JOIN months
      LEFT JOIN dl ON dl.technology_id = t.id AND dl.month = months.m
      LEFT JOIN q  ON q.technology_id  = t.id AND q.month  = months.m
      LEFT JOIN cm ON cm.technology_id = t.id AND cm.month = months.m
      WHERE t.is_ranked = TRUE
    )
    INSERT INTO technology_monthly (technology_id, month, score)
    SELECT technology_id, month, score FROM scored
    ON CONFLICT (technology_id, month) DO UPDATE SET score = EXCLUDED.score
  `);
  fastify.log.info('📈 Scores mensuels matérialisés');
}

/* ── Orchestration ────────────────────────────────────────────────────── */

async function fullCycle(fastify: FastifyInstance): Promise<void> {
  await refreshRegistries(fastify);
  await refreshContributorGeo(fastify);
  await computeSubscores(fastify);
  await materializeMonthlyScores(fastify);
  fastify.taxonomy.invalidate();
  try {
    const keys = await fastify.redis.keys('api:*');
    if (keys.length > 0) await fastify.redis.del(...keys);
  } catch {
    /* non bloquant */
  }
}

const BOOT_DELAY_MS = 30_000;
const CYCLE_INTERVAL_MS = 30 * 60_000; // les registres publics sont peu coûteux

export function startConnectorsRefresh(fastify: FastifyInstance): { stop: () => void } {
  let interval: ReturnType<typeof setInterval> | null = null;
  const boot = setTimeout(async () => {
    try {
      await fullCycle(fastify);
    } catch (err) {
      fastify.log.error({ err }, 'Cycle connecteurs initial en échec');
    }
    interval = setInterval(
      () => fullCycle(fastify).catch((err) => fastify.log.error({ err }, 'Cycle connecteurs en échec')),
      CYCLE_INTERVAL_MS
    );
  }, BOOT_DELAY_MS);

  return {
    stop: () => {
      clearTimeout(boot);
      if (interval) clearInterval(interval);
    },
  };
}
