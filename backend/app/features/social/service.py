from base64 import b64encode
from secrets import token_urlsafe
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import func, literal_column, or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import Settings
from app.features.events.schemas import (
    EventPerson,
    FriendRequestAcceptedEvent,
    FriendRequestReceivedEvent,
    PartyBookedEvent,
    PartyCancelledEvent,
    PartyInvitedEvent,
    PartyLeftEvent,
    PartyRepliedEvent,
)
from app.features.reservations.models import Reservation, Seat, StudySpace
from app.features.reservations.service import BookingError, ReservationService, reservation_states
from app.features.social.models import Friendship, Party, PartyMember, SocialUser
from app.features.social.schemas import (
    DirectoryPerson,
    FriendRequestResponse,
    FriendRequestsResponse,
    FriendResponse,
    FriendRoom,
    FriendsResponse,
    PartiesResponse,
    PartyBook,
    PartyCancellation,
    PartyMemberResponse,
    PartyResponse,
    PartySeat,
    PeopleResponse,
    SocialMe,
    SocialPerson,
    SocialRoom,
)
from app.models.profile import UserProfile


class SocialService:
    def __init__(self, session: Session, settings: Settings, user_id: UUID, name: str):
        self.session = session
        self.bookings = ReservationService(session, settings)
        self.user_id = user_id
        self.name = name[:80]
        # Sent by the router only after the transaction commits.
        self.events: list[tuple[UUID, BaseModel]] = []

    def _notify(self, user_id: UUID, event: BaseModel) -> None:
        self.events.append((user_id, event))

    def _me(self) -> EventPerson:
        return EventPerson(id=self.user_id, name=self.person(self.user_id).name)

    def enroll(self) -> SocialUser:
        self.session.execute(
            insert(SocialUser)
            .values(user_id=self.user_id, fallback_name=self.name, invite_token=token_urlsafe(24))
            .on_conflict_do_update(
                index_elements=[SocialUser.user_id], set_={"fallback_name": self.name}
            )
        )
        return self.session.get(SocialUser, self.user_id, populate_existing=True)

    def person(self, user_id: UUID) -> SocialPerson:
        profile = self.session.get(UserProfile, user_id)
        user = self.session.get(SocialUser, user_id)
        return SocialPerson(
            id=user_id,
            name=profile.name if profile else user.fallback_name if user else self.name,
            photo_url=(
                "data:image/png;base64," + b64encode(profile.photo).decode("ascii")
                if profile and profile.photo
                else None
            ),
        )

    def me(self) -> SocialMe:
        user = self.session.get(SocialUser, self.user_id)
        return SocialMe(
            **self.person(self.user_id).model_dump(),
            share_room=user.share_room if user else False,
        )

    def people(self, query: str) -> PeopleResponse:
        query = query.strip()
        if len(query) < 2:
            raise BookingError(422, "search_too_short", "Enter at least two characters")
        profiles = self.session.scalars(
            select(UserProfile)
            .where(
                UserProfile.id != self.user_id, UserProfile.name.icontains(query, autoescape=True)
            )
            .order_by(func.lower(UserProfile.name), UserProfile.id)
            .limit(20)
        )
        relations = {
            self._other(row): row
            for status in ("pending", "accepted")
            for row in self._relations(status)
        }
        people = []
        for profile in profiles:
            relation = relations.get(profile.id)
            relationship = (
                "none"
                if relation is None
                else "friends"
                if relation.status == "accepted"
                else "outgoing"
                if relation.requested_by == self.user_id
                else "incoming"
            )
            people.append(
                DirectoryPerson(
                    **self.person(profile.id).model_dump(),
                    relationship=relationship,
                    friendship_id=relation.id if relation else None,
                )
            )
        return PeopleResponse(people=people)

    def privacy(self, share_room: bool) -> SocialMe:
        user = self.enroll()
        user.share_room = share_room
        self.session.flush()
        return self.me()

    def _relations(self, status: str) -> list[Friendship]:
        return list(
            self.session.scalars(
                select(Friendship)
                .where(
                    or_(Friendship.user_low == self.user_id, Friendship.user_high == self.user_id),
                    Friendship.status == status,
                )
                .order_by(Friendship.created_at, Friendship.id)
            )
        )

    def _other(self, row: Friendship) -> UUID:
        return row.user_high if row.user_low == self.user_id else row.user_low

    def _request(self, row: Friendship) -> FriendRequestResponse:
        return FriendRequestResponse(
            id=row.id,
            person=self.person(self._other(row)),
            direction="outgoing" if row.requested_by == self.user_id else "incoming",
            status=row.status,
        )

    def friend_requests(self) -> FriendRequestsResponse:
        return FriendRequestsResponse(
            requests=[self._request(row) for row in self._relations("pending")]
        )

    def request_friend(self, user_id: UUID) -> FriendRequestResponse:
        target = self.session.get(UserProfile, user_id)
        if target is None:
            raise BookingError(404, "not_found", "User not found")
        if target.id == self.user_id:
            raise BookingError(409, "self_request", "You cannot add yourself")
        self.enroll()
        self.session.execute(
            insert(SocialUser)
            .values(user_id=target.id, fallback_name=target.name, invite_token=token_urlsafe(24))
            .on_conflict_do_nothing(index_elements=[SocialUser.user_id])
        )
        low, high = sorted((self.user_id, target.id))
        inserted = self.session.scalar(
            insert(Friendship)
            .values(user_low=low, user_high=high, requested_by=self.user_id, status="pending")
            # A no-op update holds the pair's row lock through commit, even if another
            # participant is concurrently cancelling/removing the existing relationship.
            .on_conflict_do_update(
                index_elements=[Friendship.user_low, Friendship.user_high],
                set_={"status": Friendship.status},
            )
            # xmax is 0 only for a freshly inserted row, so retries notify nobody.
            .returning(literal_column("xmax = 0"))
        )
        row = self.session.scalar(
            select(Friendship)
            .where(Friendship.user_low == low, Friendship.user_high == high)
            .with_for_update()
        )
        if row.status == "accepted":
            raise BookingError(409, "already_friends", "You are already friends")
        # Crossing requests never silently create friendship; the recipient must accept.
        if inserted:
            self._notify(
                target.id, FriendRequestReceivedEvent(friendship_id=row.id, person=self._me())
            )
        return self._request(row)

    def _friendship(self, friendship_id: UUID) -> Friendship:
        row = self.session.scalar(
            select(Friendship).where(Friendship.id == friendship_id).with_for_update()
        )
        if row is None or self.user_id not in {row.user_low, row.user_high}:
            raise BookingError(404, "not_found", "Friendship not found")
        return row

    def accept_friend(self, friendship_id: UUID) -> FriendRequestResponse:
        row = self._friendship(friendship_id)
        if row.requested_by == self.user_id:
            raise BookingError(403, "recipient_required", "Only the recipient can accept")
        if row.status != "accepted":
            row.status = "accepted"
            self.session.flush()
            event = FriendRequestAcceptedEvent(friendship_id=row.id, person=self._me())
            self._notify(row.requested_by, event)
        return self._request(row)

    def delete_friendship(self, friendship_id: UUID) -> None:
        # Either participant may decline/cancel a request or remove an accepted friendship.
        self.session.delete(self._friendship(friendship_id))
        self.session.flush()

    def friends(self) -> FriendsResponse:
        rows = self._relations("accepted")
        others = [self._other(row) for row in rows]
        sharing = list(
            self.session.scalars(
                select(SocialUser.user_id).where(
                    SocialUser.user_id.in_(others), SocialUser.share_room.is_(True)
                )
            )
        )
        rooms = {}
        for state in reservation_states(
            self.session, self.bookings.now(), user_ids=sharing, live_only=True
        ):
            if state.status in {"active", "on_break"}:
                seat = self.session.get(Seat, state.seat_id)
                space = self.session.get(StudySpace, seat.space_id)
                rooms[state.user_id] = FriendRoom(
                    id=space.id,
                    name=space.name,
                    seat_id=seat.id,
                    seat_label=seat.label,
                    on_break=state.status == "on_break",
                )
        return FriendsResponse(
            friends=[
                FriendResponse(
                    friendship_id=row.id,
                    person=self.person(self._other(row)),
                    room=rooms.get(self._other(row)),
                )
                for row in rows
            ]
        )

    def create_party(self, name: str) -> PartyResponse:
        self.enroll()
        self._lock_party_slot()
        self._require_party_slot(self.user_id)
        party = Party(organizer_id=self.user_id, name=name)
        self.session.add(party)
        self.session.flush()
        self.session.add(PartyMember(party_id=party.id, user_id=self.user_id, status="accepted"))
        self.session.flush()
        return self._detail(party)

    def _lock_party_slot(self) -> None:
        # Same user lock as booking: create/join and booking serialize, even across
        # different parties. Party mutations acquire their party lock first.
        self.session.execute(
            text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": self.user_id.int & ((1 << 63) - 1)},
        )

    def _require_party_slot(self, user_id: UUID, exclude: UUID | None = None) -> None:
        memberships = self.session.execute(
            select(Party, PartyMember)
            .join(PartyMember)
            .where(
                PartyMember.user_id == user_id,
                PartyMember.status == "accepted",
                Party.status != "cancelled",
                Party.id != exclude if exclude is not None else True,
            )
        ).all()
        live_ids = {
            state.id
            for state in reservation_states(
                self.session, self.bookings.now(), user_id=user_id, live_only=True
            )
        }
        if any(
            party.status == "open" or member.reservation_id in live_ids
            for party, member in memberships
        ):
            raise BookingError(
                409,
                "active_party_exists",
                "Only one active party per person. Leave or cancel your current party first.",
            )

    def _party(self, party_id: UUID, *, lock: bool = False, organizer: bool = False) -> Party:
        query = select(Party).where(Party.id == party_id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        party = self.session.scalar(query)
        member = self.session.get(PartyMember, (party_id, self.user_id), populate_existing=True)
        if (
            party is None
            or member is None
            or member.status not in {"invited", "accepted"}
            or (member.status == "invited" and party.status != "open")
        ):
            raise BookingError(404, "not_found", "Party not found")
        if organizer and party.organizer_id != self.user_id:
            raise BookingError(403, "organizer_required", "Only the organizer can do this")
        return party

    def _members(self, party: Party) -> list[PartyMember]:
        return list(
            self.session.scalars(
                select(PartyMember)
                .where(PartyMember.party_id == party.id)
                .order_by(PartyMember.user_id)
                .execution_options(populate_existing=True)
            )
        )

    def _detail(self, party: Party) -> PartyResponse:
        members = []
        for member in self._members(party):
            seat_info = None
            if member.reservation_id:
                reservation = self.session.get(Reservation, member.reservation_id)
                seat = self.session.get(Seat, reservation.seat_id)
                space = self.session.get(StudySpace, seat.space_id)
                seat_info = PartySeat(
                    id=seat.id, label=seat.label, room=SocialRoom(id=space.id, name=space.name)
                )
            members.append(
                PartyMemberResponse(
                    person=self.person(member.user_id),
                    status=member.status,
                    reservation_id=member.reservation_id,
                    seat=seat_info,
                )
            )
        return PartyResponse(
            id=party.id,
            name=party.name,
            organizer_id=party.organizer_id,
            status=party.status,
            created_at=party.created_at,
            members=members,
        )

    def party(self, party_id: UUID) -> PartyResponse:
        return self._detail(self._party(party_id))

    def parties(self) -> PartiesResponse:
        parties = self.session.scalars(
            select(Party)
            .join(PartyMember)
            .where(
                PartyMember.user_id == self.user_id,
                or_(
                    PartyMember.status == "accepted",
                    (PartyMember.status == "invited") & (Party.status == "open"),
                ),
            )
            .order_by(Party.created_at.desc(), Party.id)
        )
        return PartiesResponse(parties=[self._detail(party) for party in parties])

    def _open(self, party: Party) -> None:
        if party.status != "open":
            raise BookingError(409, "party_closed", "This party is no longer accepting changes")

    def invite(self, party_id: UUID, user_id: UUID) -> PartyResponse:
        party = self._party(party_id, lock=True, organizer=True)
        self._open(party)
        low, high = sorted((self.user_id, user_id))
        friend = self.session.scalar(
            select(Friendship)
            .where(
                Friendship.user_low == low,
                Friendship.user_high == high,
                Friendship.status == "accepted",
            )
            .with_for_update()
        )
        if friend is None:
            raise BookingError(409, "friend_required", "Invite an accepted friend")
        member = self.session.get(PartyMember, (party.id, user_id))
        if member and member.status in {"invited", "accepted"}:
            return self._detail(party)
        if sum(m.status in {"invited", "accepted"} for m in self._members(party)) >= 12:
            raise BookingError(409, "party_full", "A party can have at most 12 members")
        if member:
            member.status = "invited"
        else:
            self.session.add(PartyMember(party_id=party.id, user_id=user_id))
        self.session.flush()
        self._notify(
            user_id, PartyInvitedEvent(party_id=party.id, party_name=party.name, person=self._me())
        )
        return self._detail(party)

    def reply(self, party_id: UUID, accept: bool) -> PartyResponse:
        party = self._party(party_id, lock=True)
        self._open(party)
        member = self.session.get(PartyMember, (party.id, self.user_id))
        if member.status == "accepted" and accept:
            return self._detail(party)
        if member.status != "invited":
            raise BookingError(409, "not_invited", "There is no pending invitation")
        if accept:
            self._lock_party_slot()
            self._require_party_slot(self.user_id, exclude=party.id)
        member.status = "accepted" if accept else "declined"
        self.session.flush()
        self._notify(
            party.organizer_id,
            PartyRepliedEvent(
                party_id=party.id, party_name=party.name, person=self._me(), accepted=accept
            ),
        )
        return self._detail(party)

    def leave(self, party_id: UUID) -> None:
        party = self._party(party_id, lock=True)
        self._open(party)
        if party.organizer_id == self.user_id:
            raise BookingError(409, "organizer_cannot_leave", "The organizer must cancel the party")
        member = self.session.get(PartyMember, (party.id, self.user_id))
        member.status = "left"
        self.session.flush()
        self._notify(
            party.organizer_id,
            PartyLeftEvent(party_id=party.id, party_name=party.name, person=self._me()),
        )

    def book(self, party_id: UUID, request: PartyBook) -> PartyResponse:
        party = self._party(party_id, lock=True, organizer=True)
        assignments = {item.user_id: item.seat_id for item in request.assignments}
        members = self._members(party)
        accepted = {member.user_id for member in members if member.status == "accepted"}
        if set(assignments) != accepted:
            raise BookingError(409, "roster_changed", "Assign one seat to every accepted member")
        if party.status == "booked":
            # A retry cannot duplicate reservations or recreate cancelled/expired seats.
            previous = {
                member.user_id: self.session.get(Reservation, member.reservation_id).seat_id
                for member in members
                if member.reservation_id
            }
            if assignments == previous:
                return self._detail(party)
            raise BookingError(409, "already_booked", "This party already has a booking")
        self._open(party)
        rows, _now = self.bookings.reserve_party(assignments)
        # reserve_party holds every member's user lock in order. Recheck legacy
        # overlapping memberships before committing any group reservations.
        for user_id in accepted:
            self._require_party_slot(user_id, exclude=party.id)
        by_user = {row.user_id: row.id for row in rows}
        for member in members:
            if member.user_id in by_user:
                member.reservation_id = by_user[member.user_id]
        party.status = "booked"
        self.session.flush()
        for user_id in accepted - {self.user_id}:
            self._notify(user_id, PartyBookedEvent(party_id=party.id, party_name=party.name))
        return self._detail(party)

    def cancel(self, party_id: UUID) -> PartyCancellation:
        party = self._party(party_id, lock=True, organizer=True)
        cancelled = []
        if party.status != "cancelled":
            members = self._members(party)
            cancelled = self.bookings.cancel_unchecked(
                [m.reservation_id for m in members if m.reservation_id]
            )
            party.status = "cancelled"
            self.session.flush()
            for member in members:
                if member.user_id != self.user_id and member.status in {"invited", "accepted"}:
                    self._notify(
                        member.user_id,
                        PartyCancelledEvent(party_id=party.id, party_name=party.name),
                    )
        return PartyCancellation(party=self._detail(party), cancelled_reservation_ids=cancelled)
