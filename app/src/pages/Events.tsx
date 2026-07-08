import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { usePoll } from "../hooks";
import { formatAgo, formatPct, formatPp } from "../format";
import { Badge, Card, CardHeader, Input, StatCard, Td, Th } from "../components/ui";

export function EventsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const events = usePoll(api.events);
  const health = usePoll(api.health);
  const threshold = health.data?.mispricing_threshold ?? 0.05;

  const filtered = useMemo(() => {
    const all = events.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((e) =>
      [e.event_id, e.description ?? "", e.kalshi_ticker, e.polymarket_slug]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [events.data, query]);

  if (events.error && !events.data) {
    return (
      <Card className="p-4">
        <h2 className="text-base font-medium">Cannot reach the API</h2>
        <p className="mt-1 text-sm text-text-muted">{events.error}</p>
        <p className="mt-2 text-sm text-text-faint">
          Is the stack running? <code>docker compose up -d --build</code>
        </p>
      </Card>
    );
  }

  const all = events.data ?? [];
  const signals24h = all.reduce((sum, e) => sum + e.signals_24h, 0);
  const widest = all.reduce(
    (a, b) => ((b.delta ?? -1) > (a?.delta ?? -1) ? b : a),
    all[0],
  );
  const liveDeltas = all.filter((e) => e.delta !== null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Cross-venue matched events</h1>
        <p className="mt-1 text-sm text-text-muted">
          The same real-world event priced on Kalshi and Polymarket. A delta above{" "}
          {formatPp(threshold)} is flagged as a mispricing signal.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Events tracked" value={String(all.length)} />
        <StatCard
          label="Live deltas"
          value={liveDeltas.length ? String(liveDeltas.length) : "—"}
          delta={liveDeltas.length < all.length ? "some venues quiet" : undefined}
          deltaTone="error"
        />
        <StatCard
          label="Widest delta"
          value={widest ? formatPp(widest.delta) : "—"}
          delta={widest?.description ?? widest?.event_id}
          deltaTone={(widest?.delta ?? 0) > threshold ? "error" : "success"}
        />
        <StatCard
          label="Signals (24h)"
          value={String(signals24h)}
          delta={signals24h === 0 ? "markets in agreement" : "divergence detected"}
          deltaTone={signals24h === 0 ? "success" : "error"}
        />
      </div>

      <Card className="p-0">
        <CardHeader
          title="Matched events"
          description={
            events.loading ? "Loading…" : `${filtered.length} of ${all.length} pairs`
          }
          actions={
            <Input
              placeholder="Search events…"
              className="w-60"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          }
        />
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <Th>Event</Th>
              <Th align="right">Kalshi p(YES)</Th>
              <Th align="right">Polymarket p(YES)</Th>
              <Th align="right">Delta</Th>
              <Th align="right">Signals 24h</Th>
              <Th align="right">Updated</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => {
              const above = (e.delta ?? 0) > threshold;
              const updated =
                [e.kalshi_updated_at, e.polymarket_updated_at]
                  .filter((t): t is string => t !== null)
                  .sort()
                  .pop() ?? null;
              return (
                <tr
                  key={e.event_id}
                  className={[
                    "cursor-pointer transition-colors hover:bg-raised",
                    i < filtered.length - 1 ? "border-b border-border" : "",
                  ].join(" ")}
                  onClick={() => navigate(`/event/${e.event_id}`)}
                >
                  <Td className="font-medium">
                    <span className="flex flex-col">
                      <span>{e.description || e.event_id}</span>
                      <span className="num text-xs text-text-faint">{e.event_id}</span>
                    </span>
                  </Td>
                  <Td align="right" numeric>
                    {formatPct(e.kalshi_probability)}
                  </Td>
                  <Td align="right" numeric>
                    {formatPct(e.polymarket_probability)}
                  </Td>
                  <Td align="right" numeric>
                    {e.delta === null ? (
                      <span className="text-text-faint">—</span>
                    ) : above ? (
                      <Badge tone="error">{formatPp(e.delta)}</Badge>
                    ) : (
                      formatPp(e.delta)
                    )}
                  </Td>
                  <Td align="right" numeric>
                    {e.signals_24h > 0 ? (
                      <Badge tone="warning">{e.signals_24h}</Badge>
                    ) : (
                      <span className="text-text-faint">0</span>
                    )}
                  </Td>
                  <Td align="right" numeric className="text-text-muted">
                    {formatAgo(updated)}
                  </Td>
                </tr>
              );
            })}
            {!events.loading && filtered.length === 0 ? (
              <tr>
                <Td className="text-text-muted">
                  {all.length === 0
                    ? "No matched events yet — has the config-loader run?"
                    : "No events match your search."}
                </Td>
                <Td /> <Td /> <Td /> <Td /> <Td />
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
