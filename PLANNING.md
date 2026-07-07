# PLANNING.md — Cross-Venue Prediction Market Mispricing Detector

This document records the planning and scrutiny pass done **before** implementation:
what in the original spec was verified, what was wrong or risky, and which design
decisions were made (with reasoning). Read this before the README if you want to
understand *why* the pipeline looks the way it does.

---

## 1. Spec corrections found during verification

These were discovered by probing the live APIs (2026-07-07), not assumed.

### 1.1 The Kalshi endpoint in the spec is dead for anonymous use

The spec says to use `https://trading-api.kalshi.com/trade-api/v2/markets`.
That host returns **HTTP 401** for unauthenticated requests. The current public,
no-auth market-data endpoint is:

```
https://api.elections.kalshi.com/trade-api/v2/markets
```

(verified: returns 200 with full market data, no API key). The producer uses this
host, configurable via the `KALSHI_API_BASE` environment variable in case Kalshi
moves it again.

### 1.2 Kalshi's price fields are not what older docs describe

Older Kalshi docs (and most blog posts) describe integer-cent fields
(`last_price: 84`, `yes_bid: 83`). The live API now returns **dollar-denominated
string fields** and the old cent fields come back absent/null:

```json
{
  "ticker": "KXFEDDECISION-26JUL-H0",
  "last_price_dollars": "0.8400",
  "yes_bid_dollars": "0.8300",
  "yes_ask_dollars": "0.8400",
  "response_price_units": "usd_cent",
  ...
}
```

The producer therefore parses `yes_bid_dollars` / `yes_ask_dollars` (midpoint) with
`last_price_dollars` as fallback, all as decimal strings. This is exactly the kind
of drift the spec warned about ("public API fields can change") — it had already
happened before we wrote a line of code.

### 1.3 Polymarket's `outcomePrices` is a JSON string, not an array

The Gamma API returns stringified JSON inside JSON:

```json
{
  "slug": "fed-rate-hike-in-2026",
  "outcomes": "[\"Yes\", \"No\"]",
  "outcomePrices": "[\"0.475\", \"0.525\"]"
}
```

The producer must `json.loads()` both fields, find the index of `"Yes"` in
`outcomes`, and take the matching element of `outcomePrices`. Querying by
`?slug=<slug>` returns a **list** of markets (usually length 1).

### 1.4 "Latest-vs-latest" join is not a native Spark operation

The spec asks to "join the latest Kalshi reading with the latest Polymarket
reading". Spark Structured Streaming has no built-in "latest per key vs latest per
key" stream-stream join; that would need custom stateful processing
(`applyInPandasWithState`), which is overkill and fragile for v1.

**Decision:** use a standard watermarked **interval join**: split the topic into a
Kalshi stream and a Polymarket stream, inner-join on `matched_event_id` with the
event-time constraint `|kalshi_ts − poly_ts| ≤ 90s` and 2-minute watermarks on both
sides. Since the producer polls both venues in the same loop (~every 45s), each
Kalshi reading pairs with the Polymarket reading(s) taken at nearly the same time —
which is semantically *better* for mispricing detection than "latest vs latest"
(you never compare a fresh price against a stale one). One reading can match 2–3
readings from the other side inside the interval; the job dedupes per micro-batch
by keeping the pair with the smallest timestamp gap per event.

### 1.5 One 15-minute DAG containing a "daily" rollup

The spec asks for a single DAG on a 15-minute schedule whose second task is a
"daily rollup". Running a daily aggregate every 15 minutes is fine **iff the
rollup is idempotent**, so the rollup task computes the max delta per event for
*today and yesterday* (UTC) and UPSERTs into `daily_signal_summary`
(`ON CONFLICT (summary_date, matched_event_id) DO UPDATE`). This honors the spec's
single-DAG shape, keeps the summary fresh intraday, and converges to the correct
final value after midnight. The alternative (two DAGs, one `@daily`) is noted in
the README; it's a one-line schedule change.

### 1.6 Bitnami Spark image is no longer a safe default

Bitnami's Docker Hub images were moved/deprecated for anonymous pulls
(Broadcom changes, 2025). The spec's "bitnami/spark image, or custom Dockerfile"
option resolves to: **custom Dockerfile on the official `apache/spark` image**,
with the Kafka connector + Postgres JDBC jars downloaded at *build* time (so
runtime needs no Maven access and startup is deterministic).

---

## 2. Curated matched event pairs (verified live on both venues, 2026-07-07)

