import type { ApiError } from "@/api/client";

/**
 * États asynchrones partagés : squelette de chargement et bloc d'erreur avec
 * retry. Chaque visualisation branchée sur l'API rend <ChartLoader/> pendant
 * le fetch et <ChartError/> en cas d'échec — jamais d'écran cassé.
 */

export function ChartLoader({ height = 300 }: { height?: number | string }) {
  return (
    <div
      className="flex w-full items-center justify-center"
      style={{ height }}
      role="status"
      aria-label="Loading chart"
    >
      <div className="flex items-center gap-2 text-xs text-mute">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
        loading…
      </div>
    </div>
  );
}

export function ChartError({
  error,
  retry,
  height = 300,
}: {
  error: ApiError;
  retry: () => void;
  height?: number | string;
}) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-2" style={{ height }}>
      <p className="text-xs text-mute">Couldn't load data — {error.message}</p>
      <button
        onClick={retry}
        className="rounded-full border border-edge px-3 py-1 text-xs text-ink transition-colors hover:border-accent/50"
      >
        Retry
      </button>
    </div>
  );
}
