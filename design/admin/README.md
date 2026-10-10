# Users mockup
Open `08-users.html` directly in a browser with the other design files alongside it. No backend, install or build step is required.

- Search by name, email, department or student ID. Filter by current booking status and sort by name, study time or reservations.
- Open any user, edit their profile and save. Native form validation and additional trimmed-field validation prevent empty or invalid entries.
- View reservation and room details, show all history, and confirm ending a current reservation. Cancel leaves the data unchanged. Ended reservations remain in history, retaining study time.
- Refresh reads the saved demo data. Reset demo data restores the original dataset after confirmation.
- Changes persist in localStorage under `study-admin-users-v1`. With storage blocked, they last only for the current page. Browser file-URL storage may be isolated between files; a shared localhost origin gives consistent persistence across all pages.
- Sample time is fixed at 10 October 2026, 10:42 Europe/Zurich. Statistics cover the preceding 30 days. This mockup does not call or mutate the backend.
- `users-data.js` contains the sample-data adapter and mutations; `users.js` renders the Users UI. They can later be replaced with an API adapter without changing the design tokens.
- Spaces pages remain their existing separate mockups.

Run the data checks with Node:
```sh
node --test design/admin/users-data.test.cjs
```


## Create spaces and edit furniture
- Open `01-spaces.html`, choose Add space, then select a room on the sample HG floor map. No GPS fields are needed.
- `layout-data.js` contains the sample room IDs and fixed polygons that a backend room catalog will later provide. Registered rooms cannot be added twice.
- Create space opens `06-space-layout.html?space=…` for that specific space. Add tables, numbered seats, windows and doors. Select and drag objects, or edit positions and dimensions in the inspector. Tables and seats can rotate; windows and doors snap to room walls.
- Furniture placement and editing keep tables and seats inside the room boundary. Undo and Redo work until the editor is reloaded. Place at centre provides a keyboard-accessible way to add an item.
- Save layout persists local furniture and updates the Spaces list’s seat totals. Manage opens the original room Seats overview. Layout is one tab alongside Seats, Opening hours, Closures and Settings. The selected room stays the same across these tabs. Editing this admin mockup does not change the React student fixture yet.
- The editor reuses the student map’s 32 × 36 rounded seats, numbered labels, 128 × 36 default tables, seat colours, blue windows and door arcs.
- Spaces use `study-admin-spaces-v1` with version 2 data. Old sample spaces are retained; obsolete GPS values are removed when loaded.
- Layout changes require Save layout before navigating away. Refresh reads saved sample data. A shared localhost origin provides cross-page persistence.
- Run `node --test design/admin/spaces-data.test.cjs` for room selection, migration, boundary, wall snapping and persistence checks.

Furniture placement: seats snap to table slots with an 8-unit edge gap and 48-unit spacing along each edge (canvas units, not physical measurements). Tables carry their attached seats when moved, resized or rotated. Placement and Save reject overlapping furniture and items outside the room. Removing a table removes its attached seats; Undo restores the group. Existing layouts are adjusted in memory; Save persists the adjusted layout. Any legacy seat that cannot be attached remains visible and must be corrected before saving.

Tables receive the first unused alphabetical name (A–Z, then AA, AB, …). Select furniture to resize tables from corners or doors/windows from their wall endpoints. The inspector edits table labels and shapes; seat numbers are read-only and assigned automatically. Seat numbers and table letters remain upright regardless of their side or rotation. Table seats number clockwise from the table’s local upper-left edge: top left-to-right, right top-to-bottom, bottom right-to-left, then left bottom-to-top. Round tables start at their local top; L tables follow their perimeter. Seat placement, movement, deletion and resizing preserve this order, skipping empty positions. Loading the editor also renumbers existing layouts; Save persists any correction. Resize handles also support arrow keys.

Delete whole layout opens a confirmation dialog. Cancel, Escape and clicking outside leave it unchanged. Confirm clears furniture only, keeps the room outline, and can be undone/redone; Save layout persists the empty layout. The delete action is disabled for an empty layout.

