"""Temporary demo identity. Replace get_current_user when real auth is introduced."""

from uuid import UUID

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from app.config import get_settings


class DummyAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        settings = get_settings()
        request.state.user_id = str(settings.dummy_user_id)
        if settings.dummy_auth_allow_header:
            request.state.user_id = request.headers.get("X-Demo-User-Id", request.state.user_id)
        return await call_next(request)


class DummyAdminMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        settings = get_settings()
        request.state.is_admin = settings.dummy_is_admin
        override = request.headers.get("X-Demo-Admin")
        if settings.dummy_admin_allow_header and override is not None:
            if override not in {"true", "false"}:
                return JSONResponse(
                    status_code=400, content={"detail": "X-Demo-Admin must be true or false"}
                )
            request.state.is_admin = override == "true"
        return await call_next(request)


def get_current_user(request: Request) -> UUID:
    try:
        return UUID(request.state.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="X-Demo-User-Id must be a UUID") from exc


def get_current_admin(request: Request) -> UUID:
    user_id = get_current_user(request)
    if not request.state.is_admin:
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user_id
