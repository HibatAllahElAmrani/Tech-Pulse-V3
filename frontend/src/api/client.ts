/**
 * Client API centralisé (Fetch natif).
 *
 * - baseURL : VITE_API_URL (env) ; en Docker, le nginx du frontend proxifie
 *   /api → backend, donc la valeur par défaut relative "/api/v1" fonctionne
 *   sans CORS. En dev Vite, le proxy de vite.config.ts fait pareil.
 * - "Intercepteur" requête : injection automatique du JWT s'il existe.
 * - "Intercepteur" réponse : normalisation des erreurs en ApiError
 *   { status, message, details } pour une gestion uniforme dans l'UI.
 * - Timeout de 15 s pour ne jamais bloquer l'interface.
 */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const TOKEN_KEY = "osspulse.jwt";
export const auth = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (jwt: string) => localStorage.setItem(TOKEN_KEY, jwt),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const token = auth.get();
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    if (!res.ok) {
      let body: any = {};
      try {
        body = await res.json();
      } catch {
        /* réponse non-JSON */
      }
      if (res.status === 401) auth.clear(); // jeton expiré → purge
      throw new ApiError(res.status, body.error ?? res.statusText, body.details);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error).name === "AbortError") throw new ApiError(0, "Request timed out");
    throw new ApiError(0, "Network error — is the backend running?");
  } finally {
    clearTimeout(timer);
  }
}