Resize grips use curved corner marks. Table resize presets are 24, 32, 80, 128, 176, 224 and 272 canvas units, fitting 0–6 seats along each edge respectively. Windows and doors snap to preset lengths. Arrow keys on a focused grip move by one preset; resizing continues to enforce seat attachment, collision and boundary rules.

Table resizing now preserves empty sides and internal gaps, extending occupied edges only at their ends. Existing seats keep their IDs and states; deletion and resizing renumber the room. Undo/Redo restores the whole change.

Latest editor behavior: resizing extends only populated edges at their ends, preserving empty edges and deleted gaps; deleting seats or their parent renumbers remaining seats. Tools: V select, T rectangle, S seat, W window, D door, O round table, L L-table, A seat rows. Esc exits placement. Middle-button dragging pans the map. Scroll-wheel zoom keeps the point beneath the cursor fixed, within 0.5×–4× zoom. Right-click retains the browser menu. Actions: C place at centre, R rotate, F fit, +/- zoom, M theme, Delete remove, Ctrl S save, Ctrl Enter apply properties, Ctrl Z undo, Ctrl Shift Z/Ctrl Y redo, Ctrl Shift Delete opens whole-layout confirmation. Text inputs ignore letter shortcuts.

The Table submenu groups rectangle, round and L shapes. Round and L tables use shape-aware collisions and preset corner resizing. Seat-row groups have a first-row seat count (equal seats per row when straight), row count, curve angle (0 straight, 180 half-circle), and radius controls; row spacing is fixed and the radius grows as needed to prevent overlapping seats. Curved outer rows fit more seats at the first row’s seat spacing; straight rows retain equal counts. Legacy equal-count arcs are upgraded on load, preserving seat identities and deleted gaps; Save persists the updated layout. Row controls update the map live without Apply and keep input focus. Invalid edits show a reason and preserve the last valid layout. Click the large row label or the guide between seats to select a group; individual seats remain selectable. Adding a row group returns to Select automatically. Drag/rotate the row guide to move all seats together. Newly added rows and row ends get seats, while deleted internal gaps remain empty. All changes are local mockup data and support Save/Undo/Redo.

Add space: the room search replaces the manual name field in the same position. Search by room label, type or building, then click a result or use Up/Down and Enter. The room map and search select the same room, and the name is generated automatically. Already registered rooms cannot be selected, and typing a new query clears the previous selection. Unmatched text cannot create a space. The room catalog remains local sample data until backend integration.

Unsaved layout edits: following a page link offers Keep editing, Discard, or Save and leave. Saving validates the layout and retains the dialog if saving fails. Reloading or closing the page uses the browser’s native unsaved-changes prompt. Returning the layout to its saved state with Undo removes the warning.

Seat numbering is recalculated for the whole room after every placement, move, update and deletion, and again on load/save. Inserting a seat into an earlier position updates existing numbers immediately. Numbering stays consecutive and unique regardless of the order in which seats are added; seat identities and states remain unchanged.

Room scale: roomFromCoordinates converts a boundary polygon into a proportional editor coordinate system (64 units per meter). It accepts coordinateUnit m, cm or mm, or plan with a positive metersPerUnit calibration. Set coordinateAxis cartesian for coordinates where Y increases upwards; screen is the default. Each room exposes measurements (widthMeters, heightMeters, areaSquareMeters) and sourcePoint converts editor positions back to source coordinates for later backend persistence. Chairs, table presets, gaps, rows, doors and windows share this fixed physical scale. Room fitting changes the camera, not furniture dimensions. The room picker independently fits each outline into its thumbnail.

Existing mock boundaries use an explicit approximate scale, keep their saved coordinates, and display approximate dimensions in the editor. These dimensions are illustrative, not measurements of ETH rooms. The current backend has location points but no measured room polygons; no API or database integration was added. A location point cannot define floor area. Future floor-plan data must include its polygon and units/calibration.

Example future adapter input:

