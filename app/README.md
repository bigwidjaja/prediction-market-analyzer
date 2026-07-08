# Mispricing Detector — dashboard

React + TypeScript + Tailwind front end for the cross-venue mispricing
pipeline. It renders live data from the read-only API (`../api`), which in
turn reads the Postgres tables written by the streaming pipeline. All visual
decisions follow [`../DESIGN.md`](../DESIGN.md); do not introduce colors, font
sizes, spacing steps, or radii that are not defined there.

## Screens

- `/` — Matched events: latest Kalshi/Polymarket probabilities per pair, live
  delta vs the detection threshold, 24h signal counts, per-venue freshness.
- `/event/:id` — Event detail: dual-venue probability chart (6h–7d ranges),
  current/max delta, recent signals for the event.
- `/signals` — All recent mispricing signals (CSV export) and the Airflow
  daily rollup table.

## Run

The full stack (including this dashboard, served by nginx on
<http://localhost:3000>) comes up with:

```bash
docker compose up -d --build     # from the repository root
```

## Develop with hot reload

With the compose stack running (the dev server proxies `/api` to
`localhost:8000`, see `vite.config.ts`):

```bash
npm install
npm run dev     # http://localhost:5173
npm run build
npm run lint
```
