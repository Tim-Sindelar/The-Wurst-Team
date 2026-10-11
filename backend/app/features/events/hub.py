import asyncio
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from threading import Lock
from uuid import UUID

from pydantic import BaseModel

QUEUE_SIZE = 50


@dataclass(eq=False)
class Subscription:
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue[BaseModel] = field(
        default_factory=lambda: asyncio.Queue(maxsize=QUEUE_SIZE)
    )


def offer(queue: asyncio.Queue[BaseModel], event: BaseModel) -> None:
    try:
        queue.put_nowait(event)
    except asyncio.QueueFull:
        # A client this far behind is gone or stuck; dropping beats blocking publishers.
        pass


class EventHub:
    """In-process fan-out from request handlers to each user's open sockets.

    Only correct with a single backend process; more workers would need
    Postgres LISTEN/NOTIFY behind the same publish().
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._subscriptions: dict[UUID, set[Subscription]] = {}

    @contextmanager
    def subscribe(self, user_id: UUID) -> Iterator[asyncio.Queue[BaseModel]]:
        subscription = Subscription(asyncio.get_running_loop())
        with self._lock:
            self._subscriptions.setdefault(user_id, set()).add(subscription)
        try:
            yield subscription.queue
        finally:
            with self._lock:
                subscriptions = self._subscriptions.get(user_id, set())
                subscriptions.discard(subscription)
                if not subscriptions:
                    self._subscriptions.pop(user_id, None)

    def publish(self, user_id: UUID, event: BaseModel) -> None:
        """Thread safe: sync routes call this from the threadpool."""
        with self._lock:
            subscriptions = list(self._subscriptions.get(user_id, ()))
        for subscription in subscriptions:
            try:
                subscription.loop.call_soon_threadsafe(offer, subscription.queue, event)
            except RuntimeError:
                # The socket's loop has closed; its subscription is about to go away.
                pass


hub = EventHub()
