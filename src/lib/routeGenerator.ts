import { destinationPoint, type LatLng } from "./geo";
import type { MapProvider, RouteResult } from "./providers/types";

const MAX_ITERATIONS = 5;
const TOLERANCE_RATIO = 0.08; // stop once within 8% of the target distance

// Angular spread (in degrees) of the three loop waypoints around the
// dragged bearing. Wider = rounder loop that reaches further to the sides;
// narrower = a loop that stays tighter to the dragged direction.
const WAYPOINT_SPREAD_DEGREES = 100;

export interface LoopRouteResult extends RouteResult {
  targetDistanceMeters: number;
  iterations: number;
}

function buildLoopWaypoints(start: LatLng, radiusMeters: number, bearingDeg: number): LatLng[] {
  const angles = [
    bearingDeg - WAYPOINT_SPREAD_DEGREES,
    bearingDeg,
    bearingDeg + WAYPOINT_SPREAD_DEGREES,
  ];
  const outbound = angles.map((angle) => destinationPoint(start, angle, radiusMeters));
  return [start, ...outbound, start];
}

/**
 * Generates a runnable loop route that starts and ends at `start`, biased
 * toward `bearingDeg`, targeting `targetDistanceMeters` total length.
 *
 * Heuristic: place three waypoints on a circle around `start` in the general
 * direction the user dragged, ask the routing engine for the real
 * street-following path through them and back, then scale the circle radius
 * by (target / actual) and repeat until the result is close enough. This is
 * an approximation, not an optimal solver — real streets rarely form a
 * perfect circle, so the result will vary in "roundness" by area.
 */
export async function generateLoopRoute(
  provider: MapProvider,
  start: LatLng,
  targetDistanceMeters: number,
  bearingDeg: number,
): Promise<LoopRouteResult> {
  let radius = targetDistanceMeters / (2 * Math.PI);
  let best: RouteResult | null = null;
  let bestDiff = Infinity;
  let iterations = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    iterations++;
    const waypoints = buildLoopWaypoints(start, radius, bearingDeg);
    const result = await provider.route(waypoints, "foot");

    const diff = Math.abs(result.distanceMeters - targetDistanceMeters);
    if (diff < bestDiff) {
      best = result;
      bestDiff = diff;
    }

    const ratio = targetDistanceMeters / result.distanceMeters;
    if (Math.abs(1 - ratio) <= TOLERANCE_RATIO) break;

    radius *= ratio;
  }

  if (!best) {
    throw new Error("Could not generate a route.");
  }

  return { ...best, targetDistanceMeters, iterations };
}
