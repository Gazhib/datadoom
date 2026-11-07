"""All evaluator callers in this process share the configured capacity."""

from threading import BoundedSemaphore, Lock

_lock = Lock()
_limits: dict[int, BoundedSemaphore] = {}


def evaluation_slots(capacity: int) -> BoundedSemaphore:
    with _lock:
        return _limits.setdefault(capacity, BoundedSemaphore(capacity))
