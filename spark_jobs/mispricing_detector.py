"""Spark Structured Streaming job: cross-venue mispricing detection.

Two independent streaming queries over the same Kafka source:

1. Pass-through (step 3): every reading from the 'market-prices' topic is
   appended to the Postgres table market_prices via foreachBatch.

2. Mispricing detector (step 4): the topic is split into a Kalshi stream and
   a Polymarket stream, which are stream-stream joined per matched_event_id
   with an event-time interval constraint. Pairs whose probability delta
   exceeds MISPRICING_THRESHOLD are appended to mispricing_signals.

Join semantics — why an interval join and not "latest vs latest":
  Spark has no native "latest per key vs latest per key" stream-stream join
  (that needs custom stateful processing). Instead we join readings whose
  event times are within JOIN_TOLERANCE_SECONDS of each other. Because the
  producer polls both venues in the same loop (~45s), every Kalshi reading
  pairs with the Polymarket reading(s) taken at nearly the same moment —
  which is what a mispricing comparison actually wants: never compare a
  fresh price against a stale one. Watermarks bound the join state and
  tolerate the two venues' readings arriving at slightly different times.

Each query has its own checkpoint directory, so they recover independently.

Delivery semantics — effectively-once:
  Sinks INSERT via psycopg2 with ON CONFLICT DO NOTHING against the natural
  keys (market_prices: venue+event+timestamp; mispricing_signals:
  event+kalshi_ts). A micro-batch replayed after a crash between the DB
  commit and the checkpoint commit therefore inserts nothing new, and the
  same Kalshi reading pairing with Polymarket readings across SEVERAL
  micro-batches (possible with an interval join) yields exactly one signal.

  The batches are tiny by construction (a handful of matched events polled
  every ~45s, 30s triggers), so rows are collected to the driver and written
  in one INSERT ... executemany per batch. If the config ever grows to
  thousands of events, switch to a staging-table + merge pattern.
"""

import os

import psycopg2
import psycopg2.extras
from pyspark.sql import DataFrame, SparkSession, Window
from pyspark.sql import functions as F
from pyspark.sql.types import DoubleType, StringType, StructField, StructType

# --- configuration (env-overridable) -----------------------------------------
KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC", "market-prices")
POSTGRES_DSN = os.environ.get(
    "POSTGRES_DSN", "postgresql://markets:markets@postgres:5432/markets"
)
CHECKPOINT_ROOT = os.environ.get("CHECKPOINT_ROOT", "/opt/checkpoints")

# SIMPLIFICATION: the default 0.05 (5 percentage points) is a rough proxy for
# "edge after estimated fees" (Kalshi taker fees ~1c/contract near the middle
# of the book, Polymarket relayer/gas costs, plus slippage on thin books).
# A real trading system would model fees per venue, per price level, and per
# order size; for this pipeline a flat probability-delta threshold is enough
# to demonstrate the streaming mechanics.
MISPRICING_THRESHOLD = float(os.environ.get("MISPRICING_THRESHOLD", "0.05"))

# Readings further apart than this (event time) are never considered a pair.
# 2x the producer poll interval: adjacent poll cycles can pair, distant ones
# cannot.
JOIN_TOLERANCE_SECONDS = int(os.environ.get("JOIN_TOLERANCE_SECONDS", "90"))

# How late a reading may arrive (event time) before Spark drops its join
# state. Generous relative to the 45s poll interval.
WATERMARK = os.environ.get("WATERMARK", "2 minutes")

# Schema of the JSON messages produced by producer/producer.py.
READING_SCHEMA = StructType(
    [
        StructField("venue", StringType(), nullable=False),
        StructField("matched_event_id", StringType(), nullable=False),
        StructField("contract_name", StringType(), nullable=False),
        StructField("probability", DoubleType(), nullable=False),
        StructField("raw_price", DoubleType(), nullable=False),
        StructField("timestamp", StringType(), nullable=False),  # ISO-8601 UTC
    ]
)

MARKET_PRICES_INSERT = """
INSERT INTO market_prices
    (venue, matched_event_id, contract_name, probability, raw_price, "timestamp")
VALUES (%s, %s, %s, %s, %s, %s)
ON CONFLICT (venue, matched_event_id, "timestamp") DO NOTHING
"""

SIGNALS_INSERT = """
INSERT INTO mispricing_signals
    (matched_event_id, kalshi_probability, polymarket_probability,
     delta, "timestamp", kalshi_ts, detected_at)
VALUES (%s, %s, %s, %s, %s, %s, now())
ON CONFLICT (matched_event_id, kalshi_ts) DO NOTHING
"""


def insert_rows(sql: str, rows: list[tuple]) -> None:
    """Idempotent batch insert on the driver (see delivery-semantics note)."""
    if not rows:
        return
    # Timestamps arrive as offset-less strings rendered in the Spark session
    # timezone (UTC); the connection timezone is pinned to UTC so Postgres
    # interprets them as the same instant.
    with psycopg2.connect(POSTGRES_DSN, options="-c timezone=utc") as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, sql, rows)


def build_readings_stream(spark: SparkSession) -> DataFrame:
    """Kafka source -> parsed, typed stream of price readings (event-time ts)."""
    raw = (
        spark.readStream.format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_BOOTSTRAP)
        .option("subscribe", KAFKA_TOPIC)
        # First run consumes the topic from the beginning; afterwards the
        # checkpoint tracks offsets and this option is ignored.
        .option("startingOffsets", "earliest")
        .load()
    )

    return (
        raw.select(F.from_json(F.col("value").cast("string"), READING_SCHEMA).alias("r"))
        .select("r.*")
        # ISO-8601 with offset -> proper TimestampType (stored as UTC instant).
        .withColumn("timestamp", F.to_timestamp("timestamp"))
        .filter(F.col("matched_event_id").isNotNull() & F.col("probability").isNotNull())
    )


