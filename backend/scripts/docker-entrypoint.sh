#!/bin/sh
set -e
alembic upgrade head
export AUTO_MIGRATE_ON_STARTUP=false
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "${API_WORKERS:-1}"
