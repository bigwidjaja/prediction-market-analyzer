import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  StatCard,
  Td,
  Th,
} from "../components/ui";
import {
  formatCents,
  formatDelta,
  formatPct,
  formatUsd,
  marketById,
} from "../data/markets";
import { palette } from "../theme";

export function MarketDetailPage() {
  const { id } = useParams();
  const market = id ? marketById(id) : undefined;
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("100");

  if (!market) {
    return (
      <Card className="p-4">
        <h2 className="text-base font-medium">Market not found</h2>
        <p className="mt-1 text-sm text-text-muted">
          This market may have resolved or been delisted.
        </p>
        <Link to="/" className="mt-3 inline-block text-sm text-accent">
          Back to markets
        </Link>
      </Card>
    );
  }

  const price = side === "YES" ? market.yesPrice : 1 - market.yesPrice;
  const shares = Number(amount || 0) / price;
  const payout = shares * 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="accent">{market.category}</Badge>
            {market.closingSoon ? (
              <Badge tone="warning">Closing soon</Badge>
            ) : null}
          </div>
          <h1 className="mt-2 text-lg font-semibold">{market.question}</h1>
          <p className="mt-1 text-sm text-text-muted">
            Closes {market.closes} · Liquidity {formatUsd(market.liquidity)}
          </p>
        </div>
        <Button variant="ghost">
          <Link to="/">← All markets</Link>
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Yes probability"
          value={formatPct(market.yesPrice)}
          delta={`${formatDelta(market.change24h)} today`}
          deltaTone={market.change24h >= 0 ? "success" : "error"}
        />
        <StatCard label="Yes price" value={formatCents(market.yesPrice)} />
        <StatCard label="No price" value={formatCents(1 - market.yesPrice)} />
        <StatCard label="24h volume" value={formatUsd(market.volume24h)} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2 p-0">
          <CardHeader title="Yes price — last 30 days" />
          <div className="p-4">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={market.history}>
                <defs>
                  <linearGradient id="yesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={palette.accentMuted} />
                    <stop offset="100%" stopColor={palette.bg} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={palette.border} vertical={false} />
                <XAxis
                  dataKey="t"
                  stroke={palette.border}
                  tick={{ fill: palette.textFaint, fontSize: 11 }}
                  tickLine={false}
                  interval={6}
                />
                <YAxis
                  domain={[0, 1]}
                  stroke={palette.border}
                  tick={{ fill: palette.textFaint, fontSize: 11 }}
                  tickLine={false}
                  tickFormatter={(v: number) => formatPct(v)}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: palette.raised,
                    border: `1px solid ${palette.border}`,
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                  labelStyle={{ color: palette.textMuted }}
                  itemStyle={{ color: palette.text }}
                  formatter={(v) => [formatPct(Number(v)), "Yes"]}
                />
                <Area
                  type="monotone"
                  dataKey="yes"
                  stroke={palette.accent}
                  strokeWidth={2}
                  fill="url(#yesFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-base font-medium">Trade</h2>
          <div className="mt-3 flex gap-2">
            <Button
              variant={side === "YES" ? "primary" : "secondary"}
              className="flex-1 justify-center"
              onClick={() => setSide("YES")}
            >
              Yes {formatCents(market.yesPrice)}
            </Button>
            <Button
              variant={side === "NO" ? "primary" : "secondary"}
              className="flex-1 justify-center"
              onClick={() => setSide("NO")}
            >
              No {formatCents(1 - market.yesPrice)}
            </Button>
          </div>
          <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-text-muted">
            Amount (USD)
          </label>
          <Input
            className="mt-2 w-full"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.00"
          />
          <div className="mt-4 flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Est. shares</span>
              <span className="num">{shares.toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Payout if {side}</span>
              <span className="num text-success">{formatUsd(payout)}</span>
            </div>
          </div>
          <Button variant="primary" className="mt-4 w-full justify-center">
            Buy {side}
          </Button>
          <p className="mt-3 text-xs text-text-faint">
            Demo only — orders are not routed anywhere.
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-0">
          <CardHeader title="Bids" description="Buy YES" />
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <Th>Price</Th>
                <Th align="right">Shares</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {market.bids.map((level, i) => (
                <tr
                  key={level.price}
                  className={i < market.bids.length - 1 ? "border-b border-border" : ""}
                >
                  <Td numeric className="text-success">
                    {formatCents(level.price)}
                  </Td>
                  <Td align="right" numeric>
                    {level.shares.toLocaleString()}
                  </Td>
                  <Td align="right" numeric>
                    {formatUsd(level.shares * level.price)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-0">
          <CardHeader title="Asks" description="Sell YES" />
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <Th>Price</Th>
                <Th align="right">Shares</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {market.asks.map((level, i) => (
                <tr
                  key={level.price}
                  className={i < market.asks.length - 1 ? "border-b border-border" : ""}
                >
                  <Td numeric className="text-error">
                    {formatCents(level.price)}
                  </Td>
                  <Td align="right" numeric>
                    {level.shares.toLocaleString()}
                  </Td>
                  <Td align="right" numeric>
                    {formatUsd(level.shares * level.price)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
