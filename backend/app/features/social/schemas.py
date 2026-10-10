from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SocialCapabilities(BaseModel):
    enabled: bool


class SocialPerson(BaseModel):
    id: UUID
    name: str
    photo_url: str | None = None


class SocialMe(SocialPerson):
    share_room: bool


class DirectoryPerson(SocialPerson):
    relationship: Literal["none", "outgoing", "incoming", "friends"]
    friendship_id: UUID | None


class PeopleResponse(BaseModel):
    people: list[DirectoryPerson]


class PrivacyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    share_room: bool


class FriendRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: UUID


class FriendRequestResponse(BaseModel):
    id: UUID
    person: SocialPerson
    direction: Literal["incoming", "outgoing"]
    status: Literal["pending", "accepted"]


class FriendRequestsResponse(BaseModel):
    requests: list[FriendRequestResponse]


class SocialRoom(BaseModel):
    id: UUID
    name: str


class FriendResponse(BaseModel):
    friendship_id: UUID
    person: SocialPerson
    # null deliberately does not distinguish hidden location from no active session.
    room: SocialRoom | None


class FriendsResponse(BaseModel):
    friends: list[FriendResponse]


class PartyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)

    @model_validator(mode="after")
    def trim_name(self) -> "PartyCreate":
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Party name cannot be blank")
        return self


class PartyInvite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: UUID


class PartyReply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accept: bool


class SeatAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: UUID
    seat_id: UUID


class PartyBook(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assignments: list[SeatAssignment] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def distinct_assignments(self) -> "PartyBook":
        if len({item.user_id for item in self.assignments}) != len(self.assignments):
            raise ValueError("Assign each member exactly once")
        if len({item.seat_id for item in self.assignments}) != len(self.assignments):
            raise ValueError("Assign each seat exactly once")
        return self


class PartySeat(BaseModel):
    id: UUID
    label: str
    room: SocialRoom


class PartyMemberResponse(BaseModel):
    person: SocialPerson
    status: Literal["invited", "accepted", "declined", "left"]
    reservation_id: UUID | None
    seat: PartySeat | None


class PartyResponse(BaseModel):
    id: UUID
    name: str
    organizer_id: UUID
    status: Literal["open", "booked", "cancelled"]
    created_at: datetime
    members: list[PartyMemberResponse]


class PartiesResponse(BaseModel):
    parties: list[PartyResponse]


class PartyCancellation(BaseModel):
    party: PartyResponse
    cancelled_reservation_ids: list[UUID]
