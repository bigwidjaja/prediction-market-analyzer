import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import { usePoll } from "../hooks";
import { formatAgo, formatPct, formatPp, formatTime } from "../format";
import { Badge, Button, Card, CardHeader, StatCard, Td, Th } from "../components/ui";
import { palette } from "../theme";

const RANGES = [
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "3d", hours: 72 },
  { label: "7d", hours: 168 },
];

interface ChartPoint {
  t: number;
  kalshi?: number;
  polymarket?: number;
}

export function EventDetailPage() {
  const { id } = useParams();
  const eventId = id ?? "";
  const [hours, setHours] = useState(24);

  const event = usePoll(useCallback(() => api.event(eventId), [eventId]));
  const prices = usePoll(
    useCallback(() => api.eventPrices(eventId, hours), [eventId, hours]),
  );
  const signals = usePoll(useCallback(() => api.eventSignals(eventId), [eventId]));
  const health = usePoll(api.health);
  const threshold = health.data?.mispricing_threshold ?? 0.05;

  const chartData = useMemo<ChartPoint[]>(() => {
    const byTime = new Map<number, ChartPoint>();
    for (const r of prices.data ?? []) {
      const t = new Date(r.timestamp).getTime();
      const point = byTime.get(t) ?? { t };
      point[r.venue] = r.probability;
      byTime.set(t, point);
    }
    return [...byTime.values()].sort((a, b) => a.t - b.t);
  }, [prices.data]);

  if (event.error && !event.data) {
    return (
      <Card className="p-4">
        <h2 className="text-base font-medium">Event not found</h2>
        <p className="mt-1 text-sm text-text-muted">
          No matched event with id <code className="num">{eventId}</code>. It may have
          been removed from <code>config/matched_events.yaml</code>.
        </p>
        <Link to="/" className="mt-3 inline-block text-sm text-accent">
          Back to events
        </Link>
      </Card>
    );
  }

  const e = event.data;
  const above = (e?.delta ?? 0) > threshold;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            {above ? (
              <Badge tone="error">Mispriced {formatPp(e?.delta)}</Badge>
            ) : (
              <Badge tone="success">Within threshold</Badge>
            )}
            {(e?.signals_24h ?? 0) > 0 ? (
              <Badge tone="warning">{e?.signals_24h} signals in 24h</Badge>
            ) : null}
          </div>
          <h1 className="mt-2 text-lg font-semibold">
            {e?.description || eventId}
          </h1>
          <p className="num mt-1 text-sm text-text-muted">
            Kalshi <span className="text-text">{e?.kalshi_ticker ?? "…"}</span> ·
            Polymarket <span className="text-text">{e?.polymarket_slug ?? "…"}</span>
          </p>
        </div>
        <Link
          to="/"
          className="flex h-8 items-center rounded-md px-3 text-sm text-text-muted transition-colors hover:bg-raised hover:text-text"
        >
          ← All events
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Kalshi p(YES)"
          value={formatPct(e?.kalshi_probability)}
          delta={`updated ${formatAgo(e?.kalshi_updated_at)}`}
          deltaTone="success"
        />
        <StatCard
          label="Polymarket p(YES)"
          value={formatPct(e?.polymarket_probability)}
          delta={`updated ${formatAgo(e?.polymarket_updated_at)}`}
          deltaTone="success"
        />
        <StatCard
          label="Current delta"
          value={formatPp(e?.delta)}
          delta={`threshold ${formatPp(threshold)}`}
          deltaTone={above ? "error" : "success"}
        />
        <StatCard
          label="Max delta (24h)"
          value={formatPp(e?.max_delta_24h)}
          delta={
            e?.last_signal_at ? `last signal ${formatAgo(e.last_signal_at)}` : "no signals"
          }
          deltaTone={e?.last_signal_at ? "error" : "success"}
        />
      </div>

      <Card className="p-0">
        <CardHeader
          title="Implied YES probability by venue"
          description={
            prices.loading
              ? "Loading…"
              : `${(prices.data ?? []).length} readings in the window`
          }
          actions={
            <div className="flex gap-2">
              {RANGES.map((r) => (
                <Button
                  key={r.label}
                  variant={r.hours === hours ? "primary" : "ghost"}
                  onClick={() => setHours(r.hours)}
                >
                  {r.label}
                </Button>
              ))}
            </div>
          }
        />
        <div className="p-4">
          {chartData.length === 0 && !prices.loading ? (
            <p className="py-16 text-center text-sm text-text-muted">
              No readings in this window yet. The producer polls every ~45 seconds.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid stroke={palette.border} vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  stroke={palette.border}
                  tick={{ fill: palette.textFaint, fontSize: 11 }}
                  tickLine={false}
                  tickFormatter={(t: number) =>
                    new Date(t).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  }
                />
                <YAxis
                  domain={[0, 1]}
                  stroke={palette.border}
                  tick={{ fill: palette.textFaint, fontSize: 11 }}
                  tickLine={false}
                  tickFormatter={(v: number) => formatPct(v)}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: palette.raised,
                    border: `1px solid ${palette.border}`,
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                  labelStyle={{ color: palette.textMuted }}
                  labelFormatter={(t) => formatTime(new Date(Number(t)).toISOString())}
                  formatter={(v, name) => [formatPct(Number(v)), String(name)]}
                />
                <Legend
                  formatter={(value: string) => (
                    <span style={{ color: palette.textMuted, fontSize: 12 }}>{value}</span>
                  )}
                />
                <ReferenceLine y={0.5} stroke={palette.border} strokeDasharray="4 4" />
                <Line
                  type="stepAfter"
                  name="Kalshi"
                  dataKey="kalshi"
                  stroke={palette.accent}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="stepAfter"
                  name="Polymarket"
                  dataKey="polymarket"
                  stroke={palette.warning}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card className="p-0">
        <CardHeader
          title="Recent signals"
          description="Moments when the cross-venue delta exceeded the threshold"
        />
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <Th>Event time</Th>
              <Th align="right">Kalshi</Th>
              <Th align="right">Polymarket</Th>
              <Th align="right">Delta</Th>
              <Th align="right">Detected</Th>
            </tr>
          </thead>
          <tbody>
            {(signals.data ?? []).map((s, i, arr) => (
              <tr
                key={`${s.matched_event_id}-${s.timestamp}-${i}`}
                className={i < arr.length - 1 ? "border-b border-border" : ""}
              >
                <Td numeric>{formatTime(s.timestamp)}</Td>
                <Td align="right" numeric>
                  {formatPct(s.kalshi_probability)}
                </Td>
                <Td align="right" numeric>
                  {formatPct(s.polymarket_probability)}
                </Td>
                <Td align="right" numeric>
                  <Badge tone="error">{formatPp(s.delta)}</Badge>
                </Td>
                <Td align="right" numeric className="text-text-muted">
                  {formatAgo(s.detected_at)}
                </Td>
              </tr>
            ))}
            {!signals.loading && (signals.data ?? []).length === 0 ? (
              <tr>
                <Td className="text-text-muted">
                  No signals for this event — the venues agree (within{" "}
                  {formatPp(threshold)}).
                </Td>
                <Td /> <Td /> <Td /> <Td />
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
