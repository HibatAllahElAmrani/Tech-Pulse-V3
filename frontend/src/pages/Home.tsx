import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Globe2, Layers, Radio } from "lucide-react";
import HeroGlobe from "@/components/HeroGlobe";
import { CountUp, PulseDot, ScoreRing } from "@/components/widgets";
import { Sparkline } from "@/components/charts/lines";
import { Badge } from "@/components/ui/primitives";
import { useAppData } from "@/api/AppDataProvider";
import { fmt } from "@/lib/utils";

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.4, ease: "easeOut" },
};

export default function Home() {
  const { headline: HEADLINE, CASES, CATEGORIES, techsByCategory, techBySlug, countryByIso } = useAppData();
  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-accent/10 blur-[140px]" />
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 pt-12 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-6">
          <div className="relative z-10">
            <motion.div {...fadeUp}>
              <Badge color="#7C5CFF" className="mb-5">
                <PulseDot /> live across 5 ecosystems
              </Badge>
              <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight text-ink sm:text-5xl">
                Discover the <span className="text-accent">Pulse</span> of Open Source Technologies
              </h1>
              <p className="mt-5 max-w-md text-base leading-relaxed text-mute">
              Analyze, compare and track open-source technologies through real-time analytics and community insights.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/categories" className="inline-flex h-11 items-center gap-2 rounded-xl2 bg-accent px-5 text-sm font-semibold text-white shadow-[0_4px_20px_-4px_rgb(124_92_255/0.65)] transition-all duration-200 hover:brightness-110">
                  Explore rankings <ArrowRight size={15} />
                </Link>
                <Link to="/map" className="inline-flex h-11 items-center gap-2 rounded-xl2 border border-edge bg-surface px-5 text-sm font-medium text-ink transition-all duration-200 hover:border-accent/50">
                  <Globe2 size={15} className="text-mute" /> Open the world map
                </Link>
              </div>
            </motion.div>

            {/* Counters */}
            <motion.dl {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.12 }} className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-edge pt-6">
              {[
                { v: HEADLINE.signalsIndexed, label: "signals indexed", f: fmt },
                { v: HEADLINE.countries, label: "countries mapped", f: (n: number) => String(n) },
                { v: HEADLINE.technologies, label: "technologies scored", f: (n: number) => String(n) },
              ].map((s) => (
                <div key={s.label}>
                  <dt className="sr-only">{s.label}</dt>
                  <dd className="text-2xl font-bold text-ink sm:text-3xl"><CountUp to={s.v} format={s.f} /></dd>
                  <dd className="mt-1 text-xs text-mute">{s.label}</dd>
                </div>
              ))}
            </motion.dl>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            className="relative -mx-8 lg:mx-0"
          >
            <HeroGlobe height={520} />
          </motion.div>
        </div>
      </section>

      {/* ── Demo cards ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        <motion.div {...fadeUp} className="mb-6 flex items-end justify-between">
          <div>
            <p className="eyebrow mb-2">Guided demos</p>
            <h2 className="text-xl font-bold tracking-tight">Explore Real-World Use Cases</h2>
          </div>
          <Radio size={18} className="hidden text-mute sm:block" />
        </motion.div>
        <div className="grid gap-4 sm:grid-cols-2">
          {CASES.map((c, i) => (
            <motion.div key={c.id} {...fadeUp} transition={{ ...fadeUp.transition, delay: i * 0.06 }}>
              <Link to={`/cases/${c.id}`} className="card hover-raise group block p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: c.accent }}>
                      {c.country ? `${countryByIso(c.country).flag} ${countryByIso(c.country).name}` : "🌍 Global"} · {c.category}
                    </span>
                    <h3 className="mt-2 text-lg font-semibold leading-snug text-ink">{c.question}</h3>
                    <p className="mt-1.5 text-sm text-mute">{c.subtitle}</p>
                  </div>
                  <ArrowRight size={18} className="mt-1 shrink-0 text-mute transition-transform duration-200 group-hover:translate-x-1 group-hover:text-accent" />
                </div>
                <div className="mt-5 flex items-center gap-3">
                  {c.techs.map((slug) => (
                    <span key={slug} className="w-20"><Sparkline data={techBySlug(slug)?.sparkline ?? []} color={c.accent} height={26} /></span>
                  ))}
                  <span className="num ml-auto text-xs text-mute">4 steps · ~2 min</span>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Featured categories ─────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        <motion.div {...fadeUp} className="mb-6 flex items-end justify-between">
          <div>
            <p className="eyebrow mb-2">Featured categories</p>
            <h2 className="text-xl font-bold tracking-tight">This month's podiums</h2>
          </div>
          <Link to="/categories" className="hidden items-center gap-1 text-sm font-medium text-accent sm:inline-flex">
            All categories <ArrowRight size={14} />
          </Link>
        </motion.div>
        <div className="grid gap-4 md:grid-cols-3">
          {CATEGORIES.slice(0, 3).map((cat, ci) => {
            const top = techsByCategory(cat.slug).slice(0, 3);
            return (
              <motion.div key={cat.slug} {...fadeUp} transition={{ ...fadeUp.transition, delay: ci * 0.06 }}>
                <Link to={`/categories/${cat.slug}`} className="card hover-raise block p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <Layers size={14} style={{ color: cat.color }} /> {cat.name}
                    </span>
                    <Badge color={cat.color}>{techsByCategory(cat.slug).length} tracked</Badge>
                  </div>
                  <ol className="space-y-2.5">
                    {top.map((t, i) => (
                      <li key={t.slug} className="flex items-center gap-3">
                        <span className="num w-5 text-xs text-mute">{i + 1}</span>
                        <span className="flex-1 truncate text-sm font-medium text-ink">{t.name}</span>
                        <span className="w-16"><Sparkline data={t.sparkline} color={t.color} height={22} /></span>
                        <span className="num w-8 text-right text-sm font-semibold" style={{ color: i === 0 ? cat.color : undefined }}>{t.score}</span>
                      </li>
                    ))}
                  </ol>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ── Methodology strip ───────────────────────────────────────── */}
      <motion.section {...fadeUp} className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        <div className="card flex flex-col items-center gap-8 p-8 sm:flex-row">
          <ScoreRing value={87} size={110} label="composite" />
          <div className="max-w-xl">
            <h2 className="text-lg font-bold tracking-tight">A score you can audit</h2>
            <p className="mt-2 text-sm leading-relaxed text-mute">
              Every composite is the weighted sum of four visible sub-scores —{" "}
              <span className="num text-ink">0.35·adoption + 0.25·activity + 0.25·growth + 0.15·community</span> —
              and every sub-score traces back to named connectors. Toggle a source off and watch the score react.
            </p>
          </div>
          <Link to="/tech/flutter" className="num ml-auto whitespace-nowrap text-sm font-medium text-accent">
            See it live →
          </Link>
        </div>
      </motion.section>
    </div>
  );
}
