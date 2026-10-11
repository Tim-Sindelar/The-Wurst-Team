"""Local pitch friends, with two tied to the existing synthetic seat occupants."""
from secrets import token_urlsafe

from app.features.social.models import Friendship, SocialUser
from app.models.profile import UserProfile


def seed_friends(session, spaces, settings):
    profile = session.get(UserProfile, settings.dummy_user_id)
    session.execute(insert(SocialUser).values(
        user_id=settings.dummy_user_id, fallback_name=profile.name if profile else "Demo user",
        invite_token=token_urlsafe(24), share_room=False,
    ).on_conflict_do_nothing(index_elements=[SocialUser.user_id]))
    room = next((space for space in spaces if space.name == "HG F 26.3"), None)
    roster = [("Marie Curie", "02"), ("Niels Bohr", "07"), ("Ada Lovelace", None), ("Alan Turing", None)]
    for name, label in roster:
        seat = session.scalar(select(Seat).where(Seat.space_id == room.id, Seat.label == label)) if room and label else None
        friend_id = uuid5(NAMESPACE_URL, f"pitch-catalogue-person/{seat.id}" if seat else f"pitch-friend/{name}")
        session.execute(insert(UserProfile).values(id=friend_id, name=name).on_conflict_do_nothing(index_elements=[UserProfile.id]))
        session.execute(insert(SocialUser).values(
            user_id=friend_id, fallback_name=name, invite_token=token_urlsafe(24), share_room=bool(seat),
        ).on_conflict_do_update(index_elements=[SocialUser.user_id], set_={"fallback_name": name, "share_room": bool(seat)}))
        low, high = sorted([settings.dummy_user_id, friend_id])
        session.execute(insert(Friendship).values(
            id=uuid5(NAMESPACE_URL, f"pitch-friendship/{friend_id}"), user_low=low, user_high=high,
            requested_by=friend_id, status="accepted",
        ).on_conflict_do_nothing(index_elements=[Friendship.user_low, Friendship.user_high]))
    return len(roster)