```js
AdminLayoutData.roomFromCoordinates({
  id: "room-id", label: "HG E 3", kind: "Auditorium", building: "HG · Floor E",
  coordinateUnit: "m", coordinateAxis: "cartesian",
  boundary: [[100, 200], [118, 200], [118, 224], [100, 224]],
});
```


## QR labels
Open `10-space-qr.html`, or choose QR codes after Layout in a space menu or below Users in the sidebar. Select a study space, confirm its full room label and student app origin, then generate labels. Saved layouts supply actual seat numbers, including inactive seats; legacy sample spaces use their sample seat count. Empty layouts require seats first.

Supports up to 200 labels per batch, full ETH room labels (including spaces, dots and leading zeroes), and 3 × 3 cm or 4 × 4 cm QR images with white quiet margins. Room and seat captions sit outside the QR. Download individual SVG images or use Print / Save PDF for the complete batch; print at 100% / actual size with browser headers and footers off. Changing space, label, address or stored space data disables printing until labels are regenerated.

The page uses the same pinned CDN QR library as `tools/qr-generator`, so internet access is required to load it. Generation happens in the browser. Replace `https://example.com` with the stable student app origin before printing real labels. Links identify room and seat; `/check-in` remains a prototype route and generating or opening a label does not change reservations or attendance. No backend integration was added.

Run all admin data checks:
```sh
node --test design/admin/spaces-data.test.cjs design/admin/users-data.test.cjs design/admin/qr-data.test.cjs
```

Opening QR codes from a room tab locks the study-space field to that room. The sidebar entry opens the general generator, where admins can choose any space.

Compact toolbar: Badges (B) groups Outlet (P), Monitor (E) and Quiet area (Q). Select a badge tool and click seats to toggle that amenity; Enter/Space on a focused seat also works. Select a seat to toggle its badges in the inspector. Badges remain upright, persist with Save layout, and support Undo/Redo. The student app currently uses cup/clock status badges automatically and quiet/outlet feature text; monitor is a new admin amenity. No student API integration was added.

Features replaces the Badges menu label. Feature tools and inspector toggles also accept tables: applying/removing a table feature updates all its attached seats in one undoable operation. Other seat features remain intact. Seats added manually or by resizing inherit the table’s current features; individual seat features can still be adjusted. Save persists both table and seat features.

Curved tables: choose Curved (U) in the Table submenu. Resize with the same corner grips and adjust Curvature (0–100%) live in the inspector. Attached seats follow the curve at fixed spacing; resizing extends occupied edges and preserves table features. Numbering remains consecutive. White dots mark currently free, valid seat positions for all table shapes; choose Seat and click a dot to add a seat. Dots exclude occupied, overlapping or out-of-room positions.


## Preparing integration with main (reviewed bbcfcaa)
The branch remains admin-frontend. Main was fetched and inspected; no merge, rebase, cherry-pick, API writes or deployment was performed. The Preview menu and standalone preview page have been removed.

### Identity and layout adapter

integration-data.js is framework-free and can be tested independently before moving the implementation to TypeScript. It does not call the API.

