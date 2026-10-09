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
