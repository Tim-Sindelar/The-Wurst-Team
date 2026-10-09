from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.main import app


def identity(headers, **settings):
    request = Request(
        {
            "type": "http",
            "headers": [(key.lower().encode(), value.encode()) for key, value in headers.items()],
        }
    )
    return get_current_user(request, Settings(_env_file=None, **settings))


def test_proxy_identity_is_stable_and_distinct(monkeypatch):
    monkeypatch.delenv("AUTH_MODE", raising=False)
    headers = {"X-User-Id": "student@ethz.ch"}
    user = identity(headers)
    assert user == UUID("42d57044-31ad-52df-a975-b5a625501b3f")
    assert identity(headers) == user
    assert identity({**headers, "X-Demo-User-Id": "invalid"}) == user
    assert identity({"X-User-Id": "other@ethz.ch"}) != user


@pytest.mark.parametrize(
    "headers",
    [{}, {"X-User-Id": ""}, {"X-User-Id": " "}, {"X-Demo-User-Id": str(uuid4())}],
)
def test_proxy_requires_identity(headers):
    with pytest.raises(HTTPException) as error:
        identity(headers, auth_mode="proxy")
    assert error.value.status_code == 401


def test_demo_identity():
    default = identity({}, auth_mode="demo")
    other = uuid4()
    headers = {"X-Demo-User-Id": str(other)}
    assert identity(headers, auth_mode="demo") == other
    assert identity(headers, auth_mode="demo", dummy_auth_allow_header=False) == default
    with pytest.raises(HTTPException) as error:
        identity({"X-Demo-User-Id": "invalid"}, auth_mode="demo")
    assert error.value.status_code == 400


def test_protected_endpoint_requires_identity():
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, auth_mode="proxy")
    try:
        with TestClient(app) as client:
            assert client.get("/api/v1/me/reservation").status_code == 401
            assert client.get("/api/v1/health").status_code == 200
    finally:
        app.dependency_overrides.clear()
