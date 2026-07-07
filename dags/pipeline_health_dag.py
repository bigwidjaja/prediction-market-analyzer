"""Pipeline health checks + daily signal rollup.

Runs every 15 minutes (schedule below):

1. check_kalshi_freshness / check_polymarket_freshness — one task PER venue,
   because the two upstream APIs fail independently: Kalshi can be down while
   Polymarket is fine, and a single combined check would hide which side is
   stale. A task FAILS (Airflow's built-in alerting: red task, retries,
   email/callbacks if configured) when its venue has produced no new
   market_prices rows in the lookback window.

2. rollup_daily_signal_summary — recomputes the per-event daily aggregate
   (max delta, signal count, reading count) for TODAY and YESTERDAY (UTC) and
   UPSERTs into daily_signal_summary. Running a "daily" rollup on a 15-minute
   cadence is safe because the write is idempotent (ON CONFLICT DO UPDATE):
   the summary stays fresh intraday and converges to its final value after
   midnight. Yesterday is included so readings that land around midnight are
   still attributed to the correct day by a later run.

Uses the 'markets_db' Airflow connection (injected via the
AIRFLOW_CONN_MARKETS_DB env var in docker-compose.yml).
"""

from datetime import datetime, timedelta

from airflow.decorators import dag, task
from airflow.providers.postgres.hooks.postgres import PostgresHook

MARKETS_CONN_ID = "markets_db"

# The producer polls every ~45s, so a healthy venue lands ~20 readings per
# 15-minute window. An empty window means the venue (or the pipeline) is stale.
FRESHNESS_LOOKBACK_MINUTES = 15

ROLLUP_SQL = """
INSERT INTO daily_signal_summary
    (summary_date, matched_event_id, max_delta, signal_count, reading_pairs, computed_at)
SELECT
    d.summary_date,
    d.matched_event_id,
    s.max_delta,
    COALESCE(s.signal_count, 0),
    d.reading_pairs,
    now()
FROM (
    -- readings observed per event per day (both venues)
    SELECT "timestamp"::date AS summary_date, matched_event_id, count(*) AS reading_pairs
    FROM market_prices
    WHERE "timestamp" >= (current_date - INTERVAL '1 day')
    GROUP BY 1, 2
) d
LEFT JOIN (
    SELECT "timestamp"::date AS summary_date, matched_event_id,
           max(delta) AS max_delta, count(*) AS signal_count
    FROM mispricing_signals
    WHERE "timestamp" >= (current_date - INTERVAL '1 day')
    GROUP BY 1, 2
) s USING (summary_date, matched_event_id)
ON CONFLICT (summary_date, matched_event_id) DO UPDATE SET
    max_delta     = EXCLUDED.max_delta,
    signal_count  = EXCLUDED.signal_count,
    reading_pairs = EXCLUDED.reading_pairs,
    computed_at   = EXCLUDED.computed_at;
"""


def _check_venue_freshness(venue: str) -> None:
    hook = PostgresHook(postgres_conn_id=MARKETS_CONN_ID)
    row = hook.get_first(
        """
        SELECT count(*), max("timestamp")
        FROM market_prices
        WHERE venue = %s
          AND "timestamp" >= now() - INTERVAL '%s minutes'
        """,
        parameters=(venue, FRESHNESS_LOOKBACK_MINUTES),
    )
    recent_count, latest = row
    if recent_count == 0:
        # Failing the task IS the alert: it shows red in the UI, triggers
        # retries, and fires any configured failure callbacks/emails.
        raise RuntimeError(
            f"STALE VENUE: no '{venue}' readings in the last "
            f"{FRESHNESS_LOOKBACK_MINUTES} min (latest ever: {latest}). "
            f"Check the producer logs and whether the {venue} API is up."
        )
    print(f"OK: {recent_count} '{venue}' readings in the last "
          f"{FRESHNESS_LOOKBACK_MINUTES} min (latest: {latest}).")


@dag(
    dag_id="pipeline_health",
    schedule=timedelta(minutes=15),
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args={"retries": 1, "retry_delay": timedelta(minutes=2)},
    tags=["mispricing-detector"],
)
def pipeline_health():
    @task
    def check_kalshi_freshness():
        _check_venue_freshness("kalshi")

    @task
    def check_polymarket_freshness():
        _check_venue_freshness("polymarket")

    @task(trigger_rule="all_done")  # rollup runs even if a venue is stale
    def rollup_daily_signal_summary():
        hook = PostgresHook(postgres_conn_id=MARKETS_CONN_ID)
        hook.run(ROLLUP_SQL)
        for row in hook.get_records(
            "SELECT summary_date, matched_event_id, max_delta, signal_count, reading_pairs "
            "FROM daily_signal_summary WHERE summary_date >= current_date - 1 "
            "ORDER BY summary_date, matched_event_id"
        ):
            print("rollup:", row)

    [check_kalshi_freshness(), check_polymarket_freshness()] >> rollup_daily_signal_summary()


pipeline_health()
