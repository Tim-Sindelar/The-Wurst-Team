import pytest
from pydantic import ValidationError

from app.config import Settings


def test_timing_settings_can_be_overridden_by_environment(monkeypatch):
    monkeypatch.setenv("SESSION_LENGTH_MINUTES", "60")
    monkeypatch.setenv("CHECK_IN_WINDOW_MINUTES", "5")
    monkeypatch.setenv("PRIVATE_PRIORITY_WINDOW_MINUTES", "15")
    monkeypatch.setenv("PUBLIC_RESERVATION_WINDOW_MINUTES", "5")
    monkeypatch.setenv("BREAK_BUDGET_MINUTES", "12")
    settings = Settings(_env_file=None)
    assert settings.session_length_minutes == 60
    assert settings.check_in_window_minutes == 5
    assert settings.private_priority_window_minutes == 15
    assert settings.public_reservation_window_minutes == 5
    assert settings.break_budget_minutes == 12


@pytest.mark.parametrize(
    "overrides",
    [
        {"session_length_minutes": 0},
        {"break_budget_minutes": 0},
        {"check_in_window_minutes": 120},
        {"private_priority_window_minutes": 120},
        {"public_reservation_window_minutes": 20},
        {"public_reservation_window_minutes": -1},
    ],
)
def test_invalid_timing_settings_are_rejected(overrides):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **overrides)
