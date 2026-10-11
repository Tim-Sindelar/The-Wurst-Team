# Offline pitch fallback

Open `output/Study-Spaces-Pitch-Fallback-4K.pptx` in PowerPoint or Keynote, or `output/Study-Spaces-Pitch-Fallback-4K.pdf` in a PDF viewer. These are the recommended high-resolution editions; the original compact 720p files remain available. Both contain the same 24 widescreen screenshot slides, with all images embedded. They need no app server, WebGL or internet connection. Advance manually.

| Slides | Pitch section |
| --- | --- |
| 1–7 | HG, running through the halls, two taken rooms, tears, toilet reveal |
| 8–11 | Home, campus map, free seat selection, reservation |
| 12 | Black hold for the FaceTime handoff |
| 13–14 | QR scan and checked-in session if the live feed is unavailable |
| 15–18 | QR check-in, session limits and extension priority, handovers, timed breaks |
| 19 | Study together |
| 20 | Built for ETH |
| 21–23 | One library, Entire ETH with admin laptop, other universities |
| 24 | Study Spaces logo over the happy ETH campus |

The PPTX also contains brief speaking notes. No animation, music, live video or interactive app is embedded. Slide 12 is intentionally black. Skip slides 13–14 if the physical check-in demonstration succeeds.

## Sources and regeneration

`screenshots-4k/` contains fresh 3840×2160 browser captures. `capture-4k.html` preserves the original 1280×720 slide composition at triple scale while the 3D canvas renders at a pixel ratio of three. These are fresh captures, not resized 720p images. The live app text is rendered by the browser; bundled static phone textures retain their original source resolution. `screenshots/` contains the original compact 1280×720 captures. `manifest.json` records the sequence, scene parameters and speaking notes. The captures use the current pitch branch's 3D scenes, bundled phone screenshots and local app with the imported catalogue. The scanner is the same previously captured simulated-camera UI used in the pitch's QR feature. The reservation and session are genuine local API states from a temporary booking, which was ended after capture; no production reservation was made.

Capture URLs use `?capture=1..12&time=<milliseconds>`, with `feature=0..3` for scene 8 and `rollout=0..2` for scene 11. They freeze a silent frame without changing normal presentation playback. `phone=scanner` inserts the bundled scanner capture for the offline demonstration. The native app flow screenshots require navigating inside the phone iframe. Do not refresh the exported booking screenshots just before presenting unless you intend to recreate that booking.

`export.mjs` builds the PPTX using the bundled `@oai/artifact-tool` runtime and presentation skill finalizer. Run a copy in a private build directory with its `node_modules` linked to the bundled runtime, set `RUNTIME_NODE_MODULES`, and pass the repository root, presentation skill directory and bundled Python executable, followed by `--4k` for the high-resolution edition. The finalizer refuses to overwrite an existing output; use a versioned output name for a new edition.

`export-pdf.py --4k` builds the high-resolution PDF with ReportLab and embeds the full 4K image data. All captures and both final exports are backed up on `codex/pitch-demo`.
