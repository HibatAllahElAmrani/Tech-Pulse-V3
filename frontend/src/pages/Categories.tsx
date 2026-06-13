import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Smartphone, Database, BrainCircuit, Cpu, Globe, Wrench } from "lucide-react";
import { PageShell, PageHeader } from "@/components/layout/Layout";
import { Card } from "@/components/ui/primitives";
import { Sparkline } from "@/components/charts/lines";
import { EcosystemTreemap, LandscapeBubbles } from "@/components/charts/blocks";
import { useAppData } from "@/api/AppDataProvider";
import { useNavigate } from "react-router-dom";

const ICONS: Record<string, any> = { Smartphone, Database, BrainCircuit, Cpu, Globe, Wrench };

export default function Categories() {
  const navigate = useNavigate();
  const { CATEGORIES, TECHNOLOGIES, techsByCategory } = useAppData();
  return (
    <PageShell>
      <PageHeader
        eyebrow="Explore"
        title="Categories"
        sub={`${CATEGORIES.length} domains, ${TECHNOLOGIES.length} technologies, one comparable score. Pick a category to see the full ranking with country and source filters.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((cat, i) => {
          const Icon = ICONS[cat.icon] ?? Globe;
          const techs = techsByCategory(cat.slug);
          const leader = techs[0];
          return (
            <motion.div
              key={cat.slug}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
            >
              <Link to={`/categories/${cat.slug}`} className="block h-full">
                <Card className="hover-raise group flex h-full flex-col p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-xl2"
                      style={{ backgroundColor: cat.color + "1c", color: cat.color }}
                    >
                      <Icon size={19} strokeWidth={1.8} />
                    </span>
                    <div>
                      <h3 className="font-semibold leading-tight">{cat.name}</h3>
                      <p className="text-xs text-mute">{techs.length} technologies tracked</p>
                    </div>
                  </div>
                  <p className="mb-4 text-sm text-mute">{cat.blurb}</p>

                  <div className="mt-auto space-y-2.5">
                    {techs.map((t, rank) => (
                      <div key={t.slug} className="flex items-center gap-3">
                        <span className="num w-4 text-xs text-mute">{rank + 1}</span>
                        <span className="w-28 truncate text-sm font-medium">{t.name}</span>
                        <div className="min-w-0 flex-1">
                          <Sparkline data={t.sparkline} color={t.color} height={26} />
                        </div>
                        <span className="num w-8 text-right text-sm font-semibold" style={{ color: rank === 0 ? cat.color : undefined }}>
                          {t.score}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-edge pt-3 text-xs text-mute">
                    <span>
                      {leader ? (
                        <>Leader: <span className="font-medium text-ink">{leader.name}</span></>
                      ) : (
                        "No technologies yet — add one from the search bar"
                      )}
                    </span>
                    <span className="inline-flex items-center gap-1 text-accent opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      Open ranking <ArrowRight size={13} />
                    </span>
                  </div>
                </Card>
              </Link>
            </motion.div>
          );
        })}

        {/* Landscape card filling the grid */}
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.28 }}>
          <Card className="flex h-full flex-col p-5">
            <h3 className="font-semibold leading-tight">The whole landscape</h3>
            <p className="mb-2 text-xs text-mute">Growth × adoption, bubble = community. Click a bubble to open its profile.</p>
            <div className="-mx-2 mt-auto">
              <LandscapeBubbles height={290} onTechClick={(slug) => navigate(`/tech/${slug}`)} />
            </div>
          </Card>
        </motion.div>
      </div>

      <Card className="mt-6 p-5">
        <h3 className="font-semibold">Ecosystem map</h3>
        <p className="mb-2 text-xs text-mute">Area = composite score. Click a tile to open the technology profile.</p>
        <EcosystemTreemap height={400} onLeafClick={(slug) => navigate(`/tech/${slug}`)} />
      </Card>
    </PageShell>
  );
}
