from typing import Annotated
from uuid import UUID, uuid5

from fastapi import Depends, HTTPException, Request

from app.config import Settings, get_settings

USER_NAMESPACE = UUID("f3e45c1d-fc27-4dfc-b84d-463bc5637f35")


def get_current_user(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> UUID:
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
