import type { LatLng } from "../geo";
import type { GeocodeResult, MapProvider, RouteResult, RoutingProfile } from "./types";

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

async function route(waypoints: LatLng[], profile: RoutingProfile): Promise<RouteResult> {
  if (waypoints.length < 2) {
    throw new Error("route() requires at least 2 waypoints");
  }
  const token = requireToken();

  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/${DIRECTIONS_PROFILE[profile]}/${coords}`,
  );
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("access_token", token);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Routing failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const routeData = data.routes?.[0];
  if (!routeData) {
    throw new Error(`Routing failed: ${data.message ?? data.code ?? "unknown error"}`);
  }

  const path: LatLng[] = routeData.geometry.coordinates.map(
    ([lng, lat]: [number, number]) => ({ lat, lng }),
  );

  return { distanceMeters: routeData.distance, path };
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
