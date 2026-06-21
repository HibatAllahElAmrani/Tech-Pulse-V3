# Tech Pulse INPT — Full-Stack · IA · Docker

**Idée, coaching technique et supervision :** Mr. Yann BENMAISSA  
**Conception et développement :** Hibat Allah EL AMRANI, Khadija OUMHEND & Khadija OUANOUR

> *« Quel est le **X** le plus populaire dans le domaine **Y**, dans le pays **Z** ? »*

Plateforme d'intelligence open-source multi-sources : un **score composite transparent**
(0.35·adoption + 0.25·activité + 0.25·croissance + 0.15·communauté) calculé pour
15 technologies dans 5 domaines, avec dimension géographique (24 pays), prévision
**IA** à 6 mois et 4 récits guidés.

```
oss-pulse/
├── frontend/          SPA React 18 + Vite + TS (ECharts, globe 3D) — servie par nginx
├── backend/           API Fastify 4 + TS (PostgreSQL/TimescaleDB, Redis, BullMQ, Socket.io)
├── ai-service/        Micro-service FastAPI — prévision Holt damped trend (NumPy)
├── docker-compose.yml Orchestration complète (5 services)
├── .env.docker        Variables de la stack Docker
├── .env.backend       Variables pour lancer le backend hors Docker
└── .env.frontend      Variables pour lancer le frontend hors Docker
```

---

## 🚀 Démarrage en une commande

```bash
docker compose up --build
```

| Service    | URL                          | Rôle                                            |
|------------|------------------------------|-------------------------------------------------|
| frontend   | http://localhost:8080        | SPA + proxy nginx `/api` et `/ws` → backend      |
| backend    | http://localhost:4000        | REST `/api/v1` + WebSocket `/ws`                 |
| ai-service | http://localhost:8000        | `POST /forecast` (Holt damped trend)             |
| postgres   | localhost:5432               | TimescaleDB (taxonomie + séries temporelles)     |
| redis      | localhost:6379               | Cache · BullMQ · Pub/Sub                         |

Au premier démarrage, le backend applique automatiquement les **5 migrations**
(idempotentes) puis seed la taxonomie complète. Ouvre ensuite
**http://localhost:8080** — l'application est branchée de bout en bout.

### Vérifications rapides

```bash
curl http://localhost:4000/health                       # backend vivant
curl http://localhost:4000/api/v1/bootstrap | head -c 300   # bundle SPA
curl http://localhost:4000/api/v1/technologies/flutter/forecast
#   → "model": "holt-damped-trend"  ⇒ la prévision vient bien du service IA
curl http://localhost:8000/health                       # service IA
```

---

## 🧱 Architecture

```
 Navigateur ──HTTP──▶ nginx (frontend:8080)
                       ├── /            → SPA React (dist)
                       ├── /api/*  ────▶ backend:4000   (même origine → zéro CORS)
                       └── /ws     ────▶ backend:4000   (WebSocket upgrade)

 backend (Fastify)
   ├── plugins  : pg · redis(×3) · socket.io · taxonomy   (injection de dépendances)
   ├── routes   : catalog (/bootstrap, /categories…) · analytics (séries, géo, forecast…)
   │             · projects (watchlist GitHub, legacy) · health
   ├── services : taxonomy (PG→formes frontend) · scoring (générateurs déterministes)
   │             · forecastClient (→ ai-service, fallback) · github · crypto
   ├── workers  : scheduler (30s/5min/15min) → BullMQ → metricsWorker → TimescaleDB
   └── temps réel : Redis Pub/Sub → Socket.io rooms project:{id}

 ai-service (FastAPI)
   └── POST /forecast : Holt damped trend, (α,β,φ) ajustés par grid-search SSE,
       bande d'incertitude ±1.28·σ·√h. Timeout 2,5 s côté backend ;
       indisponible ⇒ fallback déterministe, champ "model" l'indique.
```

### Communication inter-services (réseau Docker `osspulse`)

| De → Vers            | Protocole | Adresse interne              |
|----------------------|-----------|------------------------------|
| frontend → backend   | HTTP/WS   | `http://backend:4000` (proxy nginx) |
| backend → postgres   | TCP       | `postgres:5432`              |
| backend → redis      | TCP       | `redis:6379`                 |
| backend → ai-service | HTTP      | `http://ai-service:8000`     |

Healthchecks + `depends_on: condition: service_healthy` ⇒ ordre de démarrage garanti :
postgres/redis/ai-service → backend (migrations puis serveur) → frontend.

---

## 🔌 Intégration Frontend ↔ Backend

Le frontend ne contient **plus aucune donnée mockée** (`src/mocks/` supprimé).
Couche API centralisée dans `frontend/src/api/` :

| Fichier              | Rôle                                                                  |
|----------------------|-----------------------------------------------------------------------|
| `client.ts`          | Fetch wrapper : baseURL (`VITE_API_URL`), JWT auto, `ApiError` normalisée, timeout 15 s |
| `endpoints.ts`       | Fonctions typées, 1 fonction = 1 route backend                        |
| `useApi.ts`          | Hook `{data, loading, error, reload}` + cache mémoire par clé          |
| `AppDataProvider.tsx`| Charge `GET /bootstrap` une fois ; expose la taxonomie + helpers (`techBySlug`, `techsByCategory`, …) sous les mêmes noms que l'ancienne couche de mocks |
| `types.ts`           | Contrat de données partagé (Tech inclut désormais `sparkline`)         |

