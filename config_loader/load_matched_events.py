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

REQUIRED_FIELDS = frozenset({"event_id", "kalshi_ticker", "polymarket_slug"})


def validation_error(events: object) -> str | None:
    """Return a human-readable problem with the parsed YAML, or None if valid."""
    if not events:
        return "no matched_events entries found"
    if not isinstance(events, list):
        return f"matched_events must be a list, got {type(events).__name__}"
    seen_ids: set[str] = set()
    for entry in events:
        if not isinstance(entry, dict):
            return f"entry {entry!r} is not a mapping"
        missing = REQUIRED_FIELDS - set(entry)
        if missing:
            return f"entry {entry!r} is missing required fields: {sorted(missing)}"
        if entry["event_id"] in seen_ids:
            return f"duplicate event_id: {entry['event_id']!r}"
        seen_ids.add(entry["event_id"])
    return None


def main() -> int:
    with open(CONFIG_PATH) as f:
        config = yaml.safe_load(f)

    events = config.get("matched_events") or []
    error = validation_error(events)
    if error is not None:
        log.error("%s (in %s)", error, CONFIG_PATH)
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
