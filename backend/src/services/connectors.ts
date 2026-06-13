/**
 * Connecteurs vers les APIs publiques des registres — les sources RÉELLES.
 *
 *   npm            api.npmjs.org          downloads/mois, historique 12 mois
 *   PyPI           pypistats.org          downloads/mois, historique ~6 mois
 *   Hugging Face   huggingface.co/api     downloads 30 j + likes (instantané)
 *   Stack Overflow api.stackexchange.com  questions/mois + taux de réponse
 *
 * Tous tolèrent l'échec (null/Map vide) : un registre indisponible ne doit
 * jamais bloquer le cycle de collecte. Les quotas sont gérés par l'appelant
 * (worker) via des budgets par cycle.
 */

const UA = 'oss-pulse/0.2.0 (open-source intelligence dashboard)';

async function getJson<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** "2026-06-03" → "2026-06" */
const ym = (day: string) => day.slice(0, 7);

/* ── npm ─────────────────────────────────────────────────────────────────── */

/** Downloads quotidiens des 365 derniers jours, agrégés par mois ("YYYY-MM"). */
export async function npmMonthlyDownloads(pkg: string): Promise<Map<string, number>> {
  const data = await getJson<{ downloads: { day: string; downloads: number }[] }>(
    `https://api.npmjs.org/downloads/range/last-year/${encodeURIComponent(pkg)}`
  );
  const out = new Map<string, number>();
  for (const d of data?.downloads ?? []) {
    out.set(ym(d.day), (out.get(ym(d.day)) ?? 0) + d.downloads);
  }
  return out;
}

/** Downloads des 30 derniers jours (instantané "mois courant"). */
export async function npmLastMonth(pkg: string): Promise<number | null> {
  const data = await getJson<{ downloads: number }>(
    `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(pkg)}`
  );
  return data?.downloads ?? null;
}

/* ── PyPI (pypistats.org) ────────────────────────────────────────────────── */

/** Downloads quotidiens (~180 jours, hors mirroirs), agrégés par mois. */
export async function pypiMonthlyDownloads(pkg: string): Promise<Map<string, number>> {
  const data = await getJson<{ data: { category: string; date: string; downloads: number }[] }>(
    `https://pypistats.org/api/packages/${encodeURIComponent(pkg.toLowerCase())}/overall`
  );
  const out = new Map<string, number>();
  for (const d of data?.data ?? []) {
    if (d.category !== 'without_mirrors') continue;
    out.set(ym(d.date), (out.get(ym(d.date)) ?? 0) + d.downloads);
  }
  return out;
}

/** Downloads des 30 derniers jours. */
export async function pypiLastMonth(pkg: string): Promise<number | null> {
  const data = await getJson<{ data: { last_month: number } }>(
    `https://pypistats.org/api/packages/${encodeURIComponent(pkg.toLowerCase())}/recent`
  );
  return data?.data?.last_month ?? null;
}

/* ── Hugging Face ────────────────────────────────────────────────────────── */

/** Downloads (fenêtre 30 j) + likes du modèle. Pas d'historique côté HF. */
export async function hfModelStats(
  modelId: string
): Promise<{ downloads: number; likes: number } | null> {
  const data = await getJson<{ downloads?: number; likes?: number }>(
    `https://huggingface.co/api/models/${modelId}`
  );
  if (!data) return null;
  return { downloads: data.downloads ?? 0, likes: data.likes ?? 0 };
}

/* ── Stack Overflow (Stack Exchange API) ─────────────────────────────────── */

const SO_BASE = 'https://api.stackexchange.com/2.3';

/** Clé d'app Stack Exchange (quota 300/j → 10 000/j). Optionnelle. */
function soKeyParam(): string {
  const key = process.env.STACKEXCHANGE_KEY?.trim();
  return key ? `&key=${encodeURIComponent(key)}` : '';
}

/** Nombre de questions taguées dans une fenêtre [from, to) (epoch secondes). */
export async function soQuestionCount(
  tag: string,
  fromEpoch: number,
  toEpoch: number
): Promise<number | null> {
  const data = await getJson<{ total?: number; backoff?: number }>(
    `${SO_BASE}/questions?site=stackoverflow&tagged=${encodeURIComponent(tag)}` +
      `&fromdate=${fromEpoch}&todate=${toEpoch}&filter=total${soKeyParam()}`
  );
  if (data?.backoff) await new Promise((r) => setTimeout(r, data.backoff! * 1000));
  return data?.total ?? null;
}

/** Taux de réponse acceptée sur les questions des 30 derniers jours. */
export async function soAnsweredRate(tag: string): Promise<number | null> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 30 * 86_400;
  const total = await soQuestionCount(tag, from, to);
  if (total === null || total === 0) return total === 0 ? 0 : null;
  const data = await getJson<{ total?: number; backoff?: number }>(
    `${SO_BASE}/search/advanced?site=stackoverflow&tagged=${encodeURIComponent(tag)}` +
      `&accepted=True&fromdate=${from}&todate=${to}&filter=total${soKeyParam()}`
  );
  if (data?.backoff) await new Promise((r) => setTimeout(r, data.backoff! * 1000));
  if (data?.total === undefined) return null;
  return Math.round((data.total / total) * 100) / 100;
}

/* ── Auto-mapping registres ↔ repo GitHub (à l'ajout d'une techno) ──────── */

/**
 * Package npm du même nom DONT le champ repository pointe vers ce repo
 * GitHub — la vérification croisée évite tout faux positif (ex. le package
 * npm "javascript" n'a rien à voir avec airbnb/javascript).
 */
