/* Typed client for the read-only pipeline API (api/app.py).
 *
 * In docker compose the dashboard is served by nginx which proxies /api to
 * the api service; in `npm run dev` the Vite dev server proxies it instead
 * (see vite.config.ts). Either way the app can always fetch same-origin.
 */

export interface EventSummary {
  event_id: string;
  kalshi_ticker: string;
  polymarket_slug: string;
  description: string | null;
  kalshi_probability: number | null;
  kalshi_updated_at: string | null;
  polymarket_probability: number | null;
  polymarket_updated_at: string | null;
  delta: number | null;
  signals_24h: number;
  max_delta_24h: number | null;
  last_signal_at: string | null;
}

export interface PriceReading {
  venue: "kalshi" | "polymarket";
  probability: number;
  timestamp: string;
}

export interface Signal {
  matched_event_id: string;
  kalshi_probability: number;
  polymarket_probability: number;
  delta: number;
  timestamp: string;
  detected_at: string;
}

export interface SummaryRow {
  summary_date: string;
  matched_event_id: string;
  max_delta: number | null;
  signal_count: number;
  reading_count: number;
  computed_at: string;
}

export interface VenueHealth {
  recent_readings: number;
  latest_reading_at: string | null;
  fresh: boolean;
}

export interface Health {
  status: string;
  freshness_window_minutes: number;
  mispricing_threshold: number;
  venues: Record<string, VenueHealth>;
}

async function get<T>(path: string): Promise<T> {
  const resp = await fetch(path, { headers: { Accept: "application/json" } });
  if (!resp.ok) {
    throw new Error(`GET ${path} failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json() as Promise<T>;
}

export const api = {
  health: () => get<Health>("/api/health"),
  events: () => get<EventSummary[]>("/api/events"),
  event: (id: string) => get<EventSummary>(`/api/events/${encodeURIComponent(id)}`),
  eventPrices: (id: string, hours: number) =>
    get<PriceReading[]>(`/api/events/${encodeURIComponent(id)}/prices?hours=${hours}`),
  eventSignals: (id: string, limit = 50) =>
    get<Signal[]>(`/api/events/${encodeURIComponent(id)}/signals?limit=${limit}`),
  signals: (limit = 100) => get<Signal[]>(`/api/signals?limit=${limit}`),
  summary: (days = 14) => get<SummaryRow[]>(`/api/summary?days=${days}`),
};
