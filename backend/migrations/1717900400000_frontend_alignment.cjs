/**
 * Migration 5 — Alignement FRONTEND (étape 4 du pivot).
 *
 * Le frontend OSS Pulse (React/Vite, /src/mocks) est la SOURCE DE VÉRITÉ du
 * contrat de données. Cette migration aligne la taxonomie sur lui :
 *
 *   1. `categories`  : slug 'database-nosql' → 'database', noms/blurbs/couleurs/
 *      icônes du frontend, colonne `position` pour l'ordre d'affichage.
 *   2. `technologies`: colonnes de présentation (tagline, color, license,
 *      first_release) + `is_ranked` / `rank_position`. Seed des 5 technos
 *      manquantes (postgresql, llama-3, mistral-7b, whisper, zephyr) et mise à
 *      jour des 10 existantes. Les technos hors périmètre frontend (ionic, vue,
 *      qwen…) restent en base mais `is_ranked = FALSE` → invisibles dans l'API.
 *   3. `technology_subscores` / `technology_metrics` / `technology_sources` :
 *      sous-scores (adoption/activity/growth/community + deltas 90j), métriques
 *      et couverture par source — valeurs EXACTES du frontend.
 *   4. `countries` : 24 pays (iso2, geo_name pour la choroplèthe, flag,
 *      centroïde, dev_weight, region) — ordre identique au frontend (PRNG).
 *   5. `sources` : métadonnées d'affichage (color, measures, unit, coverage,
 *      freshness).
 *   6. `case_stories` : les 4 récits guidés (steps en JSONB).
 *
 * Pattern strangler conservé : rien n'est supprimé, tout est additif (sauf le
 * rename de slug, corrigé car incompatible avec les routes du frontend).
 * Réversible : voir exports.down.
 */

/* eslint-disable camelcase */

exports.shorthands = undefined;

const esc = (s) => String(s).replace(/'/g, "''");
const escOrNull = (s) => (s === null || s === undefined ? 'NULL' : `'${esc(s)}'`);

// ───────────────────────────────────────────────────────────────────────────
// Données de seed — copie exacte de frontend/src/mocks (source de vérité).
// ───────────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { slug: 'mobile', name: 'Mobile frameworks', blurb: 'Cross-platform app frameworks and toolkits', color: '#22D3EE', icon: 'Smartphone', position: 1 },
  { slug: 'database', name: 'Databases', blurb: 'Relational, document, key-value and wide-column stores', color: '#34D399', icon: 'Database', position: 2 },
  { slug: 'ai-model', name: 'AI models', blurb: 'Open-weight foundation and speech models', color: '#FBBF24', icon: 'BrainCircuit', position: 3 },
  { slug: 'embedded', name: 'Embedded & IoT', blurb: 'Microcontroller platforms and RTOS ecosystems', color: '#FB7185', icon: 'Cpu', position: 4 },
  { slug: 'web', name: 'Web frameworks', blurb: 'Front-end frameworks and UI runtimes', color: '#7C5CFF', icon: 'Globe', position: 5 },
];

