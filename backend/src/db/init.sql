-- ============================================================
-- OSS Pulse - Database Schema
-- PostgreSQL 16 + TimescaleDB 2.x
-- ============================================================
-- ⚠️  FICHIER GELÉ (baseline) — NE PLUS ÉDITER.
-- Depuis l'étape 1 du pivot, le schéma est géré par des migrations versionnées
-- (node-pg-migrate) dans backend/migrations/. La migration baseline
-- (1717900000000_baseline.cjs) reproduit ce schéma à l'identique.
-- Ce fichier est conservé à titre de référence historique ; il n'est plus monté
-- dans docker-entrypoint-initdb.d et n'est plus exécuté au démarrage.
-- Toute évolution de schéma = NOUVELLE migration.
-- ============================================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    github_id BIGINT UNIQUE NOT NULL,
    github_login TEXT UNIQUE NOT NULL,
    email TEXT,
    avatar_url TEXT,
    access_token_enc TEXT,  -- AES-256-GCM encrypted
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_github_login ON users(github_login);

-- ============================================================
-- PROJECTS TABLE
-- ============================================================
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

-- ============================================================
-- USER-PROJECT WATCHLIST (many-to-many)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_projects (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_user_projects_user ON user_projects(user_id);

-- ============================================================
-- METRICS SNAPSHOTS (TimescaleDB Hypertable)
-- ============================================================
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

-- Convert to hypertable (partitioned by time)
SELECT create_hypertable('metrics_snapshots', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_metrics_project_time
    ON metrics_snapshots(project_id, time DESC);

-- Retention policies
-- Raw data: 7 days
SELECT add_retention_policy('metrics_snapshots', INTERVAL '90 days', if_not_exists => TRUE);

-- Compression after 7 days (90-95% gain typical)
ALTER TABLE metrics_snapshots SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'project_id',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('metrics_snapshots', INTERVAL '7 days', if_not_exists => TRUE);

-- ============================================================
-- COMMITS DAILY (for heatmap calendar)
-- ============================================================
CREATE TABLE IF NOT EXISTS commits_daily (
    day DATE NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    commit_count INT NOT NULL DEFAULT 0,
    unique_authors INT NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, day)
);

CREATE INDEX IF NOT EXISTS idx_commits_daily_project ON commits_daily(project_id, day DESC);

-- ============================================================
-- CONTRIBUTORS TABLE
-- ============================================================
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

-- ============================================================
-- AI PREDICTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    horizon_days INT NOT NULL,         -- 7, 30, or 90
    predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    target_date DATE NOT NULL,
    yhat NUMERIC NOT NULL,             -- predicted value
    yhat_lower NUMERIC NOT NULL,       -- 90% CI lower
    yhat_upper NUMERIC NOT NULL,       -- 90% CI upper
    model_name TEXT NOT NULL DEFAULT 'prophet',
    mape NUMERIC                       -- evaluation metric
);

CREATE INDEX IF NOT EXISTS idx_predictions_project
    ON predictions(project_id, predicted_at DESC);

-- ============================================================
-- ALERTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,              -- e.g. 'stars', 'commits_30d'
    operator TEXT NOT NULL,            -- '>', '<', 'delta_pct'
    threshold NUMERIC NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    notification_channels JSONB DEFAULT '["in_app"]',
    last_triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(is_active) WHERE is_active = TRUE;

-- ============================================================
-- HELPER: Trigger auto-update updated_at
-- ============================================================
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
