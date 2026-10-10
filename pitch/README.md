# Study Spaces pitch prototype

A clean Three.js stage with two timed TAKEN stamps. The phone contains the real app.

```sh
cd pitch
npm ci
npm run dev
```

Open http://127.0.0.1:5174. The live map mounts immediately, while the scene warms its shaders. Static scenery is batched, pixel density is capped and the 3D renderer stops redrawing once the phone is still. Use `?quality=low` for a forced lower render resolution. The actual app must be running on http://localhost:5173 with its backend. To use another deployment, pass its full URL as an encoded `app` query parameter. The deployment must permit embedding.

## Presenting

Click once or press Space to play the opening film. No scene-by-scene advances are required:

1. HG fly-in; short blackout into the hall.
2. Follow the student into two occupied rooms; TAKEN hits twice.
3. Blackout to the defeated student, head down and crying.
4. Quick blackout to shoes under the toilet door; camera rises into the overhead reveal.
5. Hold on the toilet indefinitely while the presenter speaks. The phone sits in the student's hand. Click the phone (or Space after the reveal) for the roughly one-second app zoom.
6. Use the real app to reserve a seat. Click the surrounding background or press L / Space with the presentation focused to cue the live handoff.
7. Blackout while the video operator switches to the teammate livestream, or show the configured browser feed.

The live camera starts tight on the teammate's phone showing the reservation, then physically pulls back and follows them into the pitch room. The teammate scans the QR on the demonstration desk and starts studying. There is no rendered lo-fi ending. Stream transport is still to be chosen and rehearsed.

For an embeddable browser stream, pass its URL as an encoded `live` query parameter. It connects off-screen at startup and fills the stage after the handoff. Without a URL, the handoff stays black for a switch to an external video window/source. The prototype does not control OBS or start a camera stream. Verify the phone and embedded app use the same booking account and the desk QR matches the reserved seat.

Space pauses/resumes the opening film; clicking the background during the film does not skip anything. R restarts. F toggles full screen. S mutes or unmutes the original synthesized cue. Rehearsal keys 1–7 jump to HG, hall, search, defeated close-up, toilet, app, and livestream handoff. These controls stay invisible. Music starts with the initial gesture, drops into a descending defeat cue, then cuts to silence for the toilet joke and live demo.

HG's simplified outlines come from the local backend's ETH PolyMaps floor index. The façade, windows, heights and dome are an artistic interpretation, not a surveyed exterior model. The small geometry snapshot is bundled, so the opening does not require a network request.

Keyboard events stay inside the live app while its iframe has focus. Click the surrounding scene to return control to the presentation. The phone's application is real: submitting a booking will make a real booking in the connected app. The room geometry and characters are illustrative.

The prototype does not automatically detect reservation or check-in success. The presenter cues the livestream after reservation and narrates the physical check-in. Session-policy, friends and pilot portions of the pitch remain in `../docs/pitch-story.md`.