// Ordre = ordre du tableau TECHNOLOGIES du frontend (déterminisme du PRNG).
const TECHS = [
  {
    slug: 'flutter', name: 'Flutter', category: 'mobile', position: 1,
    tagline: "Google's UI toolkit for natively compiled apps",
    description: 'Flutter renders its own widgets with Skia/Impeller, shipping a single Dart codebase to iOS, Android, web and desktop. Its momentum is strongest in emerging markets, where one team often ships every platform.',
    color: '#22D3EE', language: 'Dart', license: 'BSD-3-Clause', firstRelease: 2017,
    sources: ['github', 'stackoverflow'],
    sub: [86, 90, 84, 88], deltas: [2.1, 0.8, 3.4, 1.2],
    metrics: { stars: 165000, forks: 27200, contributors: 1340, commits: 2150, downloads: 4800000, questions: 9100, answered: 0.71, releases: 14, hfDl: null, hfLikes: null },
  },
  {
    slug: 'react-native', name: 'React Native', category: 'mobile', position: 2,
    tagline: 'Build native apps with React',
    description: 'React Native maps React components to native platform views. With the New Architecture (Fabric + TurboModules) it remains the default choice for JavaScript teams extending into mobile.',
    color: '#61DAFB', language: 'TypeScript / C++', license: 'MIT', firstRelease: 2015,
    sources: ['github', 'npm', 'stackoverflow'],
    sub: [89, 84, 68, 85], deltas: [0.6, -0.4, -1.8, 0.3],
    metrics: { stars: 119000, forks: 24400, contributors: 2680, commits: 980, downloads: 11400000, questions: 7600, answered: 0.66, releases: 9, hfDl: null, hfLikes: null },
  },
  {
    slug: 'kotlin-multiplatform', name: 'Kotlin Multiplatform', category: 'mobile', position: 3,
    tagline: 'Share Kotlin code across mobile, web and server',
    description: 'KMP shares business logic in Kotlin while keeping fully native UI. Since JetBrains declared it stable, adoption has climbed fast among Android-first teams — the steepest growth curve in the category.',
    color: '#A97BFF', language: 'Kotlin', license: 'Apache-2.0', firstRelease: 2020,
    sources: ['github', 'stackoverflow'],
    sub: [52, 82, 91, 58], deltas: [4.8, 1.1, 5.2, 3.6],
    metrics: { stars: 49800, forks: 5700, contributors: 870, commits: 1620, downloads: 950000, questions: 1450, answered: 0.62, releases: 11, hfDl: null, hfLikes: null },
  },
  {
    slug: 'postgresql', name: 'PostgreSQL', category: 'database', position: 4,
    tagline: "The world's most advanced open-source relational database",
    description: "Thirty years of engineering, an extension ecosystem (pgvector, PostGIS, TimescaleDB) and rock-solid SQL semantics make PostgreSQL the default answer to 'which database?' in most surveys.",
    color: '#60A5FA', language: 'C', license: 'PostgreSQL', firstRelease: 1996,
    sources: ['github', 'npm', 'pypi', 'stackoverflow'],
    sub: [95, 86, 74, 90], deltas: [1.0, 0.2, 1.6, 0.5],
    metrics: { stars: 16500, forks: 4700, contributors: 720, commits: 810, downloads: 38000000, questions: 6200, answered: 0.78, releases: 5, hfDl: null, hfLikes: null },
  },
  {
    slug: 'mongodb', name: 'MongoDB', category: 'database', position: 5,
    tagline: 'The document database for modern applications',
    description: 'MongoDB pairs a flexible document model with horizontal sharding. It dominates NoSQL question volume on Stack Overflow and remains the most-downloaded document store on npm and PyPI.',
    color: '#34D399', language: 'C++', license: 'SSPL', firstRelease: 2009,
    sources: ['github', 'npm', 'pypi', 'stackoverflow'],
    sub: [88, 80, 62, 84], deltas: [-0.4, -0.6, -2.1, -0.2],
    metrics: { stars: 26800, forks: 5600, contributors: 540, commits: 690, downloads: 21500000, questions: 5400, answered: 0.69, releases: 7, hfDl: null, hfLikes: null },
  },
  {
    slug: 'redis', name: 'Redis', category: 'database', position: 6,
    tagline: 'In-memory data store, cache and message broker',
    description: 'Redis keeps entire datasets in memory with optional persistence. Caching, queues, pub/sub and now vector search — it is the most universally deployed piece of data infrastructure after SQL itself.',
    color: '#FB7185', language: 'C', license: 'RSALv2 / SSPL', firstRelease: 2009,
    sources: ['github', 'npm', 'pypi', 'stackoverflow'],
    sub: [90, 78, 66, 80], deltas: [0.3, -1.2, 0.4, -0.8],
    metrics: { stars: 67800, forks: 23900, contributors: 760, commits: 410, downloads: 29000000, questions: 2900, answered: 0.74, releases: 6, hfDl: null, hfLikes: null },
  },
  {
    slug: 'cassandra', name: 'Apache Cassandra', category: 'database', position: 7,
    tagline: 'Wide-column store built for global scale',
    description: 'Cassandra trades query flexibility for linear write scalability and multi-region replication. It anchors the heavy end of the NoSQL spectrum — fewer deployments, much larger ones.',
    color: '#A3E635', language: 'Java', license: 'Apache-2.0', firstRelease: 2008,
    sources: ['github', 'pypi', 'stackoverflow'],
    sub: [58, 64, 44, 60], deltas: [-1.1, 0.4, -0.9, -1.4],
    metrics: { stars: 9100, forks: 3700, contributors: 460, commits: 320, downloads: 3100000, questions: 760, answered: 0.71, releases: 4, hfDl: null, hfLikes: null },
  },
  {
    slug: 'llama-3', name: 'Llama 3', category: 'ai-model', position: 8,
    tagline: "Meta's open-weight foundation model family",
    description: "Llama 3's 8B and 70B checkpoints became the reference open weights overnight: the most downloaded, most fine-tuned and most benchmarked family on Hugging Face, with thousands of derivatives.",
    color: '#FBBF24', language: 'Python / PyTorch', license: 'Llama Community', firstRelease: 2024,
    sources: ['github', 'huggingface', 'pypi', 'stackoverflow'],
    sub: [84, 76, 93, 82], deltas: [5.6, 1.9, 4.1, 4.4],
    metrics: { stars: 27600, forks: 3900, contributors: 120, commits: 95, downloads: 8200000, questions: 1900, answered: 0.55, releases: 3, hfDl: 8200000, hfLikes: 31400 },
  },
  {
    slug: 'mistral-7b', name: 'Mistral 7B', category: 'ai-model', position: 9,
    tagline: 'Compact, Apache-licensed model punching above its size',
    description: 'Mistral 7B proved a small model with careful training can rival much larger ones. Its permissive Apache-2.0 license made it the default base for European startups and on-device experiments.',
    color: '#FB923C', language: 'Python / PyTorch', license: 'Apache-2.0', firstRelease: 2023,
    sources: ['github', 'huggingface', 'pypi'],
    sub: [72, 70, 86, 68], deltas: [3.2, 0.7, 2.8, 2.1],
    metrics: { stars: 9800, forks: 880, contributors: 45, commits: 40, downloads: 4100000, questions: 640, answered: 0.51, releases: 4, hfDl: 4100000, hfLikes: 12800 },
  },
  {
    slug: 'whisper', name: 'Whisper', category: 'ai-model', position: 10,
    tagline: "OpenAI's open-source speech recognition model",
    description: 'Whisper transcribes and translates speech in 90+ languages. Two years on, it is still the most embedded open model in production — from subtitling pipelines to voice interfaces on the edge.',
    color: '#F472B6', language: 'Python / PyTorch', license: 'MIT', firstRelease: 2022,
    sources: ['github', 'huggingface', 'pypi', 'stackoverflow'],
    sub: [80, 58, 64, 74], deltas: [1.4, -2.2, -0.6, 0.9],
    metrics: { stars: 71200, forks: 8500, contributors: 95, commits: 18, downloads: 5600000, questions: 1100, answered: 0.58, releases: 2, hfDl: 5600000, hfLikes: 9400 },
  },
  {
    slug: 'arduino', name: 'Arduino', category: 'embedded', position: 11,
    tagline: 'The open hardware platform that started a movement',
    description: "Arduino's IDE, core libraries and board ecosystem remain the universal on-ramp to embedded development. Question volume has cooled from its 2016 peak, but classroom and maker adoption is unmatched.",
    color: '#22D3EE', language: 'C++', license: 'LGPL-2.1', firstRelease: 2005,
    sources: ['github', 'stackoverflow'],
    sub: [82, 60, 48, 86], deltas: [-0.8, -1.0, -1.6, -0.5],
    metrics: { stars: 14400, forks: 7100, contributors: 410, commits: 130, downloads: 1900000, questions: 1700, answered: 0.64, releases: 6, hfDl: null, hfLikes: null },
  },
  {
    slug: 'esp-idf', name: 'ESP-IDF', category: 'embedded', position: 12,
    tagline: "Espressif's IoT development framework for ESP32",
    description: 'ESP-IDF pairs FreeRTOS with first-class Wi-Fi/BLE stacks for the wildly popular ESP32 family. It is where makers graduate to when Arduino sketches stop scaling — and where products ship.',
    color: '#FB7185', language: 'C', license: 'Apache-2.0', firstRelease: 2016,
    sources: ['github', 'pypi', 'stackoverflow'],
    sub: [66, 84, 78, 64], deltas: [2.6, 1.4, 2.2, 1.8],
    metrics: { stars: 14800, forks: 7800, contributors: 620, commits: 940, downloads: 1200000, questions: 540, answered: 0.59, releases: 12, hfDl: null, hfLikes: null },
  },
  {
    slug: 'zephyr', name: 'Zephyr RTOS', category: 'embedded', position: 13,
    tagline: "The Linux Foundation's scalable real-time OS",
    description: 'Zephyr brings Linux-style governance, device trees and CI rigor to microcontrollers. Industrial vendors are converging on it as the professional RTOS — the fastest-growing contributor base in embedded.',
    color: '#A78BFA', language: 'C', license: 'Apache-2.0', firstRelease: 2016,
    sources: ['github', 'pypi', 'stackoverflow'],
    sub: [48, 88, 82, 56], deltas: [3.4, 0.9, 3.0, 2.7],
    metrics: { stars: 11900, forks: 7300, contributors: 1850, commits: 1480, downloads: 380000, questions: 210, answered: 0.66, releases: 3, hfDl: null, hfLikes: null },
  },
  {
    slug: 'react', name: 'React', category: 'web', position: 14,
    tagline: 'The library for web and native user interfaces',
    description: "React's component model reshaped front-end development. Server Components and the compiler keep it evolving, and its npm download volume still dwarfs every alternative combined.",
    color: '#61DAFB', language: 'JavaScript', license: 'MIT', firstRelease: 2013,
    sources: ['github', 'npm', 'stackoverflow'],
    sub: [97, 82, 60, 92], deltas: [0.4, 0.6, -0.8, 0.1],
    metrics: { stars: 229000, forks: 46800, contributors: 1660, commits: 540, downloads: 112000000, questions: 11800, answered: 0.72, releases: 4, hfDl: null, hfLikes: null },
  },
  {
    slug: 'svelte', name: 'Svelte', category: 'web', position: 15,
    tagline: 'Cybernetically enhanced web apps, compiled away',
    description: "Svelte compiles components to minimal vanilla JS — no virtual DOM at runtime. Svelte 5's runes brought fine-grained reactivity, and it tops developer-satisfaction surveys year after year.",
    color: '#FB923C', language: 'TypeScript', license: 'MIT', firstRelease: 2016,
    sources: ['github', 'npm', 'stackoverflow'],
    sub: [62, 86, 80, 70], deltas: [2.2, 1.6, 1.9, 1.5],
    metrics: { stars: 79800, forks: 4300, contributors: 730, commits: 460, downloads: 7200000, questions: 980, answered: 0.68, releases: 18, hfDl: null, hfLikes: null },
  },
];

