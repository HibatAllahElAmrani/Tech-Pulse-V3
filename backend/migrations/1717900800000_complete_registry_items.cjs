/**
 * Migration 9 — Complète le mapping items ↔ technologies classées pour la
 * couverture des connecteurs réels.
 *
 *   - Re-rattache les modèles Hugging Face seedés sous les anciens slugs non
 *     classés (llama → llama-3, mistral → mistral-7b).
 *   - Ajoute les items manquants des sources déclarées par technologie
 *     (npm/pypi/stackoverflow/huggingface) pour que chaque connecteur ait sa
 *     cible réelle.
 *
 * Additif et réversible.
 */

/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Re-rattachement des items HF seedés sous les anciens slugs
    UPDATE items SET technology_id = (SELECT id FROM technologies WHERE slug = 'llama-3')
     WHERE external_id = 'meta-llama/Meta-Llama-3-8B';
    UPDATE items SET technology_id = (SELECT id FROM technologies WHERE slug = 'mistral-7b')
     WHERE external_id = 'mistralai/Mistral-7B-v0.1';

    -- Items manquants des sources déclarées
    INSERT INTO items (source_id, external_id, name, full_name, url, technology_id)
    SELECT s.id, v.external_id, v.external_id, v.external_id, v.url, t.id
    FROM (VALUES
        ('npm',          'pg',                      'https://www.npmjs.com/package/pg',                       'postgresql'),
        ('pypi',         'psycopg2',                'https://pypi.org/project/psycopg2',                      'postgresql'),
        ('stackoverflow','postgresql',              'https://stackoverflow.com/questions/tagged/postgresql',  'postgresql'),
        ('stackoverflow','redis',                   'https://stackoverflow.com/questions/tagged/redis',       'redis'),
        ('pypi',         'cassandra-driver',        'https://pypi.org/project/cassandra-driver',              'cassandra'),
        ('stackoverflow','cassandra',               'https://stackoverflow.com/questions/tagged/cassandra',   'cassandra'),
        ('stackoverflow','kotlin-multiplatform',    'https://stackoverflow.com/questions/tagged/kotlin-multiplatform', 'kotlin-multiplatform'),
        ('stackoverflow','llama',                   'https://stackoverflow.com/questions/tagged/llama',       'llama-3'),
        ('pypi',         'mistralai',               'https://pypi.org/project/mistralai',                     'mistral-7b'),
        ('huggingface',  'openai/whisper-large-v3', 'https://huggingface.co/openai/whisper-large-v3',         'whisper'),
        ('pypi',         'openai-whisper',          'https://pypi.org/project/openai-whisper',                'whisper'),
        ('stackoverflow','openai-whisper',          'https://stackoverflow.com/questions/tagged/openai-whisper', 'whisper'),
        ('stackoverflow','arduino',                 'https://stackoverflow.com/questions/tagged/arduino',     'arduino'),
        ('stackoverflow','esp32',                   'https://stackoverflow.com/questions/tagged/esp32',       'esp-idf'),
        ('stackoverflow','zephyr-rtos',             'https://stackoverflow.com/questions/tagged/zephyr-rtos', 'zephyr'),
        ('stackoverflow','svelte',                  'https://stackoverflow.com/questions/tagged/svelte',      'svelte')
    ) AS v(source_slug, external_id, url, tech_slug)
    JOIN sources s      ON s.slug = v.source_slug
    JOIN technologies t ON t.slug = v.tech_slug
    ON CONFLICT (source_id, external_id) DO UPDATE
        SET technology_id = EXCLUDED.technology_id;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM items
     WHERE (external_id, source_id) IN (
       SELECT v.eid, s.id FROM (VALUES
         ('pg','npm'), ('psycopg2','pypi'), ('postgresql','stackoverflow'),
         ('redis','stackoverflow'), ('cassandra-driver','pypi'), ('cassandra','stackoverflow'),
         ('kotlin-multiplatform','stackoverflow'), ('llama','stackoverflow'),
         ('mistralai','pypi'), ('openai/whisper-large-v3','huggingface'),
         ('openai-whisper','pypi'), ('openai-whisper','stackoverflow'),
         ('arduino','stackoverflow'), ('esp32','stackoverflow'),
         ('zephyr-rtos','stackoverflow'), ('svelte','stackoverflow')
       ) AS v(eid, src) JOIN sources s ON s.slug = v.src
     );
    UPDATE items SET technology_id = (SELECT id FROM technologies WHERE slug = 'llama')
     WHERE external_id = 'meta-llama/Meta-Llama-3-8B';
    UPDATE items SET technology_id = (SELECT id FROM technologies WHERE slug = 'mistral')
     WHERE external_id = 'mistralai/Mistral-7B-v0.1';
  `);
};
