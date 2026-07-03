# Loop Route Planner

A small web app for planning a running loop: search/pan to an area, click to
drop a starting point, drag away from that point to draw a circle (start and
the release point are opposite ends of its diameter — that circle is the area
the route is allowed to explore), and on release it generates a real
street-following loop route that starts and ends at that point and is at
least the target distance from the sidebar's distance box.

## Stack

- Vite + React + TypeScript
- Leaflet + react-leaflet for the map
- No backend — everything runs client-side and talks directly to public
  geocoding/routing APIs over `fetch`.

## Architecture

```
src/
  lib/
    geo.ts                 Pure geo math: haversine distance, bearing, destination point
    routeGenerator.ts       The loop-route-generation algorithm (provider-agnostic)
    providers/
      types.ts              MapProvider interface: tileLayer + geocode() + route()
      osm.ts                 Default: OSM tiles + Nominatim geocoding + OSRM routing
      mapbox.ts               Full implementation, just needs an access token
      google.ts                Stub — see "Pivoting providers" below
      index.ts                 Picks the active provider from VITE_MAP_PROVIDER
  components/
    MapView.tsx             Leaflet map, start-point marker, drag interaction, route/preview rendering
    Sidebar.tsx              Distance input, route option toggles, location search, status/instructions
  App.tsx                    Top-level state (start point, target distance, route options, generated route)
```

Everything the map/routing backend does is behind the `MapProvider` interface
in `src/lib/providers/types.ts`. The rest of the app (`MapView`, `Sidebar`,
the route generator) only calls `provider.geocode()`, `provider.route()`, and
reads `provider.tileLayer` — it never talks to Nominatim/OSRM/Mapbox/Google
directly. That's what makes swapping providers a config change instead of a
rewrite.

## How the loop route is generated (`src/lib/routeGenerator.ts`)

There's no API that generates "a loop route of at least X km, roughly
circular, avoiding backtracking and highways" — routing engines only route
between waypoints along the street graph. Everything here is a heuristic
built on top of plain point-to-point routing, controllable via
`RouteGenerationOptions` (which the sidebar's three toggles map directly
onto: `maximizeRoundness`, `avoidBacktracking`, `avoidHighways`).

**The region.** The circle the user drags (center = midpoint of the start
point and the release point, radius = half the distance between them, so the
start point always sits on the boundary) is the hard cap on how far the route
is allowed to reach — `maxRadius` in the code.

**Isodiametric shape.** For a fixed diameter, a circle encloses the most
area (the isodiametric property) — so to make the generated loop use as much
of the drawn area as possible, waypoints are placed on a regular polygon
inscribed in a circle of some trial radius `r ≤ maxRadius`, with the start
point fixed as one vertex. `maximizeRoundness` on uses an 8-sided polygon
(closer to a circle); off uses a 3-sided one (a sharper, more direct loop).
The routing engine is asked for the real path through all the polygon's
vertices and back to start.

