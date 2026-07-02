import type { LatLng } from "../geo";

export interface GeocodeResult {
  label: string;
  position: LatLng;
}

export interface RouteResult {
  distanceMeters: number;
  path: LatLng[];
}

export type RoutingProfile = "foot" | "bike" | "car";

/**
 * Everything the app needs from a map backend: tiles to display, a geocoder
 * for the location search box, and a router that can turn an ordered list of
 * waypoints into a real path along streets/paths.
 *
 * Swap providers by adding a new implementation of this interface and
 * selecting it in `providers/index.ts` — see CLAUDE.md for the full guide.
 */
export interface MapProvider {
  id: "osm" | "mapbox" | "google";

  /** Leaflet tile layer config for rendering the base map. */
  tileLayer: {
    url: string;
    attribution: string;
    maxZoom: number;
  };

  /** Forward geocode a free-text query into candidate locations. */
  geocode(query: string): Promise<GeocodeResult[]>;

  /**
   * Route through an ordered list of waypoints (first and last may be the
   * same point for a loop) along real streets/paths, snapping to the network.
   */
  route(waypoints: LatLng[], profile: RoutingProfile): Promise<RouteResult>;
}
