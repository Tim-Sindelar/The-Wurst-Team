import asyncio
from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth import get_current_user
from app.features.events.hub import hub
from app.features.events.schemas import PingEvent

PING_SECONDS = 25

router = APIRouter(prefix="/api/v1", tags=["events"])


def frame(event: BaseModel) -> str:
    return f"data: {event.model_dump_json()}\n\n"


async def stream(queue: asyncio.Queue[BaseModel]) -> AsyncIterator[str]:
    """Server-sent event frames from a hub queue, with a ping when idle."""
    # The first frame sends the headers through every proxy, so the client opens at once.
    yield frame(PingEvent())
    while True:
        try:
            event = await asyncio.wait_for(queue.get(), PING_SECONDS)
        except TimeoutError:
            event = PingEvent()
        yield frame(event)


async def subscribed(user_id: UUID) -> AsyncIterator[str]:
    # Starlette cancels this generator when the client goes, which ends the subscription.
    with hub.subscribe(user_id) as queue:
        async for chunk in stream(queue):
            yield chunk


# Server-sent events, not a WebSocket: the organisers' edge proxy rejects WebSocket
# upgrades, while a streamed GET passes it like any other API call.
@router.get("/events", include_in_schema=False)
def events(user_id: Annotated[UUID, Depends(get_current_user)]) -> StreamingResponse:
    """Streams the signed-in user's ServerEvent messages as server-sent events."""
    return StreamingResponse(
        subscribed(user_id),
        media_type="text/event-stream",
        # no-transform keeps proxies (Caddy's encode among them) from compressing and
        # so buffering the stream; X-Accel-Buffering does the same for nginx.
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
