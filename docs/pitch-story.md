# Five-minute pitch: story draft

Working draft. The opening is now a continuous low-poly Three.js film; the booking app and physical check-in are live.

## Story

Follow the same ETH student from the end of a lecture to a study seat. The audience should understand the frustration before seeing the app. The booking and physical QR check-in resolve that frustration. Friends join the story after the solo flow is clear.

The two messages to remember are campus-wide discovery and reserving a seat before walking there. Keep the toilet joke as one short reveal.

## Running order

| Time | What happens | What the audience sees |
| --- | --- | --- |
| 0:00–0:35 | Lecture ends. The student tries one study area, then another. Both are full. | HG fly-in, two occupied rooms, repeated TAKEN stamps, defeated close-up and tears. Blackout into the toilet. |
| 0:35–1:00 | Introduce checking availability across campus and reserving remotely. Reveal the student on the toilet, looking at their phone. | Campus view, then the phone. App name can appear here. |
| 1:00–2:40 | Live demo: explore the campus map, open a bookable room, choose a free seat, reserve it, walk to the demonstration seat and scan its QR code. | Real app, large enough to read. Printed QR attached to the demonstration seat. After booking, match the reservation screen on the teammate’s phone in the livestream. Camera pulls back, follows them into the pitch room, then shows the desk QR scan and studying. |
| 2:40–3:00 | Explain session limits, extension priority, handovers and breaks. | Four incremental lines with matching renders: QR check-in, session limits with extension priority, handovers, coffee breaks. |
| 3:00–3:25 | Mention group booking and ETH fit. | Friends studying together, then campus map, ETH sign-in and intended free access. |
| 3:25–3:45 | Propose one library pilot, expansion across ETH, then adoption by other universities. | One library → Entire ETH → Other universities. |
| 3:45–5:00 | Close on the happy ETH vision; remaining time covers the live passage, laughter and questions if invited. | An imagined bright HG campus with friends studying and chatting. Q&A title over a gently moving campus. |

The timestamps are a rehearsal budget. One initial click plays the opening through the toilet reveal, then holds while the presenter speaks. Click the held phone to enter the real app. The physical livestream handoff is cued after reservation. The closing slides take 60–75 seconds; keep the full rehearsal below five minutes. The current short closing script is in `pitch-closing.md`.

## Spoken draft

These are speaker notes. They do not go on the slides.

### Opening

“Your lecture just finished. You have an assignment to work on, so you head to your usual study spot. Full. You try the next floor. Full too. Now you're walking through ETH, looking for somewhere to sit.”

Let the repeated failed attempts carry the frustration. No invented campus-wide statistics or claimed average minutes lost.

### Reveal

“We want you to check availability across the whole campus before you start walking. Find a seat and reserve it from your phone.”

Reveal the toilet scene.

“You can literally book your next seat from the toilet.”

Pause for the reaction, then zoom into the phone.

“Let's get this student somewhere to study.”

### Live demo

“Here's the campus. We can look through the buildings and floors. This study space has a free seat.”

Open its room plan and choose the seat.

“I'll reserve this one. It's held while I get there. If I don't check in before the deadline, it becomes available again.”

Cue the livestream, beginning tight on the teammate’s phone with the same reservation visible. The camera operator pulls back and follows the teammate into the pitch room.

“Each seat has its own QR code. I scan this seat's code to check in.”

Show successful check-in on the real phone, then the teammate sitting down at the desk in front of the judges. Hold that real studying image briefly.

For the prototype demonstration, describe bookable seats as participating spaces. The whole-campus phrase is the intended product promise, not a claim that every ETH seat already reports occupancy.

### Sessions and handovers

“Sessions have a clear end time. If I need longer, I get the first chance to extend. After that window, someone else can reserve the next session. If I leave early, their booking can start earlier. And I can take a timed break without losing my seat immediately.”

Use the incremental session slide and its matching renders. Do not wait for a two-hour session to reach its extension window or run another complete scan loop on stage.

### Friends and impact

“You can also reserve seats for your study party in the same room. Everyone scans their own seat when they arrive.”

The friends slide shows an illustration rather than another booking demo. The final happy-campus scene carries the impact: the student and their friends have a place to study.

### Pilot and close

“The next step is a pilot in one library. We'd work with the library team to map its seats, attach the QR codes and agree how bookings work on site. We'd measure how long students spend finding seats and how often reservations go unused. Then we'd expand across ETH and take the system to other universities. Each university needs to make it official and authoritative.”

“We're looking for one library to try it with.”

This is a proposed closing ask. Adjust it to the audience and any existing pilot agreement.

## Where the other features fit

- Campus exploration and the floor stack appear during the first demo action. Use real ETH building and room names to establish the local fit.
- Limited sessions, no-show expiry, extension priority, breaks and handovers belong together, immediately after successful check-in.
- Friend sessions appear in the quick closing slides. The implementation assigns seats manually in the same room; it does not automatically find adjacent seats.
- Favourites, profile editing, menus and sports data can remain visible or support questions. They do not each need narration in five minutes.
- ETH sign-in and department permissions belong in the pilot discussion to the extent they are implemented and verified. Administrative support should be described as a pilot requirement until agreed.
- If free access is the intended policy, say “free for students.” Do not imply that operating the system has no cost.

