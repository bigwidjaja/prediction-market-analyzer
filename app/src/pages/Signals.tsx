import { Link } from "react-router-dom";
import { api } from "../api";
import { usePoll } from "../hooks";
import { formatAgo, formatPct, formatPp, formatTime } from "../format";
import { Badge, Button, Card, CardHeader, StatCard, Td, Th } from "../components/ui";

function exportCsv<T extends object>(rows: T[], filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]) as Array<keyof T>;
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SignalsPage() {
  const signals = usePoll(api.signals);
  const summary = usePoll(api.summary);
  const health = usePoll(api.health);
  const threshold = health.data?.mispricing_threshold ?? 0.05;

  const rows = signals.data ?? [];
  const summaryRows = summary.data ?? [];
  const maxDelta = rows.reduce((m, s) => Math.max(m, s.delta), 0);
  const last24h = rows.filter(
    (s) => Date.now() - new Date(s.timestamp).getTime() < 24 * 3600 * 1000,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Mispricing signals</h1>
        <p className="mt-1 text-sm text-text-muted">
          Every moment the cross-venue probability delta exceeded {formatPp(threshold)}.
          An empty table means the venues agree — the detector&apos;s normal resting
          state.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Signals (recent)" value={String(rows.length)} />
        <StatCard label="Signals (24h)" value={String(last24h)} />
        <StatCard
          label="Widest delta seen"
          value={rows.length ? formatPp(maxDelta) : "—"}
        />
        <StatCard label="Detection threshold" value={formatPp(threshold)} />
      </div>

      <Card className="p-0">
        <CardHeader
          title="Recent signals"
          description={signals.loading ? "Loading…" : `${rows.length} signals`}
          actions={
            <Button
              variant="secondary"
              disabled={rows.length === 0}
              onClick={() => exportCsv(rows, "mispricing_signals.csv")}
            >
              Export CSV
            </Button>
          }
        />
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <Th>Event</Th>
              <Th>Event time</Th>
              <Th align="right">Kalshi</Th>
              <Th align="right">Polymarket</Th>
              <Th align="right">Delta</Th>
              <Th align="right">Detected</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr
                key={`${s.matched_event_id}-${s.timestamp}-${i}`}
                className={i < rows.length - 1 ? "border-b border-border" : ""}
              >
                <Td className="font-medium">
                  <Link
                    to={`/event/${s.matched_event_id}`}
                    className="transition-colors hover:text-accent"
                  >
                    {s.matched_event_id}
                  </Link>
                </Td>
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
            {!signals.loading && rows.length === 0 ? (
              <tr>
                <Td className="text-text-muted">
                  No signals yet. Real cross-venue deltas are usually below the
                  threshold; see the README for how to inject a test reading.
                </Td>
                <Td /> <Td /> <Td /> <Td /> <Td />
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      <Card className="p-0">
        <CardHeader
          title="Daily rollup"
          description="Per-event daily aggregates maintained by the Airflow DAG"
        />
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <Th>Date</Th>
              <Th>Event</Th>
              <Th align="right">Max delta</Th>
              <Th align="right">Signals</Th>
              <Th align="right">Readings</Th>
              <Th align="right">Computed</Th>
            </tr>
          </thead>
          <tbody>
            {summaryRows.map((r, i) => (
              <tr
                key={`${r.summary_date}-${r.matched_event_id}`}
                className={i < summaryRows.length - 1 ? "border-b border-border" : ""}
              >
                <Td numeric>{r.summary_date}</Td>
                <Td className="font-medium">
                  <Link
                    to={`/event/${r.matched_event_id}`}
                    className="transition-colors hover:text-accent"
                  >
                    {r.matched_event_id}
                  </Link>
                </Td>
                <Td align="right" numeric>
                  {formatPp(r.max_delta)}
                </Td>
                <Td align="right" numeric>
                  {r.signal_count}
                </Td>
                <Td align="right" numeric>
                  {r.reading_count.toLocaleString()}
                </Td>
                <Td align="right" numeric className="text-text-muted">
                  {formatAgo(r.computed_at)}
                </Td>
              </tr>
            ))}
            {!summary.loading && summaryRows.length === 0 ? (
              <tr>
                <Td className="text-text-muted">
                  No rollup rows yet — unpause the <code>pipeline_health</code> DAG in
                  Airflow.
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
