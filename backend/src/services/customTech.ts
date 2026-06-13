import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import type { CollectJobData } from '../workers/metricsWorker.js';
import { getDefaultGitHubService, type RepoMetrics } from './github.js';
import { npmPackageForRepo, pypiPackageForRepo, soTagForRepo } from './connectors.js';

/**
 * Technologies ajoutées par l'utilisateur (barre de recherche globale).
 *
 * Un repo GitHub devient une technologie de plein droit : ligne
 * `technologies` (is_custom = TRUE), item GitHub lié, catégorie, sous-scores
 * neutres (affinés par le cycle d'agrégats réels), projet enregistré pour la
 * collecte. Suppression réservée aux technos is_custom — les 15 seedées sont
 * protégées.
 */

export class CustomTechError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'CustomTechError';
  }
}

/** Mots-clés topics/langage → catégorie. Premier match gagne, sinon 'other'. */
const CATEGORY_HINTS: [string, string[]][] = [
  ['mobile', ['android', 'ios', 'mobile', 'flutter', 'react-native', 'kotlin', 'swift', 'dart']],
  ['database', ['database', 'db', 'sql', 'nosql', 'storage', 'key-value', 'graph-database', 'olap', 'datastore']],
  ['ai-model', ['llm', 'ai', 'machine-learning', 'deep-learning', 'neural-network', 'transformer', 'model', 'nlp', 'pytorch', 'tensorflow', 'speech']],
  ['embedded', ['embedded', 'iot', 'rtos', 'arduino', 'microcontroller', 'firmware', 'esp32', 'baremetal']],
  ['web', ['frontend', 'framework', 'web', 'ui', 'components', 'css', 'javascript', 'typescript', 'react', 'vue', 'ssr']],
];

export function detectCategory(topics: string[], language: string | null): string {
  const haystack = new Set(topics.map((t) => t.toLowerCase()));
  if (language) haystack.add(language.toLowerCase());
  for (const [slug, hints] of CATEGORY_HINTS) {
    if (hints.some((h) => haystack.has(h))) return slug;
  }
  return 'other';
}

const COLOR_PALETTE = ['#22D3EE', '#34D399', '#FBBF24', '#FB7185', '#7C5CFF', '#60A5FA', '#FB923C', '#A3E635', '#F472B6', '#A78BFA'];

