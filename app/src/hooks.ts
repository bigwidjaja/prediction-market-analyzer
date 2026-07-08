import { useCallback, useEffect, useRef, useState } from "react";

export interface Poll<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/* Fetch on mount and re-fetch every `intervalMs` (readings land every ~45s,
 * so a 30s poll keeps the dashboard near-live without a websocket). Previous
 * data stays on screen during refreshes; errors only clear it if the very
 * first load failed. */
export function usePoll<T>(fetcher: () => Promise<T>, intervalMs = 30_000): Poll<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const result = await fetcherRef.current();
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    const timer = setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, refresh };
}
