/**
 * Migration 3 — Taxonomie centrée TECHNOLOGIE (étape 3 du pivot, modèle ajusté).
 *
 * L'unité comparable dans les classements est une TECHNOLOGIE (React Native,
 * MongoDB, LLaMA…), pas un item mono-source : une techno s'étale sur plusieurs
 * sources (repo GitHub + package npm + modèle HF + tag Stack Overflow).
 *
 *   - `technologies`            : l'unité comparable (slug, name, primary_language?, description?).
 *   - `items.technology_id`     : chaque item source-spécifique se rattache à UNE techno (nullable).
 *                                 Les items déjà backfillés à l'étape 2 (repos ajoutés par
 *                                 l'utilisateur, external_id = github_id numérique) restent NULL.
 *   - `categories`              : axe "domaine Y" (mobile/database/ai-model/embedded/web).
 *   - `technology_categories`   : M:N entre technologies et categories (et NON item_categories).
 *
 * Seed : technologies des 5 domaines + leurs liens catégories + les items
 * source-spécifiques (en créant les items manquants pour github/npm/pypi/
 * huggingface/stackoverflow avec le bon external_id par source), chacun rattaché
 * à sa technologie.
 *
 * NB convention external_id GitHub : les items SEEDÉS utilisent `owner/repo`
 * (stable, lisible), distinct du github_id numérique des items backfillés à
 * l'étape 2 — pas de collision. La réconciliation se fera au refactor connecteur.
 *
 * Additif et réversible : voir exports.down.
 */

