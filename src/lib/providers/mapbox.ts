import type { LatLng } from "../geo";
import type { GeocodeResult, MapProvider, RouteOptions, RouteResult, RoutingProfile } from "./types";

// Set VITE_MAPBOX_TOKEN in .env.local (see CLAUDE.md) and VITE_MAP_PROVIDER=mapbox.
const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

const DIRECTIONS_PROFILE: Record<RoutingProfile, string> = {
  foot: "walking",
  bike: "cycling",
  car: "driving",
};

function requireToken(): string {
  if (!TOKEN) {
    throw new Error(
      "Mapbox provider selected but VITE_MAPBOX_TOKEN is not set. Add it to .env.local — see CLAUDE.md.",
    );
  }
  return TOKEN;
}

async function geocode(query: string): Promise<GeocodeResult[]> {
  const token = requireToken();
  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
  );
  url.searchParams.set("access_token", token);
  url.searchParams.set("limit", "5");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Geocoding failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return (data.features ?? []).map((f: { place_name: string; center: [number, number] }) => ({
    label: f.place_name,
    position: { lat: f.center[1], lng: f.center[0] },
  }));
}

async function fetchRoute(coords: string, profile: RoutingProfile, token: string, exclude?: string) {
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/${DIRECTIONS_PROFILE[profile]}/${coords}`,
  );
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "true");
  url.searchParams.set("access_token", token);
  if (exclude) url.searchParams.set("exclude", exclude);

  const res = await fetch(url.toString());
  return { res, data: await res.json() };
}

async function route(
  waypoints: LatLng[],
  profile: RoutingProfile,
  options: RouteOptions = {},
): Promise<RouteResult> {
  if (waypoints.length < 2) {
    throw new Error("route() requires at least 2 waypoints");
  }
  const token = requireToken();
  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(";");

  let { res, data } = await fetchRoute(coords, profile, token, options.avoidHighways ? "motorway" : undefined);

  // The walking/cycling profiles only support excluding a small set of road
  // classes (mainly "ferry") — fall back to a plain request if this profile
  // rejects the exclude value rather than failing generation over it.
  if (!res.ok && options.avoidHighways) {
    ({ res, data } = await fetchRoute(coords, profile, token));
  }

  const routeData = data.routes?.[0];
  if (!res.ok || !routeData) {
    throw new Error(`Routing failed: ${data.message ?? data.code ?? "unknown error"}`);
  }

  const path: LatLng[] = routeData.geometry.coordinates.map(
    ([lng, lat]: [number, number]) => ({ lat, lng }),
  );
  const steps = routeData.legs.flatMap(
    (leg: { steps: { name: string; distance: number }[] }) =>
      leg.steps.map((s) => ({ name: s.name, distanceMeters: s.distance })),
  );

  return { distanceMeters: routeData.distance, path, steps };
}

export const mapboxProvider: MapProvider = {
  id: "mapbox",
  tileLayer: {
    // Requires the token as a query param too; Mapbox raster tile endpoint.
    url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${TOKEN ?? ""}`,
    attribution:
      '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 22,
  },
  geocode,
  route,
};
