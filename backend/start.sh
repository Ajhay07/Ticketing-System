#!/bin/sh
# Start both the API server and the notification worker.
# Railway runs this as the single entry point; both processes
# share the same container and env vars.

python -m app.workers.notification_worker &
exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
