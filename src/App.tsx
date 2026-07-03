import { useCallback, useState } from "react";
import "./App.css";
import { MapView, type FlyToTarget } from "./components/MapView";
import { Sidebar, toMeters, type DistanceUnit } from "./components/Sidebar";
import type { LatLng } from "./lib/geo";
import { mapProvider } from "./lib/providers";
import {
  DEFAULT_ROUTE_OPTIONS,
  generateLoopRoute,
  type LoopRouteResult,
  type RouteGenerationOptions,
} from "./lib/routeGenerator";

function App() {
  const [startPoint, setStartPoint] = useState<LatLng | null>(null);
  const [distanceValue, setDistanceValue] = useState(5);
  const [unit, setUnit] = useState<DistanceUnit>("km");
  const [routeOptions, setRouteOptions] = useState<RouteGenerationOptions>(DEFAULT_ROUTE_OPTIONS);
  const [route, setRoute] = useState<LoopRouteResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<FlyToTarget | null>(null);

  const handleSetStartPoint = useCallback((p: LatLng) => {
    setStartPoint(p);
    setRoute(null);
    setError(null);
  }, []);

  const handleDragComplete = useCallback(
    async (dragEnd: LatLng) => {
      if (!startPoint) return;
      const targetMeters = toMeters(distanceValue, unit);
      if (targetMeters <= 0) {
        setError("Enter a target distance greater than zero.");
        return;
      }

      setIsGenerating(true);
      setError(null);
      try {
        const result = await generateLoopRoute(
          mapProvider,
          startPoint,
          dragEnd,
          targetMeters,
          routeOptions,
        );
        setRoute(result);
      } catch (err) {
        setRoute(null);
        setError(err instanceof Error ? err.message : "Failed to generate route.");
      } finally {
        setIsGenerating(false);
      }
    },
    [startPoint, distanceValue, unit, routeOptions],
  );

  const handleLocationSelected = useCallback((p: LatLng) => {
    setFlyToTarget({ position: p, key: Date.now() });
  }, []);

  const handleClear = useCallback(() => {
    setStartPoint(null);
    setRoute(null);
    setError(null);
  }, []);

  return (
    <div className="app">
      <Sidebar
        provider={mapProvider}
        distanceValue={distanceValue}
        unit={unit}
        onDistanceValueChange={setDistanceValue}
        onUnitChange={setUnit}
        routeOptions={routeOptions}
        onRouteOptionsChange={setRouteOptions}
        onLocationSelected={handleLocationSelected}
        startPoint={startPoint}
        route={route}
        isGenerating={isGenerating}
        error={error}
        onClear={handleClear}
      />
      <main className="map-pane">
        <MapView
          provider={mapProvider}
          startPoint={startPoint}
          onSetStartPoint={handleSetStartPoint}
          onDragComplete={handleDragComplete}
          route={route}
          interactionsDisabled={isGenerating}
          flyToTarget={flyToTarget}
        />
      </main>
    </div>
  );
}

export default App;
