"""Unit tests for the venue fetchers in producer/producer.py.

These cover the API-drift-prone parsing paths (see PLANNING.md §1): Kalshi's
dollar-denominated string fields and Polymarket's stringified-JSON-inside-JSON
outcome arrays.
"""

import json
from datetime import datetime

import pytest

import producer as producer_mod
from producer import Reading, fetch_kalshi, fetch_polymarket


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeSession:
    """Records requests and returns a canned response."""

    def __init__(self, payload, status=200):
        self.response = FakeResponse(payload, status)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append({"url": url, "params": params, "timeout": timeout})
        return self.response


def kalshi_market(**overrides):
    market = {
        "ticker": "KXTEST-26",
        "status": "active",
        "last_price_dollars": "0.8400",
        "yes_bid_dollars": "0.8300",
        "yes_ask_dollars": "0.8500",
    }
    market.update(overrides)
    return {"market": market}


# --- Kalshi -------------------------------------------------------------------

def test_kalshi_uses_bid_ask_midpoint():
    session = FakeSession(kalshi_market())
    reading = fetch_kalshi(session, "evt", "KXTEST-26")
    assert reading == Reading("kalshi", "evt", "KXTEST-26", 0.84, 0.84)


def test_kalshi_midpoint_differs_from_last_price():
    session = FakeSession(
        kalshi_market(yes_bid_dollars="0.1000", yes_ask_dollars="0.2000",
                      last_price_dollars="0.9900")
    )
    reading = fetch_kalshi(session, "evt", "KXTEST-26")
    assert reading is not None
    assert reading.probability == pytest.approx(0.15)
    assert reading.raw_price == 0.99  # raw_price stays the venue headline price


def test_kalshi_falls_back_to_last_price_when_book_empty():
    # Empty book renders as bid=0 (and/or ask=1); midpoint would be meaningless.
    session = FakeSession(
        kalshi_market(yes_bid_dollars="0", yes_ask_dollars="1.0000",
                      last_price_dollars="0.6200")
    )
    reading = fetch_kalshi(session, "evt", "KXTEST-26")
    assert reading is not None
    assert reading.probability == 0.62


def test_kalshi_falls_back_when_bid_or_ask_missing():
    session = FakeSession(
        kalshi_market(yes_bid_dollars=None, yes_ask_dollars="",
                      last_price_dollars="0.4100")
    )
    reading = fetch_kalshi(session, "evt", "KXTEST-26")
    assert reading is not None
    assert reading.probability == 0.41


def test_kalshi_skips_non_active_market():
    session = FakeSession(kalshi_market(status="settled"))
    assert fetch_kalshi(session, "evt", "KXTEST-26") is None


def test_kalshi_skips_when_no_usable_price():
    session = FakeSession(
        kalshi_market(yes_bid_dollars=None, yes_ask_dollars=None,
                      last_price_dollars=None)
    )
    assert fetch_kalshi(session, "evt", "KXTEST-26") is None


def test_kalshi_requests_market_endpoint():
    session = FakeSession(kalshi_market())
    fetch_kalshi(session, "evt", "KXTEST-26")
    assert session.calls[0]["url"].endswith("/markets/KXTEST-26")


# --- Polymarket ---------------------------------------------------------------

def polymarket_market(**overrides):
    market = {
        "slug": "test-slug",
        "closed": False,
        # Stringified JSON inside JSON — the documented Gamma API quirk.
        "outcomes": json.dumps(["Yes", "No"]),
        "outcomePrices": json.dumps(["0.825", "0.175"]),
    }
    market.update(overrides)
    return [market]


def test_polymarket_parses_stringified_outcome_arrays():
    session = FakeSession(polymarket_market())
    reading = fetch_polymarket(session, "evt", "test-slug")
    assert reading == Reading("polymarket", "evt", "test-slug", 0.825, 0.825)


def test_polymarket_finds_yes_regardless_of_order():
    session = FakeSession(
        polymarket_market(
            outcomes=json.dumps(["No", "Yes"]),
            outcomePrices=json.dumps(["0.3", "0.7"]),
        )
    )
    reading = fetch_polymarket(session, "evt", "test-slug")
    assert reading is not None
    assert reading.probability == 0.7


def test_polymarket_skips_closed_market():
    session = FakeSession(polymarket_market(closed=True))
    assert fetch_polymarket(session, "evt", "test-slug") is None


def test_polymarket_skips_when_slug_not_found():
    session = FakeSession([])
    assert fetch_polymarket(session, "evt", "missing-slug") is None


def test_polymarket_skips_when_no_yes_outcome():
    session = FakeSession(
        polymarket_market(
            outcomes=json.dumps(["Trump", "Biden"]),
            outcomePrices=json.dumps(["0.5", "0.5"]),
        )
    )
    assert fetch_polymarket(session, "evt", "test-slug") is None


def test_polymarket_queries_by_slug():
    session = FakeSession(polymarket_market())
    fetch_polymarket(session, "evt", "test-slug")
    assert session.calls[0]["params"] == {"slug": "test-slug"}


# --- message schema -----------------------------------------------------------

def test_reading_message_schema():
    message = Reading("kalshi", "evt", "KXTEST-26", 0.8333333333, 0.84).to_message()
    assert message["venue"] == "kalshi"
    assert message["matched_event_id"] == "evt"
    assert message["contract_name"] == "KXTEST-26"
    assert message["probability"] == 0.833333  # rounded to 6 decimals
    assert message["raw_price"] == 0.84
    # ISO-8601 with UTC offset, parseable back to an aware datetime.
    parsed = datetime.fromisoformat(message["timestamp"])
    assert parsed.utcoffset() is not None
    assert parsed.utcoffset().total_seconds() == 0


def test_load_matched_events_reads_yaml(tmp_path):
    path = tmp_path / "events.yaml"
    path.write_text(
        "matched_events:\n"
        "  - event_id: a\n"
        "    kalshi_ticker: T\n"
        "    polymarket_slug: s\n"
    )
    events = producer_mod.load_matched_events(str(path))
    assert events == [{"event_id": "a", "kalshi_ticker": "T", "polymarket_slug": "s"}]
