"""Read-only HTTP API over the pipeline's Postgres tables.

Serves the React dashboard (web/) and anything else that wants the data
without speaking SQL. Strictly read-only: the pipeline (Spark, Airflow,
config-loader) stays the only writer.

Endpoints (all JSON):
  GET /api/health                     DB reachability + per-venue freshness
  GET /api/events                     matched events + latest price per venue + live delta
  GET /api/events/{id}                one event (same shape as a list item)
  GET /api/events/{id}/prices         price history for both venues (?hours=24)
  GET /api/events/{id}/signals        recent signals for one event (?limit=50)
  GET /api/signals                    recent signals across all events (?limit=100)
  GET /api/summary                    daily rollup rows (?days=14)
"""

import os
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
import psycopg2.pool
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

POSTGRES_DSN = os.environ.get(
    "POSTGRES_DSN", "postgresql://markets:markets@postgres:5432/markets"
)

# A venue with no reading in this window is reported as stale (mirrors the
# Airflow freshness check).
FRESHNESS_MINUTES = int(os.environ.get("FRESHNESS_MINUTES", "15"))

# Surfaced to the dashboard so it highlights deltas with the same threshold
# the Spark job uses. Keep in sync with the spark service env in compose.
MISPRICING_THRESHOLD = float(os.environ.get("MISPRICING_THRESHOLD", "0.05"))

app = FastAPI(title="Mispricing Detector API", version="1.0.0")

# The dashboard is same-origin behind nginx in compose; CORS is for local
# `vite dev` (:5173) hitting the API (:8000) directly. Read-only data, no
# credentials, so a wildcard is fine.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"])

pool: psycopg2.pool.ThreadedConnectionPool | None = None


@app.on_event("startup")
def open_pool() -> None:
    global pool
    pool = psycopg2.pool.ThreadedConnectionPool(minconn=1, maxconn=8, dsn=POSTGRES_DSN)


@app.on_event("shutdown")
def close_pool() -> None:
    if pool is not None:
        pool.closeall()


@contextmanager
def cursor():
    assert pool is not None
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield cur
        conn.rollback()  # read-only: release any implicit transaction
    finally:
        pool.putconn(conn)


LATEST_READINGS_SQL = """
SELECT DISTINCT ON (matched_event_id, venue)
    matched_event_id, venue, probability, "timestamp"
FROM market_prices
ORDER BY matched_event_id, venue, "timestamp" DESC
"""


def fetch_events(event_id: str | None = None) -> list[dict]:
    with cursor() as cur:
        if event_id is not None:
            cur.execute("SELECT * FROM matched_events WHERE event_id = %s", (event_id,))
        else:
            cur.execute("SELECT * FROM matched_events ORDER BY event_id")
        events = cur.fetchall()

        cur.execute(LATEST_READINGS_SQL)
        latest = {(r["matched_event_id"], r["venue"]): r for r in cur.fetchall()}

        cur.execute(
            """
            SELECT matched_event_id, count(*) AS signal_count, max(delta) AS max_delta,
                   max("timestamp") AS last_signal_at
            FROM mispricing_signals
            WHERE "timestamp" >= now() - INTERVAL '24 hours'
            GROUP BY matched_event_id
            """
        )
        signals = {r["matched_event_id"]: r for r in cur.fetchall()}

    result = []
    for event in events:
        eid = event["event_id"]
        kalshi = latest.get((eid, "kalshi"))
        poly = latest.get((eid, "polymarket"))
        sig = signals.get(eid)
        delta = None
        if kalshi and poly:
            delta = abs(kalshi["probability"] - poly["probability"])
        result.append(
            {
                "event_id": eid,
                "kalshi_ticker": event["kalshi_ticker"],
                "polymarket_slug": event["polymarket_slug"],
                "description": event["description"],
                "kalshi_probability": kalshi["probability"] if kalshi else None,
                "kalshi_updated_at": kalshi["timestamp"] if kalshi else None,
                "polymarket_probability": poly["probability"] if poly else None,
                "polymarket_updated_at": poly["timestamp"] if poly else None,
                "delta": delta,
                "signals_24h": sig["signal_count"] if sig else 0,
                "max_delta_24h": sig["max_delta"] if sig else None,
                "last_signal_at": sig["last_signal_at"] if sig else None,
            }
        )
    return result


@app.get("/api/health")
def health() -> dict:
    with cursor() as cur:
        cur.execute(
            """
            SELECT venue,
                   count(*) FILTER (
                       WHERE "timestamp" >= now() - make_interval(mins => %s)
                   ) AS recent_readings,
                   max("timestamp") AS latest_reading_at
            FROM market_prices
            GROUP BY venue
            """,
            (FRESHNESS_MINUTES,),
        )
        rows = cur.fetchall()
    venues = {
        row["venue"]: {
            "recent_readings": row["recent_readings"],
            "latest_reading_at": row["latest_reading_at"],
            "fresh": row["recent_readings"] > 0,
        }
        for row in rows
    }
    for venue in ("kalshi", "polymarket"):
        venues.setdefault(
            venue, {"recent_readings": 0, "latest_reading_at": None, "fresh": False}
        )
    return {
        "status": "ok",
        "freshness_window_minutes": FRESHNESS_MINUTES,
        "mispricing_threshold": MISPRICING_THRESHOLD,
        "venues": venues,
    }


@app.get("/api/events")
def list_events() -> list[dict]:
    return fetch_events()


@app.get("/api/events/{event_id}")
def get_event(event_id: str) -> dict:
    events = fetch_events(event_id)
    if not events:
        raise HTTPException(status_code=404, detail=f"unknown event_id: {event_id}")
    return events[0]


@app.get("/api/events/{event_id}/prices")
def event_prices(
    event_id: str,
    hours: int = Query(default=24, ge=1, le=24 * 30),
) -> list[dict]:
    with cursor() as cur:
        cur.execute(
            """
            SELECT venue, probability, "timestamp"
            FROM market_prices
            WHERE matched_event_id = %s
              AND "timestamp" >= now() - make_interval(hours => %s)
            ORDER BY "timestamp"
            """,
            (event_id, hours),
        )
        return cur.fetchall()


@app.get("/api/events/{event_id}/signals")
def event_signals(
    event_id: str,
    limit: int = Query(default=50, ge=1, le=500),
) -> list[dict]:
    with cursor() as cur:
        cur.execute(
            """
            SELECT matched_event_id, kalshi_probability, polymarket_probability,
                   delta, "timestamp", detected_at
            FROM mispricing_signals
            WHERE matched_event_id = %s
            ORDER BY "timestamp" DESC
            LIMIT %s
            """,
            (event_id, limit),
        )
        return cur.fetchall()


@app.get("/api/signals")
def list_signals(limit: int = Query(default=100, ge=1, le=1000)) -> list[dict]:
    with cursor() as cur:
        cur.execute(
            """
            SELECT matched_event_id, kalshi_probability, polymarket_probability,
                   delta, "timestamp", detected_at
            FROM mispricing_signals
            ORDER BY "timestamp" DESC
            LIMIT %s
            """,
            (limit,),
        )
        return cur.fetchall()


@app.get("/api/summary")
def summary(days: int = Query(default=14, ge=1, le=365)) -> list[dict]:
    with cursor() as cur:
        cur.execute(
            """
            SELECT summary_date, matched_event_id, max_delta, signal_count,
                   reading_count, computed_at
            FROM daily_signal_summary
            WHERE summary_date >= current_date - %s
            ORDER BY summary_date DESC, matched_event_id
            """,
            (days,),
        )
        return cur.fetchall()