const COUNTRIES = [
  ['US', 'United States', 'United States of America', '🇺🇸', 39.8, -98.6, 100, 'North America'],
  ['IN', 'India', 'India', '🇮🇳', 22.4, 79.0, 92, 'Asia'],
  ['CN', 'China', 'China', '🇨🇳', 35.5, 103.9, 78, 'Asia'],
  ['DE', 'Germany', 'Germany', '🇩🇪', 51.1, 10.4, 46, 'Europe'],
  ['GB', 'United Kingdom', 'United Kingdom', '🇬🇧', 54.1, -2.9, 44, 'Europe'],
  ['BR', 'Brazil', 'Brazil', '🇧🇷', -10.8, -53.1, 42, 'South America'],
  ['FR', 'France', 'France', '🇫🇷', 46.6, 2.5, 38, 'Europe'],
  ['JP', 'Japan', 'Japan', '🇯🇵', 36.6, 138.0, 36, 'Asia'],
  ['CA', 'Canada', 'Canada', '🇨🇦', 56.1, -106.3, 30, 'North America'],
  ['RU', 'Russia', 'Russia', '🇷🇺', 61.5, 96.7, 28, 'Europe'],
  ['ID', 'Indonesia', 'Indonesia', '🇮🇩', -2.2, 117.4, 26, 'Asia'],
  ['NL', 'Netherlands', 'Netherlands', '🇳🇱', 52.2, 5.6, 18, 'Europe'],
  ['ES', 'Spain', 'Spain', '🇪🇸', 40.2, -3.6, 18, 'Europe'],
  ['PL', 'Poland', 'Poland', '🇵🇱', 52.1, 19.4, 17, 'Europe'],
  ['IT', 'Italy', 'Italy', '🇮🇹', 42.8, 12.1, 16, 'Europe'],
  ['KR', 'South Korea', 'South Korea', '🇰🇷', 36.4, 127.8, 16, 'Asia'],
  ['MX', 'Mexico', 'Mexico', '🇲🇽', 23.9, -102.5, 14, 'North America'],
  ['TR', 'Turkey', 'Turkey', '🇹🇷', 39.1, 35.2, 13, 'Europe'],
  ['AU', 'Australia', 'Australia', '🇦🇺', -25.7, 134.5, 13, 'Oceania'],
  ['VN', 'Vietnam', 'Vietnam', '🇻🇳', 16.6, 106.3, 12, 'Asia'],
  ['NG', 'Nigeria', 'Nigeria', '🇳🇬', 9.6, 8.1, 11, 'Africa'],
  ['MA', 'Morocco', 'Morocco', '🇲🇦', 31.9, -6.9, 7, 'Africa'],
  ['EG', 'Egypt', 'Egypt', '🇪🇬', 26.6, 29.9, 8, 'Africa'],
  ['ZA', 'South Africa', 'South Africa', '🇿🇦', -29.0, 25.1, 8, 'Africa'],
];