| event_id | Kalshi ticker | Polymarket slug | Kalshi p(YES) | Poly p(YES) |
|---|---|---|---|---|
| fed-jul2026-no-change | `KXFEDDECISION-26JUL-H0` | `will-there-be-no-change-in-fed-interest-rates-after-the-july-2026-meeting` | 0.84 | 0.825 |
| fed-jul2026-cut-25bps | `KXFEDDECISION-26JUL-C25` | `will-the-fed-decrease-interest-rates-by-25-bps-after-the-july-2026-meeting` | 0.01 | 0.0075 |
| fed-sep2026-no-change | `KXFEDDECISION-26SEP-H0` | `will-there-be-no-change-in-fed-interest-rates-after-the-september-2026-meeting-615` | 0.68 | 0.69 |
| us-recession-2026 | `KXRECSSNBER-26` | `us-recession-by-end-of-2026` | 0.09 | 0.105 |
| fed-hike-by-end-2026 | `FEDHIKE-26DEC31` | `fed-rate-hike-in-2026` | 0.48 | 0.475 |

Observed deltas at curation time were 0.5–2.5 percentage points — realistically
below the 5pp default threshold, so `mispricing_signals` stays quiet until a real
divergence (or a lowered threshold / injected test message) occurs. That is the
correct resting behavior for the detector.

**Known matching caveats (documented, accepted for v1):**

- `us-recession-2026`: Kalshi resolves on an **NBER recession declaration**;
  Polymarket's rules are similar but not word-for-word identical. Persistent
  "mispricing" between them can be a *definition gap*, not an edge.
- `fed-hike-by-end-2026`: both resolve on a 2026 Fed hike, but listed close dates
  differ slightly (Kalshi close 2027-01-01, Polymarket endDate 2026-12-09 per API —
  Polymarket's `endDate` is a listing attribute, not the resolution deadline).
- Fed-decision pairs are near-identical rule-wise; they are the cleanest pairs.
- All five markets **will eventually close**. The producer logs and skips pairs
  whose market is closed/settled; refresh `config/matched_events.yaml` periodically.

## 3. Architecture decisions

| Area | Decision | Why |
|---|---|---|
| Kafka | `apache/kafka:3.9.1`, single node, combined broker+controller KRaft, topic auto-create off, explicit `kafka-init` one-shot creates `market-prices` (3 partitions, RF 1) | Official image, no Zookeeper, deterministic topic config |
| Spark deploy mode | `spark-submit --master local[2]` inside one container (no master/worker cluster) | Laptop-friendly; a 1-node "cluster" adds containers and RAM for zero demo value |
| Spark→Postgres | Two independent streaming queries in one app (raw pass-through + join), each with its own checkpoint dir, both via `foreachBatch` + JDBC append | Spec-mandated foreachBatch/JDBC; separate checkpoints = independent recovery |
| Delivery semantics | At-least-once into Postgres (duplicates possible on restart replay) | Exactly-once JDBC upserts are out of scope for v1; documented in README |
| Config load | One-shot `config-loader` container (Python + PyYAML + psycopg2) that UPSERTs `matched_events.yaml` into Postgres after it is healthy | Postgres init scripts can't parse YAML; a one-shot container keeps YAML as the single source of truth and re-syncs on every `docker compose up` |
| Airflow | `apache/airflow:2.11.0`, LocalExecutor, metadata DB = separate `airflow` database inside the same Postgres container, `airflow-init` one-shot for migration + admin user | One less container than a dedicated metadata DB; standard official pattern |
| Producer | `python:3.12-slim` + `confluent-kafka` + `requests`, `restart: unless-stopped` | librdkafka-backed client, robust reconnects, tiny image |
| Timestamps | Producer emits ISO-8601 UTC; all Postgres columns `TIMESTAMPTZ`; watermarks/joins in event time | Avoids the classic local-time drift bugs |
| Threshold | `MISPRICING_THRESHOLD` env var, default `0.05` | Rough proxy for "edge after fees" — a simplification, documented in code |

## 4. Risks / known limitations (v1)

1. **API drift** — both schemas already drifted from public docs once (see §1.2,
   §1.3). Producer fails *per event per venue* (logs and continues), never crashes
   the loop on one bad response.
2. **Markets close** — matched pairs go stale over time; the Airflow health check
   will flag venue staleness, and the YAML needs manual refresh (auto-matching is
   explicitly out of scope).
3. **At-least-once writes** — restart replay can duplicate rows in
   `market_prices` / `mispricing_signals`. Downstream consumers should treat rows
   as observations, not unique events.
4. **Thin books** — `last_price` on an illiquid market can be stale; midpoint of
   bid/ask is used when available, but a 5pp "signal" on a market with pennies of
   liquidity is not tradeable. The threshold is a proxy, not a P&L claim.
5. **No secrets, no cloud** — verified: both APIs need no keys; everything runs in
   Docker Compose on one machine.

## 5. Build order (as executed)

1. Kafka (KRaft) + Postgres + init SQL + `config-loader` — verify tables and
   `matched_events` rows.
2. Producer — verify live fetches from both venues and messages on
   `market-prices` via `kafka-console-consumer`.
3. Spark pass-through — verify raw rows land in `market_prices`.
4. Stream-stream interval join + delta — verify `mispricing_signals` populates
   (with a lowered threshold / injected test reading, since real deltas are
   currently < 5pp).
5. Airflow health-check + rollup DAG — verify scheduled runs and Postgres queries.

Verification commands for each step are in the README.
