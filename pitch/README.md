# Study Spaces pitch prototype

A clean Three.js stage with two timed TAKEN stamps. The phone contains the real app.

```sh
cd pitch
npm ci
npm run dev
```

Open http://127.0.0.1:5174. The live map mounts immediately, while the scene warms its shaders. Static scenery is batched, pixel density is capped and the 3D renderer stops redrawing once the phone is still. Use `?quality=low` for a forced lower render resolution. The actual app must be running on http://localhost:5173 with its backend. To use another deployment, pass its full URL as an encoded `app` query parameter. The deployment must permit embedding.

## Presenting

Click the scene or press Right to advance:

1. Stylised HG exterior using its actual floor outlines. Click to fly toward the entrance and into the hall.
2. Campus hall and occupied study rooms.
3. The camera follows the student to each door, peeks inside and stamps TAKEN twice.
4. Shoes under a closed stall door. The camera rises above it for the toilet reveal. Click the phone to move into it.
5. Camera brings the phone forward. Once it settles, use the actual app on its screen to find and reserve a seat. Click outside the phone to continue.
6. Calm study scene with headphones.

Space plays the HG fly-in and hall sequence through the phone transition, then holds for the live demo. Left moves back. R restarts. F toggles full screen. Music starts on the first interaction and cuts to silence at the toilet. S mutes or unmutes it. Number keys 1–6 jump to scenes. Controls are intentionally invisible.

HG's simplified outlines come from the local backend's ETH PolyMaps floor index. The façade, windows, heights and dome are an artistic interpretation, not a surveyed exterior model. The small geometry snapshot is bundled, so the opening does not require a network request.

Keyboard events stay inside the live app while its iframe has focus. Click the surrounding scene to return control to the presentation. The phone's application is real: submitting a booking will make a real booking in the connected app. The room geometry and characters are illustrative.

The prototype does not automatically detect successful check-in. Advance to the study scene after the real check-in succeeds. This remains an opening/demo treatment; the session-policy, friends and pilot portions of the pitch are in `../docs/pitch-story.md`.
