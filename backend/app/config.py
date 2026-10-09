from functools import lru_cache
from uuid import UUID

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://hackathon:hackathon@localhost:5432/hackathon"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    session_length_minutes: int = Field(default=120, gt=0)
    check_in_window_minutes: int = Field(default=15, gt=0)
    private_priority_window_minutes: int = Field(default=20, gt=0)
    public_reservation_window_minutes: int = Field(default=10, gt=0)
    break_budget_minutes: int = Field(default=30, gt=0)
    dummy_user_id: UUID = UUID("00000000-0000-0000-0000-000000000001")
    dummy_auth_allow_header: bool = True
    dummy_is_admin: bool = False
    dummy_admin_allow_header: bool = True

    @model_validator(mode="after")
    def validate_reservation_windows(self) -> "Settings":
        if not (
            self.public_reservation_window_minutes
            < self.private_priority_window_minutes
            < self.session_length_minutes
        ):
            raise ValueError("Require public window < private window < session length")
        if self.check_in_window_minutes >= self.session_length_minutes:
            raise ValueError("Check-in window must be shorter than the session")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
