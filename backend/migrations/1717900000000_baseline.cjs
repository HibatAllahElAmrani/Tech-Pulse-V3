/**
 * Migration BASELINE (migration 0) — étape 1 du pivot.
 *
 * Reproduit À L'IDENTIQUE le schéma historique de backend/src/db/init.sql,
 * désormais GELÉ. Toutes les instructions sont idempotentes (IF NOT EXISTS /
 * if_not_exists => TRUE), donc cette migration s'applique sans erreur :
 *   - sur une base NEUVE (création complète),
 *   - sur une base EXISTANTE déjà initialisée par l'ancien init.sql (no-op).
 *
 * À partir d'ici, toute évolution de schéma passe par une NOUVELLE migration
 * versionnée — ne plus éditer init.sql.
 */

/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Extensions
    -- TimescaleDB est optionnelle : activee si disponible (image timescale/timescaledb),
    -- sinon la table reste une table PostgreSQL classique (dev/CI sans extension).
    DO $ts$ BEGIN
      CREATE EXTENSION IF NOT EXISTS timescaledb;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'TimescaleDB indisponible - metrics_snapshots restera une table standard';
    END $ts$;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    -- USERS
    CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        github_id BIGINT UNIQUE NOT NULL,
        github_login TEXT UNIQUE NOT NULL,
        email TEXT,
        avatar_url TEXT,
        access_token_enc TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_users_github_login ON users(github_login);

    -- PROJECTS
    CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        github_id BIGINT UNIQUE NOT NULL,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        full_name TEXT GENERATED ALWAYS AS (owner || '/' || repo) STORED,
        description TEXT,
        language TEXT,
        homepage TEXT,
        is_archived BOOLEAN DEFAULT FALSE,
        is_fork BOOLEAN DEFAULT FALSE,
        project_created_at TIMESTAMPTZ,
        last_pushed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(owner, repo)
    );
    CREATE INDEX IF NOT EXISTS idx_projects_full_name ON projects(full_name);
    CREATE INDEX IF NOT EXISTS idx_projects_language ON projects(language);

    -- USER-PROJECT WATCHLIST
    CREATE TABLE IF NOT EXISTS user_projects (
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        added_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, project_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_projects_user ON user_projects(user_id);

    -- METRICS SNAPSHOTS (hypertable)
    CREATE TABLE IF NOT EXISTS metrics_snapshots (
        time TIMESTAMPTZ NOT NULL,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        stars INT NOT NULL DEFAULT 0,
        forks INT NOT NULL DEFAULT 0,
        watchers INT NOT NULL DEFAULT 0,
        open_issues INT NOT NULL DEFAULT 0,
        open_prs INT NOT NULL DEFAULT 0,
        contributors_30d INT NOT NULL DEFAULT 0,
        commits_30d INT NOT NULL DEFAULT 0,
        PRIMARY KEY (project_id, time)
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_project_time
        ON metrics_snapshots(project_id, time DESC);
    DO $ts$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        PERFORM create_hypertable('metrics_snapshots', 'time',
            chunk_time_interval => INTERVAL '1 day',
            if_not_exists => TRUE);
        PERFORM add_retention_policy('metrics_snapshots', INTERVAL '90 days', if_not_exists => TRUE);
        EXECUTE 'ALTER TABLE metrics_snapshots SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = ''project_id'',
            timescaledb.compress_orderby = ''time DESC''
        )';
        PERFORM add_compression_policy('metrics_snapshots', INTERVAL '7 days', if_not_exists => TRUE);
      END IF;
    END $ts$;

    -- COMMITS DAILY
    CREATE TABLE IF NOT EXISTS commits_daily (
        day DATE NOT NULL,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        commit_count INT NOT NULL DEFAULT 0,
        unique_authors INT NOT NULL DEFAULT 0,
        PRIMARY KEY (project_id, day)
    );
    CREATE INDEX IF NOT EXISTS idx_commits_daily_project ON commits_daily(project_id, day DESC);

    -- CONTRIBUTORS
    CREATE TABLE IF NOT EXISTS contributors (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        login TEXT NOT NULL,
        github_id BIGINT,
        avatar_url TEXT,
        contributions INT NOT NULL DEFAULT 0,
        last_contribution_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(project_id, login)
    );
    CREATE INDEX IF NOT EXISTS idx_contributors_project ON contributors(project_id);
    CREATE INDEX IF NOT EXISTS idx_contributors_top
        ON contributors(project_id, contributions DESC);

    -- PREDICTIONS
    CREATE TABLE IF NOT EXISTS predictions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        horizon_days INT NOT NULL,
        predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        target_date DATE NOT NULL,
        yhat NUMERIC NOT NULL,
        yhat_lower NUMERIC NOT NULL,
        yhat_upper NUMERIC NOT NULL,
        model_name TEXT NOT NULL DEFAULT 'prophet',
        mape NUMERIC
    );
    CREATE INDEX IF NOT EXISTS idx_predictions_project
        ON predictions(project_id, predicted_at DESC);

    -- ALERTS
    CREATE TABLE IF NOT EXISTS alerts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        metric TEXT NOT NULL,
        operator TEXT NOT NULL,
        threshold NUMERIC NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        notification_channels JSONB DEFAULT '["in_app"]',
        last_triggered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(is_active) WHERE is_active = TRUE;

    -- TRIGGER: auto-update updated_at
    CREATE OR REPLACE FUNCTION trigger_set_timestamp()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS set_timestamp_users ON users;
    CREATE TRIGGER set_timestamp_users
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION trigger_set_timestamp();

    DROP TRIGGER IF EXISTS set_timestamp_projects ON projects;
    CREATE TRIGGER set_timestamp_projects
        BEFORE UPDATE ON projects
        FOR EACH ROW
        EXECUTE FUNCTION trigger_set_timestamp();
  `);
};

exports.down = (pgm) => {
  // Baseline rollback : best-effort, ordre inverse des dépendances FK.
  pgm.sql(`
    DROP TRIGGER IF EXISTS set_timestamp_projects ON projects;
    DROP TRIGGER IF EXISTS set_timestamp_users ON users;
    DROP FUNCTION IF EXISTS trigger_set_timestamp();
    DROP TABLE IF EXISTS alerts;
    DROP TABLE IF EXISTS predictions;
    DROP TABLE IF EXISTS contributors;
    DROP TABLE IF EXISTS commits_daily;
    DROP TABLE IF EXISTS metrics_snapshots;
    DROP TABLE IF EXISTS user_projects;
    DROP TABLE IF EXISTS projects;
    DROP TABLE IF EXISTS users;
  `);
};
