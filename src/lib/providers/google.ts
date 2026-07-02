import type { MapProvider } from "./types";

// Not implemented yet — Google's REST Geocoding/Directions APIs don't send
// CORS headers, so plain fetch() calls from the browser (like the osm and
// mapbox providers use) will fail. To actually wire this up you have two
// options; see CLAUDE.md for the full writeup:
//
//   1. Load the Google Maps JavaScript SDK (@googlemaps/js-api-loader) and
//      use `google.maps.Geocoder` + `google.maps.DirectionsService`, which
//      call Google's backend directly from the SDK (no CORS issue).
//   2. Proxy the REST APIs through a small backend/serverless function so
//      the browser never calls Google directly.
//
// Set VITE_GOOGLE_MAPS_API_KEY in .env.local once you implement one of the
// above, then flip VITE_MAP_PROVIDER=google.
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

function notImplemented(): never {
  throw new Error(
    "Google Maps provider is a stub. See the comment at the top of src/lib/providers/google.ts and CLAUDE.md for how to finish it.",
  );
}

export const googleProvider: MapProvider = {
  id: "google",
  tileLayer: {
    // Placeholder: Google doesn't offer a plain XYZ raster tile URL for use
    // outside its own SDK/ToS, so this needs the JS SDK's map renderer
    // instead of a Leaflet TileLayer. Falls back to OSM tiles until then.
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (Google tiles not wired up yet, see google.ts)',
    maxZoom: 19,
  },
  geocode: async () => {
    void API_KEY;
    return notImplemented();
  },
  route: async () => notImplemented(),
};
