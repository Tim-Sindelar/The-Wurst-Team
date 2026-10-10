from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, RootModel


class EventPerson(BaseModel):
    id: UUID
    name: str


class FriendRequestReceivedEvent(BaseModel):
    type: Literal["friend_request.received"] = "friend_request.received"
    friendship_id: UUID
    person: EventPerson


class FriendRequestAcceptedEvent(BaseModel):
    type: Literal["friend_request.accepted"] = "friend_request.accepted"
    friendship_id: UUID
    person: EventPerson


class PartyInvitedEvent(BaseModel):
    type: Literal["party.invited"] = "party.invited"
    party_id: UUID
    party_name: str
    person: EventPerson


class PartyRepliedEvent(BaseModel):
    type: Literal["party.replied"] = "party.replied"
    party_id: UUID
    party_name: str
    person: EventPerson
    accepted: bool


class PartyLeftEvent(BaseModel):
    type: Literal["party.left"] = "party.left"
    party_id: UUID
    party_name: str
    person: EventPerson


class PartyBookedEvent(BaseModel):
    type: Literal["party.booked"] = "party.booked"
    party_id: UUID
    party_name: str


class PartyCancelledEvent(BaseModel):
    type: Literal["party.cancelled"] = "party.cancelled"
    party_id: UUID
    party_name: str


class PingEvent(BaseModel):
    """Heartbeat so proxies keep an idle socket open. Clients ignore it."""

    type: Literal["ping"] = "ping"


type AnyEvent = (
    FriendRequestReceivedEvent
    | FriendRequestAcceptedEvent
    | PartyInvitedEvent
    | PartyRepliedEvent
    | PartyLeftEvent
    | PartyBookedEvent
    | PartyCancelledEvent
    | PingEvent
)


class ServerEvent(RootModel[Annotated[AnyEvent, Field(discriminator="type")]]):
    """One message on the /api/v1/events WebSocket."""
