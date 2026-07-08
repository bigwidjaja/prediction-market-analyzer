"""Unit tests for the YAML validation in config_loader/load_matched_events.py."""

from load_matched_events import validation_error


def valid_entry(**overrides):
    entry = {
        "event_id": "fed-jul2026-no-change",
        "kalshi_ticker": "KXFEDDECISION-26JUL-H0",
        "polymarket_slug": "will-there-be-no-change",
        "description": "Fed holds in July 2026",
    }
    entry.update(overrides)
    return entry


def test_valid_config_passes():
    assert validation_error([valid_entry()]) is None


def test_description_is_optional():
    entry = valid_entry()
    del entry["description"]
    assert validation_error([entry]) is None


def test_empty_list_rejected():
    assert validation_error([]) is not None
    assert validation_error(None) is not None


def test_non_list_rejected():
    assert "must be a list" in validation_error({"event_id": "x"})


def test_missing_required_field_rejected():
    entry = valid_entry()
    del entry["kalshi_ticker"]
    error = validation_error([entry])
    assert error is not None
    assert "kalshi_ticker" in error


def test_non_mapping_entry_rejected():
    assert "not a mapping" in validation_error(["just-a-string"])


def test_duplicate_event_id_rejected():
    error = validation_error([valid_entry(), valid_entry()])
    assert error is not None
    assert "duplicate" in error
