# NEXT_STEPS.md — follow-up work

What remains after the v2 pass that unified the pipeline, API, and dashboard
into one tool. Ordered roughly by value.

## 1. Signal quality

- **Signal episodes.** While a real mispricing persists, the detector emits
  one signal per poll cycle (~every 45s). Aggregate contiguous signals into
  episodes with `started_at` / `ended_at` / `peak_delta`, either in the Spark
  job (stateful processing) or as an Airflow/SQL rollup. The dashboard would
  then show "3 episodes today" instead of a wall of near-identical rows.
- **Fee-aware thresholds.** Replace the flat 5pp threshold with per-venue fee
  modeling (Kalshi taker fee schedule, Polymarket gas/relayer costs) so the
  delta approximates executable edge. Requires storing bid/ask (see below).
- **Store bid/ask and book depth, not just the midpoint.** The producer
  already reads Kalshi's bid/ask; persisting them (plus Polymarket's book via
  the CLOB API) enables spread-aware signals and a liquidity column in the UI.

## 2. Event lifecycle

- **Market-close detection.** The producer logs and skips closed markets, but
  nothing surfaces this. Persist a `status` per matched event (e.g. the
  config-loader or a small Airflow task probing both venues) and show
  closed/stale pairs in the dashboard instead of silently dropping them.
- **`verified_at` / expiry metadata in `matched_events.yaml`**, plus a DAG
  check that warns when a pair is likely dead (no readings for N hours).
- **Semi-automated pair discovery.** Fuzzy title/date matching between the
  venues' market catalogs to *propose* new pairs for manual curation
  (auto-matching without review stays out of scope).

## 3. Operations

- **End-to-end smoke test in CI.** `docker compose up`, inject a synthetic
  divergent reading into Kafka, assert it appears in `mispricing_signals` and
  via `/api/signals`, tear down. The compose stack already supports this; it
  needs a workflow job with enough disk/RAM budget and a produce-from-CI path.
- **Spark job unit tests.** The join/dedup transforms (`build_signals_stream`,
  `dedupe_signals_batch`) are plain DataFrame functions; test them with a
  local `SparkSession` on static frames (pyspark is a heavy CI dependency —
  consider a separate workflow job with caching).
- **DAG import test** (`DagBag` smoke test) once an `apache-airflow` dev
  dependency pin is chosen; it catches most DAG breakage for one line of code.
- **Alerting beyond the Airflow UI.** Failure callbacks (email/Slack webhook)
  on the freshness checks; optionally a signal-fired notification.
- **Metrics.** Producer publish rate, Spark batch durations, and API latency
  via Prometheus + a Grafana panel, or at minimum structured JSON logs.

## 4. Product

- **Delta history chart.** The event detail page charts both venues'
  probabilities; add a second pane charting the delta itself against the
  threshold line.
- **WebSocket/SSE updates** instead of 30s polling once signal volume makes
  it worth it.
- **Backtesting view.** With enough retained history: for each past signal,
  what happened to the delta over the next N hours? This turns the tool from
  a monitor into an analysis instrument.
- **Auth for non-local deployments.** The API is deliberately unauthenticated
  on localhost; add a token or basic auth (and HTTPS) before exposing it.

## 5. Housekeeping

- **Postgres migrations.** Schema changes currently require `docker compose
  down -v` (init scripts only run on first boot). Adopt a lightweight
  migration runner (e.g. a one-shot container applying versioned SQL) so
  existing volumes can upgrade in place.
- **Frontend bundle splitting.** The single JS chunk is ~620 kB (recharts
  dominates); lazy-load the chart on the event detail route.
- **Pre-commit hooks** (ruff, oxlint) to catch lint before CI.
