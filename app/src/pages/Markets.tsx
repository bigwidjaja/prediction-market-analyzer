import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, CardHeader, StatCard, Td, Th } from "../components/ui";
import {
  formatCents,
  formatDelta,
  formatUsd,
  markets,
  type Category,
} from "../data/markets";

const categories: Array<Category | "All"> = [
  "All",
  "Politics",
  "Crypto",
  "Sports",
  "Science",
  "Economy",
];

export function MarketsPage() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<Category | "All">("All");

  const filtered = useMemo(
    () =>
      category === "All"
        ? markets
        : markets.filter((m) => m.category === category),
    [category],
  );

  const totalVolume = markets.reduce((sum, m) => sum + m.volume24h, 0);
  const totalLiquidity = markets.reduce((sum, m) => sum + m.liquidity, 0);
  const biggestMover = markets.reduce((a, b) =>
    Math.abs(b.change24h) > Math.abs(a.change24h) ? b : a,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Markets</h1>
        <p className="mt-1 text-sm text-text-muted">
          Live prediction markets, ranked by 24h volume.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Open markets" value={String(markets.length)} />
        <StatCard
          label="24h volume"
          value={formatUsd(totalVolume)}
          delta="+12% vs yesterday"
          deltaTone="success"
        />
        <StatCard label="Total liquidity" value={formatUsd(totalLiquidity)} />
        <StatCard
          label="Biggest mover"
          value={formatDelta(biggestMover.change24h)}
          delta={biggestMover.question.slice(0, 34) + "…"}
          deltaTone={biggestMover.change24h >= 0 ? "success" : "error"}
        />
      </div>

      <Card className="p-0">
        <CardHeader
          title="All markets"
          description={`${filtered.length} markets`}
          actions={
            <div className="flex gap-2">
              {categories.map((c) => (
                <Button
                  key={c}
                  variant={c === category ? "primary" : "ghost"}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </Button>
              ))}
            </div>
          }
        />
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <Th>Market</Th>
              <Th>Category</Th>
              <Th align="right">Yes price</Th>
              <Th align="right">24h change</Th>
              <Th align="right">24h volume</Th>
              <Th align="right">Liquidity</Th>
              <Th>Closes</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m, i) => (
              <tr
                key={m.id}
                className={[
                  "cursor-pointer transition-colors hover:bg-raised",
                  i < filtered.length - 1 ? "border-b border-border" : "",
                ].join(" ")}
                onClick={() => navigate(`/market/${m.id}`)}
              >
                <Td className="font-medium">{m.question}</Td>
                <Td>
                  <Badge tone="accent">{m.category}</Badge>
                </Td>
                <Td align="right" numeric>
                  {formatCents(m.yesPrice)}
                </Td>
                <Td
                  align="right"
                  numeric
                  className={m.change24h >= 0 ? "text-success" : "text-error"}
                >
                  {formatDelta(m.change24h)}
                </Td>
                <Td align="right" numeric>
                  {formatUsd(m.volume24h)}
                </Td>
                <Td align="right" numeric>
                  {formatUsd(m.liquidity)}
                </Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="text-text-muted">{m.closes}</span>
                    {m.closingSoon ? (
                      <Badge tone="warning">Closing soon</Badge>
                    ) : null}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
