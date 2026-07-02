import type { LatLng } from "../geo";
import type { GeocodeResult, MapProvider, RouteResult, RoutingProfile } from "./types";

// FOSSGIS community OSRM demo server. Free, no API key, but a shared public
// resource: low volume / personal use only. See CLAUDE.md for self-hosting
// instructions if you outgrow it.
const OSRM_BASE_URL = "https://routing.openstreetmap.de";

const OSRM_PROFILE_PATH: Record<RoutingProfile, string> = {
  foot: "routed-foot/route/v1/foot",
  bike: "routed-bike/route/v1/bike",
  car: "routed-car/route/v1/driving",
};

// OpenStreetMap's Nominatim geocoder. Free, no API key, but rate-limited to
// ~1 request/second and intended for light use. See CLAUDE.md.
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

async function geocode(query: string): Promise<GeocodeResult[]> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Geocoding failed: ${res.status} ${res.statusText}`);
  }

  const results: { display_name: string; lat: string; lon: string }[] = await res.json();

  return results.map((r) => ({
    label: r.display_name,
    position: { lat: parseFloat(r.lat), lng: parseFloat(r.lon) },
  }));
}

async function route(waypoints: LatLng[], profile: RoutingProfile): Promise<RouteResult> {
  if (waypoints.length < 2) {
    throw new Error("route() requires at least 2 waypoints");
  }

  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${OSRM_BASE_URL}/${OSRM_PROFILE_PATH[profile]}/${coords}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Routing failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.[0]) {
    throw new Error(`Routing failed: ${data.code ?? "unknown error"}`);
  }

  const routeData = data.routes[0];
  const path: LatLng[] = routeData.geometry.coordinates.map(
    ([lng, lat]: [number, number]) => ({ lat, lng }),
  );

  return { distanceMeters: routeData.distance, path };
}

export const osmProvider: MapProvider = {
  id: "osm",
  tileLayer: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  geocode,
  route,
};
