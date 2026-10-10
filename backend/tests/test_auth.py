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


@pytest.mark.parametrize("path", ["/api/v1/me", "/api/v1/me/reservation", "/api/v1/admin/spaces"])
def test_protected_endpoint_requires_identity(path):
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, auth_mode="proxy")
    try:
        with TestClient(app) as client:
            assert client.get(path, headers={"X-Demo-Admin": "true"}).status_code == 401
            assert client.get("/api/v1/health").status_code == 200
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize("override", ["true", "false", "invalid"])
@pytest.mark.parametrize("allow_header", [True, False])
def test_proxy_rejects_demo_admin_privileges(override, allow_header):
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None,
        auth_mode="proxy",
        dummy_is_admin=True,
        dummy_admin_allow_header=allow_header,
    )
    try:
        with TestClient(app) as client:
            response = client.get(
                "/api/v1/admin/spaces",
                headers={"X-User-Id": "student@ethz.ch", "X-Demo-Admin": override},
            )
            assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def profile_client():
    settings = Settings(_env_file=None, auth_mode="proxy")
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        with TestClient(app) as client:
            yield client, settings
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize(
    "headers, name",
    [
        ({"X-User-Name": "Zo%C3%AB + M%C3%BCller"}, "Zoë + Müller"),
        ({"X-User-Name": "  "}, "student@ethz.ch"),
        ({}, "student@ethz.ch"),
    ],
)
def test_proxy_profile(profile_client, headers, name):
    client, _settings = profile_client
    response = client.get("/api/v1/me", headers={"X-User-Id": "student@ethz.ch", **headers})
    assert response.status_code == 200
    assert response.json() == {
        "id": "42d57044-31ad-52df-a975-b5a625501b3f",
        "name": name,
        "email": "student@ethz.ch",
    }
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("allow_header", [True, False])
def test_demo_profile(profile_client, allow_header):
    client, settings = profile_client
    settings.auth_mode = "demo"
    settings.dummy_user_id = uuid4()
    settings.dummy_auth_allow_header = allow_header
    other = uuid4()
    response = client.get(
        "/api/v1/me",
        headers={
            "X-Demo-User-Id": str(other),
            "X-User-Id": "ignored@ethz.ch",
            "X-User-Name": "Ignored",
        },
    )
    assert response.status_code == 200
    assert response.json() == {
        "id": str(other if allow_header else settings.dummy_user_id),
        "name": "Demo user",
        "email": None,
    }
    assert response.headers["Cache-Control"] == "no-store"
