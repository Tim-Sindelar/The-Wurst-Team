# TODO: remove the standalone map route

The campus map now lives on the Home screen (`frontend/src/components/HomeMap.tsx`),
and the "Campus map" button on Home is gone. The standalone map is kept for now
so we can fall back to it. Delete it once the Home map is settled:

- `paths.map` in `frontend/src/routes.ts` and its `<Route>`
- `frontend/src/screens/MapScreen.tsx`
- the non-embedded parts of `CampusMap` (top bar, toolbar, selection card,
  `MapSheet` sheets): either port them into the expanded Home map or drop them
- the `/map` mentions in `AGENTS.md` ("Campus map" section) and `design/`
