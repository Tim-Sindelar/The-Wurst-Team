# Pitch cheatsheet

## Open these before presenting

- Presentation: **http://127.0.0.1:5174/?quality=low**
- Local app: **http://localhost:5173/**
- Local admin: **http://localhost:5173/admin**
- Hosted app for the iPhone: **https://02.hackathon.ethz.ch/**
- Offline files: `pitch/fallback/output/Study-Spaces-Pitch-Fallback.pptx` and `.pdf`

Keep the PDF open on another desktop, and keep FaceTime's phone share and camera feed connected. The normal presentation URL must not contain `capture=`.

## Start localhost

Open Docker Desktop first. Use three terminal tabs. Run commands from the repository root:

```sh
cd /Users/domen/Documents/ETH/viscon_hackathon_26/The-Wurst-Team
```

**Tab 1 — backend and database:**

```sh
docker compose up -d --wait backend
```

**Tab 2 — phone app:**

```sh
npm --prefix frontend run dev -- --host 127.0.0.1 --strictPort
```

**Tab 3 — presentation:**

```sh
npm --prefix pitch run dev -- --strictPort
```

Leave the two Vite tabs running. An occupied port usually means that server is already running: check its URL before starting another copy.

## Restart / recover

| What happened | Quick recovery |
| --- | --- |
| Animation or phone looks wrong | Reload the presentation, then use `6` to jump to the live phone |
| Presentation server stopped | In its terminal, rerun `npm --prefix pitch run dev -- --strictPort` |
| App server stopped | In its terminal, rerun `npm --prefix frontend run dev -- --host 127.0.0.1 --strictPort` |
| Need to restart either Vite server | `Ctrl+C` in that server's terminal, then rerun its start command |
| API is unresponsive | `docker compose restart backend` |
| Docker stopped | Open Docker Desktop, then `docker compose up -d --wait backend` |
| Backend code/image changed | `docker compose up -d --build --wait backend` |
| App or 3D still fails on stage | Continue in the already-open PDF or PPTX |

Status and logs:

```sh
docker compose ps
curl --fail http://127.0.0.1:8000/api/v1/ready
docker compose logs --tail=50 backend
```

If an old Vite terminal is lost, identify the listener before stopping its Node process:

```sh
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:5174 -sTCP:LISTEN
```

## Refresh demo occupancy before rehearsal

```sh
npm --prefix pitch run seed
```

This refreshes the synthetic crowd, keeping the imported layouts, seats, QR tokens and other active bookings. The root `.env` selects **`PITCH_DATABASE_NAME=pitch_catalogue_20261011`**. Leave that setting in place. The restart commands above preserve the database and Docker volumes.

If your previous rehearsal left you holding a seat, use **Cancel reservation** or **End session** in the app before the next run. Refresh the presentation afterward.

## Presentation controls

**Click outside the app screen first if keys stop responding.** Keyboard focus inside the phone stays in the phone.

| Key / action | Effect |
| --- | --- |
| `Space` or click at the opening | Start the automatic film |
| `Space` during the opening | Pause / resume |
| `Right` during animations | Skip the current opening scene; continue manually |
| Click toilet phone, or `Space` after reveal | Zoom into the live app |
| `L` after reserving, or click outside the phone | Black handoff for FaceTime |
| `P` after returning from FaceTime | First closing slide: QR check-in |
| `Right`, `Space`, or click on closing slides | Next reveal / slide |
| `Left` or right-click on closing slides | Previous reveal / slide |
| `E` from the handoff onward | Jump to the branded happy-campus ending |
| `D` on the final slide | Enlarge / shrink the interactive phone |
| `R` or `Home` | Restart the normal automatic opening |
| `F` | Toggle fullscreen |
| `S` | Toggle music mute |
| `Escape` | Pause scene motion; stops music |

Rehearsal jumps: **1 HG · 2 running · 3 rooms · 4 tears · 5 toilet · 6 live phone · 7 black handoff**.

## Live check-in cue

1. Find a free seat and reserve it. The physical check-in must use the **same backend and account** as that reservation.
2. Say: **“The seat is held. Let's go there.”** Click outside the app, then press `L`.
3. Switch to the prepared FaceTime phone share. Cut to the camera already framed tightly on that phone, then pull back and follow the teammate.
4. Scan the matching seat QR. Show the session timer, then the teammate sitting down.
5. Return to the pitch browser, focus the black presentation and press `P`.

**The localhost reservation does not reach the hosted iPhone.** For the real scan, book in a normal hosted browser tab using the teammate's account, or have the teammate reserve on the hosted phone. Hosted authentication inside the 3D iframe is unreliable. The phone's physical reservation and printed QR must belong to that hosted seat.

Use the real QR from the relevant admin's QR codes page. The current scanner accepts the printed app URL or the raw seat token; the QR illustration in the slides is only an illustration.

## Five-minute pacing

| Time | Beat |
| --- | --- |
| 0:00–0:45 | HG, wandering, two taken rooms, tears |
| 0:45–1:00 | Toilet reveal. “Check availability across the whole campus. Book a seat from the toilet.” |
| 1:00–2:20 | Find a room, choose a seat, reserve |
| 2:20–3:00 | Teammate walks in, scans, sits |
| 3:00–4:30 | Session rules, friends, ETH fit, rollout |
| 4:30–5:00 | Impact and Study Spaces ending |

## Offline fallback navigation

| Slide | Resume here |
| --- | --- |
| 1 | Start of pitch |
| 7 | Toilet / solution |
| 8 | Home demo |
| 9–11 | Map, seat selection, reservation |
| 12 | Intentional black FaceTime handoff |
| 13–14 | QR scan and checked-in session if the live demo fails |
| 15 | Closing slides begin |
| 19 | Study together |
| 20 | Built for ETH |
| 21–23 | Pilot and expansion, including admin laptop |
| 24 | Branded ending |

The fallback is fully static and offline. It contains no live app, music or video. Skip slides 13–14 when the physical demo succeeds.
