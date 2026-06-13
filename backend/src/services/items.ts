import type { Pool } from 'pg';

/**
 * Item — entité générique (spine) du modèle multi-sources introduit à l'étape 2.
 * Représente un dépôt GitHub, un modèle Hugging Face, un package npm/PyPI, un tag
 * Stack Overflow, etc. `source_slug` est joint depuis la table `sources`.
 */
export interface Item {
  id: string;
  source_id: number;
  source_slug: string;
  external_id: string;
  name: string;
  full_name: string | null;
  url: string | null;
  language: string | null;
  description: string | null;
  technology_id: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Repository LECTURE SEULE pour `items`. À ce stade (strangler), il n'est pas
 * encore branché aux endpoints : ceux-ci continuent de passer par le chemin
 * GitHub historique. Il prépare la bascule des étapes suivantes.
 */
export class ItemsRepository {
  constructor(private readonly pg: Pool) {}

  private static readonly SELECT = `
    SELECT i.id, i.source_id, s.slug AS source_slug, i.external_id,
           i.name, i.full_name, i.url, i.language, i.description,
           i.technology_id, i.created_at, i.updated_at
      FROM items i
      JOIN sources s ON s.id = i.source_id
  `;

  /** Liste les items, plus récents d'abord. */
  async list(limit = 100): Promise<Item[]> {
    const { rows } = await this.pg.query<Item>(
      `${ItemsRepository.SELECT} ORDER BY i.created_at DESC LIMIT $1`,
      [limit]
    );
    return rows;
  }

  /** Récupère un item par son UUID. */
  async getById(id: string): Promise<Item | null> {
    const { rows } = await this.pg.query<Item>(
      `${ItemsRepository.SELECT} WHERE i.id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  /** Récupère un item par (source, external_id). */
  async getBySourceExternal(sourceSlug: string, externalId: string): Promise<Item | null> {
    const { rows } = await this.pg.query<Item>(
      `${ItemsRepository.SELECT} WHERE s.slug = $1 AND i.external_id = $2`,
      [sourceSlug, externalId]
    );
    return rows[0] ?? null;
  }

  /** Liste les items d'une source donnée (slug). */
  async listBySource(sourceSlug: string, limit = 100): Promise<Item[]> {
    const { rows } = await this.pg.query<Item>(
      `${ItemsRepository.SELECT} WHERE s.slug = $1 ORDER BY i.created_at DESC LIMIT $2`,
      [sourceSlug, limit]
    );
    return rows;
  }
}
