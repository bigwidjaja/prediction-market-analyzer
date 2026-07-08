"""Poll Kalshi + Polymarket for each matched event pair and publish readings to Kafka.

Every POLL_INTERVAL_SECONDS (default 45s), for each entry in
config/matched_events.yaml, this script:
  1. fetches the current YES probability from Kalshi's public API,
  2. fetches the current YES probability from Polymarket's Gamma API,
  3. publishes one JSON message per (venue, event) reading to the
     'market-prices' Kafka topic, keyed by matched_event_id.

Message schema (one reading):
  {
    "venue":            "kalshi" | "polymarket",
    "matched_event_id": "fed-jul2026-no-change",
    "contract_name":    "<kalshi ticker or polymarket slug>",
    "probability":      0.84,          # normalized YES probability in [0, 1]
    "raw_price":        0.84,          # venue-native price (see mapping notes)
    "timestamp":        "2026-07-07T19:40:00.123456+00:00"  # ISO-8601 UTC
  }

Failures are handled per (event, venue): a bad response for one market is
logged and skipped without affecting other markets or crashing the loop.
The container restarts on hard crashes (compose restart policy).

------------------------------------------------------------------------------
VENUE FIELD MAPPING (verified against live APIs on 2026-07-07 — public API
schemas drift, re-verify against current docs if parsing starts failing):

Kalshi   GET {KALSHI_API_BASE}/markets/{ticker}
  NOTE: the spec's original host (trading-api.kalshi.com) returns 401 for
  anonymous requests; api.elections.kalshi.com is the current public host.
  Response: {"market": {...}}. Prices are DOLLAR-DENOMINATED STRINGS
  (the legacy integer-cent fields like "last_price": 84 are absent/null):
      "yes_bid_dollars":     "0.8300"
      "yes_ask_dollars":     "0.8400"
      "last_price_dollars":  "0.8400"
      "status":              "active" | "closed" | "settled" | ...
  probability := midpoint of yes_bid/yes_ask when both are present and the
  book is non-empty, else last_price_dollars. A Kalshi binary contract pays
  $1, so a dollar price IS the implied YES probability.
  raw_price   := last_price_dollars (the venue's own headline price).

Polymarket   GET {POLYMARKET_API_BASE}/markets?slug={slug}
  Response: a JSON LIST of market objects (normally length 1). The two
  interesting fields are *stringified JSON inside JSON*:
      "outcomes":       "[\"Yes\", \"No\"]"
      "outcomePrices":  "[\"0.825\", \"0.175\"]"
      "closed":         false
  probability := float(outcomePrices[index of "Yes" in outcomes]).
  Prices are already probabilities in [0, 1] (each share pays $1).
  raw_price   := the same YES price (Polymarket has no separate native unit).
------------------------------------------------------------------------------
"""

import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import requests
import yaml
from confluent_kafka import Producer
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("producer")

# --- configuration (env-overridable, sane local defaults) --------------------
KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
TOPIC = os.environ.get("KAFKA_TOPIC", "market-prices")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SECONDS", "45"))
CONFIG_PATH = os.environ.get("MATCHED_EVENTS_PATH", "/config/matched_events.yaml")
KALSHI_API_BASE = os.environ.get(
    "KALSHI_API_BASE", "https://api.elections.kalshi.com/trade-api/v2"
)
POLYMARKET_API_BASE = os.environ.get(
    "POLYMARKET_API_BASE", "https://gamma-api.polymarket.com"
)
HTTP_TIMEOUT = float(os.environ.get("HTTP_TIMEOUT_SECONDS", "10"))


@dataclass
class Reading:
    venue: str
    matched_event_id: str
    contract_name: str
    probability: float
    raw_price: float

    def to_message(self) -> dict:
        return {
            "venue": self.venue,
            "matched_event_id": self.matched_event_id,
            "contract_name": self.contract_name,
            "probability": round(self.probability, 6),
            "raw_price": round(self.raw_price, 6),
            "timestamp": datetime.now(UTC).isoformat(),
        }


def load_matched_events(path: str) -> list[dict]:
    with open(path) as f:
        return yaml.safe_load(f)["matched_events"]


# --- venue fetchers (see field-mapping notes in the module docstring) --------

