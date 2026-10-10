from typing import Annotated
from urllib.parse import unquote
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.database import get_session
from app.features.reservations.schemas import BookingErrorResponse, RequestValidationErrorResponse
from app.features.reservations.service import BookingError
from app.features.social.schemas import (
    FriendRequestCreate,
    FriendRequestResponse,
    FriendRequestsResponse,
    FriendsResponse,
    PartiesResponse,
    PartyBook,
    PartyCancellation,
    PartyCreate,
    PartyInvite,
    PartyReply,
    PartyResponse,
    PrivacyUpdate,
    SocialCapabilities,
    SocialMe,
)
from app.features.social.service import SocialService
from app.schemas import ErrorResponse


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/api/v1/social", tags=["social"], dependencies=[Depends(no_store)])


@router.get(
    "/capabilities", response_model=SocialCapabilities, operation_id="get_social_capabilities"
)
def capabilities(settings: Annotated[Settings, Depends(get_settings)]) -> SocialCapabilities:
    return SocialCapabilities(enabled=settings.social_enabled)


def require_social(settings: Annotated[Settings, Depends(get_settings)]) -> None:
    if not settings.social_enabled:
        raise BookingError(404, "social_disabled", "Social features are unavailable")


feature_router = APIRouter(
    dependencies=[Depends(require_social)],
    responses={
        401: {"model": ErrorResponse},
        403: {"model": BookingErrorResponse},
        404: {"model": BookingErrorResponse},
        409: {"model": BookingErrorResponse},
        422: {"model": RequestValidationErrorResponse},
    },
)


def get_service(
    request: Request,
    user_id: Annotated[UUID, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
) -> SocialService:
    # Keep auth identity untouched and never publish email addresses to other users.
    name = (
        unquote(request.headers.get("X-User-Name", "")).strip() or "Study Spaces user"
        if settings.auth_mode == "proxy"
        else "Demo user"
    )
    return SocialService(session, settings, user_id, name)


Service = Annotated[SocialService, Depends(get_service)]


def saved[T](service: SocialService, result: T) -> T:
    service.session.commit()
    return result


@feature_router.get("/me", response_model=SocialMe, operation_id="get_social_me")
def me(service: Service) -> SocialMe:
    return service.me()


@feature_router.post("/me/invite-link", response_model=SocialMe, operation_id="create_friend_link")
def create_link(service: Service) -> SocialMe:
    return saved(service, service.create_link())


@feature_router.patch("/me/privacy", response_model=SocialMe, operation_id="update_social_privacy")
def privacy(request: PrivacyUpdate, service: Service) -> SocialMe:
    return saved(service, service.privacy(request.share_room))


@feature_router.get("/friends", response_model=FriendsResponse, operation_id="list_friends")
def friends(service: Service) -> FriendsResponse:
    return service.friends()


@feature_router.get(
    "/friend-requests", response_model=FriendRequestsResponse, operation_id="list_friend_requests"
)
def friend_requests(service: Service) -> FriendRequestsResponse:
    return service.friend_requests()


@feature_router.post(
    "/friend-requests", response_model=FriendRequestResponse, operation_id="send_friend_request"
)
def request_friend(request: FriendRequestCreate, service: Service) -> FriendRequestResponse:
    return saved(service, service.request_friend(request.invite_token))


@feature_router.post(
    "/friend-requests/{friendship_id}/accept",
    response_model=FriendRequestResponse,
    operation_id="accept_friend_request",
)
def accept_friend(friendship_id: UUID, service: Service) -> FriendRequestResponse:
    return saved(service, service.accept_friend(friendship_id))


@feature_router.delete(
    "/friendships/{friendship_id}", status_code=204, operation_id="delete_friendship"
)
def delete_friendship(friendship_id: UUID, service: Service) -> None:
    saved(service, service.delete_friendship(friendship_id))


@feature_router.get("/parties", response_model=PartiesResponse, operation_id="list_parties")
def parties(service: Service) -> PartiesResponse:
    return service.parties()


@feature_router.post(
    "/parties", response_model=PartyResponse, status_code=201, operation_id="create_party"
)
def create_party(request: PartyCreate, service: Service) -> PartyResponse:
    return saved(service, service.create_party(request.name))


@feature_router.get("/parties/{party_id}", response_model=PartyResponse, operation_id="get_party")
def party(party_id: UUID, service: Service) -> PartyResponse:
    return service.party(party_id)


@feature_router.post(
    "/parties/{party_id}/invitations",
    response_model=PartyResponse,
    operation_id="invite_party_member",
)
def invite(party_id: UUID, request: PartyInvite, service: Service) -> PartyResponse:
    return saved(service, service.invite(party_id, request.user_id))


@feature_router.post(
    "/parties/{party_id}/reply",
    response_model=PartyResponse,
    operation_id="reply_to_party_invitation",
)
def reply(party_id: UUID, request: PartyReply, service: Service) -> PartyResponse:
    return saved(service, service.reply(party_id, request.accept))


@feature_router.post("/parties/{party_id}/leave", status_code=204, operation_id="leave_party")
def leave(party_id: UUID, service: Service) -> None:
    saved(service, service.leave(party_id))


@feature_router.post(
    "/parties/{party_id}/book", response_model=PartyResponse, operation_id="book_party"
)
def book(party_id: UUID, request: PartyBook, service: Service) -> PartyResponse:
    return saved(service, service.book(party_id, request))


@feature_router.post(
    "/parties/{party_id}/cancel", response_model=PartyCancellation, operation_id="cancel_party"
)
def cancel(party_id: UUID, service: Service) -> PartyCancellation:
    return saved(service, service.cancel(party_id))


router.include_router(feature_router)