Chaque visualisation gère ses états **loading / error / success**
(`ChartLoader` / `ChartError` avec retry).

### Correspondance page ↔ endpoints

| Page / composant        | Endpoints consommés                                                       |
|-------------------------|---------------------------------------------------------------------------|
| Bootstrap (toutes pages)| `GET /bootstrap`                                                           |
| Home (globe)            | `GET /analytics/globe`                                                     |
| Categories              | bootstrap + `GET /analytics/treemap` + `GET /analytics/landscape`          |
| CategoryDetail          | `GET /analytics/race?category=` + `GET /analytics/geo/category/:slug`      |
| RankingTable (pays)     | `GET /technologies/:slug/subscores?country=XX` (batch) + `/geo` (lazy)     |
| TechDetail · Overview   | `GET /technologies/:slug/flow` + `/calendar`                               |
| TechDetail · Sources    | `GET /technologies/:slug/sources/series`                                   |
| TechDetail · Geography  | `GET /technologies/:slug/geo` + `/subscores?country=`                      |
| TechDetail · Forecast   | `GET /technologies/:slug/forecast` **(IA)**                                |
| MapPage                 | `GET /analytics/geo?category=&signal=`                                     |
| CaseStory               | bootstrap + `/geo` + `/sources/series` par étape                           |

---

## 🤖 Service IA (Forecast)

`POST http://ai-service:8000/forecast`

```json
{ "series": [62.1, 63.0, …, 87.0], "horizon": 6, "clamp_min": 5, "clamp_max": 99 }
```

```json
{ "mid": [88.3, …], "lo": [...], "hi": [...],
  "model": "holt-damped-trend",
  "params": { "alpha": 0.8, "beta": 0.05, "phi": 0.95, "sigma": 0.854 } }
```

Le backend appelle ce service dans `GET /technologies/:slug/forecast` et retombe
sur le générateur déterministe si le service est injoignable (champ
`"model": "deterministic"`). L'onglet **Forecast** du frontend affiche un badge
`AI · holt-damped-trend` ou `fallback · deterministic`.

---

## 🛠️ Développement hors Docker

```bash
# 1. Infra seule
docker compose up postgres redis ai-service

# 2. Backend
cp .env.backend backend/.env
cd backend && npm install && npm run migrate:up && npm run dev    # :4000

# 3. Frontend (proxy /api → :4000 déjà configuré dans vite.config.ts)
cp .env.frontend frontend/.env
cd frontend && npm install && npm run dev                          # :5173
```

### Tests

```bash
cd backend && npx vitest run     # 19 tests de parité des générateurs
cd backend && npx tsc --noEmit   # typecheck backend
cd frontend && npx tsc -b        # typecheck frontend
```

---

## 📋 Modifications apportées (intégration) — justification

| Modification | Justification |
|---|---|
| **Frontend** : couche `src/api/` + suppression de `src/mocks/` | Remplacement des données mockées par les appels réels ; les helpers gardent les mêmes noms → diff minimal, zéro régression visuelle. |
| **Frontend** : états loading/error sur chaque graphe | Une API réseau peut échouer ; jamais d'écran cassé, retry partout. |
| **Frontend** : Dockerfile multi-stage + nginx proxy `/api`,`/ws` | Une seule origine pour le navigateur → suppression du problème CORS par construction. |
| **Backend** : `GET /bootstrap` | La SPA chargeait 6+ ressources au démarrage ; un seul aller-retour (anti-chattiness). |
| **Backend** : champ `sparkline` dans `Tech` | Les listes affichent une mini-courbe par techno ; sans ce champ il aurait fallu N appels `/series`. Champ additif. |
| **Backend** : `forecastClient` + champ `model` | Branche le module IA sur la fonctionnalité Forecast avec dégradation gracieuse ; `model` rend la provenance auditable. |
| **Migrations** : gardes `IF EXISTS timescaledb` | Le schéma fonctionne aussi sur PostgreSQL vanilla (CI/dev) ; comportement strictement identique sur l'image TimescaleDB. |
| **`backend/docker-compose.yml` supprimé** | Une seule source de vérité d'orchestration (racine) ; évite la divergence. |
| **AI service** : Holt damped trend (NumPy pur) | Modèle de prévision réel (paramètres appris par série), léger (~50 Mo d'image), explicable — adapté à une démonstration PFE. |

---

## 🔐 Sécurité

helmet · CORS restreint · rate-limit 200 req/min · validation **zod** de tous les
params/query · JWT (`Authorization: Bearer`) sur la surface `projects` ·
chiffrement AES-256-GCM des tokens GitHub · conteneur IA non-root ·
secrets exclusivement via variables d'environnement (valeurs de dev fournies,
à régénérer en production : `openssl rand -hex 32`).
