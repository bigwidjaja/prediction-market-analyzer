"""One-shot loader: sync config/matched_events.yaml into Postgres.

Runs as a short-lived container on every `docker compose up`, after Postgres
is healthy. UPSERTs each entry keyed on event_id, so editing the YAML and
re-running compose updates the reference table in place. Rows removed from
the YAML are NOT deleted (historical market_prices rows may reference them).
"""

import logging
import os
import sys

import psycopg2
import yaml

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("config-loader")

CONFIG_PATH = os.environ.get("MATCHED_EVENTS_PATH", "/config/matched_events.yaml")
POSTGRES_DSN = os.environ.get(
    "POSTGRES_DSN", "postgresql://markets:markets@postgres:5432/markets"
)

UPSERT_SQL = """
INSERT INTO matched_events (event_id, kalshi_ticker, polymarket_slug, description, loaded_at)
VALUES (%s, %s, %s, %s, now())
ON CONFLICT (event_id) DO UPDATE SET
    kalshi_ticker   = EXCLUDED.kalshi_ticker,
    polymarket_slug = EXCLUDED.polymarket_slug,
    description     = EXCLUDED.description,
    loaded_at       = now();
"""


def main() -> int:
    with open(CONFIG_PATH) as f:
        config = yaml.safe_load(f)

    events = config.get("matched_events") or []
    if not events:
        log.error("No matched_events found in %s", CONFIG_PATH)
        return 1

    required = {"event_id", "kalshi_ticker", "polymarket_slug"}
    for entry in events:
        missing = required - set(entry)
        if missing:
            log.error("Entry %s is missing required fields: %s", entry, missing)
            return 1

    with psycopg2.connect(POSTGRES_DSN) as conn, conn.cursor() as cur:
        for entry in events:
            cur.execute(
                UPSERT_SQL,
                (
                    entry["event_id"],
                    entry["kalshi_ticker"],
                    entry["polymarket_slug"],
                    (entry.get("description") or "").strip(),
                ),
            )
            log.info(
                "Upserted %s (kalshi=%s, polymarket=%s)",
                entry["event_id"],
                entry["kalshi_ticker"],
                entry["polymarket_slug"],
            )

    log.info("Loaded %d matched events into Postgres.", len(events))
    return 0


if __name__ == "__main__":
    sys.exit(main())
