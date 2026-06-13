import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Star, Loader2, Plus, Check } from "lucide-react";
import { endpoints } from "@/api/endpoints";
import { useAppData } from "@/api/AppDataProvider";
import { ApiError } from "@/api/client";
import type { SearchResults, SearchRepoHit } from "@/api/types";
import { cn } from "@/lib/utils";

/**
 * Barre de recherche globale (header) — deux sections :
 *   · technologies suivies → navigation directe vers /tech/:slug ;
 *   · repos GitHub → ajout au catalogue (catégorie suggérée, modifiable),
 *     la techno apparaît ensuite dans tous les dashboards via refresh().
 */
export function SearchBar() {
  const navigate = useNavigate();
  const { CATEGORIES, refresh } = useAppData();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // fullName en cours d'ajout
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [catChoice, setCatChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounce 350 ms.
  useEffect(() => {
    setError(null);
    if (q.trim().length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      endpoints
        .search(q.trim())
        .then((r) => {
          setResults(r);
          setLoading(false);
        })
        .catch(() => {
          setResults(null);
          setLoading(false);
          setError("Recherche indisponible");
        });
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  // Fermeture au clic extérieur / Échap.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const goTech = (slug: string) => {
    setOpen(false);
    setQ("");
    navigate(`/tech/${slug}`);
  };

  const addRepo = async (hit: SearchRepoHit) => {
    setAdding(hit.fullName);
    setError(null);
    try {
      const category = catChoice[hit.fullName] ?? hit.suggestedCategory;
      const created = await endpoints.addTechnology(hit.owner, hit.repo, category);
      await refresh();
      setAdded((s) => new Set(s).add(hit.fullName));
      goTech(created.slug);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ajout impossible");
    } finally {
      setAdding(null);
    }
  };

  const showDropdown = open && (loading || results !== null || error !== null);

  return (
    <div ref={boxRef} className="relative w-full max-w-xs sm:max-w-sm">
      <div className="flex items-center gap-2 rounded-xl border border-edge bg-raised/60 px-3 py-1.5 transition-colors focus-within:border-accent/60">
        <Search size={14} className="shrink-0 text-mute" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search techs or GitHub repos…"
          className="w-full bg-transparent text-sm text-ink placeholder:text-mute focus:outline-none"
        />
        {loading && <Loader2 size={14} className="shrink-0 animate-spin text-mute" />}
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[28rem] overflow-y-auto rounded-xl border border-edge bg-bg p-2 shadow-xl">
          {error && <p className="px-2 py-1.5 text-xs text-rose-400">{error}</p>}

          {results && results.technologies.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-mute">
                Tracked technologies
              </p>
              {results.technologies.map((t) => (
                <button
                  key={t.slug}
                  onClick={() => goTech(t.slug)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-raised"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                  <span className="text-sm font-medium text-ink">{t.name}</span>
                  <span className="text-xs text-mute">{t.category}</span>
                  <span className="num ml-auto text-xs text-mute">{t.score}</span>
                </button>
              ))}
            </>
          )}

          {results && results.repositories.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-mute">
                GitHub repositories
              </p>
              {results.repositories.map((r) => {
                const isTracked = r.tracked || added.has(r.fullName);
                const isAdding = adding === r.fullName;
                return (
                  <div key={r.fullName} className="rounded-lg px-2 py-2 transition-colors hover:bg-raised">
                    <div className="flex items-center gap-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{r.fullName}</p>
                        {r.description && <p className="truncate text-xs text-mute">{r.description}</p>}
                      </div>
                      <span className="num flex shrink-0 items-center gap-1 text-xs text-mute">
                        <Star size={11} /> {r.stars >= 1000 ? `${Math.round(r.stars / 100) / 10}k` : r.stars}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      {isTracked ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <Check size={12} /> Already tracked
                        </span>
                      ) : (
                        <>
                          <select
                            value={catChoice[r.fullName] ?? r.suggestedCategory}
                            onChange={(e) =>
                              setCatChoice((c) => ({ ...c, [r.fullName]: e.target.value }))
                            }
                            className="rounded-md border border-edge bg-raised px-1.5 py-0.5 text-xs text-ink focus:outline-none"
                          >
                            {CATEGORIES.map((c) => (
                              <option key={c.slug} value={c.slug}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => addRepo(r)}
                            disabled={isAdding}
                            className={cn(
                              "ml-auto flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25",
                              isAdding && "opacity-60",
                            )}
                          >
                            {isAdding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                            {isAdding ? "Adding…" : "Track"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {results && results.technologies.length === 0 && results.repositories.length === 0 && !loading && (
            <p className="px-2 py-3 text-center text-xs text-mute">No result for “{results.query}”</p>
          )}
        </div>
      )}
    </div>
  );
}
