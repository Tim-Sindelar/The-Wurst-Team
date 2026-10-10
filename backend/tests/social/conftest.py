import pytest

from tests.reservations.conftest import client as client
from tests.reservations.conftest import clock as clock
from tests.reservations.conftest import policy as policy
from tests.reservations.conftest import seats as seats


@pytest.fixture
def social_client(client, policy):
    policy.social_enabled = True
    return client