**Hitting the target distance, always ≥.** Starting from
`r = min(maxRadius, targetDistance / 2π)` (what the radius would be if the
route were a perfect circle), each iteration scales `r` by
`target / actual returned distance` and re-queries, capped at `maxRadius`,
for up to 5 iterations or until within 5% over target. The candidate kept is
always the smallest-overshoot result that's `>= targetDistance` — undershoots
are only used to decide which direction to adjust `r`, never returned. If
`r` is capped at `maxRadius` and the result is still short of the target, the
loop stops early (growing further can't help) and `AreaTooSmallError` is
thrown, with the largest distance actually achieved in that area so the UI
can suggest a bigger drag or a shorter target.

**Avoiding backtracking.** After landing on a candidate, `computeBacktrackRatio`
quantizes the route's points to an ~11m grid and measures what fraction of
the route's length lies on an (undirected) grid edge it also traverses
elsewhere — i.e. doubling back over the same street. If `avoidBacktracking`
is on and that ratio is above 15%, it retries the same radius with the
polygon rotated (up to 2 extra tries), keeping whichever attempt has the
lowest backtrack ratio among those still meeting the distance target.

**Avoiding highways.** Best-effort only, two mechanisms:
1. The OSRM/Mapbox request includes `exclude=motorway,trunk` (or `motorway`
   for Mapbox) when `avoidHighways` is on. If the routing profile doesn't
   support excluding those classes it errors out and the provider
   transparently retries without `exclude` — **the FOSSGIS `routed-foot`
   profile this app defaults to does not support it**, so on the default
   setup this mechanism is currently a no-op. It's wired up so it starts
   working automatically if you switch to a profile/provider that does
   support it (e.g. a self-hosted OSRM with a foot profile that defines
   excludable classes).
2. `estimateHighwayFraction` pattern-matches step names against things like
   "Interstate", "Freeway", "I-90" and reports what fraction of the route's
   distance falls on matches. This only catches *named* highways in
   English-style naming — most footway/residential steps are unnamed and
   won't match either way. It's currently informational (shown in the
   sidebar) rather than fed back into candidate selection.

This is a heuristic, not an optimal solver — real street networks aren't
regular polygons, so how close/round the result is will vary a lot by area
(dense grid vs. sparse suburban streets vs. a dead-end near water). If you
want to improve it later, likely directions: use the highway-fraction score
to actually pick among multiple candidates (not just report it), or query
Overpass for real road classifications instead of guessing from step names.

## Pivoting map/routing providers

Set `VITE_MAP_PROVIDER` in `.env.local` (create it, gitignored by default
from the Vite template) to `osm`, `mapbox`, or `google`.

### Default: OSM (`osm`)

No API key. Uses:
- **Tiles + attribution:** `tile.openstreetmap.org`
- **Geocoding:** Nominatim (`nominatim.openstreetmap.org`) — free, but rate
  limited to ~1 request/second and meant for light use per the
  [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).
  Browser requests can't set a custom `User-Agent` header, which the policy
  normally asks for — fine for personal/dev use, but if this gets real
  traffic, self-host Nominatim or switch providers.
- **Routing:** the FOSSGIS community OSRM demo server
  (`routing.openstreetmap.de`, profile `routed-foot`) — free, no key, but
  also a shared public resource intended for light use. If you outgrow it,
  either self-host OSRM (it's straightforward with Docker + an `.osm.pbf`
  extract from [Geofabrik](https://download.geofabrik.de/)) or switch to
  Mapbox/Google.

### Mapbox (`mapbox`)

Fully implemented in `src/lib/providers/mapbox.ts` — just needs a token:

1. Create a free account at [mapbox.com](https://www.mapbox.com/) and grab
   an access token.
2. Add to `.env.local`:
   ```
   VITE_MAP_PROVIDER=mapbox
   VITE_MAPBOX_TOKEN=pk.your_token_here
   ```
3. Restart the dev server (Vite only reads `.env*` files at startup).

Uses the Mapbox Geocoding API (`geocoding/v5/mapbox.places`) and Directions
API (`directions/v5/mapbox/walking`), both of which support CORS for direct
browser calls.

### Google Maps (`google`)

**Not implemented** — currently a stub in `src/lib/providers/google.ts` that
throws a clear error if selected. Google's REST Geocoding/Directions APIs
don't return CORS headers, so the `fetch()`-based approach the other two
providers use won't work directly from the browser. To finish it:

- **Option A (recommended for a client-only app):** load the
  `@googlemaps/js-api-loader` package and use `google.maps.Geocoder` +
  `google.maps.DirectionsService` from the JS SDK instead of raw `fetch`
  calls — the SDK talks to Google's backend without hitting CORS. You'll
  also want `google.maps.Map` itself rather than a Leaflet `TileLayer`,
  since Google's tiles aren't available as a plain XYZ URL under its ToS.
- **Option B:** add a minimal backend/serverless function that proxies the
  REST APIs, and point `google.ts` at that instead of Google directly.

Either way, set `VITE_GOOGLE_MAPS_API_KEY` in `.env.local` once it's wired
up, then `VITE_MAP_PROVIDER=google`.

## Running locally

```
npm install
npm run dev
```

## Known limitations

- No offline/error handling beyond surfacing the raw error message in the
  sidebar — e.g. if OSRM can't find a route (isolated island, no nearby
  roads), you'll see a generic routing error.
- The loop heuristic can produce a fairly irregular shape in sparse street
  networks (it'll follow whatever roads exist near the target radius, not
  necessarily a smooth loop).
- "Avoid highways" doesn't actually exclude anything on the default OSM
  provider (the FOSSGIS `routed-foot` profile doesn't support `exclude`) — it
  only scores/reports named highway matches. See the routeGenerator section
  above.
- "Avoid backtracking" reduces but doesn't eliminate doubling back — it's a
  bounded number of retries with a rotated polygon, not a search over the
  full street graph.
- Public Nominatim/OSRM demo servers are not meant for production traffic —
  see the provider notes above before deploying this somewhere with real
  usage.
