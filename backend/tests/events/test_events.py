import asyncio
import json
import threading
from uuid import UUID

import pytest

from app.features.events import router as events_router
from app.features.events.hub import QUEUE_SIZE, EventHub
from app.features.events.schemas import PingEvent
from app.features.social import router as social_router
from tests.social.test_social import BASE, assignments, call, friendship, login, party

A, B, C = [UUID(int=index) for index in range(1, 4)]


@pytest.fixture
def published(monkeypatch):
    """Every (recipient, event type) the social routes publish, still delivered."""
    sent: list[tuple[UUID, str]] = []
    publish = social_router.hub.publish

    def record(user_id, event):
        sent.append((user_id, event.type))
        publish(user_id, event)

    monkeypatch.setattr(social_router.hub, "publish", record)
    return sent


def received(user, act, count=1):
    """The JSON events `user`'s stream sends while `act()` runs, after the opening ping."""

    async def scenario():
        frames = events_router.subscribed(user)
        try:
            assert json.loads((await anext(frames)).removeprefix("data: ")) == {"type": "ping"}
            await asyncio.to_thread(act)
            chunks = [await asyncio.wait_for(anext(frames), 2) for _ in range(count)]
        finally:
            await frames.aclose()
        assert all(chunk.startswith("data: ") and chunk.endswith("\n\n") for chunk in chunks)
        return [json.loads(chunk.removeprefix("data: ")) for chunk in chunks]

    return asyncio.run(scenario())


def test_friend_request_reaches_the_open_stream(social_client):
    client = social_client
    target = login(client, B)
    login(client, A)
    responses = []
    [event] = received(
        B,
        lambda: responses.append(
            call(client, "POST", BASE + "/friend-requests", A, {"user_id": target})
        ),
    )
    assert responses[0].status_code == 200, responses[0].text
    assert event["type"] == "friend_request.received"
    assert event["friendship_id"] == responses[0].json()["id"]
    assert event["person"] == {"id": str(A), "name": "Demo user"}

    path = BASE + f"/friend-requests/{event['friendship_id']}/accept"
    [accepted] = received(A, lambda: call(client, "POST", path, B))
    assert accepted["type"] == "friend_request.accepted"
    assert A not in social_router.hub._subscriptions


def test_friend_events_notify_only_new_changes(social_client, published):
    client = social_client
    target = login(client, B)
    first = call(client, "POST", BASE + "/friend-requests", A, {"user_id": target})
    retry = call(client, "POST", BASE + "/friend-requests", A, {"user_id": target})
    assert retry.status_code == 200
    failed = call(client, "POST", BASE + "/friend-requests", B, {"user_id": target})
    assert failed.status_code == 409
    relation = first.json()["id"]
    call(client, "POST", BASE + f"/friend-requests/{relation}/accept", B)
    call(client, "POST", BASE + f"/friend-requests/{relation}/accept", B)
    call(client, "DELETE", BASE + f"/friendships/{relation}", B)
    assert published == [(B, "friend_request.received"), (A, "friend_request.accepted")]


def test_party_events_reach_the_right_members(social_client, seats, published):
    client = social_client
    party_id = party(client, A, B, accept=False)
    friendship(client, A, C)
    published.clear()

    call(client, "POST", BASE + f"/parties/{party_id}/invitations", A, {"user_id": str(B)})
    call(client, "POST", BASE + f"/parties/{party_id}/invitations", A, {"user_id": str(C)})
    call(client, "POST", BASE + f"/parties/{party_id}/reply", B, {"accept": True})
    call(client, "POST", BASE + f"/parties/{party_id}/reply", C, {"accept": False})
    assert published == [
        (C, "party.invited"),
        (A, "party.replied"),
        (A, "party.replied"),
    ]

    published.clear()
    booked = call(client, "POST", BASE + f"/parties/{party_id}/book", A, assignments(seats))
    assert booked.status_code == 200, booked.text
    call(client, "POST", BASE + f"/parties/{party_id}/book", A, assignments(seats))
    call(client, "POST", BASE + f"/parties/{party_id}/cancel", A)
    call(client, "POST", BASE + f"/parties/{party_id}/cancel", A)
    assert published == [(B, "party.booked"), (B, "party.cancelled")]


def test_leaving_notifies_the_organizer(social_client, published):
    client = social_client
    party_id = party(client, A, B)
    published.clear()
    assert call(client, "POST", BASE + f"/parties/{party_id}/leave", B).status_code == 204
    assert published == [(A, "party.left")]


def test_hub_delivers_across_threads_and_drops_when_full():
    hub = EventHub()

    async def scenario():
        with hub.subscribe(A) as queue, hub.subscribe(B) as other:
            worker = threading.Thread(
                target=lambda: [hub.publish(A, PingEvent()) for _ in range(QUEUE_SIZE + 5)]
            )
            worker.start()
            await asyncio.to_thread(worker.join)
            await asyncio.sleep(0)
            assert queue.qsize() == QUEUE_SIZE
            assert other.empty()
        assert A not in hub._subscriptions

    asyncio.run(scenario())


def test_idle_streams_ping(monkeypatch):
    monkeypatch.setattr(events_router, "PING_SECONDS", 0.01)

    async def scenario():
        frames = events_router.stream(asyncio.Queue())
        chunks = [await anext(frames) for _ in range(2)]
        await frames.aclose()
        return chunks

    assert asyncio.run(scenario()) == ['data: {"type":"ping"}\n\n'] * 2


def test_proxy_mode_refuses_streams_without_a_user(client, policy):
    policy.auth_mode = "proxy"
    assert client.get("/api/v1/events").status_code == 401
