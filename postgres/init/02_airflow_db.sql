-- Separate database for Airflow's metadata, inside the same Postgres
-- container (keeps the compose file to one Postgres service).
-- The pipeline tables live in the 'markets' database; Airflow's internal
-- state lives in 'airflow'.
CREATE USER airflow WITH PASSWORD 'airflow';
CREATE DATABASE airflow OWNER airflow;
