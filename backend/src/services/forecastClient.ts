import { getEnv } from '../config/env.js';

/**
 * Client du micro-service IA de prévision (FastAPI, Holt damped trend).
 *
 * Contrat : POST {AI_SERVICE_URL}/forecast
 *   body    { series: number[], horizon: number, clamp_min, clamp_max }
 *   réponse { mid, lo, hi, model, params }
 *
 * Tolérance aux pannes : timeout court (2,5 s) + retour `null` sur toute
 * erreur — l'appelant retombe alors sur le générateur déterministe. Le
 * service IA est un enrichissement, jamais un point de défaillance.
 */

export interface AiForecast {
  mid: number[];
  lo: number[];
  hi: number[];
  model: string;
  params: Record<string, number>;
}

export async function aiForecast(series: number[], horizon = 6): Promise<AiForecast | null> {
  const env = getEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  try {
    const res = await fetch(`${env.AI_SERVICE_URL}/forecast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ series, horizon, clamp_min: 5, clamp_max: 99 }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AiForecast;
    if (
      !Array.isArray(data.mid) || data.mid.length !== horizon ||
      !Array.isArray(data.lo) || !Array.isArray(data.hi)
    ) {
      return null;
    }
    return data;
  } catch {
    return null; // service indisponible → fallback déterministe côté route
  } finally {
    clearTimeout(timer);
  }
}