const SOURCES_META = [
  ['github', '#A78BFA', 'Stars, forks, contributors, commit cadence and contributor locations', 'events / month', ['mobile', 'database', 'ai-model', 'embedded', 'web'], 'refreshed hourly'],
  ['npm', '#FB7185', 'Package downloads, dependents and version velocity for the JS ecosystem', 'downloads / month', ['mobile', 'web', 'database'], 'refreshed daily'],
  ['pypi', '#60A5FA', 'Package downloads and release cadence for the Python ecosystem', 'downloads / month', ['database', 'ai-model', 'embedded'], 'refreshed daily'],
  ['huggingface', '#FBBF24', 'Model downloads, likes, spaces and fine-tune derivatives', 'downloads / month', ['ai-model'], 'refreshed daily'],
  ['stackoverflow', '#FB923C', 'Question volume, answer rate and tag co-occurrence', 'questions / month', ['mobile', 'database', 'embedded', 'web', 'ai-model'], 'refreshed weekly'],
];

const CASES = [
  {
    id: 'mobile-morocco', position: 1,
    question: 'Which mobile framework should a Moroccan startup bet on?',
    title: 'Mobile in Morocco',
    subtitle: 'Flutter vs React Native vs Kotlin Multiplatform, seen from Casablanca',
    category: 'mobile', country: 'MA', techs: ['flutter', 'react-native', 'kotlin-multiplatform'], accent: '#22D3EE',
    steps: [
      { heading: 'Start with the local ranking', body: 'Filtering the mobile category to Morocco re-orders the podium. Flutter overtakes React Native on local signals: GitHub contributor locations around Casablanca and Rabat, Stack Overflow activity in the flutter tag, and search interest. One Dart codebase for both stores fits small local teams.', chart: 'ranking' },
      { heading: 'Momentum confirms it', body: "Over the last 12 months Flutter's composite score in Morocco climbed steadily while React Native plateaued. Kotlin Multiplatform grows fastest in relative terms — but from a small base, mostly inside Android-first agencies.", chart: 'trend' },
      { heading: "It's a regional pattern, not a quirk", body: "The choropleth shows the same tilt across the Maghreb and West Africa: Flutter's share of mobile activity is highest where teams are small and Android dominates. The US and UK lean React Native — JavaScript talent is abundant there.", chart: 'map' },
      { heading: 'Read the sub-scores before deciding', body: "Flutter wins on activity and growth; React Native still edges adoption thanks to npm's enormous installed base. If your team already writes React, the gap narrows. If you're hiring fresh graduates from INPT or ENSIAS — Flutter is the safer bet.", chart: 'radar' },
    ],
    verdict: 'Flutter, with confidence 0.81. Strongest local momentum, healthiest community signals, and the lowest staffing risk for a two-platform launch from Morocco.',
  },
  {
    id: 'nosql-france', position: 2,
    question: 'What is the most popular NoSQL database in France?',
    title: 'NoSQL in France',
    subtitle: 'MongoDB vs Redis vs Cassandra through French signals',
    category: 'database', country: 'FR', techs: ['mongodb', 'redis', 'cassandra'], accent: '#34D399',
    steps: [
      { heading: 'MongoDB leads the French ranking…', body: 'On raw composite score, MongoDB takes the French NoSQL crown: highest adoption among .fr-domain contributors, the most active French-language Q&A, and a steady stream of meetups from Paris to Lyon.', chart: 'ranking' },
      { heading: '…but Redis is everywhere', body: "Redis sits in nearly every French stack as cache or queue, so its adoption sub-score nearly matches MongoDB's. The difference is made on community: 'primary database' choices generate far more questions, tutorials and conference talks than infrastructure plumbing does.", chart: 'sources' },
      { heading: 'Cassandra is a different animal', body: "Cassandra's French footprint is concentrated in a handful of very large deployments — telecoms and banking. Few teams, huge clusters. Its survey share understates its importance and overstates its hireability.", chart: 'radar' },
      { heading: 'The trend is flattening', body: 'All three curves have flattened over 12 months as PostgreSQL (with JSONB) absorbs workloads that once defaulted to NoSQL. The interesting growth in French data infrastructure is happening at the edges: vector search and embedded analytics.', chart: 'trend' },
    ],
    verdict: "MongoDB, with confidence 0.77 — the most popular by composite score. Pick Redis if 'popular' means 'most deployed'; pick Cassandra only if you operate at telecom scale.",
  },
  {
    id: 'arduino-pulse', position: 3,
    question: 'Is Arduino still the gateway to embedded?',
    title: 'The Arduino question',
    subtitle: 'A 20-year-old platform against professional newcomers',
    category: 'embedded', country: null, techs: ['arduino', 'esp-idf', 'zephyr'], accent: '#FB7185',
    steps: [
      { heading: 'Adoption says yes, loudly', body: "Arduino's adoption and community sub-scores still dominate the category. Every electronics classroom from Turin to Rabat starts here, and its Stack Overflow answer base is the largest knowledge commons in embedded.", chart: 'ranking' },
      { heading: 'Activity tells another story', body: "Core repository activity has cooled — the platform is mature, not abandoned. Meanwhile ESP-IDF commits at 7× Arduino's monthly rate and Zephyr's contributor count is the largest in the category. The energy moved downstream.", chart: 'sources' },
      { heading: 'Geography splits maker vs. industry', body: "Arduino's footprint peaks in Italy, Spain and Latin America — education and maker culture. Zephyr concentrates in Germany, the Nordics and the US, tracking industrial electronics. ESP-IDF follows ESP32 sales: strongest in China and the EU.", chart: 'map' },
      { heading: 'The forecast is a hand-off', body: "Projected six months out, Arduino's composite drifts down slowly while ESP-IDF and Zephyr converge on it. The gateway is intact; the destination changed. Learn on Arduino, ship on ESP-IDF, standardize on Zephyr.", chart: 'trend' },
    ],
    verdict: 'Yes — Arduino remains the on-ramp (confidence 0.84), but it no longer owns the highway. Treat it as education infrastructure, not a product platform.',
  },
  {
    id: 'open-models', position: 4,
    question: 'Which open-weight AI model is actually winning?',
    title: 'The open-weights race',
    subtitle: 'Llama 3 vs Mistral 7B vs Whisper on Hugging Face signals',
    category: 'ai-model', country: null, techs: ['llama-3', 'mistral-7b', 'whisper'], accent: '#FBBF24',
    steps: [
      { heading: 'Llama 3 leads the composite', body: 'Llama 3 tops the category on sheer gravity: the most Hugging Face downloads, the most fine-tune derivatives, the most benchmark citations. Its growth sub-score (93) is the highest of all 15 technologies tracked by OSS Pulse.', chart: 'ranking' },
      { heading: 'Each model wins a different source', body: "The connector panels disagree, and that's the point. Hugging Face crowns Llama 3. PyPI (via transformers and whisper packages) favors Whisper — it ships inside products. GitHub stars favor Whisper too: a two-year head start compounds.", chart: 'sources' },
      { heading: 'Geography is strategy made visible', body: "Mistral's map is unmistakable: a 2.8× over-index in France and a strong EU halo — sovereignty procurement at work. Llama 3 mirrors global compute distribution. Whisper's footprint follows subtitle and accessibility pipelines, peaking in Japan and Germany.", chart: 'map' },
      { heading: 'Growth vs. embedding', body: "The radar makes the trade-off explicit. Llama 3 and Mistral score on growth and adoption — the frontier race. Whisper scores on adoption with sagging activity: finished, embedded, everywhere. 'Winning' depends on whether you're choosing a base model or shipping a feature.", chart: 'radar' },
    ],
    verdict: "Llama 3 by composite score (confidence 0.72). Mistral 7B if your constraint is licensing or European hosting; Whisper if the question is 'which open model is in production right now'.",
  },
];