- Campus workspaces: /api/v1/map/workspaces has string workspace IDs, tables.libraryId and seats.tableId, plus PolyMaps unit/level IDs such as ETH.HG.E.E_003. Reservation spaces and seats use UUIDs under /api/v1/admin/spaces. These are separate database features. Do not equate them by name or invent UUIDs. A persisted map-workspace → reservation-space mapping is still needed. The adapter preserves explicit backendSpaceId/backendSeatId bindings; display numbering does not change those identities.
- overview maps the real admin overview shape (timezone, server_time, opening_hours, closures, seat labels, reservations) and translates on_break → break, claimable → bookable, unavailable → unavailable. Live state comes from reservations, not layout JSON. An API-backed room without availability shows unknown rather than free.
- geographicRoom accepts GeoJSON [longitude, latitude] and projects a small room polygon to approximate local metres at 64 canvas units/metre. decodeRoom understands main's compact floor files: origin [lng,lat], scale and flat ring offsets. North maps upwards; geographicPoint reverses the transform. The editor currently supports one polygon without holes. Multi-wing and holed outlines are rejected explicitly, rather than silently losing geometry. Campus pins alone cannot supply a room outline. Main's floor service loads /api/v1/map/floors/index.json and /levels/{encoded level ID}.json.
- layoutPayload produces an UpdateSpaceRequest-compatible {layout: {...}} envelope with schemaVersion 1, unitsPerMeter, room geometry and configured objects. It retains shape/curvature/features and seat bindings, and excludes availability and QR tokens. This is a proposed layout schema: main currently stores an arbitrary dict and its mobile seat screen still reads mock roomGeometry/roomTables. Both sides must adopt the envelope before live wiring.
- bindSeats attaches explicitly returned seat UUIDs/labels one-to-one. Existing editor IDs remain stable for undo/resize. New seats must be created through admin_create_seat before they become reservable; the returned seat UUID must be bound. Main has no seat hard-delete endpoint, so removing a configured seat should deactivate its UUID after reviewing conflicts, not delete/recreate it or renumber backend identities.

### Merge checklist

1. Port the admin shell/editor into frontend/src/features/admin and reuse Mantine theme, ThemeToggle, Icon and tokens. Keep this HTML mockup as its visual reference; do not embed its CSS globally into the phone UI. Desktop compact controls are 26/32px; phone targets must remain at least 44px.
2. Use main's generated SDK/TanStack Query helpers, not handwritten fetch calls or generated-file edits. Use relative /api routing. Fetch admin_list_spaces, admin_get_space_overview and map workspaces/floor plans through the shared client. Keep loading, empty, 401/403 and retry states.
3. Add an explicit association between a reservation space UUID and map workspace/unit/level IDs. Selecting a map room supplies lat/lng and the geographic outline; preserve full room labels independently of main's comparison-only roomKey normalizer. Never flatten multi-level rooms into one floor.
4. Replace Save's localStorage adapter with a reviewed seat-create/update + layout-save sequence. There is no atomic bulk-layout/seat endpoint yet. Show reservation_impacts from 409 responses and require a decision before force=true; don't silently deactivate occupied seats. Partial saves must retain returned IDs and be resumable.
5. Replace the mobile seat map's mock imports with the same layout envelope and live seat availability. Keep backend labels/UUIDs separate from editor display numbers. Round/L/curved shapes and feature icons need matching React renderer support.
6. QR generation is still room/seat demo links. Real seat QR codes must use backend qr_token from authenticated admin_get_seat, preserve tokens across renames/renumbering, and feed CheckInRequest through an authenticated POST. Never put QR tokens in public map/layout data. Opening a QR link alone must not check in. The mobile scan screen still needs URL/token handoff.
7. Opening hours must map to Monday=0, start_minute/end_minute (1440 is end of day). Closures use timezone-aware timestamps and UUID seat IDs. Campus published hours may be null; do not interpret that as continuous opening. Server time governs reservations.
8. Users remains a local mockup: main has /api/v1/me profile endpoints and demo occupant names in overviews, but no admin user-list/profile-edit/study-history APIs. Do not treat mock emails/departments/statistics as database fields. Production admin roles are also unresolved: main's admin endpoints deny proxy-mode admin access and allow demo privileges only. Don't bypass authentication in the frontend.
9. Once React/backend code is changed, run the repository frontend lint/typecheck/build and backend tests, regenerate OpenAPI if contracts change, and test both themes. Current preparation changes only design/; no build or database migration is required.

Adapter and mockup checks:

```sh
node --test design/admin/integration-data.test.cjs design/admin/spaces-data.test.cjs design/admin/users-data.test.cjs design/admin/qr-data.test.cjs
```

Delete study place is available in the Spaces list and Settings. It asks for confirmation, stores the removed local record for Undo, and preserves user reservation history. It does not call a backend delete endpoint.

While dragging an existing element, press Space to rotate it 90°. Rotation preserves attached seats and existing boundary/collision rules; moving and rotating remain one Undo action. Hold Space does not repeat rotations.