# --- query 1: raw pass-through ------------------------------------------------

def write_market_prices(batch_df: DataFrame, batch_id: int) -> None:
    """foreachBatch sink: idempotent insert of every raw reading."""
    rows = [
        (r.venue, r.matched_event_id, r.contract_name,
         r.probability, r.raw_price, r.timestamp)
        for r in batch_df.select(
            "venue", "matched_event_id", "contract_name",
            "probability", "raw_price",
            # Cast to string in the session timezone (UTC): collect() would
            # otherwise localize timestamps to the driver's OS timezone.
            F.col("timestamp").cast("string").alias("timestamp"),
        ).collect()
    ]
    insert_rows(MARKET_PRICES_INSERT, rows)


# --- query 2: cross-venue join + mispricing signals ---------------------------

def build_signals_stream(readings: DataFrame) -> DataFrame:
    """Interval-join Kalshi vs Polymarket readings and compute the delta."""
    kalshi = (
        readings.filter(F.col("venue") == "kalshi")
        .select(
            F.col("matched_event_id").alias("k_event_id"),
            F.col("probability").alias("kalshi_probability"),
            F.col("timestamp").alias("kalshi_ts"),
        )
        .withWatermark("kalshi_ts", WATERMARK)
    )
    polymarket = (
        readings.filter(F.col("venue") == "polymarket")
        .select(
            F.col("matched_event_id").alias("p_event_id"),
            F.col("probability").alias("polymarket_probability"),
            F.col("timestamp").alias("poly_ts"),
        )
        .withWatermark("poly_ts", WATERMARK)
    )

    # Inner stream-stream join: same event, readings taken within the
    # tolerance window of each other. The time-range predicate is what lets
    # Spark expire join state using the watermarks.
    joined = kalshi.join(
        polymarket,
        on=F.expr(
            f"""
            k_event_id = p_event_id
            AND poly_ts BETWEEN kalshi_ts - INTERVAL {JOIN_TOLERANCE_SECONDS} SECONDS
                            AND kalshi_ts + INTERVAL {JOIN_TOLERANCE_SECONDS} SECONDS
            """
        ),
        how="inner",
    )

    return (
        joined.withColumn(
            "delta", F.abs(F.col("kalshi_probability") - F.col("polymarket_probability"))
        )
        .withColumn("timestamp", F.greatest("kalshi_ts", "poly_ts"))
        .withColumn(
            "pair_gap_seconds",
            F.abs(F.col("kalshi_ts").cast("double") - F.col("poly_ts").cast("double")),
        )
        .select(
            F.col("k_event_id").alias("matched_event_id"),
            "kalshi_probability",
            "polymarket_probability",
            "delta",
            "timestamp",
            "kalshi_ts",
            "pair_gap_seconds",
        )
        .filter(F.col("delta") > MISPRICING_THRESHOLD)
    )


def dedupe_signals_batch(batch_df: DataFrame) -> DataFrame:
    """Keep only the closest-in-time pair per (event, Kalshi reading).

    The interval join can pair one Kalshi reading with 2-3 Polymarket readings
    (adjacent poll cycles fall inside the tolerance window). Within a
    micro-batch this window function picks the closest pair; ACROSS
    micro-batches the ON CONFLICT (matched_event_id, kalshi_ts) key in the
    sink guarantees at most one signal per Kalshi reading overall.
    """
    closest_pair = Window.partitionBy("matched_event_id", "kalshi_ts").orderBy(
        F.col("pair_gap_seconds").asc(), F.col("timestamp").asc()
    )
    return (
        batch_df.withColumn("rank", F.row_number().over(closest_pair))
        .filter(F.col("rank") == 1)
        .select(
            "matched_event_id", "kalshi_probability", "polymarket_probability",
            "delta",
            # String casts render in session timezone (UTC); see
            # write_market_prices for why collect() of raw timestamps is unsafe.
            F.col("timestamp").cast("string").alias("timestamp"),
            F.col("kalshi_ts").cast("string").alias("kalshi_ts"),
        )
    )


def write_mispricing_signals(batch_df: DataFrame, batch_id: int) -> None:
    """foreachBatch sink: dedupe pairs, then idempotently insert signals."""
    rows = [
        (r.matched_event_id, r.kalshi_probability, r.polymarket_probability,
         r.delta, r.timestamp, r.kalshi_ts)
        for r in dedupe_signals_batch(batch_df).collect()
    ]
    insert_rows(SIGNALS_INSERT, rows)


def main() -> None:
    spark = (
        SparkSession.builder.appName("mispricing-detector")
        # Local single-process job: cut the default 200 shuffle partitions.
        .config("spark.sql.shuffle.partitions", "4")
        # Collected timestamps must be unambiguous UTC (see insert_rows).
        .config("spark.sql.session.timeZone", "UTC")
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("WARN")

    readings = build_readings_stream(spark)

    raw_query = (
        readings.writeStream.foreachBatch(write_market_prices)
        .option("checkpointLocation", f"{CHECKPOINT_ROOT}/market_prices")
        .trigger(processingTime="30 seconds")
        .start()
    )

    signals_query = (
        build_signals_stream(readings)
        .writeStream.foreachBatch(write_mispricing_signals)
        .option("checkpointLocation", f"{CHECKPOINT_ROOT}/mispricing_signals")
        .trigger(processingTime="30 seconds")
        .start()
    )

    # Run both queries until either fails (container restarts on failure).
    spark.streams.awaitAnyTermination()
    raise SystemExit(f"streaming query terminated: raw={raw_query.exception()}, "
                     f"signals={signals_query.exception()}")


if __name__ == "__main__":
    main()
