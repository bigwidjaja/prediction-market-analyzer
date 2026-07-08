"""Integration tests for the read-only API against a real Postgres.

Skipped unless TEST_POSTGRES_DSN is set (CI provides a postgres service
container; locally, `docker compose up -d postgres` and
`TEST_POSTGRES_DSN=postgresql://markets:markets@localhost:5432/markets pytest`).
The schema is applied from postgres/init/01_schema.sql, so these tests also
verify the schema file itself.
"""

import os
from pathlib import Path

import pytest

DSN = os.environ.get("TEST_POSTGRES_DSN")

pytestmark = pytest.mark.skipif(DSN is None, reason="TEST_POSTGRES_DSN not set")

SCHEMA = (Path(__file__).parent.parent / "postgres" / "init" / "01_schema.sql").read_text()

SEED = """
TRUNCATE matched_events, market_prices, mispricing_signals, daily_signal_summary;

INSERT INTO matched_events (event_id, kalshi_ticker, polymarket_slug, description) VALUES
    ('evt-a', 'KX-A', 'slug-a', 'Event A'),
    ('evt-b', 'KX-B', 'slug-b', 'Event B');

INSERT INTO market_prices
    (venue, matched_event_id, contract_name, probability, raw_price, "timestamp") VALUES
    ('kalshi',     'evt-a', 'KX-A',   0.80, 0.80, now() - INTERVAL '10 minutes'),
    ('kalshi',     'evt-a', 'KX-A',   0.84, 0.84, now() - INTERVAL '1 minute'),
    ('polymarket', 'evt-a', 'slug-a', 0.70, 0.70, now() - INTERVAL '1 minute'),
    ('kalshi',     'evt-b', 'KX-B',   0.10, 0.10, now() - INTERVAL '2 minutes');

INSERT INTO mispricing_signals
    (matched_event_id, kalshi_probability, polymarket_probability, delta,
     "timestamp", kalshi_ts, detected_at) VALUES
    ('evt-a', 0.84, 0.70, 0.14, now() - INTERVAL '1 minute',
     now() - INTERVAL '1 minute', now());

INSERT INTO daily_signal_summary
    (summary_date, matched_event_id, max_delta, signal_count, reading_count) VALUES
    (current_date, 'evt-a', 0.14, 1, 3);
"""


@pytest.fixture(scope="module")
def client():
    import psycopg2

    with psycopg2.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute(SCHEMA)
        cur.execute(SEED)

    os.environ["POSTGRES_DSN"] = DSN
    from fastapi.testclient import TestClient

    import app as api_app

    with TestClient(api_app.app) as test_client:
        yield test_client


def test_health_reports_fresh_venues(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["venues"]["kalshi"]["fresh"] is True
    assert body["venues"]["polymarket"]["fresh"] is True
    assert body["mispricing_threshold"] > 0


def test_events_joins_latest_reading_per_venue(client):
    events = {e["event_id"]: e for e in client.get("/api/events").json()}
    assert set(events) == {"evt-a", "evt-b"}

    a = events["evt-a"]
    assert a["kalshi_probability"] == 0.84  # latest, not the older 0.80
    assert a["polymarket_probability"] == 0.70
    assert a["delta"] == pytest.approx(0.14)
    assert a["signals_24h"] == 1

    b = events["evt-b"]
    assert b["kalshi_probability"] == 0.10
    assert b["polymarket_probability"] is None  # no polymarket reading yet
    assert b["delta"] is None
    assert b["signals_24h"] == 0


def test_single_event_and_404(client):
    assert client.get("/api/events/evt-a").json()["event_id"] == "evt-a"
    assert client.get("/api/events/nope").status_code == 404


def test_event_prices_are_time_ordered(client):
    prices = client.get("/api/events/evt-a/prices?hours=24").json()
    assert len(prices) == 3
    timestamps = [p["timestamp"] for p in prices]
    assert timestamps == sorted(timestamps)


def test_signals_endpoints(client):
    all_signals = client.get("/api/signals").json()
    assert len(all_signals) == 1
    assert all_signals[0]["matched_event_id"] == "evt-a"
    assert all_signals[0]["delta"] == pytest.approx(0.14)

    assert client.get("/api/events/evt-a/signals").json() == all_signals
    assert client.get("/api/events/evt-b/signals").json() == []


def test_summary(client):
    rows = client.get("/api/summary").json()
    assert len(rows) == 1
    assert rows[0]["matched_event_id"] == "evt-a"
    assert rows[0]["reading_count"] == 3


def test_signal_dedup_key_rejects_duplicates(client):
    """The UNIQUE (matched_event_id, kalshi_ts) key backs the Spark sink's
    ON CONFLICT DO NOTHING — a replayed pairing must not create a second row."""
    import psycopg2

    with psycopg2.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO mispricing_signals
                (matched_event_id, kalshi_probability, polymarket_probability,
                 delta, "timestamp", kalshi_ts, detected_at)
            SELECT matched_event_id, kalshi_probability, polymarket_probability,
                   delta, "timestamp", kalshi_ts, now()
            FROM mispricing_signals
            ON CONFLICT (matched_event_id, kalshi_ts) DO NOTHING
            """
        )
    assert len(client.get("/api/signals").json()) == 1
