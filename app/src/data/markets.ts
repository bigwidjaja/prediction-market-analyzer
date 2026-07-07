export type Category = "Politics" | "Crypto" | "Sports" | "Science" | "Economy";

export interface PricePoint {
  t: string;
  yes: number;
}

export interface OrderLevel {
  price: number;
  shares: number;
}

export interface Market {
  id: string;
  question: string;
  category: Category;
  yesPrice: number; // 0..1
  change24h: number; // absolute delta in price
  volume24h: number; // USD
  liquidity: number; // USD
  closes: string;
  closingSoon: boolean;
  history: PricePoint[];
  bids: OrderLevel[];
  asks: OrderLevel[];
}

export interface Position {
  marketId: string;
  side: "YES" | "NO";
  shares: number;
  avgPrice: number;
}

function series(seed: number, base: number, drift: number): PricePoint[] {
  const points: PricePoint[] = [];
  let value = base;
  let s = seed;
  for (let i = 0; i < 30; i += 1) {
    s = (s * 9301 + 49297) % 233280;
    const noise = (s / 233280 - 0.5) * 0.06;
    value = Math.min(0.97, Math.max(0.03, value + drift + noise));
    const day = i + 1;
    points.push({ t: `Jun ${day}`, yes: Number(value.toFixed(3)) });
  }
  return points;
}

function book(mid: number): { bids: OrderLevel[]; asks: OrderLevel[] } {
  const bids: OrderLevel[] = [];
  const asks: OrderLevel[] = [];
  for (let i = 1; i <= 5; i += 1) {
    bids.push({
      price: Number((mid - i * 0.01).toFixed(2)),
      shares: 900 - i * 120 + (i % 2) * 260,
    });
    asks.push({
      price: Number((mid + i * 0.01).toFixed(2)),
      shares: 820 - i * 100 + (i % 3) * 210,
    });
  }
  return { bids, asks };
}

export const markets: Market[] = [
  {
    id: "fed-cut-sept",
    question: "Will the Fed cut rates at the September 2026 meeting?",
    category: "Economy",
    yesPrice: 0.72,
    change24h: 0.041,
    volume24h: 1_842_000,
    liquidity: 412_000,
    closes: "Sep 16, 2026",
    closingSoon: false,
    history: series(7, 0.55, 0.006),
    ...book(0.72),
  },
  {
    id: "btc-150k",
    question: "Will Bitcoin close above $150,000 on July 31, 2026?",
    category: "Crypto",
    yesPrice: 0.34,
    change24h: -0.028,
    volume24h: 3_205_000,
    liquidity: 688_000,
    closes: "Jul 31, 2026",
    closingSoon: true,
    history: series(21, 0.45, -0.004),
    ...book(0.34),
  },
  {
    id: "eth-etf-inflows",
    question: "Will ETH ETF net inflows exceed $10B in 2026?",
    category: "Crypto",
    yesPrice: 0.58,
    change24h: 0.012,
    volume24h: 964_000,
    liquidity: 251_000,
    closes: "Dec 31, 2026",
    closingSoon: false,
    history: series(33, 0.5, 0.003),
    ...book(0.58),
  },
  {
    id: "us-recession-2026",
    question: "Will the US enter a recession before the end of 2026?",
    category: "Economy",
    yesPrice: 0.19,
    change24h: -0.015,
    volume24h: 1_120_000,
    liquidity: 340_000,
    closes: "Dec 31, 2026",
    closingSoon: false,
    history: series(45, 0.27, -0.003),
    ...book(0.19),
  },
  {
    id: "starship-mars-flyby",
    question: "Will SpaceX launch an uncrewed Mars flyby mission by 2027?",
    category: "Science",
    yesPrice: 0.41,
    change24h: 0.062,
    volume24h: 742_000,
    liquidity: 198_000,
    closes: "Dec 31, 2027",
    closingSoon: false,
    history: series(59, 0.3, 0.004),
    ...book(0.41),
  },
  {
    id: "wc-final-brazil",
    question: "Will Brazil reach the 2026 World Cup final?",
    category: "Sports",
    yesPrice: 0.27,
    change24h: 0.008,
    volume24h: 2_410_000,
    liquidity: 520_000,
    closes: "Jul 19, 2026",
    closingSoon: true,
    history: series(71, 0.24, 0.001),
    ...book(0.27),
  },
  {
    id: "senate-flip",
    question: "Will control of the US Senate flip in the 2026 midterms?",
    category: "Politics",
    yesPrice: 0.48,
    change24h: -0.006,
    volume24h: 1_980_000,
    liquidity: 455_000,
    closes: "Nov 3, 2026",
    closingSoon: false,
    history: series(83, 0.51, -0.001),
    ...book(0.48),
  },
  {
    id: "agi-benchmark",
    question: "Will a public model score >95% on ARC-AGI-2 by end of 2026?",
    category: "Science",
    yesPrice: 0.63,
    change24h: 0.094,
    volume24h: 4_870_000,
    liquidity: 902_000,
    closes: "Dec 31, 2026",
    closingSoon: false,
    history: series(97, 0.4, 0.008),
    ...book(0.63),
  },
];

export const positions: Position[] = [
  { marketId: "fed-cut-sept", side: "YES", shares: 2500, avgPrice: 0.61 },
  { marketId: "btc-150k", side: "NO", shares: 4000, avgPrice: 0.6 },
  { marketId: "agi-benchmark", side: "YES", shares: 1200, avgPrice: 0.44 },
  { marketId: "wc-final-brazil", side: "NO", shares: 3100, avgPrice: 0.71 },
  { marketId: "senate-flip", side: "YES", shares: 800, avgPrice: 0.52 },
];

export function marketById(id: string): Market | undefined {
  return markets.find((m) => m.id === id);
}

export function positionValue(p: Position): number {
  const market = marketById(p.marketId);
  if (!market) return 0;
  const price = p.side === "YES" ? market.yesPrice : 1 - market.yesPrice;
  return p.shares * price;
}

export function positionCost(p: Position): number {
  return p.shares * p.avgPrice;
}

export function formatUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(2)}`;
}

export function formatCents(price: number): string {
  return `${Math.round(price * 100)}¢`;
}

export function formatPct(price: number): string {
  return `${Math.round(price * 100)}%`;
}

export function formatDelta(delta: number): string {
  const pts = Math.round(Math.abs(delta) * 100);
  return `${delta >= 0 ? "+" : "-"}${pts} pt${pts === 1 ? "" : "s"}`;
}
