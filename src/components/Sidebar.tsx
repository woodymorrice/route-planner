import { useState } from "react";
import type { LatLng } from "../lib/geo";
import type { GeocodeResult, MapProvider } from "../lib/providers/types";
import type { LoopRouteResult, RouteGenerationOptions } from "../lib/routeGenerator";

export type DistanceUnit = "km" | "mi";

const MI_PER_KM = 0.621371;

export function toMeters(value: number, unit: DistanceUnit): number {
  return unit === "km" ? value * 1000 : (value / MI_PER_KM) * 1000;
}

function fromMeters(meters: number, unit: DistanceUnit): number {
  return unit === "km" ? meters / 1000 : (meters / 1000) * MI_PER_KM;
}

interface SidebarProps {
  provider: MapProvider;
  distanceValue: number;
  unit: DistanceUnit;
  onDistanceValueChange: (v: number) => void;
  onUnitChange: (u: DistanceUnit) => void;
  routeOptions: RouteGenerationOptions;
  onRouteOptionsChange: (o: RouteGenerationOptions) => void;
  onLocationSelected: (p: LatLng, label: string) => void;
  startPoint: LatLng | null;
  route: LoopRouteResult | null;
  isGenerating: boolean;
  error: string | null;
  onClear: () => void;
}

export function Sidebar({
  provider,
  distanceValue,
  unit,
  onDistanceValueChange,
  onUnitChange,
  routeOptions,
  onRouteOptionsChange,
  onLocationSelected,
  startPoint,
  route,
  isGenerating,
  error,
  onClear,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const found = await provider.geocode(query.trim());
      setResults(found);
      if (found.length === 0) {
        setSearchError("No results found.");
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  function selectResult(r: GeocodeResult) {
    onLocationSelected(r.position, r.label);
    setResults([]);
    setQuery(r.label);
  }

  function toggle(key: keyof RouteGenerationOptions) {
    onRouteOptionsChange({ ...routeOptions, [key]: !routeOptions[key] });
  }

  return (
    <aside className="sidebar">
      <h1>Loop Route Planner</h1>

      <section>
        <h2>Go to a location</h2>
        <form onSubmit={runSearch} className="search-form">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a place or address"
          />
          <button type="submit" disabled={searching}>
            {searching ? "…" : "Go"}
          </button>
        </form>
        {searchError && <p className="error">{searchError}</p>}
        {results.length > 0 && (
          <ul className="search-results">
            {results.map((r, i) => (
              <li key={i}>
                <button type="button" onClick={() => selectResult(r)}>
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Target distance</h2>
        <div className="distance-input">
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={distanceValue}
            onChange={(e) => onDistanceValueChange(parseFloat(e.target.value) || 0)}
          />
          <select value={unit} onChange={(e) => onUnitChange(e.target.value as DistanceUnit)}>
            <option value="km">km</option>
            <option value="mi">mi</option>
          </select>
        </div>
      </section>

      <section>
        <h2>Route options</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={routeOptions.maximizeRoundness}
            onChange={() => toggle("maximizeRoundness")}
          />
          Maximize roundness (use the full drawn area)
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={routeOptions.avoidBacktracking}
            onChange={() => toggle("avoidBacktracking")}
          />
          Avoid backtracking on the same street
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={routeOptions.avoidHighways}
            onChange={() => toggle("avoidHighways")}
          />
          Avoid highways/freeways (best effort)
        </label>
      </section>

      <section>
        <h2>How to use</h2>
        <ol className="instructions">
          <li>Click the map to drop a starting point.</li>
          <li>Press and drag from that point to draw the area you want to run in.</li>
          <li>Release the mouse to generate a loop route of your target distance within that area.</li>
        </ol>
      </section>

      <section className="status">
        {isGenerating && <p>Generating route…</p>}
        {error && <p className="error">{error}</p>}
        {!isGenerating && route && (
          <div className="route-stats">
            <p>
              <strong>{fromMeters(route.distanceMeters, unit).toFixed(2)} {unit}</strong> route
              generated (target {fromMeters(route.targetDistanceMeters, unit).toFixed(2)} {unit}+)
            </p>
            <p className="muted">
              {route.iterations} attempt{route.iterations === 1 ? "" : "s"}
              {routeOptions.avoidBacktracking && ` · ${(route.backtrackRatio * 100).toFixed(0)}% backtracking`}
              {routeOptions.avoidHighways && ` · ${(route.highwayFraction * 100).toFixed(0)}% on named highways`}
            </p>
          </div>
        )}
        {(startPoint || route) && (
          <button type="button" className="clear-button" onClick={onClear}>
            Clear
          </button>
        )}
      </section>

      <footer className="provider-badge">Map data: {provider.id.toUpperCase()}</footer>
    </aside>
  );
}
