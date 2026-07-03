import { useCallback, useState } from "react";
import "./App.css";
import { MapView, type FlyToTarget } from "./components/MapView";
import { Sidebar, toMeters, type DistanceUnit } from "./components/Sidebar";
import type { LatLng } from "./lib/geo";
import { mapProvider } from "./lib/providers";
import type { RouteResult } from "./lib/providers/types";
import {
  DEFAULT_ROUTE_OPTIONS,
  generateLoopRoute,
  type LoopRouteResult,
  type RouteGenerationOptions,
} from "./lib/routeGenerator";
import {
  manualPointAfter,
  manualPointBefore,
  manualSegmentIndexAfter,
  manualSegmentIndexBefore,
} from "./lib/manualRoute";

export type PlanningMode = "auto" | "manual";

function App() {
  const [planningMode, setPlanningMode] = useState<PlanningMode>("auto");

  // Auto-generation state
  const [startPoint, setStartPoint] = useState<LatLng | null>(null);
  const [distanceValue, setDistanceValue] = useState(5);
  const [unit, setUnit] = useState<DistanceUnit>("km");
  const [routeOptions, setRouteOptions] = useState<RouteGenerationOptions>(DEFAULT_ROUTE_OPTIONS);
  const [route, setRoute] = useState<LoopRouteResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual drawing state
  const [manualPoints, setManualPoints] = useState<LatLng[]>([]);
  const [manualSegments, setManualSegments] = useState<RouteResult[]>([]);
  const [manualFinished, setManualFinished] = useState(false);
  const [isAddingSegment, setIsAddingSegment] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

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

  const handleManualPointClick = useCallback(
    async (p: LatLng) => {
      if (manualFinished || isAddingSegment) return;

      if (manualPoints.length === 0) {
        setManualPoints([p]);
        return;
      }

      const last = manualPoints[manualPoints.length - 1];
      setIsAddingSegment(true);
      setManualError(null);
      try {
        const leg = await mapProvider.route([last, p], "foot");
        setManualPoints((pts) => [...pts, p]);
        setManualSegments((segs) => [...segs, leg]);
      } catch (err) {
        setManualError(err instanceof Error ? err.message : "Couldn't route to that point.");
      } finally {
        setIsAddingSegment(false);
      }
    },
    [manualPoints, manualFinished, isAddingSegment],
  );

  const handleCloseLoop = useCallback(async () => {
    if (manualFinished || isAddingSegment || manualPoints.length < 2) return;

    const last = manualPoints[manualPoints.length - 1];
    const start = manualPoints[0];
    setIsAddingSegment(true);
    setManualError(null);
    try {
      const leg = await mapProvider.route([last, start], "foot");
      setManualSegments((segs) => [...segs, leg]);
      setManualFinished(true);
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Couldn't close the loop.");
    } finally {
      setIsAddingSegment(false);
    }
  }, [manualPoints, manualFinished, isAddingSegment]);

  const handleFinishManualRoute = useCallback(() => {
    if (manualPoints.length < 2 || manualSegments.length === 0 || manualFinished) return;
    setManualFinished(true);
  }, [manualPoints, manualSegments, manualFinished]);

  const handleInsertManualPoint = useCallback(
    async (segmentIndex: number, point: LatLng) => {
      if (isAddingSegment) return;
      const from = manualPoints[segmentIndex];
      const to =
        segmentIndex + 1 < manualPoints.length ? manualPoints[segmentIndex + 1] : manualPoints[0];
      if (!from || !to) return;

      setIsAddingSegment(true);
      setManualError(null);
      try {
        const [legA, legB] = await Promise.all([
          mapProvider.route([from, point], "foot"),
          mapProvider.route([point, to], "foot"),
        ]);
        setManualPoints((pts) => {
          const next = [...pts];
          next.splice(segmentIndex + 1, 0, point);
          return next;
        });
        setManualSegments((segs) => {
          const next = [...segs];
          next.splice(segmentIndex, 1, legA, legB);
          return next;
        });
      } catch (err) {
        setManualError(err instanceof Error ? err.message : "Couldn't insert a point there.");
      } finally {
        setIsAddingSegment(false);
      }
    },
    [manualPoints, isAddingSegment],
  );

  const handleMoveManualPoint = useCallback(
    async (index: number, newPos: LatLng) => {
      if (isAddingSegment) return;
      const segmentsLen = manualSegments.length;
      const before = manualPointBefore(manualPoints, segmentsLen, index);
      const after = manualPointAfter(manualPoints, segmentsLen, index);
      const beforeSegIdx = manualSegmentIndexBefore(manualPoints, segmentsLen, index);
      const afterSegIdx = manualSegmentIndexAfter(segmentsLen, index);
      if (!before && !after) return;

      setIsAddingSegment(true);
      setManualError(null);
      try {
        const [newBeforeLeg, newAfterLeg] = await Promise.all([
          before ? mapProvider.route([before, newPos], "foot") : Promise.resolve(null),
          after ? mapProvider.route([newPos, after], "foot") : Promise.resolve(null),
        ]);
        setManualSegments((segs) => {
          const next = [...segs];
          if (beforeSegIdx !== null && newBeforeLeg) next[beforeSegIdx] = newBeforeLeg;
          if (afterSegIdx !== null && newAfterLeg) next[afterSegIdx] = newAfterLeg;
          return next;
        });
        setManualPoints((pts) => {
          const next = [...pts];
          next[index] = newPos;
          return next;
        });
      } catch (err) {
        setManualError(err instanceof Error ? err.message : "Couldn't move that point.");
      } finally {
        setIsAddingSegment(false);
      }
    },
    [manualPoints, manualSegments, isAddingSegment],
  );

  const handleRemoveManualPoint = useCallback(
    async (index: number) => {
      if (index === 0 || isAddingSegment) return;
      const segmentsLen = manualSegments.length;
      const before = manualPoints[index - 1];
      const after = manualPointAfter(manualPoints, segmentsLen, index);

      setIsAddingSegment(true);
      setManualError(null);
      try {
        if (after) {
          const bridged = await mapProvider.route([before, after], "foot");
          setManualSegments((segs) => {
            const next = [...segs];
            next.splice(index - 1, 2, bridged);
            return next;
          });
        } else {
          setManualSegments((segs) => {
            const next = [...segs];
            next.splice(index - 1, 1);
            return next;
          });
        }
        setManualPoints((pts) => {
          const next = [...pts];
          next.splice(index, 1);
          return next;
        });
      } catch (err) {
        setManualError(err instanceof Error ? err.message : "Couldn't remove that point.");
      } finally {
        setIsAddingSegment(false);
      }
    },
    [manualPoints, manualSegments, isAddingSegment],
  );

  const handleLocationSelected = useCallback((p: LatLng) => {
    setFlyToTarget({ position: p, key: Date.now() });
  }, []);

  const handlePlanningModeChange = useCallback((mode: PlanningMode) => {
    setPlanningMode(mode);
    setStartPoint(null);
    setRoute(null);
    setError(null);
    setManualPoints([]);
    setManualSegments([]);
    setManualFinished(false);
    setManualError(null);
  }, []);

  const handleClear = useCallback(() => {
    setStartPoint(null);
    setRoute(null);
    setError(null);
    setManualPoints([]);
    setManualSegments([]);
    setManualFinished(false);
    setManualError(null);
  }, []);

  const manualDistanceMeters = manualSegments.reduce((sum, s) => sum + s.distanceMeters, 0);
  const canClear =
    planningMode === "auto" ? Boolean(startPoint || route) : manualPoints.length > 0;

  return (
    <div className="app">
      <Sidebar
        provider={mapProvider}
        planningMode={planningMode}
        onPlanningModeChange={handlePlanningModeChange}
        distanceValue={distanceValue}
        unit={unit}
        onDistanceValueChange={setDistanceValue}
        onUnitChange={setUnit}
        routeOptions={routeOptions}
        onRouteOptionsChange={setRouteOptions}
        onLocationSelected={handleLocationSelected}
        route={route}
        isGenerating={isGenerating}
        error={error}
        manualPointCount={manualPoints.length}
        manualDistanceMeters={manualDistanceMeters}
        manualFinished={manualFinished}
        isAddingSegment={isAddingSegment}
        manualError={manualError}
        onFinishManualRoute={handleFinishManualRoute}
        canClear={canClear}
        onClear={handleClear}
      />
      <main className="map-pane">
        <MapView
          provider={mapProvider}
          planningMode={planningMode}
          startPoint={startPoint}
          onSetStartPoint={handleSetStartPoint}
          onDragComplete={handleDragComplete}
          route={route}
          interactionsDisabled={isGenerating}
          flyToTarget={flyToTarget}
          manualPoints={manualPoints}
          manualSegments={manualSegments}
          manualFinished={manualFinished}
          isAddingSegment={isAddingSegment}
          onManualPointClick={handleManualPointClick}
          onCloseLoop={handleCloseLoop}
          onInsertPoint={handleInsertManualPoint}
          onMovePoint={handleMoveManualPoint}
          onRemovePoint={handleRemoveManualPoint}
        />
      </main>
    </div>
  );
}

export default App;