/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1) CATEGORIES (axe "domaine") -------------------------------------------
    CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        parent_id INT REFERENCES categories(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- 2) TECHNOLOGIES (unité comparable) --------------------------------------
    CREATE TABLE IF NOT EXISTS technologies (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        primary_language TEXT,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    DROP TRIGGER IF EXISTS set_timestamp_technologies ON technologies;
    CREATE TRIGGER set_timestamp_technologies
        BEFORE UPDATE ON technologies
        FOR EACH ROW
        EXECUTE FUNCTION trigger_set_timestamp();

    -- 3) ITEMS.technology_id (nullable) ---------------------------------------
    ALTER TABLE items
        ADD COLUMN IF NOT EXISTS technology_id INT REFERENCES technologies(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_items_technology ON items(technology_id);

    -- 4) TECHNOLOGY_CATEGORIES (M:N) ------------------------------------------
    CREATE TABLE IF NOT EXISTS technology_categories (
        technology_id INT NOT NULL REFERENCES technologies(id) ON DELETE CASCADE,
        category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (technology_id, category_id)
    );

    -- ========================= SEED =========================
    -- Catégories
    INSERT INTO categories (slug, name, domain) VALUES
        ('mobile',         'Mobile',             'mobile'),
        ('database-nosql', 'NoSQL Database',     'database'),
        ('ai-model',       'AI Model',           'ai-model'),
        ('embedded',       'Embedded / Arduino', 'embedded'),
        ('web',            'Web Framework',      'web')
    ON CONFLICT (slug) DO NOTHING;

    -- Technologies
    INSERT INTO technologies (slug, name, primary_language, description) VALUES
        ('react-native',         'React Native',         'JavaScript', 'Cross-platform mobile framework'),
        ('flutter',              'Flutter',              'Dart',       'UI toolkit for mobile/web/desktop'),
        ('ionic',                'Ionic',                'TypeScript', 'Hybrid mobile framework'),
        ('nativescript',         'NativeScript',         'TypeScript', 'Native mobile apps with JS/TS'),
        ('kotlin-multiplatform', 'Kotlin Multiplatform', 'Kotlin',     'Shared code across platforms'),
        ('mongodb',              'MongoDB',              'C++',        'Document-oriented NoSQL database'),
        ('cassandra',            'Apache Cassandra',     'Java',       'Wide-column NoSQL database'),
        ('redis',                'Redis',                'C',          'In-memory key-value store'),
        ('couchdb',              'Apache CouchDB',       'Erlang',     'Document NoSQL database'),
        ('neo4j',                'Neo4j',                'Java',       'Graph database'),
        ('llama',                'LLaMA',                NULL,         'Meta large language models'),
        ('mistral',              'Mistral',              NULL,         'Mistral AI open models'),
        ('qwen',                 'Qwen',                 NULL,         'Alibaba Qwen models'),
        ('gemma',                'Gemma',                NULL,         'Google Gemma models'),
        ('gpt2',                 'GPT-2',                NULL,         'OpenAI GPT-2 model'),
        ('arduino',              'Arduino',              'C++',        'Open-source electronics platform'),
        ('platformio',           'PlatformIO',           'Python',     'Embedded development ecosystem'),
        ('esp-idf',              'ESP-IDF',              'C',          'Espressif IoT Development Framework'),
        ('react',                'React',                'JavaScript', 'UI library'),
        ('vue',                  'Vue.js',               'TypeScript', 'Progressive web framework'),
        ('svelte',               'Svelte',               'TypeScript', 'Compiler-based web framework'),
        ('angular',              'Angular',              'TypeScript', 'Web application framework'),
        ('solid',                'SolidJS',              'TypeScript', 'Reactive web framework')
    ON CONFLICT (slug) DO NOTHING;

    -- Liens technologie -> catégorie
    INSERT INTO technology_categories (technology_id, category_id)
    SELECT t.id, c.id
    FROM (VALUES
        ('react-native','mobile'),
        ('flutter','mobile'),
        ('ionic','mobile'),
        ('nativescript','mobile'),
        ('kotlin-multiplatform','mobile'),
        ('mongodb','database-nosql'),
        ('cassandra','database-nosql'),
        ('redis','database-nosql'),
        ('couchdb','database-nosql'),
        ('neo4j','database-nosql'),
        ('llama','ai-model'),
        ('mistral','ai-model'),
        ('qwen','ai-model'),
        ('gemma','ai-model'),
        ('gpt2','ai-model'),
        ('arduino','embedded'),
        ('platformio','embedded'),
        ('esp-idf','embedded'),
        ('react','web'),
        ('vue','web'),
        ('svelte','web'),
        ('angular','web'),
        ('solid','web')
    ) AS m(tech_slug, cat_slug)
    JOIN technologies t ON t.slug = m.tech_slug
    JOIN categories c   ON c.slug = m.cat_slug
    ON CONFLICT DO NOTHING;

    -- Items source-spécifiques (création des manquants) + rattachement techno
    INSERT INTO items (source_id, external_id, name, full_name, url, language, technology_id)
    SELECT s.id, v.external_id, v.name, v.full_name, v.url, v.language, t.id
    FROM (VALUES
        -- Mobile
        ('github',       'facebook/react-native',       'react-native',     'facebook/react-native',       'https://github.com/facebook/react-native',            'JavaScript', 'react-native'),
        ('npm',          'react-native',                'react-native',     'react-native',                'https://www.npmjs.com/package/react-native',          'JavaScript', 'react-native'),
        ('stackoverflow','react-native',                'react-native',     'react-native',                'https://stackoverflow.com/questions/tagged/react-native', NULL,     'react-native'),
        ('github',       'flutter/flutter',             'flutter',          'flutter/flutter',             'https://github.com/flutter/flutter',                  'Dart',       'flutter'),
        ('stackoverflow','flutter',                     'flutter',          'flutter',                     'https://stackoverflow.com/questions/tagged/flutter',  NULL,         'flutter'),
        ('github',       'ionic-team/ionic-framework',  'ionic-framework',  'ionic-team/ionic-framework',  'https://github.com/ionic-team/ionic-framework',       'TypeScript', 'ionic'),
        ('npm',          '@ionic/core',                 '@ionic/core',      '@ionic/core',                 'https://www.npmjs.com/package/@ionic/core',           'TypeScript', 'ionic'),
        ('github',       'NativeScript/NativeScript',   'NativeScript',     'NativeScript/NativeScript',   'https://github.com/NativeScript/NativeScript',        'TypeScript', 'nativescript'),
        ('npm',          'nativescript',                'nativescript',     'nativescript',                'https://www.npmjs.com/package/nativescript',          'TypeScript', 'nativescript'),
        ('github',       'JetBrains/kotlin',            'kotlin',           'JetBrains/kotlin',            'https://github.com/JetBrains/kotlin',                 'Kotlin',     'kotlin-multiplatform'),
        -- NoSQL
        ('github',       'mongodb/mongo',               'mongo',            'mongodb/mongo',               'https://github.com/mongodb/mongo',                    'C++',        'mongodb'),
        ('npm',          'mongodb',                     'mongodb',          'mongodb',                     'https://www.npmjs.com/package/mongodb',               'JavaScript', 'mongodb'),
        ('pypi',         'pymongo',                     'pymongo',          'pymongo',                     'https://pypi.org/project/pymongo',                    'Python',     'mongodb'),
        ('stackoverflow','mongodb',                     'mongodb',          'mongodb',                     'https://stackoverflow.com/questions/tagged/mongodb',  NULL,         'mongodb'),
        ('github',       'apache/cassandra',            'cassandra',        'apache/cassandra',            'https://github.com/apache/cassandra',                 'Java',       'cassandra'),
        ('github',       'redis/redis',                 'redis',            'redis/redis',                 'https://github.com/redis/redis',                      'C',          'redis'),
        ('npm',          'redis',                       'redis',            'redis',                       'https://www.npmjs.com/package/redis',                 'JavaScript', 'redis'),
        ('pypi',         'redis',                       'redis',            'redis',                       'https://pypi.org/project/redis',                      'Python',     'redis'),
        ('github',       'apache/couchdb',              'couchdb',          'apache/couchdb',              'https://github.com/apache/couchdb',                   'Erlang',     'couchdb'),
        ('github',       'neo4j/neo4j',                 'neo4j',            'neo4j/neo4j',                 'https://github.com/neo4j/neo4j',                      'Java',       'neo4j'),
        -- AI models (Hugging Face)
        ('huggingface',  'meta-llama/Meta-Llama-3-8B',  'Meta-Llama-3-8B',  'meta-llama/Meta-Llama-3-8B',  'https://huggingface.co/meta-llama/Meta-Llama-3-8B',   NULL,         'llama'),
        ('huggingface',  'mistralai/Mistral-7B-v0.1',   'Mistral-7B-v0.1',  'mistralai/Mistral-7B-v0.1',   'https://huggingface.co/mistralai/Mistral-7B-v0.1',    NULL,         'mistral'),
        ('huggingface',  'Qwen/Qwen2-7B',               'Qwen2-7B',         'Qwen/Qwen2-7B',               'https://huggingface.co/Qwen/Qwen2-7B',                NULL,         'qwen'),
        ('huggingface',  'google/gemma-7b',             'gemma-7b',         'google/gemma-7b',             'https://huggingface.co/google/gemma-7b',              NULL,         'gemma'),
        ('huggingface',  'openai-community/gpt2',        'gpt2',             'openai-community/gpt2',       'https://huggingface.co/openai-community/gpt2',        NULL,         'gpt2'),
        -- Embedded / Arduino
        ('github',       'arduino/Arduino',             'Arduino',          'arduino/Arduino',             'https://github.com/arduino/Arduino',                  'C++',        'arduino'),
        ('github',       'platformio/platformio-core',  'platformio-core',  'platformio/platformio-core',  'https://github.com/platformio/platformio-core',       'Python',     'platformio'),
        ('pypi',         'platformio',                  'platformio',       'platformio',                  'https://pypi.org/project/platformio',                 'Python',     'platformio'),
        ('github',       'espressif/esp-idf',           'esp-idf',          'espressif/esp-idf',           'https://github.com/espressif/esp-idf',                'C',          'esp-idf'),
        -- Web
        ('github',       'facebook/react',              'react',            'facebook/react',              'https://github.com/facebook/react',                   'JavaScript', 'react'),
        ('npm',          'react',                       'react',            'react',                       'https://www.npmjs.com/package/react',                 'JavaScript', 'react'),
        ('stackoverflow','reactjs',                     'reactjs',          'reactjs',                     'https://stackoverflow.com/questions/tagged/reactjs',  NULL,         'react'),
        ('github',       'vuejs/core',                  'vue-core',         'vuejs/core',                  'https://github.com/vuejs/core',                       'TypeScript', 'vue'),
        ('npm',          'vue',                         'vue',              'vue',                         'https://www.npmjs.com/package/vue',                   'TypeScript', 'vue'),
        ('github',       'sveltejs/svelte',             'svelte',           'sveltejs/svelte',             'https://github.com/sveltejs/svelte',                  'TypeScript', 'svelte'),
        ('npm',          'svelte',                      'svelte',           'svelte',                      'https://www.npmjs.com/package/svelte',                'TypeScript', 'svelte'),
        ('github',       'angular/angular',             'angular',          'angular/angular',             'https://github.com/angular/angular',                  'TypeScript', 'angular'),
        ('npm',          '@angular/core',               '@angular/core',    '@angular/core',               'https://www.npmjs.com/package/@angular/core',         'TypeScript', 'angular'),
        ('github',       'solidjs/solid',               'solid',            'solidjs/solid',               'https://github.com/solidjs/solid',                    'TypeScript', 'solid'),
        ('npm',          'solid-js',                    'solid-js',         'solid-js',                    'https://www.npmjs.com/package/solid-js',              'TypeScript', 'solid')
    ) AS v(source_slug, external_id, name, full_name, url, language, tech_slug)
    JOIN sources s      ON s.slug = v.source_slug
    JOIN technologies t ON t.slug = v.tech_slug
    ON CONFLICT (source_id, external_id) DO UPDATE
        SET technology_id = EXCLUDED.technology_id;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Réverse le seed : retire les items rattachés à une technologie.
    DELETE FROM items WHERE technology_id IS NOT NULL;
    DROP INDEX IF EXISTS idx_items_technology;
    ALTER TABLE items DROP COLUMN IF EXISTS technology_id;
    DROP TABLE IF EXISTS technology_categories;
    DROP TRIGGER IF EXISTS set_timestamp_technologies ON technologies;
    DROP TABLE IF EXISTS technologies;
    DROP TABLE IF EXISTS categories;
  `);
};
