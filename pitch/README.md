# Study Spaces pitch prototype

A clean Three.js stage with two timed TAKEN stamps. The phone contains the real app.

```sh
cd pitch
npm ci
npm run dev
```

Open http://127.0.0.1:5174. The live phone defaults to https://02.hackathon.ethz.ch/ and mounts immediately on Home, while the scene warms its shaders. Sign in to the hosted app in the presentation browser before rehearsing; verify the authenticated app loads inside the phone. The toilet scene and Q&A each return the app to Home; saved bookings remain available. Static scenery is batched, pixel density is capped and the 3D renderer stops redrawing once the phone is still. Use `?quality=low` for a forced lower render resolution. For the local backup, use `?app=http%3A%2F%2Flocalhost%3A5173%2F` with the local frontend and backend running. Any deployment's Home URL can be supplied as an encoded `app` query parameter. Existing URLs ending in `/map` also open Home. The deployment must permit embedding.

## Presenting

Click once or press Space to play the opening film. No scene-by-scene advances are required:

1. HG fly-in; short blackout into the hall.
2. Follow the student into two occupied rooms; TAKEN hits twice.
3. Blackout to the defeated student, head down and crying.
4. Quick blackout to shoes under the toilet door; camera rises into the overhead reveal.
5. Hold on the toilet indefinitely while the presenter speaks. The phone sits in the student's hand. Click the phone (or Space after the reveal) for the roughly one-second app zoom.
6. Use the real app to reserve a seat. Click the surrounding background or press L / Space with the presentation focused to cue the live handoff.
7. Blackout while the video operator switches to the teammate livestream, or show the configured browser feed.
8. After the teammate checks in and sits down, click the live image or press Right / Space to cut to the closing slides.
9. Four quick slides: a four-step session explanation with an app screen for each render (scanner first), four students chatting beside the party planner phone, ETH fit with the portrait 3D map on a phone, then a three-step zoom from One library → Entire ETH → Other universities. The admin room setup appears on a 3D laptop only while Entire ETH is bold.
10. End on Q&A over an imagined happy ETH campus: friends study and chat, while students stroll along varied paths. The hosted app opens Home in an interactive phone at the top right, restoring the demo's saved booking. A small static admin laptop at the bottom left invites questions; switch to the hosted admin website for an interactive explanation. Enlarging the live phone hides the admin laptop. The campus keeps moving gently until you leave the scene; reduced motion freezes it.

For the current FaceTime setup, show the teammate's shared reservation screen first, then cut to the filming phone's camera, framed tightly on that same screen. Only then pull back and follow the teammate into the pitch room. The teammate scans the QR on the demonstration desk and starts studying. Keep the two FaceTime windows prepared before the opening; use the black handoff during the desktop switch. See `../docs/live-check-in.md` for the cue sequence and optional OBS output. There is no rendered lo-fi ending.

For an embeddable browser stream, pass its URL as an encoded `live` query parameter. It connects off-screen at startup and fills the stage after the handoff. Without a URL, the handoff stays black for a switch to an external video window/source. The prototype does not control OBS or start a camera stream. Verify the phone and embedded app use the same booking account and the desk QR matches the reserved seat.

During the live feed and closing slides, click or use Right / Space to continue. The first slide starts with QR check-in; the next three clicks reveal session limits with extension priority, handovers, then timed breaks. Each reveal swaps the static 3D render. A fourth click moves to Study together. Left returns to the previous closing slide. P jumps directly to the closing slides from the app or feed; E jumps to the happy campus after the live handoff. If using an external video source, return to the pitch browser before pressing P. The browser does not switch external video windows for you.

Left or right-click moves backward through slides and reveals, including back from the first QR feature to the live handoff. The adoption slide has three zoom levels: click / Right / Space to widen the view, Left or right-click to narrow it. Moving backward from Q&A restores the widest adoption view.

Space pauses/resumes the opening film; clicking the background during the film does not skip anything. R restarts. F toggles full screen. S mutes or unmutes the original synthesized cue. Rehearsal keys 1–7 jump to HG, hall, search, defeated close-up, toilet, app, and livestream handoff. These controls stay invisible. Music starts with the initial gesture, drops into a descending defeat cue, then cuts to silence for the toilet joke and live demo.

HG's simplified outlines come from the local backend's ETH PolyMaps floor index. The façade, windows, heights and dome are an artistic interpretation, not a surveyed exterior model. The small geometry snapshot is bundled, so the opening does not require a network request.

Keyboard events stay inside the live app while its iframe has focus. Click the surrounding scene to return control to the presentation. The phone's application is real: submitting a booking will make a real booking in the connected app. The room geometry and characters are illustrative.

On Q&A, D toggles between the top-right phone and a larger centred phone. Clicking the phone's outer frame does the same; clicking inside its screen operates the app. Click the surrounding campus first if the app has keyboard focus. The phone tracks the camera so it stays in position while the campus moves.

The prototype does not automatically detect reservation or check-in success. The presenter cues the livestream after reservation and narrates the physical check-in. The slide copy is in `closing.js`; the 60–75 second closing script is in `../docs/pitch-closing.md`, with the broader story in `../docs/pitch-story.md`.

## Closing assets

`assets/party-planner.jpg` is a native 390×844 capture of the actual GroupSeatsScreen from an isolated local preview with sample data, four assignments and no submitted booking. The session assets show actual UI with isolated sample API responses: the scanner, extension priority, end-session confirmation, and on break. `session-scanner.jpg` uses ScanScreen with a simulated QR camera feed; no physical camera was accessed. No mutation was submitted. These are static phone textures, so the slides do not depend on additional live bookings. `assets/campus-map-phone.jpg` is a real 390×844 capture of HG in the app's 3D Workspaces view. `assets/admin-room-setup.jpg` is the app's built-in AdminLayoutPage with a sample room and sixteen seats, captured without saving a layout. Earlier active-timer and landscape-map captures remain bundled in the source assets but are no longer used by the slides. `assets/seat-qr.svg` encodes an illustration marker, not a valid seat token. Do not print it for the physical demo.

The current slide captures were refreshed from main at `2ef73f8`, merged into the pitch branch in `1aae520`. The live iframe now uses the hosted deployment's frontend and database. The local backup uses the merged frontend; its backend was rebuilt and migrated without reseeding bookings.
