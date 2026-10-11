# Physical check-in for the pitch

Use the teammate's iPhone for the app and a second phone for the moving camera. The camera operator films the app phone, walks behind the teammate into the pitch room, films the desk scan and then the teammate studying.

## App and desk setup

The current presentation defaults to the local app, using the imported production room/seat/layout catalogue and synthetic occupancy. Production seat IDs and QR tokens are preserved. This is ready for laptop rehearsal. Its bookings do not reach the hosted iPhone: copying room/seat data does not synchronise reservations. For a physical check-in, either use the hosted app directly on both devices or prepare HTTPS access to the same local backend on the phone; the latter is not configured yet.

1. For the hosted check-in flow, use https://02.hackathon.ethz.ch/ on both devices. Point the presentation at it with `?app=https%3A%2F%2F02.hackathon.ethz.ch%2F` only after authenticated embedding works, or open the hosted app in a normal browser tab. The toilet scene and Q&A open Home, where any saved booking is restored. Hosted login did not work reliably inside the presentation, which is why local rehearsal is now the default.
2. Sign in as the same demo participant on both devices. In proxy auth, different logins own different reservations. Check that Profile shows the same account on each. Do not rely on the local shared demo-user behaviour.
3. Choose a participating demo seat in that environment. Print a QR whose payload is exactly that seat's existing `qr_token`. The in-app scanner submits the decoded text directly; a URL wrapper will not be understood. Obtain the token from the hosted demo inventory / authorized administrator, not a different local database. `make seed` prints the existing tokens when run against the corresponding demo backend; do not seed another environment merely to obtain a code.
4. Attach the printed QR flat to the desk where the teammate will study. Use a large, high-contrast print with a clear white margin. Keep the corresponding seat label beside it.
5. Open the hosted app on the iPhone in Safari. Rehearse camera permission and an actual scan before the pitch, then end the rehearsal session so the seat is free again. The HTTPS page is required for camera access on the phone.

## FaceTime handoff

Keep the call and iPhone screen share connected before the opening film. The audience sees one image at a time: shared phone, then camera feed. Prepare both windows at presentation size and rehearse switching without searching for windows or resizing them on stage.

1. Finish the hosted booking, with the reservation visible on both devices. Hold the teammate's shared reservation screen still.
2. Say, “The seat is held. Let's go there.” Cue L or click outside the pitch phone to fade to black. Switch to the prepared FaceTime desktop and show the phone share large, alone, for one beat.
3. Cut to the camera feed, already framed tightly on that same reservation screen. The filming operator waits until this feed is visible, then pulls back and follows the teammate into the room.
4. Keep the camera feed large during the walk. At the scan, optionally cut to the shared app screen to show check-in and the ticking timer clearly, then back to the teammate sitting down.
5. Switch back to the pitch's black handoff screen, focus the presentation and press P to reveal the first closing slide.

For a cleaner projector output, OBS can capture each FaceTime window separately using its macOS Screen Capture source. Prepare three scenes: Pitch, Phone share (portrait, centred on black), and Camera (fills the output with its aspect ratio preserved). Use a short fade between scenes and a full-screen Program projector on the audience display; keep OBS controls on the laptop. Test that both FaceTime windows capture correctly before adopting this setup. No streaming or recording is required. Keep the call's local microphone and speaker output muted during the passage if the presenter is narrating, and rehearse the audio setup.

If staying with desktop swipes, dedicate that desktop to FaceTime, maximise the window being shown and hide the other window. Make the black handoff deliberate; never resize or arrange windows in front of the audience.

## Alternative browser camera feed

An alternative transport is VDO.Ninja. On the filming phone, open VDO.Ninja, choose "Add your camera to OBS", select the rear camera and start. Use landscape orientation. Keep its microphone muted; the presenter supplies the narration. Copy the generated viewer link into the presentation's encoded `live` query parameter, or into an OBS Browser Source if a video operator is already using OBS. Connect and check the feed before the opening film starts.

The presentation supports an embedded viewer and an external-source blackout handoff. This is setup guidance, not evidence that a stream is connected. Rehearse on the actual laptop, phones and venue network. The two camera jobs use two phones: the app phone scans the QR, the filming phone keeps sending the scene.

## On stage

1. The presenter reserves the prepared seat through the real app.
2. The teammate refreshes `/reservation` on the iPhone until the same room, seat and active hold are visible. The current client also polls bookings every 15 seconds; a refresh avoids waiting for that poll.
3. The camera operator frames that reservation screen tightly in landscape video. The presenter says, "The seat is held. Let's go there."
4. Cue the handoff by clicking outside the phone or pressing L with the presentation focused. The camera operator pulls back and follows the teammate into the pitch room.
5. At the desk, the teammate taps the app's check-in action and scans the printed QR using the app's scanner. Use Safari for the app, not the iPhone Camera app. Show the resulting session screen and ticking timer to the filming camera for a beat.
6. The teammate places the phone down, sits and starts working. Allow roughly 25–40 seconds for the live passage, then continue the pitch.

The hosted scanner has no typed-code fallback. Rehearse the real QR and camera permission beforehand. An explicitly introduced recording is the fallback for a failed scan or video connection; do not rely on the local development-only skip button in the hosted app.

## Sources

- [OBS macOS Screen Capture](https://obsproject.com/kb/macos-screen-capture-source)
- [OBS full-screen projectors](https://obsproject.com/kb/power-of-projectors)
- [VDO.Ninja basics](https://docs.vdo.ninja/getting-started/vdo.ninja-basics)
- [Embedding a VDO.Ninja viewer](https://docs.vdo.ninja/guides/how-to-use-vdo.ninja-on-a-website)
- [Browser camera secure-context requirement](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- Repo flow: `frontend/src/screens/ScanScreen.tsx`, `frontend/src/hooks/useQrScanner.ts`, `frontend/src/hooks/useMyReservation.ts`, `backend/app/features/reservations/seed.py` and `backend/app/auth.py`.
