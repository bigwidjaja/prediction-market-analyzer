FROM python:3.12-slim

RUN pip install --no-cache-dir pyyaml==6.0.2 psycopg2-binary==2.9.10

WORKDIR /app
COPY load_matched_events.py .

CMD ["python", "load_matched_events.py"]
