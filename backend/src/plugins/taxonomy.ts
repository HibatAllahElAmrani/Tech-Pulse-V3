import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { TaxonomyService } from '../services/taxonomy.js';

declare module 'fastify' {
  interface FastifyInstance {
    taxonomy: TaxonomyService;
  }
}

/**
 * Décore l'instance Fastify avec le service taxonomie (technologies, pays,
 * catégories, sources, cases) — chargé depuis PostgreSQL, cache mémoire 60 s.
 */
const taxonomyPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('taxonomy', new TaxonomyService(fastify.pg));
};

export default fp(taxonomyPlugin, { name: 'taxonomy', dependencies: ['pg'] });
