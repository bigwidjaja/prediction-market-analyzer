-- Schema for the mispricing detector pipeline.
-- Runs automatically on first Postgres container startup
-- (mounted into /docker-entrypoint-initdb.d).

-- Reference table: the manually curated cross-venue event mapping.
-- Rows are UPSERTed from config/matched_events.yaml by the config-loader
-- one-shot container on every `docker compose up`.
CREATE TABLE IF NOT EXISTS matched_events (
    event_id        TEXT PRIMARY KEY,
    kalshi_ticker   TEXT NOT NULL,
    polymarket_slug TEXT NOT NULL,
    description     TEXT,
    loaded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every raw price reading from every venue (append-only, written by the
-- Spark pass-through query). The natural key (venue, matched_event_id,
-- timestamp) is UNIQUE and the writer uses ON CONFLICT DO NOTHING, so
-- micro-batch replays after a Spark restart do not duplicate rows
-- (effectively-once delivery).
CREATE TABLE IF NOT EXISTS market_prices (
    id               BIGSERIAL PRIMARY KEY,
    venue            TEXT NOT NULL,           -- 'kalshi' | 'polymarket'
    matched_event_id TEXT NOT NULL,
    contract_name    TEXT NOT NULL,           -- kalshi ticker / polymarket slug
    probability      DOUBLE PRECISION NOT NULL CHECK (probability >= 0 AND probability <= 1),
    raw_price        DOUBLE PRECISION NOT NULL, -- venue-native price (see producer comments)
    "timestamp"      TIMESTAMPTZ NOT NULL,    -- event time: when the producer took the reading
    UNIQUE (venue, matched_event_id, "timestamp")
);

CREATE INDEX IF NOT EXISTS idx_market_prices_event_ts
    ON market_prices (matched_event_id, "timestamp");
CREATE INDEX IF NOT EXISTS idx_market_prices_venue_ts
    ON market_prices (venue, "timestamp");

-- Flagged mispricing signals (written by the Spark join query when
-- |kalshi_probability - polymarket_probability| > threshold).
-- One signal per (event, Kalshi reading): the interval join can pair the
-- same Kalshi reading with Polymarket readings across several micro-batches,
-- so the UNIQUE key + ON CONFLICT DO NOTHING keeps only the first pairing
-- (which the per-batch dedup makes the closest-in-time one seen so far).
CREATE TABLE IF NOT EXISTS mispricing_signals (
    id                     BIGSERIAL PRIMARY KEY,
    matched_event_id       TEXT NOT NULL,
    kalshi_probability     DOUBLE PRECISION NOT NULL,
    polymarket_probability DOUBLE PRECISION NOT NULL,
    delta                  DOUBLE PRECISION NOT NULL,
    "timestamp"            TIMESTAMPTZ NOT NULL, -- event time of the paired readings (max of the two)
    kalshi_ts              TIMESTAMPTZ NOT NULL, -- event time of the Kalshi reading (dedup key)
    detected_at            TIMESTAMPTZ NOT NULL, -- wall clock when Spark flagged it
    UNIQUE (matched_event_id, kalshi_ts)
);

CREATE INDEX IF NOT EXISTS idx_mispricing_signals_event_ts
    ON mispricing_signals (matched_event_id, "timestamp");

-- Daily rollup maintained by the Airflow DAG. UPSERTed on a 15-minute cadence
-- for today/yesterday, so re-runs are idempotent and the final daily value
-- converges after midnight UTC.
CREATE TABLE IF NOT EXISTS daily_signal_summary (
    summary_date     DATE NOT NULL,
    matched_event_id TEXT NOT NULL,
    max_delta        DOUBLE PRECISION,
    signal_count     INTEGER NOT NULL DEFAULT 0,
    reading_count    INTEGER NOT NULL DEFAULT 0, -- individual price readings observed that day (both venues)
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (summary_date, matched_event_id)
);
