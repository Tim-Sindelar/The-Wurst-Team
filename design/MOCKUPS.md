# Mock screens

Open `index.html` in a browser (double-click works, no install or server). The guide font loads from Google Fonts, or falls back to a system font.

Start with `design-rules.md`. The files table there says what each file is.

## Seat arrangement mockup

Open `screens/02-seat-arrangement.html` directly, or follow its link from `index.html`. The room contains 35 seats: eight four-seat tables and a three-seat window counter. There are 17 free seats in the sample data. The stepped footprint and furniture placement are invented for this mockup.

The screen uses the shared `tokens.css`, `base.css` and `base.js`. No installation, server, external map service or camera access is needed. JavaScript provides local map interactions:

- Drag with a mouse or one finger to pan; pinch with two fingers to zoom.
- Use the compact + / − controls or the mouse wheel to zoom. The four-corner button fits the whole room.
- Keyboard: arrows to pan, + / − to zoom, Home or 0 to fit. Tab through seats and press Enter or Space to select.
- Select a seat to inspect its state. The detail card and reservation button reflect whether it is free, unavailable or bookable later. Selecting from the overview returns to at least 100% for inspection.
- “Choose any free seat” selects the first free example; it does not reserve it.

Reservation buttons remain visual placeholders. No backend requests, reservations, authentication or attendance changes occur. The bookable-later state is a sample policy proposal.

The reusable map component is documented on `components.html`. Edit SVG geometry to change walls or tables; each seat's `data-x` and `data-y` locate it on the 640 × 760 canvas. Keep `data-seat-number`, `data-seat-state`, text and accessible labels consistent. Map size tokens live in `tokens.css`. The header sun/moon button switches the whole screen between dark and light, including the room, seats, map controls, info panel and details. The choice is remembered when browser storage is available; `?theme=light` can also open a light preview. DIN is used if installed, otherwise a system font fallback is used.

Seat markers use solid colour fills with numbers; reserved seats are not dashed. On-break seats use bronze with a coffee-cup badge; seats bookable later use orange with a clock badge. Both retain their seat numbers. The colour key is inside the top-left info disclosure; there is no separate screen legend or visible gesture instruction. Native disclosure controls work with keyboard or touch, Escape closes the key, and touching the map closes it.
