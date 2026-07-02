import type { MapProvider } from "./types";
import { osmProvider } from "./osm";
import { mapboxProvider } from "./mapbox";
import { googleProvider } from "./google";

const PROVIDERS: Record<string, MapProvider> = {
  osm: osmProvider,
  mapbox: mapboxProvider,
  google: googleProvider,
};

// Pivot providers by setting VITE_MAP_PROVIDER in .env.local — see CLAUDE.md.
const selectedId = (import.meta.env.VITE_MAP_PROVIDER as string | undefined) ?? "osm";

export const mapProvider: MapProvider = PROVIDERS[selectedId] ?? osmProvider;

export type { MapProvider, GeocodeResult, RouteResult, RoutingProfile } from "./types";
