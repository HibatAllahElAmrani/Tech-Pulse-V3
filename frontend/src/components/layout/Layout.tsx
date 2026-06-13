import { NavLink, Link, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun, Activity } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/theme/ThemeProvider";
import { PulseDot } from "@/components/widgets";
import { SearchBar } from "@/components/SearchBar";

const NAV = [
  { to: "/categories", label: "Categories" },
  { to: "/compare", label: "Compare" },
  { to: "/map", label: "World map" },
  { to: "/cases/mobile-morocco", label: "Demo stories", match: "/cases" },
];

export function Navbar() {
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-ink">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15">
            <Activity size={15} className="text-accent" />
          </span>
          Tech&nbsp;Pulse
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((n) => {
            const active = pathname.startsWith(n.match ?? n.to);
            return (
              <NavLink
                key={n.to}
                to={n.to}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-200",
                  active ? "bg-raised text-ink" : "text-mute hover:text-ink",
                )}
              >
                {n.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="ml-auto flex flex-1 items-center justify-end gap-3">
          <SearchBar />
          <span className="hidden items-center gap-2 text-xs text-mute lg:flex">
            <PulseDot color="#34D399" /> live data
          </span>
          <button
            onClick={toggle}
            aria-label="Toggle theme"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-edge text-mute transition-colors duration-200 hover:border-accent/50 hover:text-ink"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-20 border-t border-edge">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-xs text-mute sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>Tech Pulse — multi-source open-source intelligence, live data from public registries.</span>
        <span className="num">GitHub · npm · PyPI · Hugging Face · Stack Overflow</span>
      </div>
    </footer>
  );
}

export function PageShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { pathname } = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.main
        key={pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className={cn("mx-auto w-full px-4 sm:px-6", wide ? "max-w-none" : "max-w-7xl")}
      >
        {children}
      </motion.main>
    </AnimatePresence>
  );
}

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pb-8 pt-10 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {sub && <p className="mt-2 text-sm leading-relaxed text-mute">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
