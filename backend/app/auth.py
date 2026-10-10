from base64 import b64encode
from io import BytesIO
from typing import Annotated
from urllib.parse import unquote
from uuid import UUID, uuid5

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, UploadFile
from PIL import Image, ImageOps
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from starlette.requests import HTTPConnection

from app.config import Settings, get_settings
from app.database import get_session
from app.models.profile import UserProfile
from app.schemas import ErrorResponse, UserResponse

USER_NAMESPACE = UUID("f3e45c1d-fc27-4dfc-b84d-463bc5637f35")
router = APIRouter(prefix="/api/v1", tags=["auth"])
MAX_PHOTO_BYTES = 12 * 1024 * 1024


def get_current_user(
    request: HTTPConnection, settings: Annotated[Settings, Depends(get_settings)]
) -> UUID:
    # HTTPConnection, not Request, so WebSocket routes authenticate the same way.
    if settings.auth_mode == "proxy":
        email = request.headers.get("X-User-Id", "").strip()
        if not email:
            raise HTTPException(status_code=401, detail="Authentication required")
        return uuid5(USER_NAMESPACE, email)
    if not settings.dummy_auth_allow_header:
        return settings.dummy_user_id
    try:
        return UUID(request.headers.get("X-Demo-User-Id", str(settings.dummy_user_id)))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="X-Demo-User-Id must be a UUID") from exc


def get_current_admin(
    request: Request,
    user_id: Annotated[UUID, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UUID:
    if settings.auth_mode != "demo":
        if user_id in settings.admin_user_ids:
            return user_id
        raise HTTPException(status_code=403, detail="Administrator access required")
    is_admin = settings.dummy_is_admin
    override = request.headers.get("X-Demo-Admin")
    if settings.dummy_admin_allow_header and override is not None:
        if override not in {"true", "false"}:
            raise HTTPException(status_code=400, detail="X-Demo-Admin must be true or false")
        is_admin = override == "true"
    if not is_admin:
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user_id


@router.get(
    "/me",
    response_model=UserResponse,
    operation_id="get_me",
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}},
)
def get_me(
    request: Request,
    response: Response,
    user_id: Annotated[UUID, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
) -> UserResponse:
    response.headers["Cache-Control"] = "no-store"
    profile = session.get(UserProfile, user_id)
    if settings.auth_mode == "demo":
        name, email = "Demo user", None
    else:
        email = request.headers["X-User-Id"].strip()
        name = unquote(request.headers.get("X-User-Name", "")).strip() or "Study Spaces user"
    # The app loads /me on sign-in. Register the public display profile once,
    # preserving subsequent profile edits and never using email as a public name.
    if profile is None:
        session.execute(
            insert(UserProfile)
            .values(id=user_id, name=name[:80])
            .on_conflict_do_nothing(index_elements=[UserProfile.id])
        )
        session.commit()
        profile = session.get(UserProfile, user_id)
    photo_url = None
    if profile:
        name = profile.name
        if profile.photo:
            photo_url = "data:image/png;base64," + b64encode(profile.photo).decode("ascii")
    return UserResponse(id=user_id, name=name, email=email, photo_url=photo_url)


def prepare_photo(photo: UploadFile) -> bytes:
    if photo.size is not None and photo.size > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photo must be 12 MiB or smaller")
    data = photo.file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photo must be 12 MiB or smaller")
    try:
        with Image.open(BytesIO(data), formats=("JPEG", "PNG", "WEBP")) as source:
            if source.width * source.height > 16_000_000:
                raise HTTPException(status_code=400, detail="Photo must be at most 16 megapixels")
            source.load()
            image = ImageOps.exif_transpose(source).convert("RGBA")
            image.thumbnail((256, 256))
            image.info.clear()
            output = BytesIO()
            image.save(output, format="PNG")
            return output.getvalue()
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(
            status_code=400, detail="Upload a valid JPEG, PNG or WebP photo"
        ) from exc


@router.patch(
    "/me",
    response_model=UserResponse,
    operation_id="update_me",
    responses={
        400: {"model": ErrorResponse},
        401: {"model": ErrorResponse},
        413: {"model": ErrorResponse},
    },
)
def update_me(
    request: Request,
    response: Response,
    user_id: Annotated[UUID, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    name: Annotated[str, Form(min_length=1, max_length=80)],
    photo: UploadFile | None = None,
    remove_photo: Annotated[bool, Form()] = False,
) -> UserResponse:
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Display name cannot be blank")
    if photo and remove_photo:
        raise HTTPException(status_code=400, detail="Choose a photo or remove it, not both")
    changes: dict[str, str | bytes | None] = {"name": name}
    if photo:
        changes["photo"] = prepare_photo(photo)
    elif remove_photo:
        changes["photo"] = None
    statement = insert(UserProfile).values(id=user_id, **changes)
    session.execute(statement.on_conflict_do_update(index_elements=[UserProfile.id], set_=changes))
    session.commit()
    return get_me(request, response, user_id, settings, session)
