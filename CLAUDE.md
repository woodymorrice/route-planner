# Loop Route Planner

A small web app for planning a running loop: search/pan to an area, click to
drop a starting point, drag away from that point to aim a direction, and on
release it generates a real street-following loop route of a target distance
that starts and ends at that point.

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
    Sidebar.tsx              Distance input, location search, status/instructions
  App.tsx                    Top-level state (start point, target distance, generated route)
```

Everything the map/routing backend does is behind the `MapProvider` interface
in `src/lib/providers/types.ts`. The rest of the app (`MapView`, `Sidebar`,
the route generator) only calls `provider.geocode()`, `provider.route()`, and
reads `provider.tileLayer` — it never talks to Nominatim/OSRM/Mapbox/Google
directly. That's what makes swapping providers a config change instead of a
rewrite.

## How the loop route is generated (`src/lib/routeGenerator.ts`)

There's no API that generates "a loop route of exactly X km" — routing
engines only route between waypoints. The approach here:

1. Take the bearing the user dragged in, and a radius guess of
   `targetDistance / (2π)` (i.e. what the radius would be if the route were
   a perfect circle).
2. Place three waypoints on a circle of that radius around the start point,
   spread across the dragged bearing (`bearing - 100°, bearing, bearing +
   100°`), and ask the routing engine for the real path through
   `start → wp1 → wp2 → wp3 → start`.
3. Compare the actual returned distance to the target, scale the radius by
   `target / actual`, and repeat (up to 5 iterations, stops within 8% of
   target).

This is a heuristic, not an optimal solver — real street networks aren't
circular, so how close/round the result is will vary a lot by area (dense
grid vs. sparse suburban streets vs. a dead-end near water). If you want to
improve it later, likely directions: try multiple candidate bearings and keep
the best-fitting one, or increase/vary the waypoint count based on target
distance.

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
- Public Nominatim/OSRM demo servers are not meant for production traffic —
  see the provider notes above before deploying this somewhere with real
  usage.