function colorFor(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[h % COLOR_PALETTE.length];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export interface CreatedTech {
  slug: string;
  name: string;
  category: string;
  color: string;
  stars: number;
}

export async function createTechnologyFromRepo(
  fastify: FastifyInstance,
  metricsQueue: Queue<CollectJobData>,
  owner: string,
  repo: string,
  categorySlug?: string
): Promise<CreatedTech> {
  const gh = getDefaultGitHubService();

  let m: RepoMetrics;
  try {
    m = await gh.getRepoMetrics(owner, repo);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 403 || status === 429) {
      throw new CustomTechError(
        503,
        'GitHub rate limit exceeded — add GITHUB_PERSONAL_TOKEN in .env.docker or retry later'
      );
    }
    throw new CustomTechError(404, `Repository ${owner}/${repo} not found on GitHub`);
  }
  const externalId = `${m.owner}/${m.repo}`;

  // Déjà suivi comme technologie ?
  const dup = await fastify.pg.query<{ slug: string }>(
    `SELECT t.slug
       FROM items i
       JOIN technologies t ON t.id = i.technology_id
       JOIN sources s ON s.id = i.source_id AND s.slug = 'github'
      WHERE LOWER(i.external_id) = LOWER($1)`,
    [externalId]
  );
  if (dup.rows.length > 0) {
    throw new CustomTechError(409, `Already tracked as technology "${dup.rows[0].slug}"`);
  }

  const category = categorySlug ?? detectCategory(m.topics, m.language);
  const cat = await fastify.pg.query<{ id: number }>(`SELECT id FROM categories WHERE slug = $1`, [category]);
  if (cat.rows.length === 0) throw new CustomTechError(400, `Unknown category "${category}"`);

  // Slug unique : nom du repo, préfixé par l'owner en cas de collision.
  let slug = slugify(m.repo);
  const taken = async (s: string) =>
    (await fastify.pg.query(`SELECT 1 FROM technologies WHERE slug = $1`, [s])).rows.length > 0;
  if (!slug || (await taken(slug))) {
    slug = slugify(`${m.owner}-${m.repo}`);
    if (!slug || (await taken(slug))) throw new CustomTechError(409, `Slug conflict for ${externalId}`);
  }

  const color = colorFor(slug);
  const firstRelease = m.project_created_at ? new Date(m.project_created_at).getUTCFullYear() : null;

  const client = await fastify.pg.connect();
  try {
    await client.query('BEGIN');
    const techRes = await client.query<{ id: number }>(
      `INSERT INTO technologies
         (slug, name, primary_language, description, tagline, color, license,
          first_release, is_ranked, rank_position, is_custom)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE,
               (SELECT COALESCE(MAX(rank_position), 0) + 1 FROM technologies), TRUE)
       RETURNING id`,
      [slug, m.repo, m.language, m.description ?? '', m.description ?? '', color, m.license ?? '', firstRelease]
    );
    const techId = techRes.rows[0].id;

    await client.query(
      `INSERT INTO technology_categories (technology_id, category_id) VALUES ($1, $2)`,
      [techId, cat.rows[0].id]
    );
    // Sous-scores neutres : le cycle d'agrégats réels affine activity/growth
    // dès la première collecte (~1 min après l'ajout).
    await client.query(
      `INSERT INTO technology_subscores (technology_id, adoption, activity, growth, community)
       VALUES ($1, 50, 50, 50, 50)`,
      [techId]
    );
    await client.query(
      `INSERT INTO technology_metrics (technology_id, stars, forks) VALUES ($1, $2, $3)`,
      [techId, m.stars, m.forks]
    );
    await client.query(
      `INSERT INTO technology_sources (technology_id, source_id)
       SELECT $1, id FROM sources WHERE slug = 'github'`,
      [techId]
    );
    await client.query(
      `INSERT INTO items (source_id, external_id, name, full_name, url, language, description, technology_id)
       SELECT s.id, $1, $2, $1, $3, $4, $5, $6
         FROM sources s WHERE s.slug = 'github'
       ON CONFLICT (source_id, external_id) DO UPDATE SET technology_id = EXCLUDED.technology_id`,
      [externalId, m.repo, `https://github.com/${externalId}`, m.language, m.description, techId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Auto-mapping des registres : package npm/PyPI homonyme vérifié (son URL
  // de repo doit pointer vers CE repo GitHub) + tag Stack Overflow homonyme à
  // volume significatif. Les connecteurs collecteront ces items dès le
  // prochain cycle — downloads et questions réels sans intervention manuelle.
  try {
    const [npmPkg, pypiPkg, soTag] = await Promise.all([
      npmPackageForRepo(m.owner, m.repo),
      pypiPackageForRepo(m.owner, m.repo),
      soTagForRepo(m.repo),
    ]);
    const mappings: { source: string; externalId: string; url: string }[] = [];
    if (npmPkg) mappings.push({ source: 'npm', externalId: npmPkg, url: `https://www.npmjs.com/package/${npmPkg}` });
    if (pypiPkg) mappings.push({ source: 'pypi', externalId: pypiPkg, url: `https://pypi.org/project/${pypiPkg}` });
    if (soTag) mappings.push({ source: 'stackoverflow', externalId: soTag, url: `https://stackoverflow.com/questions/tagged/${soTag}` });
    for (const map of mappings) {
      await fastify.pg.query(
        `INSERT INTO items (source_id, external_id, name, full_name, url, technology_id)
         SELECT s.id, $2, $2, $2, $3, (SELECT id FROM technologies WHERE slug = $4)
           FROM sources s WHERE s.slug = $1
         ON CONFLICT (source_id, external_id) DO NOTHING`,
        [map.source, map.externalId, map.url, slug]
      );
      await fastify.pg.query(
        `INSERT INTO technology_sources (technology_id, source_id)
         SELECT t.id, s.id FROM technologies t, sources s
          WHERE t.slug = $1 AND s.slug = $2
         ON CONFLICT DO NOTHING`,
        [slug, map.source]
      );
    }
    if (mappings.length > 0) {
      fastify.log.info(
        { tech: slug, mappings: mappings.map((x) => `${x.source}:${x.externalId}`) },
        '🔗 Registres auto-mappés'
      );
    }
  } catch (err) {
    fastify.log.warn({ tech: slug, err }, 'Auto-mapping registres en échec (non bloquant)');
  }

  // Enregistre le projet pour la collecte + premier job immédiat.
  const proj = await fastify.pg.query<{ id: string }>(
    `INSERT INTO projects
       (github_id, owner, repo, description, language, homepage, is_archived,
        is_fork, project_created_at, last_pushed_at, item_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             (SELECT i.id FROM items i JOIN sources s ON s.id = i.source_id
               WHERE s.slug = 'github' AND i.external_id = $11))
     ON CONFLICT (owner, repo) DO UPDATE
       SET item_id = EXCLUDED.item_id, last_pushed_at = EXCLUDED.last_pushed_at
     RETURNING id`,
    [m.github_id, m.owner, m.repo, m.description, m.language, m.homepage,
     m.is_archived, m.is_fork, m.project_created_at, m.last_pushed_at, externalId]
  );
  await metricsQueue.add(
    `collect:initial:${proj.rows[0].id}`,
    { projectId: proj.rows[0].id, owner: m.owner, repo: m.repo, priority: 'low' },
    { priority: 1 }
  );

  await invalidateCaches(fastify);
  return { slug, name: m.repo, category, color, stars: m.stars };
}

export async function deleteCustomTechnology(fastify: FastifyInstance, slug: string): Promise<void> {
  const tech = await fastify.pg.query<{ id: number; is_custom: boolean }>(
    `SELECT id, is_custom FROM technologies WHERE slug = $1`,
    [slug]
  );
  if (tech.rows.length === 0) throw new CustomTechError(404, 'Technology not found');
  if (!tech.rows[0].is_custom) {
    throw new CustomTechError(403, 'Seeded technologies cannot be removed');
  }
  const techId = tech.rows[0].id;

  const client = await fastify.pg.connect();
  try {
    await client.query('BEGIN');
    // Projets créés pour cette techno (et leurs séries, via FK CASCADE).
    await client.query(
      `DELETE FROM projects p
        USING items i
        WHERE p.item_id = i.id AND i.technology_id = $1`,
      [techId]
    );
    await client.query(`DELETE FROM items WHERE technology_id = $1`, [techId]);
    await client.query(`DELETE FROM technologies WHERE id = $1`, [techId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await invalidateCaches(fastify);
}

async function invalidateCaches(fastify: FastifyInstance): Promise<void> {
  fastify.taxonomy.invalidate();
  try {
    const keys = await fastify.redis.keys('api:*');
    if (keys.length > 0) await fastify.redis.del(...keys);
  } catch {
    /* non bloquant */
  }
}
