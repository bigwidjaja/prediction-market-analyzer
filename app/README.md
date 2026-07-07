# Prediction Market Analyzer — UI

React + TypeScript + Tailwind app. All visual decisions follow
[`../DESIGN.md`](../DESIGN.md); do not introduce colors, font sizes, spacing
steps, or radii that are not defined there.

## Screens

- `/` — Markets dashboard (stats, filterable market table)
- `/market/:id` — Market detail (price chart, trade panel, order book)
- `/portfolio` — Portfolio (P&L stats, open positions)

## Develop

```bash
npm install
npm run dev     # http://localhost:5173
npm run build
npm run lint
```
