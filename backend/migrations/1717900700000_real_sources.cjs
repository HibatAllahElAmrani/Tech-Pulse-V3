/**
 * Migration 8 — Passage au 100 % data-driven.
 *
 *   1. `source_monthly`     : séries mensuelles par item et par métrique
 *                             (downloads npm/pypi/hf, questions SO, answered_rate…).
 *                             Alimentée par les connecteurs réels, y compris le
 *                             backfill historique (npm fournit 12 mois réels).
 *   2. `contributor_geo`    : localisation déclarée des contributeurs GitHub,
 *                             résolue en pays — la seule source réelle de géo.
 *   3. `technology_monthly` : score composite mensuel matérialisé par le worker
 *                             (remplace le générateur scoreSeries).
 *   4. PURGE des valeurs seedées : sous-scores remis au neutre (50) et
 *      métriques à zéro. La collecte réelle les remplit dès le premier cycle —
 *      plus aucune valeur inventée n'est servie, même transitoirement.
 *
 * Réversible (les tables sont additives ; la purge ne l'est pas, par design).
 */

/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS source_monthly (
        month DATE NOT NULL,
        item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        metric TEXT NOT NULL,
        value NUMERIC NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (item_id, metric, month)
    );
    CREATE INDEX IF NOT EXISTS idx_source_monthly_item ON source_monthly(item_id, month DESC);

    CREATE TABLE IF NOT EXISTS contributor_geo (
        login TEXT PRIMARY KEY,
        location_raw TEXT,
        iso2 CHAR(2) REFERENCES countries(iso2),
        resolved BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_contributor_geo_iso ON contributor_geo(iso2) WHERE iso2 IS NOT NULL;

    CREATE TABLE IF NOT EXISTS technology_monthly (
        technology_id INT NOT NULL REFERENCES technologies(id) ON DELETE CASCADE,
        month DATE NOT NULL,
        score NUMERIC(5,1) NOT NULL,
        PRIMARY KEY (technology_id, month)
    );

    -- ── Purge des valeurs seedées ─────────────────────────────────────────
    UPDATE technology_subscores
       SET adoption = 50, activity = 50, growth = 50, community = 50,
           delta_adoption = 0, delta_activity = 0, delta_growth = 0, delta_community = 0,
           updated_at = NOW();

    UPDATE technology_metrics
       SET stars = 0, forks = 0, contributors = 0, commits_monthly = 0,
           downloads_monthly = 0, questions_monthly = 0, answered_rate = 0,
           releases_year = 0, hf_downloads = NULL, hf_likes = NULL,
           updated_at = NOW();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS technology_monthly;
    DROP TABLE IF EXISTS contributor_geo;
    DROP TABLE IF EXISTS source_monthly;
  `);
};
