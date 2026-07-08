FROM apache/spark:3.5.3

# Connector jars are baked into the image at build time so runtime needs no
# Maven/Ivy resolution (deterministic startup, works offline):
#   - spark-sql-kafka + its two runtime deps -> Kafka structured streaming source
USER root
RUN set -eux; \
    cd /opt/spark/jars; \
    curl -fsSLO https://repo1.maven.org/maven2/org/apache/spark/spark-sql-kafka-0-10_2.12/3.5.3/spark-sql-kafka-0-10_2.12-3.5.3.jar; \
    curl -fsSLO https://repo1.maven.org/maven2/org/apache/spark/spark-token-provider-kafka-0-10_2.12/3.5.3/spark-token-provider-kafka-0-10_2.12-3.5.3.jar; \
    curl -fsSLO https://repo1.maven.org/maven2/org/apache/kafka/kafka-clients/3.4.1/kafka-clients-3.4.1.jar; \
    curl -fsSLO https://repo1.maven.org/maven2/org/apache/commons/commons-pool2/2.11.1/commons-pool2-2.11.1.jar

# psycopg2 powers the idempotent ON CONFLICT sinks in the job (the plain JDBC
# writer can only blind-append, which duplicates rows on micro-batch replay).
RUN pip3 install --no-cache-dir psycopg2-binary==2.9.10

# Writable checkpoint dir for the streaming queries (mounted as a named volume).
RUN mkdir -p /opt/checkpoints && chown -R spark:spark /opt/checkpoints

WORKDIR /opt/app
COPY mispricing_detector.py .
RUN chown -R spark:spark /opt/app

USER spark
ENTRYPOINT ["/opt/spark/bin/spark-submit", "--master", "local[2]", "/opt/app/mispricing_detector.py"]