def fetch_kalshi(session: requests.Session, event_id: str, ticker: str) -> Reading | None:
    resp = session.get(f"{KALSHI_API_BASE}/markets/{ticker}", timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    market = resp.json()["market"]

    if market.get("status") != "active":
        log.warning("[kalshi/%s] market %s is '%s', skipping (update matched_events.yaml)",
                    event_id, ticker, market.get("status"))
        return None

    def dollars(field: str) -> float | None:
        raw = market.get(field)
        return float(raw) if raw not in (None, "") else None

    last = dollars("last_price_dollars")
    bid, ask = dollars("yes_bid_dollars"), dollars("yes_ask_dollars")

    # Midpoint is a better fair-value estimate than last trade on thin books,
    # but an empty book shows bid=0/ask=1(or 0) — fall back to last in that case.
    if bid is not None and ask is not None and bid > 0 and ask < 1:
        probability = (bid + ask) / 2
    elif last is not None:
        probability = last
    else:
        log.warning("[kalshi/%s] no usable price fields on %s, skipping", event_id, ticker)
        return None

    raw_price = last if last is not None else probability
    return Reading("kalshi", event_id, ticker, probability, raw_price)


def fetch_polymarket(session: requests.Session, event_id: str, slug: str) -> Reading | None:
    resp = session.get(
        f"{POLYMARKET_API_BASE}/markets", params={"slug": slug}, timeout=HTTP_TIMEOUT
    )
    resp.raise_for_status()
    markets = resp.json()

    if not markets:
        log.warning("[polymarket/%s] no market found for slug %s, skipping", event_id, slug)
        return None
    market = markets[0]

    if market.get("closed"):
        log.warning("[polymarket/%s] market %s is closed, skipping (update matched_events.yaml)",
                    event_id, slug)
        return None

    # 'outcomes' and 'outcomePrices' are stringified JSON arrays.
    outcomes = json.loads(market["outcomes"])
    prices = json.loads(market["outcomePrices"])
    try:
        yes_price = float(prices[outcomes.index("Yes")])
    except (ValueError, IndexError):
        log.warning("[polymarket/%s] no 'Yes' outcome in %s for %s, skipping",
                    event_id, outcomes, slug)
        return None

    return Reading("polymarket", event_id, slug, yes_price, yes_price)


# --- kafka plumbing -----------------------------------------------------------

def delivery_callback(err, msg):
    if err is not None:
        log.error("Kafka delivery failed for key=%s: %s", msg.key(), err)


def poll_once(session: requests.Session, producer: Producer, events: list[dict]) -> None:
    ok = failed = 0
    for event in events:
        event_id = event["event_id"]
        fetches = [
            ("kalshi", fetch_kalshi, event["kalshi_ticker"]),
            ("polymarket", fetch_polymarket, event["polymarket_slug"]),
        ]
        for venue, fetch, contract in fetches:
            try:
                reading = fetch(session, event_id, contract)
            except Exception as exc:  # per-(event,venue) isolation: log and move on
                log.error("[%s/%s] fetch FAILED: %s", venue, event_id, exc)
                failed += 1
                continue
            if reading is None:
                failed += 1
                continue
            message = reading.to_message()
            try:
                producer.produce(
                    TOPIC,
                    key=event_id.encode(),
                    value=json.dumps(message).encode(),
                    callback=delivery_callback,
                )
            except BufferError:
                # Local librdkafka queue is full (broker unreachable for a
                # while). Give delivery callbacks a chance to drain it and
                # retry once; if still full, drop this reading rather than
                # crash the whole poll loop.
                producer.poll(5)
                try:
                    producer.produce(
                        TOPIC,
                        key=event_id.encode(),
                        value=json.dumps(message).encode(),
                        callback=delivery_callback,
                    )
                except BufferError:
                    log.error("[%s/%s] Kafka queue full, dropping reading", venue, event_id)
                    failed += 1
                    continue
            log.info("[%s/%s] p(YES)=%.4f published", venue, event_id, reading.probability)
            ok += 1
    producer.flush(10)
    log.info("Poll cycle complete: %d published, %d skipped/failed.", ok, failed)


def main() -> None:
    events = load_matched_events(CONFIG_PATH)
    log.info("Loaded %d matched event pairs from %s", len(events), CONFIG_PATH)

    producer = Producer({
        "bootstrap.servers": KAFKA_BOOTSTRAP,
        "client.id": "market-price-producer",
        # Modest durability settings; single-broker local setup.
        "acks": "all",
        "retries": 5,
    })
    session = requests.Session()
    session.headers["User-Agent"] = "mispricing-detector/0.1 (portfolio project)"
    # Retry transient upstream failures (rate limits, 5xx, connection resets)
    # with backoff inside one poll cycle instead of losing the reading.
    retry = Retry(
        total=3,
        backoff_factor=1.0,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
    )
    for prefix in ("https://", "http://"):
        session.mount(prefix, HTTPAdapter(max_retries=retry))

    while True:
        started = time.monotonic()
        poll_once(session, producer, events)
        elapsed = time.monotonic() - started
        time.sleep(max(0.0, POLL_INTERVAL - elapsed))


if __name__ == "__main__":
    main()
