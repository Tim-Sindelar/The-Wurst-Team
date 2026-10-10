from base64 import b64decode
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.database import get_session
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
def profile_client(db):
    def test_session():
        with Session(db) as session:
            yield session

    settings = Settings(_env_file=None, auth_mode="proxy")
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_session] = test_session
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
        "photo_url": None,
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
        "photo_url": None,
    }
    assert response.headers["Cache-Control"] == "no-store"


def photo_bytes(format="PNG", size=(320, 160)):
    output = BytesIO()
    Image.new("RGB", size, "red").save(output, format=format)
    return output.getvalue()


@pytest.mark.parametrize("mode", ["demo", "proxy"])
def test_profile_edits_persist_without_changing_identity(profile_client, mode):
    client, settings = profile_client
    settings.auth_mode = mode
    owner = {"X-User-Id": "student@ethz.ch", "X-User-Name": "Original Name"}
    original = client.get("/api/v1/me", headers=owner).json()
    response = client.patch("/api/v1/me", headers=owner, data={"name": "  New Name  "})
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json() == {**original, "name": "New Name"}
    assert client.get("/api/v1/me", headers=owner).json() == response.json()
    other = {"X-User-Id": "other@ethz.ch", "X-Demo-User-Id": str(uuid4())}
    assert client.get("/api/v1/me", headers=other).json()["name"] != "New Name"
    assert client.patch("/api/v1/me", headers=other, data={"name": "Other"}).status_code == 200
    assert client.get("/api/v1/me", headers=owner).json()["name"] == "New Name"


@pytest.mark.parametrize("format", ["JPEG", "PNG", "WEBP"])
def test_profile_photo_upload_preserve_replace_and_remove(profile_client, format):
    client, _settings = profile_client
    owner = {"X-User-Id": "student@ethz.ch"}
    response = client.patch(
        "/api/v1/me",
        headers=owner,
        data={"name": "My profile"},
        files={"photo": ("../../photo", photo_bytes(format), "application/octet-stream")},
    )
    assert response.status_code == 200
    saved = response.json()
    assert client.get("/api/v1/me", headers=owner).json() == saved
    with Image.open(BytesIO(b64decode(saved["photo_url"].split(",")[1]))) as photo:
        assert photo.format == "PNG"
        assert photo.size == (256, 128)
        assert not photo.getexif()
    renamed = client.patch("/api/v1/me", headers=owner, data={"name": "Renamed"})
    assert renamed.json()["photo_url"] == saved["photo_url"]
    replaced = client.patch(
        "/api/v1/me",
        headers=owner,
        data={"name": "Renamed"},
        files={"photo": ("new.png", photo_bytes(size=(64, 64)), "image/png")},
    )
    assert replaced.status_code == 200
    assert replaced.json()["photo_url"] != saved["photo_url"]
    other = client.get("/api/v1/me", headers={"X-User-Id": "other@ethz.ch"})
    assert other.json()["photo_url"] is None
    removed = client.patch(
        "/api/v1/me", headers=owner, data={"name": "Renamed", "remove_photo": "true"}
    )
    assert removed.status_code == 200
    assert client.get("/api/v1/me", headers=owner).json()["photo_url"] is None


@pytest.mark.parametrize("name", ["", "   ", "a" * 81])
def test_profile_rejects_invalid_name(profile_client, name):
    client, _settings = profile_client
    owner = {"X-User-Id": "student@ethz.ch"}
    original = client.get("/api/v1/me", headers=owner).json()
    response = client.patch("/api/v1/me", headers=owner, data={"name": name})
    assert response.status_code in {400, 422}
    assert client.get("/api/v1/me", headers=owner).json() == original


@pytest.mark.parametrize(
    "data, status",
    [(b"not an image", 400), (b"<svg></svg>", 400), (b"a" * (2 * 1024 * 1024 + 1), 413)],
    ids=["invalid", "svg", "oversized"],
)
def test_profile_rejects_invalid_photo_atomically(profile_client, data, status):
    client, _settings = profile_client
    owner = {"X-User-Id": "student@ethz.ch"}
    original = client.get("/api/v1/me", headers=owner).json()
    response = client.patch(
        "/api/v1/me",
        headers=owner,
        data={"name": "Should not save"},
        files={"photo": ("photo.png", data, "image/png")},
    )
    assert response.status_code == status
    assert client.get("/api/v1/me", headers=owner).json() == original


def test_profile_update_requires_identity(profile_client):
    client, _settings = profile_client
    assert client.patch("/api/v1/me", data={"name": "Nobody"}).status_code == 401


def test_profile_rejects_large_dimensions(profile_client):
    client, _settings = profile_client
    response = client.patch(
        "/api/v1/me",
        headers={"X-User-Id": "student@ethz.ch"},
        data={"name": "Student"},
        files={"photo": ("large.png", photo_bytes(size=(4001, 4000)), "image/png")},
    )
    assert response.status_code == 400
    assert "16 megapixels" in response.json()["detail"]


def test_profile_photo_orientation_and_metadata(profile_client):
    client, _settings = profile_client
    output = BytesIO()
    metadata = Image.Exif()
    metadata[274] = 6
    metadata[315] = "Private metadata"
    Image.new("RGB", (320, 160), "blue").save(output, format="JPEG", exif=metadata)
    response = client.patch(
        "/api/v1/me",
        headers={"X-User-Id": "student@ethz.ch"},
        data={"name": "Student"},
        files={"photo": ("portrait.jpg", output.getvalue(), "image/jpeg")},
    )
    assert response.status_code == 200
    with Image.open(BytesIO(b64decode(response.json()["photo_url"].split(",")[1]))) as photo:
        assert photo.size == (128, 256)
        assert not photo.info


def test_profile_cannot_edit_identity(profile_client):
    client, _settings = profile_client
    owner = {"X-User-Id": "student@ethz.ch", "X-Demo-User-Id": str(uuid4())}
    original = client.get("/api/v1/me", headers=owner).json()
    response = client.patch(
        "/api/v1/me",
        headers=owner,
        data={"name": "New name", "id": str(uuid4()), "email": "other@ethz.ch"},
    )
    assert response.status_code == 200
    assert response.json()["id"] == original["id"]
    assert response.json()["email"] == original["email"]


def test_profile_rejects_conflicting_photo_changes(profile_client):
    client, _settings = profile_client
    response = client.patch(
        "/api/v1/me",
        headers={"X-User-Id": "student@ethz.ch"},
        data={"name": "Student", "remove_photo": "true"},
        files={"photo": ("photo.png", photo_bytes(), "image/png")},
    )
    assert response.status_code == 400


def test_proxy_admin_allowlist_is_server_controlled(profile_client):
    client, settings = profile_client
    owner = {"X-User-Id": "admin@ethz.ch"}
    other = {"X-User-Id": "student@ethz.ch", "X-Demo-Admin": "true"}
    admin_id = UUID(client.get("/api/v1/me", headers=owner).json()["id"])
    assert client.get("/api/v1/admin/spaces", headers=owner).status_code == 403
    settings.admin_user_ids = [admin_id]
    assert client.get("/api/v1/admin/spaces", headers=owner).status_code == 200
    assert client.get("/api/v1/admin/spaces", headers=other).status_code == 403
    assert client.get("/api/v1/admin/spaces").status_code == 401
