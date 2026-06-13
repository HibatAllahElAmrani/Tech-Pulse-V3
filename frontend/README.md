# OSS Pulse — front-end prototype

A static, fully client-side prototype of **OSS Pulse**: a multi-source open-source intelligence dashboard that answers *"what is the most popular X, in domain Y, in country Z?"* with a transparent composite score.

All data is **mock data**, generated deterministically in `/src/mocks` — no backend, no auth, no API keys.

## Run it

```bash
npm install
npm run dev
```

Then open the printed URL (usually http://localhost:5173).

Production build:

```bash
npm run build
npm run preview
```

## What's inside

| Route | What it shows |
|---|---|
| `/` | 3D rotating globe hero, animated counters, 4 demo-story cards, featured category podiums |
| `/categories` | 5 domain cards with mini-leaderboards + ecosystem treemap + landscape bubbles |
| `/categories/:slug` | Filterable ranking table (country / sources / timeframe), bar-chart race, score trajectories, category choropleth |
| `/tech/:slug` | Tech profile — composite ring + radar, tabs: Overview (sankey, calendar heatmap), Sources, Geography (choropleth + per-country sub-scores), Forecast (confidence band), Compare |
| `/compare` | 2–5 techs side by side: overlaid radar, multi-series line with brush, sub-score table |
| `/map` | Full-width choropleth with category filter and a **signal-source toggle** (surveys / GitHub locations / search trends) showing how confidence shifts |
| `/cases/:id` | 4 guided stories: `mobile-morocco`, `nosql-france`, `arduino-pulse`, `open-models` |

## Stack

- React 18 + TypeScript + Vite
- TailwindCSS (dark default, light toggle, CSS-variable theming)
- Apache ECharts (`echarts-for-react`) — choropleth, radar, sankey, treemap, calendar heatmap, bar race, forecast band, bubbles
- `react-globe.gl` + three.js — home hero only
- Framer Motion — page transitions & scroll reveals
- Inter (UI) + JetBrains Mono (numerals)

## Where things live

```
src/
  mocks/        types, 24 countries, 5 sources, 15 technologies,
                deterministic series generators (seeded PRNG), 4 case stories
  components/
    charts/     EChart wrapper, Choropleth, lines (radar/spark/multi/forecast),
                blocks (treemap/sankey/calendar/bubbles/race)
    ui/         Button, Card, Badge, Tabs, Segmented, Select
    layout/     Navbar, Footer, PageShell, PageHeader
    widgets.tsx ScoreRing, CountUp, Delta, PulseDot, SubScoreBars
  pages/        Home, Categories, CategoryDetail, TechDetail, Compare, MapPage, CaseStory
  theme/        ThemeProvider (dark/light), color tokens
  assets/       world.json (GeoJSON for maps & globe)
```

## The score (mock methodology)

`composite = 0.35·adoption + 0.25·activity + 0.25·growth + 0.15·community`

Sub-scores are normalized 0–100 from per-source signals (GitHub, npm, PyPI, Hugging Face, Stack Overflow). Country views re-weight signals by geo-attributed activity, with an explicit confidence per signal source. The numbers are fabricated but internally consistent — the four demo stories hold up under every chart.
