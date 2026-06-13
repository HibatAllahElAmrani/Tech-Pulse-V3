/**
 * Migration 7 — Technologies ajoutées par l'utilisateur.
 *
 *   1. `technologies.is_custom` : distingue les technos ajoutées via la barre
 *      de recherche (supprimables) des 15 seedées (protégées).
 *   2. Catégorie fourre-tout `other` : accueille les repos qui ne matchent
 *      aucune des 5 catégories d'origine.
 *
 * Additif et réversible.
 */

/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE technologies
        ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE;

    INSERT INTO categories (slug, name, domain, blurb, color, icon, position)
    VALUES ('other', 'Other & Tools', 'other',
            'Libraries, CLIs and everything added from the search bar',
            '#94A3B8', 'Wrench', 6)
    ON CONFLICT (slug) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM technologies WHERE is_custom = TRUE;
    ALTER TABLE technologies DROP COLUMN IF EXISTS is_custom;
    DELETE FROM categories WHERE slug = 'other';
  `);
};
