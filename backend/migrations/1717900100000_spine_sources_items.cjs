/**
 * Migration 2 — Spine générique : `sources` + `items` (étape 2 du pivot).
 *
 * Pattern STRANGLER : on ajoute le spine multi-sources À CÔTÉ de l'existant.
 *   - `sources`        : référentiel des 5 sources (github, huggingface, npm, pypi, stackoverflow).
 *   - `items`          : entité générique, colonne vertébrale du modèle multi-sources.
 *   - `projects.item_id`           : rattache chaque projet GitHub à son item (backfill).
 *   - `metrics_snapshots.item_id`  : rattache les métriques à l'item (backfill depuis project_id).
 *
 * On NE supprime RIEN : `projects` reste la table des détails spécifiques GitHub,
 * `project_id` reste sur `metrics_snapshots`. Les endpoints actuels continuent de
 * passer par le chemin GitHub. La bascule se fera aux étapes suivantes.
 *
 * Réversible : voir exports.down.
 *
 * NB TimescaleDB : le backfill de `metrics_snapshots.item_id` est un UPDATE sur
 * l'hypertable. Sur une base de dev (données < 7 jours), aucun chunk n'est encore
 * compressé, l'UPDATE passe sans souci. Sur une base avec chunks compressés, il
 * faudrait décompresser au préalable (hors périmètre dev).
 */

/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1) SOURCES (référentiel) ------------------------------------------------
    CREATE TABLE IF NOT EXISTS sources (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        base_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );

    INSERT INTO sources (slug, label, base_url) VALUES
        ('github',        'GitHub',         'https://github.com'),
        ('huggingface',   'Hugging Face',   'https://huggingface.co'),
        ('npm',           'npm',            'https://www.npmjs.com'),
        ('pypi',          'PyPI',           'https://pypi.org'),
        ('stackoverflow', 'Stack Overflow', 'https://stackoverflow.com')
    ON CONFLICT (slug) DO NOTHING;

    -- 2) ITEMS (spine générique) ----------------------------------------------
    CREATE TABLE IF NOT EXISTS items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        source_id INT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        name TEXT NOT NULL,
        full_name TEXT,
        url TEXT,
        language TEXT,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (source_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_id);
    CREATE INDEX IF NOT EXISTS idx_items_full_name ON items(full_name);

    -- réutilise la fonction trigger updated_at posée à la baseline
    DROP TRIGGER IF EXISTS set_timestamp_items ON items;
    CREATE TRIGGER set_timestamp_items
        BEFORE UPDATE ON items
        FOR EACH ROW
        EXECUTE FUNCTION trigger_set_timestamp();

    -- 3) PROJECTS.item_id + backfill ------------------------------------------
    ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES items(id) ON DELETE SET NULL;

    -- crée un item GitHub pour chaque projet existant (idempotent)
    INSERT INTO items (source_id, external_id, name, full_name, url, language, description, created_at, updated_at)
    SELECT s.id,
           p.github_id::text,
           p.repo,
           p.full_name,
           'https://github.com/' || p.full_name,
           p.language,
           p.description,
           p.created_at,
           p.updated_at
    FROM projects p
    CROSS JOIN sources s
    WHERE s.slug = 'github'
    ON CONFLICT (source_id, external_id) DO NOTHING;

    -- relie projects -> items
    UPDATE projects p
    SET item_id = i.id
    FROM items i
    JOIN sources s ON s.id = i.source_id AND s.slug = 'github'
    WHERE i.external_id = p.github_id::text
      AND p.item_id IS DISTINCT FROM i.id;

    -- 4) METRICS_SNAPSHOTS.item_id + backfill ---------------------------------
    -- TimescaleDB interdit ADD COLUMN avec contrainte (FK) sur une hypertable
    -- dont la compression (columnstore) est activée. On désactive temporairement
    -- la compression (retrait policy + décompression de tous les chunks), on
    -- ajoute la colonne + backfill, puis on rétablit la compression À L'IDENTIQUE
    -- de la baseline (segmentby='project_id', orderby='time DESC', policy 7 jours).

    -- 4.a) retirer la policy de compression (si TimescaleDB present)
    DO $ts$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        PERFORM remove_compression_policy('metrics_snapshots', if_exists => TRUE);
      END IF;
    END $ts$;

    -- 4.b) décompresser tous les chunks compressés
    DO $$
    DECLARE r RECORD;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN RETURN; END IF;
      FOR r IN SELECT format('%I.%I', chunk_schema, chunk_name) AS qn
               FROM timescaledb_information.chunks
               WHERE hypertable_name = 'metrics_snapshots' AND is_compressed
      LOOP
        EXECUTE format('SELECT decompress_chunk(%L::regclass)', r.qn);
      END LOOP;
    END $$;

    -- 4.c) desactiver la compression (columnstore) si TimescaleDB present
    DO $ts$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        EXECUTE 'ALTER TABLE metrics_snapshots SET (timescaledb.compress = false)';
      END IF;
    END $ts$;

    -- 4.d) ajouter la colonne FK
    ALTER TABLE metrics_snapshots
        ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES items(id) ON DELETE CASCADE;

    -- 4.e) backfill (inchangé)
    UPDATE metrics_snapshots m
    SET item_id = p.item_id
    FROM projects p
    WHERE m.project_id = p.id
      AND m.item_id IS DISTINCT FROM p.item_id;

    -- 4.f + 4.g) réactiver compression + policy à l'identique (si TimescaleDB)
    DO $ts$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        EXECUTE 'ALTER TABLE metrics_snapshots SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = ''project_id'',
            timescaledb.compress_orderby = ''time DESC''
        )';
        PERFORM add_compression_policy('metrics_snapshots', INTERVAL '7 days', if_not_exists => TRUE);
      END IF;
    END $ts$;

    -- 4.h) index
    CREATE INDEX IF NOT EXISTS idx_metrics_item_time
        ON metrics_snapshots(item_id, time DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- metrics_snapshots : même séquence (décompresser, désactiver la compression,
    -- DROP COLUMN, réactiver la compression à l'identique, re-policy).
    DO $ts$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        PERFORM remove_compression_policy('metrics_snapshots', if_exists => TRUE);
      END IF;
    END $ts$;

    DO $$
    DECLARE r RECORD;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN RETURN; END IF;
      FOR r IN SELECT format('%I.%I', chunk_schema, chunk_name) AS qn
               FROM timescaledb_information.chunks
               WHERE hypertable_name = 'metrics_snapshots' AND is_compressed
      LOOP
        EXECUTE format('SELECT decompress_chunk(%L::regclass)', r.qn);
      END LOOP;
    END $$;

    DO $ts$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        EXECUTE 'ALTER TABLE metrics_snapshots SET (timescaledb.compress = false)';
      END IF;
    END $ts$;

    DROP INDEX IF EXISTS idx_metrics_item_time;
    ALTER TABLE metrics_snapshots DROP COLUMN IF EXISTS item_id;

    DO $ts$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        EXECUTE 'ALTER TABLE metrics_snapshots SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = ''project_id'',
            timescaledb.compress_orderby = ''time DESC''
        )';
        PERFORM add_compression_policy('metrics_snapshots', INTERVAL '7 days', if_not_exists => TRUE);
      END IF;
    END $ts$;

    -- reste inchangé
    ALTER TABLE projects DROP COLUMN IF EXISTS item_id;
    DROP TRIGGER IF EXISTS set_timestamp_items ON items;
    DROP TABLE IF EXISTS items;
    DROP TABLE IF EXISTS sources;
  `);
};
