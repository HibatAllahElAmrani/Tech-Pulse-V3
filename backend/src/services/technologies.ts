import type { Pool } from 'pg';
import type { Item } from './items.js';

/**
 * Technology — l'unité comparable dans les classements (étape 3). Une techno
 * (React Native, MongoDB, LLaMA…) agrège des `items` de plusieurs sources.
 */
export interface Technology {
  id: number;
  slug: string;
  name: string;
  primary_language: string | null;
  description: string | null;
}

export interface Category {
  id: number;
  slug: string;
  name: string;
  domain: string;
  parent_id: number | null;
}

/**
 * Repository LECTURE SEULE pour la taxonomie (technologies / catégories / items
 * rattachés). Pas encore branché aux endpoints (strangler) ; sert la bascule des
 * étapes suivantes et la vérification du seed.
 */
export class TechnologiesRepository {
  constructor(private readonly pg: Pool) {}

  /** Liste toutes les technologies. */
  async list(): Promise<Technology[]> {
    const { rows } = await this.pg.query<Technology>(
      `SELECT id, slug, name, primary_language, description
         FROM technologies ORDER BY name`
    );
    return rows;
  }

  /** Liste les technologies d'une catégorie (par slug de catégorie). */
  async listByCategory(categorySlug: string): Promise<Technology[]> {
    const { rows } = await this.pg.query<Technology>(
      `SELECT t.id, t.slug, t.name, t.primary_language, t.description
         FROM technologies t
         JOIN technology_categories tc ON tc.technology_id = t.id
         JOIN categories c ON c.id = tc.category_id
        WHERE c.slug = $1
        ORDER BY t.name`,
      [categorySlug]
    );
    return rows;
  }

  /** Liste les items source-spécifiques rattachés à une technologie (par slug). */
  async listItems(technologySlug: string): Promise<Item[]> {
    const { rows } = await this.pg.query<Item>(
      `SELECT i.id, i.source_id, s.slug AS source_slug, i.external_id,
              i.name, i.full_name, i.url, i.language, i.description,
              i.technology_id, i.created_at, i.updated_at
         FROM items i
         JOIN sources s ON s.id = i.source_id
         JOIN technologies t ON t.id = i.technology_id
        WHERE t.slug = $1
        ORDER BY s.slug`,
      [technologySlug]
    );
    return rows;
  }

  /** Liste les catégories (axe domaine). */
  async listCategories(): Promise<Category[]> {
    const { rows } = await this.pg.query<Category>(
      `SELECT id, slug, name, domain, parent_id FROM categories ORDER BY name`
    );
    return rows;
  }
}
