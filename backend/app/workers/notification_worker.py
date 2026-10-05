"""Notification worker scaffold.

Full email-sending logic (templates, retries, email_logs bookkeeping) is
Phase 4. This Phase 1 scaffold proves the queue round-trips and gives the
Docker Compose `worker` service something real to run.
"""

from __future__ import annotations

import logging

from app.services.queue import NOTIFICATION_QUEUE_KEY, get_queue_backend

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("notification_worker")


def run_forever() -> None:
    backend = get_queue_backend()
    logger.info("Notification worker started, watching queue %s", NOTIFICATION_QUEUE_KEY)
    while True:
        job = backend.dequeue(NOTIFICATION_QUEUE_KEY, timeout=5)
        if job is None:
            continue
        logger.info("Received notification job: %s", job)
        # Phase 4: render template, send via EmailProvider, write email_logs,
        # retry with backoff on failure.


if __name__ == "__main__":
    run_forever()
