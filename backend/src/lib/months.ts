/**
 * Axe temporel des endpoints analytiques : fenêtres glissantes ancrées sur la
 * date courante, dont les clés ISO (YYYY-MM / YYYY-MM-DD) permettent de
 * joindre les agrégats TimescaleDB aux libellés affichés.
 */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MonthRef {
  label: string; // format frontend : "Jun '26"
  key: string;   // clé de jointure SQL : "2026-06"
}

function monthRef(d: Date): MonthRef {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    label: `${MONTH_NAMES[m]} '${String(y).slice(2)}`,
    key: `${y}-${String(m + 1).padStart(2, '0')}`,
  };
}

/** Les `n` derniers mois, mois courant inclus (ordre chronologique). */
export function lastMonths(n = 12, now = new Date()): MonthRef[] {
  const out: MonthRef[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(monthRef(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return out;
}

/** Les `n` mois suivant le mois courant (horizon de prévision). */
export function nextMonths(n = 6, now = new Date()): MonthRef[] {
  const out: MonthRef[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(monthRef(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))));
  }
  return out;
}

/** Les `n` derniers jours (clé "YYYY-MM-DD"), aujourd'hui inclus, ordre chronologique. */
export function lastDays(n = 182, now = new Date()): string[] {
  const out: string[] = [];
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}
