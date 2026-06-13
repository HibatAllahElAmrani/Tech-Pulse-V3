/**
 * Migration 4 — Trigger de synchronisation metrics_snapshots.item_id (étape 2bis).
 *
 * TROU STRANGLER : la migration de l'étape 2 a backfillé `item_id`, mais le
 * `metricsWorker` insère toujours sans `item_id` → de nouvelles lignes NULL
 * réapparaissent après chaque cycle de collecte.
 *
 * Tant que les connecteurs n'écrivent pas `item_id` directement, on dérive
 * `item_id` depuis `project_id` via un trigger BEFORE INSERT (supporté
 * nativement sur une hypertable TimescaleDB — pas besoin de toucher à la
 * compression ici).
 *
 * ⚠️ TEMPORAIRE : trigger de transition pour la période strangler. À SUPPRIMER
 * à l'étape 4, quand les connecteurs écriront `item_id` directement.
 *
 * Réversible : voir exports.down (DROP TRIGGER + DROP FUNCTION).
 */

/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1) Fonction : dérive item_id depuis project_id si absent
    CREATE OR REPLACE FUNCTION sync_metrics_item_id_from_project()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.item_id IS NULL AND NEW.project_id IS NOT NULL THEN
        SELECT p.item_id INTO NEW.item_id
        FROM projects p
        WHERE p.id = NEW.project_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- 2) Trigger BEFORE INSERT sur l'hypertable
    DROP TRIGGER IF EXISTS sync_item_id_before_insert ON metrics_snapshots;
    CREATE TRIGGER sync_item_id_before_insert
        BEFORE INSERT ON metrics_snapshots
        FOR EACH ROW
        EXECUTE FUNCTION sync_metrics_item_id_from_project();

    -- 3) Backfill des NULL restants apparus depuis l'étape 2
    UPDATE metrics_snapshots m
    SET item_id = p.item_id
    FROM projects p
    WHERE m.project_id = p.id
      AND m.item_id IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS sync_item_id_before_insert ON metrics_snapshots;
    DROP FUNCTION IF EXISTS sync_metrics_item_id_from_project();
  `);
};
