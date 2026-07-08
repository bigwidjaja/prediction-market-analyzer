# Cross-Venue Prediction Market Mispricing Detector

A real-time streaming tool that watches the **same real-world event** priced on
two prediction market venues — [Kalshi](https://kalshi.com) and
[Polymarket](https://polymarket.com) — flags moments when their implied
probabilities diverge by more than a configurable threshold, and serves the
results on a live web dashboard.

Portfolio project demonstrating streaming data engineering end to end: Kafka
(KRaft), PySpark Structured Streaming (watermarked stream-stream join),
Postgres, Airflow, a FastAPI read layer, and a React dashboard — fully
self-contained in Docker Compose. **No cloud services, no API keys** (both
venues expose public market-data endpoints).

> See [`PLANNING.md`](PLANNING.md) for the pre-implementation scrutiny pass:
> what in the original design was verified against the live APIs, what had to
> be corrected (endpoints, price field formats), and why each architecture
> decision was made. [`NEXT_STEPS.md`](NEXT_STEPS.md) tracks planned follow-up
> work.

## Architecture

```
 Kalshi API ──┐                       ┌──────────────────────────────┐
              │   producer.py        │  Kafka topic: market-prices  │
              ├──► (poll ~45s) ──────►  key = matched_event_id      │
 Polymarket ──┘    1 JSON msg per    │  (single broker, KRaft mode) │
    Gamma API      (venue, event)     └──────────────┬───────────────┘
                                                     │
                                     Spark Structured Streaming
                                     (mispricing_detector.py)
                                                     │
                              ┌──────────────────────┴──────────────────────┐
                              │ query 1: pass-through                       │
                              │   every reading ──► market_prices           │
                              │ query 2: interval join per event            │
                              │   kalshi ⋈ polymarket (±90s, watermarked)   │
                              │   |Δ probability| > 0.05 ──► mispricing_    │
                              │                              signals        │
                              └──────────────────────┬──────────────────────┘
                                                     │  foreachBatch, idempotent
                                                     │  ON CONFLICT inserts
                                                     ▼
                                                 Postgres ◄── matched_events
                                                   ▲  ▲       (config loader)
                                                   │  │
                                   Airflow (15min) │  │ FastAPI (read-only, :8000)
                                   ├─ freshness    │  │        ▲
                                   └─ daily rollup ┘  │        │ /api proxied by nginx
                                                      │        │
                                                      └── React dashboard (:3000)
```

| Component | File(s) | Role |
|---|---|---|
| Producer | `producer/producer.py` | Polls both venues per matched pair every 45s, publishes JSON readings to Kafka |
| Spark job | `spark_jobs/mispricing_detector.py` | Pass-through to `market_prices` + watermarked interval join producing `mispricing_signals` (idempotent sinks) |
| Postgres | `postgres/init/*.sql` | Pipeline tables + indexes + dedup keys; separate `airflow` metadata DB |
| Config loader | `config_loader/load_matched_events.py` | One-shot: validates and UPSERTs `config/matched_events.yaml` into the `matched_events` table on every compose up |
| Airflow DAG | `dags/pipeline_health_dag.py` | Per-venue staleness alerts + idempotent daily rollup |
| API | `api/app.py` | Read-only FastAPI over the pipeline tables: latest deltas, price history, signals, rollups, freshness |
| Dashboard | `app/` | React + Tailwind UI (events, event detail with dual-venue chart, signals) served by nginx, live-polling the API |

## Event matching approach — and its limitations

Cross-venue event matching is **manual and curated** in v1: five pairs in
[`config/matched_events.yaml`](config/matched_events.yaml), each mapping one
Kalshi ticker to one Polymarket slug. Auto-matching (fuzzy title matching,
embedding similarity, etc.) is explicitly out of scope.

Limitations to be aware of:

- **Resolution rules are not identical across venues.** E.g. Kalshi's
  `KXRECSSNBER-26` resolves strictly on an NBER recession declaration, while
  Polymarket's `us-recession-by-end-of-2026` has similar-but-not-identical
  wording. A persistent delta can be a *definition gap*, not a tradeable edge.
- **Markets close.** These pairs were verified live on 2026-07-07. When a
  market closes/settles, the producer logs a warning and skips it — refresh
  the YAML and re-run `docker compose up config-loader producer`.
- **The 5pp threshold is a rough proxy** for "edge after estimated fees"
  (Kalshi taker fees, Polymarket gas/slippage). It is not a P&L claim — a 5pp
  gap on a book with pennies of liquidity is not executable.

## API schema caveat

**Kalshi's and Polymarket's public API response schemas should be re-verified
against their current docs whenever the pipeline is set up — public API fields
change.** This project already absorbed two such drifts during implementation
(2026-07-07):

- The commonly documented Kalshi host `trading-api.kalshi.com` now returns
  **401** anonymously; the pipeline uses `api.elections.kalshi.com` (public,
  no auth). Override with `KALSHI_API_BASE` if it moves again.
- Kalshi price fields are now dollar-denominated strings
  (`yes_bid_dollars: "0.8300"`); the legacy integer-cent fields
  (`last_price: 84`) come back null/absent.
- Polymarket's `outcomes`/`outcomePrices` are *stringified JSON inside JSON*
  and must be double-parsed.

The exact field mappings are documented in the docstring of
`producer/producer.py` and pinned down by the unit tests in
`tests/test_producer.py`.

## Setup

Requirements: Docker with the Compose plugin, ~6 GB free RAM, internet access
(to reach the two public APIs).

```bash
docker compose up -d --build
```

First start pulls/builds images (a few minutes). Then:

- **Dashboard**: <http://localhost:3000> — matched events with live deltas,
  per-event price charts, signal history.
- **API**: <http://localhost:8000/api/health> (interactive docs at
  <http://localhost:8000/docs>).
- **Airflow UI**: <http://localhost:8080> (user `admin`, password `admin`) —
  unpause the `pipeline_health` DAG.
- **Kafka** debug listener on `localhost:9094`; **Postgres** on
  `localhost:5432` (`markets`/`markets`, db `markets`).

Stop with `docker compose down` (add `-v` to also wipe Kafka/Postgres/checkpoint
data for a fully fresh start).

## Verifying each component

The pipeline was built and verified in stages; the same commands verify a
fresh deployment.

### 1. Kafka + Postgres + reference data

```bash
docker compose ps                          # kafka + postgres healthy;
                                           # kafka-init + config-loader exited (0)
docker logs kafka-init                     # "topic market-prices ready"
docker logs config-loader                  # "Loaded 5 matched events into Postgres."
docker exec postgres psql -U markets -d markets \
  -c 'SELECT event_id, kalshi_ticker, polymarket_slug FROM matched_events;'
```

### 2. Producer → Kafka

```bash
docker logs -f producer
# per poll cycle, one line per (venue, event):
#   [kalshi/fed-jul2026-no-change] p(YES)=0.8350 published
#   ...
#   Poll cycle complete: 10 published, 0 skipped/failed.

docker exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 --topic market-prices \
  --from-beginning --max-messages 5
```

Each message looks like:

```json
{"venue": "kalshi", "matched_event_id": "fed-jul2026-no-change",
 "contract_name": "KXFEDDECISION-26JUL-H0", "probability": 0.835,
 "raw_price": 0.84, "timestamp": "2026-07-07T19:36:07.585113+00:00"}
```

### 3. Spark pass-through → Postgres

```bash
docker logs spark 2>&1 | grep -iE 'error|exception' | grep -v WARN   # expect empty
docker exec postgres psql -U markets -d markets \
  -c 'SELECT venue, count(*), max("timestamp") FROM market_prices GROUP BY venue;'
# both venues counting up every ~45s
```

### 4. Join + mispricing signals

Real cross-venue deltas on the curated pairs are currently ~0.5–2.5pp, i.e.
below the 5pp threshold — so `mispricing_signals` should stay empty in normal
operation. To prove the detection path, inject a fake divergent reading:

```bash
TS=$(date -u +%Y-%m-%dT%H:%M:%S.000000+00:00)
echo "{\"venue\": \"polymarket\", \"matched_event_id\": \"fed-jul2026-cut-25bps\", \
\"contract_name\": \"SIMULATED-TEST-READING\", \"probability\": 0.99, \
\"raw_price\": 0.99, \"timestamp\": \"$TS\"}" | \
docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh \
  --bootstrap-server localhost:9092 --topic market-prices

sleep 60
docker exec postgres psql -U markets -d markets \
  -c 'SELECT * FROM mispricing_signals ORDER BY detected_at DESC LIMIT 5;'
# rows with delta ≈ 0.97 (fake 0.99 vs real Kalshi ~0.015)
```

The signal also appears on the dashboard's Signals page and on the event's
detail page.

(Alternatively set `MISPRICING_THRESHOLD: "0.001"` on the spark **and api**
services and restart them — real readings will then trigger signals.)

### 5. Airflow

```bash
docker exec airflow-scheduler airflow dags list-import-errors   # "No data found"
docker exec airflow-scheduler airflow dags unpause pipeline_health
docker exec airflow-scheduler airflow dags trigger pipeline_health
# after ~30s:
docker exec airflow-scheduler airflow dags list-runs -d pipeline_health
docker exec postgres psql -U markets -d markets \
  -c 'SELECT * FROM daily_signal_summary ORDER BY summary_date, matched_event_id;'
```

To see the staleness alert fire: `docker stop producer`, wait >15 minutes, and
the next `check_kalshi_freshness` / `check_polymarket_freshness` run fails with
`STALE VENUE: ...` in the task log. `docker start producer` to recover. The
dashboard sidebar shows the same freshness state (green/red per venue).

### 6. API + dashboard

```bash
curl -s localhost:8000/api/health | python3 -m json.tool
curl -s localhost:8000/api/events | python3 -m json.tool
curl -s 'localhost:8000/api/events/fed-jul2026-no-change/prices?hours=1' | python3 -m json.tool
# then open http://localhost:3000
```

## Tests and CI

```bash
pip install -r requirements-dev.txt
ruff check .
pytest                      # unit tests (producer parsing, config validation)

# API integration tests need a Postgres:
docker compose up -d postgres
TEST_POSTGRES_DSN=postgresql://markets:markets@localhost:5432/markets pytest

# frontend:
cd app && npm ci && npm run lint && npm run build
```

GitHub Actions (`.github/workflows/ci.yml`) runs all of the above on every
push/PR: ruff + pytest (with a Postgres service container) and the frontend
lint + type-check + build.

## Design notes / known limitations

- **Effectively-once delivery.** Sinks insert with `ON CONFLICT DO NOTHING`
  against natural keys (`market_prices`: venue + event + timestamp;
  `mispricing_signals`: event + Kalshi reading time), so micro-batch replays
  after a Spark restart do not duplicate rows.
- **Interval join, not "latest vs latest".** Readings are paired when their
  event times are within 90s of each other (2× the poll interval), with
  2-minute watermarks bounding join state. One Kalshi reading can match
  several Polymarket readings; the per-batch window dedup plus the
  `(event, kalshi_ts)` unique key guarantee at most one signal per Kalshi
  reading.
- **The "daily" rollup runs every 15 minutes** and idempotently UPSERTs
  today's and yesterday's aggregates, converging to the final daily value
  after midnight UTC. Prefer a strict end-of-day job? Change the DAG
  `schedule` to `"@daily"` — the SQL is already idempotent.
- **Single-node everything.** One Kafka broker (RF 1), Spark in
  `local[2]` mode, one Postgres. Deliberate: this demonstrates streaming
  semantics, not cluster ops.
- **The API is read-only and unauthenticated** — it exposes public market
  data on localhost. Add auth before exposing it anywhere else.

## Repository layout

```
├── docker-compose.yml          # all services (Kafka, Postgres, Spark, Airflow, api, web, producer)
├── config/matched_events.yaml  # the curated cross-venue event mapping (v1 source of truth)
├── config_loader/              # one-shot YAML -> matched_events table sync
├── producer/                   # Kalshi/Polymarket poller -> Kafka
├── spark_jobs/                 # Structured Streaming job + Dockerfile (connector jars baked in)
├── postgres/init/              # schema + airflow metadata DB init scripts
├── dags/                       # Airflow pipeline_health DAG
├── api/                        # read-only FastAPI over the pipeline tables
├── app/                        # React dashboard (nginx-served; see app/README.md + DESIGN.md)
├── tests/                      # pytest suite (producer parsing, config validation, API)
├── .github/workflows/ci.yml    # lint + tests + frontend build on every push/PR
├── DESIGN.md                   # dashboard design system
├── PLANNING.md                 # pre-implementation scrutiny & design decisions
└── NEXT_STEPS.md               # planned follow-up work
```
