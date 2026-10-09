"""Temporary demo identity. Replace get_current_user when real auth is introduced."""

from uuid import UUID

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app.config import get_settings


class DummyAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        settings = get_settings()
        request.state.user_id = str(settings.dummy_user_id)
        if settings.dummy_auth_allow_header:
            request.state.user_id = request.headers.get("X-Demo-User-Id", request.state.user_id)
        return await call_next(request)


def get_current_user(request: Request) -> UUID:
    try:
        return UUID(request.state.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="X-Demo-User-Id must be a UUID") from exc