// ───────────────────────────────────────────────────────────────────────────

exports.up = (pgm) => {
  // 1) Structure ------------------------------------------------------------
  pgm.sql(`
    -- 1.a) CATEGORIES : alignement slug + colonnes de présentation
    UPDATE categories SET slug = 'database' WHERE slug = 'database-nosql';
    ALTER TABLE categories
        ADD COLUMN IF NOT EXISTS blurb TEXT,
        ADD COLUMN IF NOT EXISTS color TEXT,
        ADD COLUMN IF NOT EXISTS icon TEXT,
        ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;

    -- 1.b) TECHNOLOGIES : colonnes de présentation + flag de ranking
    ALTER TABLE technologies
        ADD COLUMN IF NOT EXISTS tagline TEXT,
        ADD COLUMN IF NOT EXISTS color TEXT,
        ADD COLUMN IF NOT EXISTS license TEXT,
        ADD COLUMN IF NOT EXISTS first_release INT,
        ADD COLUMN IF NOT EXISTS is_ranked BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS rank_position INT;

    -- 1.c) SOURCES : métadonnées d'affichage
    ALTER TABLE sources
        ADD COLUMN IF NOT EXISTS color TEXT,
        ADD COLUMN IF NOT EXISTS measures TEXT,
        ADD COLUMN IF NOT EXISTS unit TEXT,
        ADD COLUMN IF NOT EXISTS coverage TEXT[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS freshness TEXT;

    -- 1.d) COUNTRIES
    CREATE TABLE IF NOT EXISTS countries (
        iso2 CHAR(2) PRIMARY KEY,
        name TEXT NOT NULL,
        geo_name TEXT NOT NULL,
        flag TEXT NOT NULL,
        lat NUMERIC(6,2) NOT NULL,
        lng NUMERIC(6,2) NOT NULL,
        dev_weight INT NOT NULL,
        region TEXT NOT NULL,
        position INT NOT NULL
    );

    -- 1.e) SOUS-SCORES par technologie (adoption/activity/growth/community + deltas 90j)
    CREATE TABLE IF NOT EXISTS technology_subscores (
        technology_id INT PRIMARY KEY REFERENCES technologies(id) ON DELETE CASCADE,
        adoption SMALLINT NOT NULL CHECK (adoption BETWEEN 0 AND 100),
        activity SMALLINT NOT NULL CHECK (activity BETWEEN 0 AND 100),
        growth SMALLINT NOT NULL CHECK (growth BETWEEN 0 AND 100),
        community SMALLINT NOT NULL CHECK (community BETWEEN 0 AND 100),
        delta_adoption NUMERIC(5,1) NOT NULL DEFAULT 0,
        delta_activity NUMERIC(5,1) NOT NULL DEFAULT 0,
        delta_growth NUMERIC(5,1) NOT NULL DEFAULT 0,
        delta_community NUMERIC(5,1) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 1.f) MÉTRIQUES agrégées par technologie
    CREATE TABLE IF NOT EXISTS technology_metrics (
        technology_id INT PRIMARY KEY REFERENCES technologies(id) ON DELETE CASCADE,
        stars INT NOT NULL DEFAULT 0,
        forks INT NOT NULL DEFAULT 0,
        contributors INT NOT NULL DEFAULT 0,
        commits_monthly INT NOT NULL DEFAULT 0,
        downloads_monthly BIGINT NOT NULL DEFAULT 0,
        questions_monthly INT NOT NULL DEFAULT 0,
        answered_rate NUMERIC(4,2) NOT NULL DEFAULT 0,
        releases_year INT NOT NULL DEFAULT 0,
        hf_downloads BIGINT,
        hf_likes INT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 1.g) Couverture techno ↔ source (les connecteurs du frontend)
    CREATE TABLE IF NOT EXISTS technology_sources (
        technology_id INT NOT NULL REFERENCES technologies(id) ON DELETE CASCADE,
        source_id INT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        PRIMARY KEY (technology_id, source_id)
    );

    -- 1.h) RÉCITS guidés (cases)
    CREATE TABLE IF NOT EXISTS case_stories (
        id TEXT PRIMARY KEY,
        question TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL,
        category_slug TEXT NOT NULL REFERENCES categories(slug) ON UPDATE CASCADE,
        country_iso2 CHAR(2) REFERENCES countries(iso2),
        techs TEXT[] NOT NULL,
        accent TEXT NOT NULL,
        steps JSONB NOT NULL,
        verdict TEXT NOT NULL,
        position INT NOT NULL
    );
  `);

  // 2) Seed CATEGORIES -------------------------------------------------------
  for (const c of CATEGORIES) {
    pgm.sql(`
      INSERT INTO categories (slug, name, domain, blurb, color, icon, position)
      VALUES ('${c.slug}', '${esc(c.name)}', '${c.slug}', '${esc(c.blurb)}', '${c.color}', '${c.icon}', ${c.position})
      ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name, blurb = EXCLUDED.blurb, color = EXCLUDED.color,
            icon = EXCLUDED.icon, position = EXCLUDED.position;
    `);
  }

  // 3) Seed COUNTRIES ---------------------------------------------------------
  const countryValues = COUNTRIES.map(
    ([iso2, name, geo, flag, lat, lng, w, region], i) =>
      `('${iso2}', '${esc(name)}', '${esc(geo)}', '${flag}', ${lat}, ${lng}, ${w}, '${esc(region)}', ${i + 1})`
  ).join(',\n      ');
  pgm.sql(`
    INSERT INTO countries (iso2, name, geo_name, flag, lat, lng, dev_weight, region, position) VALUES
      ${countryValues}
    ON CONFLICT (iso2) DO UPDATE
      SET name = EXCLUDED.name, geo_name = EXCLUDED.geo_name, flag = EXCLUDED.flag,
          lat = EXCLUDED.lat, lng = EXCLUDED.lng, dev_weight = EXCLUDED.dev_weight,
          region = EXCLUDED.region, position = EXCLUDED.position;
  `);

  // 4) Seed SOURCES meta ------------------------------------------------------
  for (const [slug, color, measures, unit, coverage, freshness] of SOURCES_META) {
    const cov = coverage.map((c) => `'${c}'`).join(',');
    pgm.sql(`
      UPDATE sources
         SET color = '${color}', measures = '${esc(measures)}', unit = '${esc(unit)}',
             coverage = ARRAY[${cov}]::TEXT[], freshness = '${esc(freshness)}'
       WHERE slug = '${slug}';
    `);
  }

  // 5) Seed TECHNOLOGIES (upsert métadonnées + sous-scores + métriques + sources)
  for (const t of TECHS) {
    pgm.sql(`
      INSERT INTO technologies (slug, name, primary_language, description, tagline, color, license, first_release, is_ranked, rank_position)
      VALUES ('${t.slug}', '${esc(t.name)}', '${esc(t.language)}', '${esc(t.description)}',
              '${esc(t.tagline)}', '${t.color}', '${esc(t.license)}', ${t.firstRelease}, TRUE, ${t.position})
      ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name, primary_language = EXCLUDED.primary_language,
            description = EXCLUDED.description, tagline = EXCLUDED.tagline,
            color = EXCLUDED.color, license = EXCLUDED.license,
            first_release = EXCLUDED.first_release,
            is_ranked = TRUE, rank_position = EXCLUDED.rank_position;
    `);

    pgm.sql(`
      INSERT INTO technology_subscores
        (technology_id, adoption, activity, growth, community,
         delta_adoption, delta_activity, delta_growth, delta_community)
      SELECT id, ${t.sub[0]}, ${t.sub[1]}, ${t.sub[2]}, ${t.sub[3]},
             ${t.deltas[0]}, ${t.deltas[1]}, ${t.deltas[2]}, ${t.deltas[3]}
        FROM technologies WHERE slug = '${t.slug}'
      ON CONFLICT (technology_id) DO UPDATE
        SET adoption = EXCLUDED.adoption, activity = EXCLUDED.activity,
            growth = EXCLUDED.growth, community = EXCLUDED.community,
            delta_adoption = EXCLUDED.delta_adoption, delta_activity = EXCLUDED.delta_activity,
            delta_growth = EXCLUDED.delta_growth, delta_community = EXCLUDED.delta_community,
            updated_at = NOW();
    `);

    const m = t.metrics;
    pgm.sql(`
      INSERT INTO technology_metrics
        (technology_id, stars, forks, contributors, commits_monthly, downloads_monthly,
         questions_monthly, answered_rate, releases_year, hf_downloads, hf_likes)
      SELECT id, ${m.stars}, ${m.forks}, ${m.contributors}, ${m.commits}, ${m.downloads},
             ${m.questions}, ${m.answered}, ${m.releases}, ${m.hfDl ?? 'NULL'}, ${m.hfLikes ?? 'NULL'}
        FROM technologies WHERE slug = '${t.slug}'
      ON CONFLICT (technology_id) DO UPDATE
        SET stars = EXCLUDED.stars, forks = EXCLUDED.forks, contributors = EXCLUDED.contributors,
            commits_monthly = EXCLUDED.commits_monthly, downloads_monthly = EXCLUDED.downloads_monthly,
            questions_monthly = EXCLUDED.questions_monthly, answered_rate = EXCLUDED.answered_rate,
            releases_year = EXCLUDED.releases_year, hf_downloads = EXCLUDED.hf_downloads,
            hf_likes = EXCLUDED.hf_likes, updated_at = NOW();
    `);

    const srcList = t.sources.map((s) => `'${s}'`).join(',');
    pgm.sql(`
      INSERT INTO technology_sources (technology_id, source_id)
      SELECT t.id, s.id
        FROM technologies t, sources s
       WHERE t.slug = '${t.slug}' AND s.slug IN (${srcList})
      ON CONFLICT DO NOTHING;
    `);

    pgm.sql(`
      INSERT INTO technology_categories (technology_id, category_id)
      SELECT t.id, c.id
        FROM technologies t, categories c
       WHERE t.slug = '${t.slug}' AND c.slug = '${t.category}'
      ON CONFLICT DO NOTHING;
    `);
  }

  // 6) Seed CASE STORIES ------------------------------------------------------
  for (const c of CASES) {
    const techsArr = c.techs.map((s) => `'${s}'`).join(',');
    const stepsJson = esc(JSON.stringify(c.steps));
    pgm.sql(`
      INSERT INTO case_stories
        (id, question, title, subtitle, category_slug, country_iso2, techs, accent, steps, verdict, position)
      VALUES ('${c.id}', '${esc(c.question)}', '${esc(c.title)}', '${esc(c.subtitle)}',
              '${c.category}', ${escOrNull(c.country)}, ARRAY[${techsArr}]::TEXT[],
              '${c.accent}', '${stepsJson}'::jsonb, '${esc(c.verdict)}', ${c.position})
      ON CONFLICT (id) DO UPDATE
        SET question = EXCLUDED.question, title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
            category_slug = EXCLUDED.category_slug, country_iso2 = EXCLUDED.country_iso2,
            techs = EXCLUDED.techs, accent = EXCLUDED.accent, steps = EXCLUDED.steps,
            verdict = EXCLUDED.verdict, position = EXCLUDED.position;
    `);
  }
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS case_stories;
    DROP TABLE IF EXISTS technology_sources;
    DROP TABLE IF EXISTS technology_metrics;
    DROP TABLE IF EXISTS technology_subscores;
    DROP TABLE IF EXISTS countries;
    ALTER TABLE sources
        DROP COLUMN IF EXISTS color, DROP COLUMN IF EXISTS measures,
        DROP COLUMN IF EXISTS unit, DROP COLUMN IF EXISTS coverage,
        DROP COLUMN IF EXISTS freshness;
    ALTER TABLE technologies
        DROP COLUMN IF EXISTS tagline, DROP COLUMN IF EXISTS color,
        DROP COLUMN IF EXISTS license, DROP COLUMN IF EXISTS first_release,
        DROP COLUMN IF EXISTS is_ranked, DROP COLUMN IF EXISTS rank_position;
    ALTER TABLE categories
        DROP COLUMN IF EXISTS blurb, DROP COLUMN IF EXISTS color,
        DROP COLUMN IF EXISTS icon, DROP COLUMN IF EXISTS position;
    UPDATE categories SET slug = 'database-nosql' WHERE slug = 'database';
  `);
};
