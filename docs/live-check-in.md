# Physical check-in for the pitch

Use the teammate's iPhone for the app and a second phone for the moving camera. The camera operator films the app phone, walks behind the teammate into the pitch room, films the desk scan and then the teammate studying.

## App and desk setup

1. Use the same hosted app environment in the presentation and on the iPhone. The presentation currently defaults to the local backend, which will not share a booking with the hosted app. Set its `app` query parameter to the hosted Home URL (the deployment root). The toilet scene and Q&A open Home, where any saved booking is restored. Verify the hosted app can be embedded and is already signed in; if the managed login cannot work in the iframe, open the hosted app directly for the live booking segment.
2. Sign in as the same demo participant on both devices. In proxy auth, different logins own different reservations. Check that Profile shows the same account on each. Do not rely on the local shared demo-user behaviour.
3. Choose a participating demo seat in that environment. Print a QR whose payload is exactly that seat's existing `qr_token`. The in-app scanner submits the decoded text directly; a URL wrapper will not be understood. Obtain the token from the hosted demo inventory / authorized administrator, not a different local database. `make seed` prints the existing tokens when run against the corresponding demo backend; do not seed another environment merely to obtain a code.
4. Attach the printed QR flat to the desk where the teammate will study. Use a large, high-contrast print with a clear white margin. Keep the corresponding seat label beside it.
5. Open the hosted app on the iPhone in Safari. Rehearse camera permission and an actual scan before the pitch, then end the rehearsal session so the seat is free again. The HTTPS page is required for camera access on the phone.

## Camera feed

Suggested transport: VDO.Ninja. On the filming phone, open VDO.Ninja, choose "Add your camera to OBS", select the rear camera and start. Use landscape orientation. Keep its microphone muted; the presenter supplies the narration. Copy the generated viewer link into the presentation's encoded `live` query parameter, or into an OBS Browser Source if a video operator is already using OBS. Connect and check the feed before the opening film starts.

The presentation supports an embedded viewer and an external-source blackout handoff. This is setup guidance, not evidence that a stream is connected. Rehearse on the actual laptop, phones and venue network. The two camera jobs use two phones: the app phone scans the QR, the filming phone keeps sending the scene.

## On stage

1. The presenter reserves the prepared seat through the real app.
2. The teammate refreshes `/reservation` on the iPhone until the same room, seat and active hold are visible. The current client also polls bookings every 15 seconds; a refresh avoids waiting for that poll.
3. The camera operator frames that reservation screen tightly in landscape video. The presenter says, "The seat is held. Let's go there."
4. Cue the handoff by clicking outside the phone or pressing L with the presentation focused. The camera operator pulls back and follows the teammate into the pitch room.
5. At the desk, the teammate taps the app's check-in action and scans the printed QR using the app's scanner. Use Safari for the app, not the iPhone Camera app. Show the resulting session screen and ticking timer to the filming camera for a beat.
6. The teammate places the phone down, sits and starts working. Allow roughly 25–40 seconds for the live passage, then continue the pitch.

If scanning fails, the app already has a manual-code entry that goes through the same real check-in request. Introduce it honestly as manual entry. Keep the seat token available to the teammate. An explicitly introduced recording is the fallback for a failed video connection.

## Sources

- [VDO.Ninja basics](https://docs.vdo.ninja/getting-started/vdo.ninja-basics)
- [Embedding a VDO.Ninja viewer](https://docs.vdo.ninja/guides/how-to-use-vdo.ninja-on-a-website)
- [Browser camera secure-context requirement](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- Repo flow: `frontend/src/screens/ScanScreen.tsx`, `frontend/src/hooks/useQrScanner.ts`, `frontend/src/hooks/useMyReservation.ts`, `backend/app/features/reservations/seed.py` and `backend/app/auth.py`.