export async function npmPackageForRepo(
  owner: string,
  repo: string
): Promise<string | null> {
  const name = repo.toLowerCase();
  const data = await getJson<{ name?: string; repository?: { url?: string } }>(
    `https://registry.npmjs.org/${encodeURIComponent(name)}`
  );
  const repoUrl = data?.repository?.url ?? '';
  return new RegExp(`github\\.com[/:]${owner}/${repo}(\\.git)?/?$`, 'i').test(repoUrl)
    ? data!.name ?? name
    : null;
}

/** Package PyPI du même nom dont les URLs de projet pointent vers ce repo. */
export async function pypiPackageForRepo(
  owner: string,
  repo: string
): Promise<string | null> {
  const name = repo.toLowerCase();
  const data = await getJson<{
    info?: { name?: string; project_urls?: Record<string, string>; home_page?: string };
  }>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  if (!data?.info) return null;
  const urls = [...Object.values(data.info.project_urls ?? {}), data.info.home_page ?? ''];
  const re = new RegExp(`github\\.com/${owner}/${repo}/?$`, 'i');
  return urls.some((u) => re.test(u ?? '')) ? data.info.name ?? name : null;
}

/** Tag Stack Overflow homonyme, s'il a un volume significatif (>1000 questions). */
export async function soTagForRepo(repo: string): Promise<string | null> {
  const tag = repo.toLowerCase();
  const data = await getJson<{ items?: { name: string; count: number }[] }>(
    `${SO_BASE}/tags/${encodeURIComponent(tag)}/info?site=stackoverflow${soKeyParam()}`
  );
  const hit = data?.items?.[0];
  return hit && hit.count > 1000 ? hit.name : null;
}

/* ── Résolution pays des localisations GitHub ────────────────────────────── */

/**
 * Localisation libre ("Casablanca, Morocco", "SF Bay Area") → ISO2, par
 * correspondance hors-ligne sur noms de pays + grandes villes + codes.
 * Couvre les 24 pays de la table `countries` ; le reste est ignoré (non
 * localisé) plutôt qu'inventé.
 */
const COUNTRY_PATTERNS: [string, RegExp][] = [
  ['US', /\b(usa|u\.s\.a?\.?|united states|america|california|new york|nyc|san francisco|seattle|austin|boston|chicago|texas|washington|silicon valley|bay area|los angeles|portland|denver|atlanta)\b/i],
  ['IN', /\b(india|bangalore|bengaluru|mumbai|delhi|hyderabad|chennai|pune|kolkata)\b/i],
  ['CN', /\b(china|beijing|shanghai|shenzhen|hangzhou|guangzhou|chengdu|中国|北京|上海|深圳|杭州)\b/i],
  ['DE', /\b(germany|deutschland|berlin|munich|münchen|hamburg|cologne|köln|frankfurt|stuttgart)\b/i],
  ['GB', /\b(uk|u\.k\.|united kingdom|england|london|manchester|scotland|edinburgh|wales|bristol|cambridge|oxford)\b/i],
  ['BR', /\b(brazil|brasil|são paulo|sao paulo|rio de janeiro|belo horizonte|curitiba|florianópolis)\b/i],
  ['FR', /\b(france|paris|lyon|toulouse|bordeaux|nantes|lille|marseille|grenoble)\b/i],
  ['JP', /\b(japan|tokyo|osaka|kyoto|日本|東京)\b/i],
  ['CA', /\b(canada|toronto|vancouver|montreal|montréal|ottawa|waterloo|quebec)\b/i],
  ['RU', /\b(russia|moscow|saint petersburg|россия|москва)\b/i],
  ['ID', /\b(indonesia|jakarta|bandung|surabaya|yogyakarta|bali)\b/i],
  ['NL', /\b(netherlands|holland|amsterdam|rotterdam|utrecht|eindhoven|the hague)\b/i],
  ['ES', /\b(spain|españa|madrid|barcelona|valencia|sevilla|málaga)\b/i],
  ['PL', /\b(poland|polska|warsaw|warszawa|kraków|krakow|wrocław|wroclaw|poznań|gdańsk)\b/i],
  ['IT', /\b(italy|italia|rome|roma|milan|milano|turin|torino|naples|bologna)\b/i],
  ['KR', /\b(south korea|korea|seoul|busan|한국|서울)\b/i],
  ['MX', /\b(mexico|méxico|mexico city|cdmx|guadalajara|monterrey)\b/i],
  ['TR', /\b(turkey|türkiye|istanbul|ankara|izmir)\b/i],
  ['AU', /\b(australia|sydney|melbourne|brisbane|perth|canberra)\b/i],
  ['VN', /\b(vietnam|viet nam|hanoi|ho chi minh|saigon|da nang)\b/i],
  ['NG', /\b(nigeria|lagos|abuja|ibadan)\b/i],
  ['MA', /\b(morocco|maroc|casablanca|rabat|marrakech|marrakesh|fes|fès|tangier|tanger|agadir)\b/i],
  ['EG', /\b(egypt|cairo|alexandria|giza|مصر|القاهرة)\b/i],
  ['ZA', /\b(south africa|cape town|johannesburg|pretoria|durban)\b/i],
];

export function locationToIso2(location: string | null | undefined): string | null {
  if (!location) return null;
  for (const [iso2, re] of COUNTRY_PATTERNS) {
    if (re.test(location)) return iso2;
  }
  return null;
}
