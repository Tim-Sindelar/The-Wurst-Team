import asyncio
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, WebSocket

from app.auth import get_current_user
from app.features.events.hub import hub
from app.features.events.schemas import PingEvent

PING_SECONDS = 25

router = APIRouter(prefix="/api/v1", tags=["events"])


@router.websocket("/events")
async def events(websocket: WebSocket, user_id: Annotated[UUID, Depends(get_current_user)]) -> None:
    """Pushes the signed-in user's ServerEvent messages as JSON text frames."""
    await websocket.accept()
    with hub.subscribe(user_id) as queue:

        async def send() -> None:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), PING_SECONDS)
                except TimeoutError:
                    event = PingEvent()
                await websocket.send_text(event.model_dump_json())

        sender = asyncio.create_task(send())
        try:
            # Clients never send anything; reading only notices the close.
            while (await websocket.receive())["type"] != "websocket.disconnect":
                pass
        finally:
            sender.cancel()
            await asyncio.gather(sender, return_exceptions=True)
