"""Spark Structured Streaming job: Kafka market-prices -> Postgres.

Step 3 (this version): pass-through only. Reads JSON readings from the
'market-prices' topic, parses them, and appends every reading to the
Postgres table market_prices via foreachBatch + JDBC.

The mispricing join/delta logic is added in step 4.
"""

import os

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import DoubleType, StringType, StructField, StructType

# --- configuration (env-overridable) -----------------------------------------
KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC", "market-prices")
POSTGRES_URL = os.environ.get("POSTGRES_URL", "jdbc:postgresql://postgres:5432/markets")
POSTGRES_USER = os.environ.get("POSTGRES_USER", "markets")
POSTGRES_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "markets")
CHECKPOINT_ROOT = os.environ.get("CHECKPOINT_ROOT", "/opt/checkpoints")

JDBC_OPTIONS = {
    "url": POSTGRES_URL,
    "user": POSTGRES_USER,
    "password": POSTGRES_PASSWORD,
    "driver": "org.postgresql.Driver",
}

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


def write_market_prices(batch_df: DataFrame, batch_id: int) -> None:
    """foreachBatch sink: append every raw reading to Postgres market_prices.

    Plain JDBC append => at-least-once (a batch replayed after a crash between
    the JDBC commit and the checkpoint commit is inserted twice). Acceptable
    for v1; documented in the README.
    """
    (
        batch_df.select(
            "venue", "matched_event_id", "contract_name",
            "probability", "raw_price", "timestamp",
        )
        .write.format("jdbc")
        .options(dbtable="market_prices", **JDBC_OPTIONS)
        .mode("append")
        .save()
    )


def main() -> None:
    spark = (
        SparkSession.builder.appName("mispricing-detector")
        # Local single-process job: cut the default 200 shuffle partitions.
        .config("spark.sql.shuffle.partitions", "4")
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

    raw_query.awaitTermination()


if __name__ == "__main__":
    main()
