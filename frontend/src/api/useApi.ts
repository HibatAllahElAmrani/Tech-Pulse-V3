import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./client";

/**
 * Hook générique d'appel API avec les trois états canoniques
 * loading / error / success, et un cache mémoire par clé pour éviter de
 * re-télécharger une réponse déjà vue dans la session (les endpoints
 * analytiques sont déterministes et déjà cachés côté serveur).
 */

const memCache = new Map<string, unknown>();

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

export function useApi<T>(key: string, fetcher: () => Promise<T>, enabled = true): ApiState<T> {
  const [data, setData] = useState<T | null>(() => (memCache.get(key) as T) ?? null);
  const [loading, setLoading] = useState(enabled && !memCache.has(key));
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) return;
    if (tick === 0 && memCache.has(key)) {
      setData(memCache.get(key) as T);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((d) => {
        if (cancelled) return;
        memCache.set(key, d);
        setData(d);
        setLoading(false);
      })
      .catch((e: ApiError) => {
        if (cancelled) return;
        setError(e);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key, enabled, tick]);

  const reload = useCallback(() => {
    memCache.delete(key);
    setTick((t) => t + 1);
  }, [key]);

  return { data, loading, error, reload };
}
