import type { FastifyInstance } from 'fastify';
import { getDefaultGitHubService } from './github.js';

/**
 * Enregistre les repos GitHub des technologies classées comme `projects`
 * suivis par le scheduler de collecte.
 *
 * La taxonomie seedée fournit déjà les items GitHub (external_id = 'owner/repo',
 * items.technology_id renseigné). Le scheduler, lui, ne collecte que la table
 * `projects`. Ce service comble le fossé : pour chaque item GitHub d'une techno
 * classée sans projet lié, il résout le repo via l'API GitHub puis upserte la
 * ligne `projects` (item_id → item seedé). Idempotent : ne refait rien quand le
 * lien existe déjà.
 */
export async function ensureTechnologyProjects(fastify: FastifyInstance): Promise<number> {
  const gh = getDefaultGitHubService();

  const { rows } = await fastify.pg.query<{ item_id: string; external_id: string; slug: string }>(`
    SELECT i.id AS item_id, i.external_id, t.slug
      FROM items i
      JOIN technologies t ON t.id = i.technology_id AND t.is_ranked = TRUE
      JOIN sources s ON s.id = i.source_id AND s.slug = 'github'
      LEFT JOIN projects p ON p.item_id = i.id
     WHERE p.id IS NULL
       AND i.external_id LIKE '%/%'
     ORDER BY t.rank_position ASC
  `);

  if (rows.length === 0) {
    fastify.log.info('🔗 Repos des technologies déjà tous enregistrés comme projects');
    return 0;
  }

  let linked = 0;
  for (const row of rows) {
    const [owner, repo] = row.external_id.split('/');
    try {
      const m = await gh.getRepoMetrics(owner, repo);
      await fastify.pg.query(
        `INSERT INTO projects
           (github_id, owner, repo, description, language, homepage,
            is_archived, is_fork, project_created_at, last_pushed_at, item_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (owner, repo) DO UPDATE
           SET item_id = EXCLUDED.item_id,
               description = EXCLUDED.description,
               language = EXCLUDED.language,
               last_pushed_at = EXCLUDED.last_pushed_at`,
        [
          m.github_id, m.owner, m.repo, m.description, m.language, m.homepage,
          m.is_archived, m.is_fork, m.project_created_at, m.last_pushed_at, row.item_id,
        ]
      );
      linked++;
      fastify.log.info({ tech: row.slug, repo: row.external_id }, '🔗 Repo enregistré pour collecte');
    } catch (err) {
      fastify.log.warn(
        { tech: row.slug, repo: row.external_id, err: err instanceof Error ? err.message : String(err) },
        'Enregistrement du repo impossible (quota GitHub ?) — retenté au prochain cycle'
      );
    }
  }
  return linked;
}