## Visual direction and live transition

Use one consistent low-poly student for the opening. A single start gesture plays the HG fly-in, hallway search, two TAKEN stamps and defeated close-up. The student lowers their head and cries; cut through black to the feet-first toilet reveal. Hold the overhead shot with a naturally sized phone in their hand for the presenter to finish the joke. Clicking the phone gives a roughly one-second zoom into the real app.

Remove the rendered study ending. After the real reservation, cue a livestream that begins tightly framed on the teammate’s phone showing that reservation. Pull back to third person and follow them walking into the presentation room. Show the desk QR scan, successful check-in and the teammate starting to study. This makes the final payoff happen in the judges’ room.

Livestream transport is still undecided. The prototype supports an embeddable browser feed via `?live=...` and a blackout handoff for an external video source. The external video operator switches during black; there is no automatic OBS integration. The camera operator supplies the physical zoom-out. Do not claim the livestream is connected until tested.

Before rehearsal, verify the teammate’s phone is signed in as the booking user, the QR belongs to the reserved seat, and both screens show the same current reservation. Prepare the camera operator outside the room, begin on the phone, then widen and follow. Avoid filming bystanders. The camera operator can stay silent; the presenter narrates. Agree a short spoken cue for the handoff and keep a clearly introduced recording available if the live feed fails.

Slide copy: optional short title, useful labels, or no text. Avoid generic chapter slides, repeated three-card layouts, decorative icons, filler subtitles, stock business language and conclusions printed under every image. The spoken notes carry the explanation.

## Repo and app findings

Inspection on 10 October 2026. This was code inspection and a read-only look at the local Home and Map screens, not an end-to-end booking rehearsal.

| Claim | What the current project supports | Evidence |
| --- | --- | --- |
| Individual reservation and QR check-in | Frontend uses generated backend mutations. Scan supports camera and typed seat code. | `frontend/src/screens/SeatMapScreen.tsx`, `ReservationScreen.tsx`, `ScanScreen.tsx` |
| Session rules | Configurable defaults: 120-minute sessions, 15-minute check-in window, priority from 20 to 10 minutes before end, 30-minute break allowance. Verify deployed values before naming numbers on stage. | `backend/app/config.py`, `frontend/src/screens/SessionScreen.tsx` |
| Group booking | Real party flow, explicit membership acceptance, manual same-room assignments, all-or-nothing reservations, individual check-in. | `docs/social-backend.md`, `frontend/src/features/social-draft/LivePartyBookingScreen.tsx` |
| ETH-specific map | Campus map and floor stack, workspaces, room booking information and selected campus datasets. Room bookings are not physical occupancy sensors. | `AGENTS.md`, `occupancy-map-preview/README.md` |
| Campus-wide live seat occupancy | Not established. The local Home screen showed two demo spaces with four free seats each. | Local app at `http://localhost:5173/` |
| Actual seat geometry | Booking screen still uses a stand-in room layout. Do not present it as a surveyed seating plan. | `frontend/src/domain/room.ts` |
| Login and departmental access | Proxy identity exists. No department access rules found. Current admin authentication denies proxy-mode admin access. | `backend/app/auth.py` |
| Admin mapping | Developer map editor exists. Production library administration and enforcement require further work and institutional agreement. | `occupancy-map-preview/README.md`, `backend/app/auth.py` |
| Physical studying payoff | Livestream replaces the rendered lo-fi scene. Feed transport and desk check-in still need rehearsal. | `pitch/README.md` |
| Notifications | Preferences exist; delivery is deferred. Avoid promising delivered push notifications. | `README.md` |
| Market uniqueness | Not researched. Use concrete ETH-specific capabilities rather than “no other app does this.” | Requires separate competitor research |

## Rehearsal decisions still needed

- Judges are former ETH students and VIS members. Any additional judging criteria remain to be checked.
- Number of presenters and who controls the presentation, phone and physical QR demonstration.
- Presentation device and phone-mirroring setup.
- Final app name. Current UI says Study Spaces.

For the friends segment, use a separate prepared organizer account with no active reservation. The solo demo account will already be checked in and cannot simultaneously take another seat in a party booking. An explicitly introduced recording is another option.

For a follow-up group-booking demonstration, prepare accepted members without conflicting reservations and verify the deployed social feature uses the real backend. The five-minute pitch uses the closing illustration instead of this second live flow.

## Presentation references

The requested search surfaced recurring complaints about dense text, generic images, repetitive layouts and unsupported facts. Use these as editing checks rather than treating punctuation or a particular word as proof of AI authorship.

- [Common AI presentation mistakes](https://www.presentations.ai/blog/common-ai-presentation-mistakes)
- [Why AI presentations look generic](https://kinsy.ai/blog/why-ai-presentations-look-generic/)
