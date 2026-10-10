import asyncio
import threading
from uuid import UUID

import pytest
from starlette.testclient import WebSocketDenialResponse

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


def connect(client, user):
    return client.websocket_connect("/api/v1/events", headers={"X-Demo-User-Id": str(user)})


def test_friend_request_reaches_the_open_socket(social_client):
    client = social_client
    target = login(client, B)
    login(client, A)
    with connect(client, B) as socket:
        response = call(client, "POST", BASE + "/friend-requests", A, {"user_id": target})
        assert response.status_code == 200, response.text
        event = socket.receive_json()
    assert event["type"] == "friend_request.received"
    assert event["friendship_id"] == response.json()["id"]
    assert event["person"] == {"id": str(A), "name": "Demo user"}

    with connect(client, A) as socket:
        path = BASE + f"/friend-requests/{event['friendship_id']}/accept"
        accepted = call(client, "POST", path, B)
        assert accepted.status_code == 200, accepted.text
        assert socket.receive_json()["type"] == "friend_request.accepted"


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


def test_proxy_mode_refuses_sockets_without_a_user(client, policy):
    policy.auth_mode = "proxy"
    with pytest.raises(WebSocketDenialResponse) as denied:
        with client.websocket_connect("/api/v1/events"):
            pass
    assert denied.value.status_code == 401
