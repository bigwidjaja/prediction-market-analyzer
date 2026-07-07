import { Link } from "react-router-dom";
import { Badge, Button, Card, CardHeader, StatCard, Td, Th } from "../components/ui";
import {
  formatCents,
  formatUsd,
  marketById,
  positionCost,
  positionValue,
  positions,
} from "../data/markets";

export function PortfolioPage() {
  const totalValue = positions.reduce((sum, p) => sum + positionValue(p), 0);
  const totalCost = positions.reduce((sum, p) => sum + positionCost(p), 0);
  const totalPnl = totalValue - totalCost;
  const pnlPct = (totalPnl / totalCost) * 100;
  const winners = positions.filter(
    (p) => positionValue(p) - positionCost(p) > 0,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Portfolio</h1>
        <p className="mt-1 text-sm text-text-muted">
          Open positions across {positions.length} markets.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Portfolio value" value={formatUsd(totalValue)} />
        <StatCard
          label="Unrealized P&L"
          value={`${totalPnl >= 0 ? "+" : ""}${formatUsd(totalPnl)}`}
          delta={`${totalPnl >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% all time`}
          deltaTone={totalPnl >= 0 ? "success" : "error"}
        />
        <StatCard label="Cost basis" value={formatUsd(totalCost)} />
        <StatCard
          label="Winning positions"
          value={`${winners} / ${positions.length}`}
        />
      </div>

      <Card className="p-0">
        <CardHeader
          title="Open positions"
          actions={<Button variant="secondary">Export CSV</Button>}
        />
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <Th>Market</Th>
              <Th>Side</Th>
              <Th align="right">Shares</Th>
              <Th align="right">Avg price</Th>
              <Th align="right">Mark</Th>
              <Th align="right">Value</Th>
              <Th align="right">P&L</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => {
              const market = marketById(p.marketId);
              if (!market) return null;
              const mark = p.side === "YES" ? market.yesPrice : 1 - market.yesPrice;
              const value = positionValue(p);
              const pnl = value - positionCost(p);
              return (
                <tr
                  key={p.marketId}
                  className={i < positions.length - 1 ? "border-b border-border" : ""}
                >
                  <Td className="font-medium">
                    <Link
                      to={`/market/${market.id}`}
                      className="transition-colors hover:text-accent"
                    >
                      {market.question}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={p.side === "YES" ? "success" : "error"}>
                      {p.side}
                    </Badge>
                  </Td>
                  <Td align="right" numeric>
                    {p.shares.toLocaleString()}
                  </Td>
                  <Td align="right" numeric>
                    {formatCents(p.avgPrice)}
                  </Td>
                  <Td align="right" numeric>
                    {formatCents(mark)}
                  </Td>
                  <Td align="right" numeric>
                    {formatUsd(value)}
                  </Td>
                  <Td
                    align="right"
                    numeric
                    className={pnl >= 0 ? "text-success" : "text-error"}
                  >
                    {pnl >= 0 ? "+" : ""}
                    {formatUsd(pnl)}
                  </Td>
                  <Td align="right">
                    <Button variant="danger">Close</Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
