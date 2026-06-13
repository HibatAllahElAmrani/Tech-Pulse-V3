/**
 * Migration 6 — Items GitHub manquants pour la collecte réelle.
 *
 * La migration 5 a ajouté 5 technologies classées (postgresql, llama-3,
 * mistral-7b, whisper, zephyr) sans leur item GitHub : le service
 * d'enregistrement (techProjects.ts) ne peut donc pas les suivre. On seed ici
 * leurs items source github (external_id = 'owner/repo'), comme la migration 3
 * l'a fait pour les autres.
 *
 * Additif et réversible.
 */

/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO items (source_id, external_id, name, full_name, url, language, technology_id)
    SELECT s.id, v.external_id, v.name, v.full_name, v.url, v.language, t.id
    FROM (VALUES
        ('github', 'postgres/postgres',        'postgres',          'postgres/postgres',        'https://github.com/postgres/postgres',        'C',      'postgresql'),
        ('github', 'meta-llama/llama3',        'llama3',            'meta-llama/llama3',        'https://github.com/meta-llama/llama3',        'Python', 'llama-3'),
        ('github', 'mistralai/mistral-inference', 'mistral-inference', 'mistralai/mistral-inference', 'https://github.com/mistralai/mistral-inference', 'Python', 'mistral-7b'),
        ('github', 'openai/whisper',           'whisper',           'openai/whisper',           'https://github.com/openai/whisper',           'Python', 'whisper'),
        ('github', 'zephyrproject-rtos/zephyr','zephyr',            'zephyrproject-rtos/zephyr','https://github.com/zephyrproject-rtos/zephyr','C',      'zephyr')
    ) AS v(source_slug, external_id, name, full_name, url, language, tech_slug)
    JOIN sources s      ON s.slug = v.source_slug
    JOIN technologies t ON t.slug = v.tech_slug
    ON CONFLICT (source_id, external_id) DO UPDATE
        SET technology_id = EXCLUDED.technology_id;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM items
     WHERE external_id IN (
       'postgres/postgres', 'meta-llama/llama3', 'mistralai/mistral-inference',
       'openai/whisper', 'zephyrproject-rtos/zephyr'
     )
       AND source_id = (SELECT id FROM sources WHERE slug = 'github');
  `);
};
