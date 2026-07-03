import { bearingDegrees, destinationPoint, distanceMeters, type LatLng } from "./geo";
import type { MapProvider, RouteResult, RouteStep } from "./providers/types";

const MAX_RADIUS_ITERATIONS = 5;
const TOLERANCE_RATIO = 0.05; // stop refining once within 5% over target
const ROUND_VERTEX_COUNT = 8; // "maximize roundness" on: approximate a circle
const SIMPLE_VERTEX_COUNT = 3; // "maximize roundness" off: original sharper loop
const BACKTRACK_RETRY_ATTEMPTS = 2;
const BACKTRACK_THRESHOLD = 0.15;
// Below this, waypoints packed into the region are close enough together that
// OSRM's nearest-edge snapping can put them on effectively arbitrary (even
// disconnected-looking) nearby paths, producing nonsensical routes instead of
// a small loop. Fail fast instead of querying the router with a degenerate region.
const MIN_REGION_RADIUS_METERS = 50;
// ~11m grid at the equator — coarse enough that GPS/OSRM jitter on the same
// street still collapses to one edge, fine enough not to conflate parallel streets.
const BACKTRACK_GRID_PRECISION = 4;

// Named highways/freeways OSRM step names sometimes carry. Best-effort only:
// unnamed footways/residential streets (the majority of steps) don't match,
// and this is English/US-leaning — see CLAUDE.md.
const HIGHWAY_NAME_PATTERN = /\b(Interstate|Freeway|Motorway|Expressway|Turnpike|I-\d+|US-\d+|Hwy)\b/i;

export interface RouteGenerationOptions {
  /** Penalize/retry routes that double back over the same street. */
  avoidBacktracking: boolean;
  /** Spread waypoints around a full circle instead of a narrow arc, to fill the drawn area as evenly as possible. */
  maximizeRoundness: boolean;
  /** Best-effort: ask the routing engine to exclude motorways/trunk roads, and penalize named highways in scoring. */
  avoidHighways: boolean;
}

export const DEFAULT_ROUTE_OPTIONS: RouteGenerationOptions = {
  avoidBacktracking: true,
  maximizeRoundness: true,
  avoidHighways: true,
};

export interface LoopRouteResult extends RouteResult {
  targetDistanceMeters: number;
  iterations: number;
  backtrackRatio: number;
  highwayFraction: number;
}

export class AreaTooSmallError extends Error {
  targetDistanceMeters: number;
  achievedMaxDistanceMeters: number | null;

  /** Pass `achievedMaxDistanceMeters: null` when the dragged region itself is too small to even query. */
  constructor(targetDistanceMeters: number, achievedMaxDistanceMeters: number | null) {
    const message =
      achievedMaxDistanceMeters === null
        ? `The area you dragged is too small to plan a route in — try dragging a bigger circle.`
        : `This area is too small for a ${(targetDistanceMeters / 1000).toFixed(2)} km loop — the ` +
          `largest loop that fits is about ${(achievedMaxDistanceMeters / 1000).toFixed(2)} km. ` +
          `Try dragging a bigger circle, or lower your target distance.`;
    super(message);
    this.name = "AreaTooSmallError";
    this.targetDistanceMeters = targetDistanceMeters;
    this.achievedMaxDistanceMeters = achievedMaxDistanceMeters ?? 0;
  }
}

/**
 * Waypoints for a regular polygon inscribed in the circle the user dragged
 * (center = midpoint of start/dragEnd, radius = half that distance), with
 * `start` fixed as one vertex. A regular polygon is the closest a fixed set
 * of street-network waypoints can get to "maximize area for a given
 * diameter" (the isodiametric ideal is a circle); more vertices → rounder.
 */
function buildRegionWaypoints(
  start: LatLng,
  bearingDeg: number,
  radius: number,
  vertexCount: number,
  rotationOffsetDeg = 0,
): LatLng[] {
  const center = destinationPoint(start, bearingDeg, radius);
  const startAngle = bearingDeg + 180; // bearing from center back to start
  const step = 360 / vertexCount;

  const waypoints: LatLng[] = [start];
  for (let i = 1; i < vertexCount; i++) {
    const angle = startAngle + rotationOffsetDeg + i * step;
    waypoints.push(destinationPoint(center, angle, radius));
  }
  waypoints.push(start);
  return waypoints;
}

function quantize(p: LatLng): string {
  return `${p.lat.toFixed(BACKTRACK_GRID_PRECISION)},${p.lng.toFixed(BACKTRACK_GRID_PRECISION)}`;
}

/** Fraction of the route's length spent on a street segment it also traverses elsewhere (either direction). */
export function computeBacktrackRatio(path: LatLng[]): number {
  const traversals = new Map<string, number>();
  let totalLength = 0;
  let repeatedLength = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const a = quantize(path[i]);
    const b = quantize(path[i + 1]);
    if (a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const segLength = distanceMeters(path[i], path[i + 1]);
    totalLength += segLength;

    const count = (traversals.get(key) ?? 0) + 1;
    traversals.set(key, count);
    if (count > 1) repeatedLength += segLength;
  }

  return totalLength > 0 ? repeatedLength / totalLength : 0;
}

/** Fraction of the route's length on steps whose name looks like a highway/freeway. */
export function estimateHighwayFraction(steps: RouteStep[], totalDistanceMeters: number): number {
  if (totalDistanceMeters <= 0) return 0;
  const flagged = steps
    .filter((s) => HIGHWAY_NAME_PATTERN.test(s.name))
    .reduce((sum, s) => sum + s.distanceMeters, 0);
  return flagged / totalDistanceMeters;
}

interface Candidate {
  result: RouteResult;
  radius: number;
}

/**
 * Generates a runnable loop route that starts and ends at `start`, confined
 * to the circle the user dragged (start on the boundary, `dragEnd` the
 * opposite end of the diameter), targeting `targetDistanceMeters`.
 *
 * Approach: place waypoints on a regular polygon inscribed in a circle of
 * some trial radius (capped at the dragged radius), ask the routing engine
 * for the real street-following path through them and back, and adjust the
 * radius until the result is at or just over the target distance. Throws
 * `AreaTooSmallError` if even the full dragged area can't reach the target.
 * This is a heuristic, not an optimal solver — see CLAUDE.md.
 */
export async function generateLoopRoute(
  provider: MapProvider,
  start: LatLng,
  dragEnd: LatLng,
  targetDistanceMeters: number,
  options: RouteGenerationOptions = DEFAULT_ROUTE_OPTIONS,
): Promise<LoopRouteResult> {
  const maxRadius = distanceMeters(start, dragEnd) / 2;
  if (maxRadius < MIN_REGION_RADIUS_METERS) {
    throw new AreaTooSmallError(targetDistanceMeters, null);
  }

  const bearingDeg = bearingDegrees(start, dragEnd);
  const vertexCount = options.maximizeRoundness ? ROUND_VERTEX_COUNT : SIMPLE_VERTEX_COUNT;
  const routeOptions = { avoidHighways: options.avoidHighways };

  let radius = Math.min(maxRadius, targetDistanceMeters / (2 * Math.PI));
  let bestOverall: Candidate | null = null;
  let bestOverTarget: Candidate | null = null;
  let iterations = 0;

  for (let i = 0; i < MAX_RADIUS_ITERATIONS; i++) {
    iterations++;
    const waypoints = buildRegionWaypoints(start, bearingDeg, radius, vertexCount);
    const result = await provider.route(waypoints, "foot", routeOptions);

    if (!bestOverall || result.distanceMeters > bestOverall.result.distanceMeters) {
      bestOverall = { result, radius };
    }
    if (
      result.distanceMeters >= targetDistanceMeters &&
      (!bestOverTarget || result.distanceMeters < bestOverTarget.result.distanceMeters)
    ) {
      bestOverTarget = { result, radius };
    }

    const closeEnough =
      bestOverTarget &&
      (bestOverTarget.result.distanceMeters - targetDistanceMeters) / targetDistanceMeters <=
        TOLERANCE_RATIO;
    const cappedAndShort = radius >= maxRadius - 1 && result.distanceMeters < targetDistanceMeters;

    if (closeEnough || cappedAndShort) break;

    const ratio = targetDistanceMeters / result.distanceMeters;
    radius = Math.min(maxRadius, Math.max(radius * ratio, 5));
  }

  if (!bestOverTarget) {
    throw new AreaTooSmallError(targetDistanceMeters, bestOverall?.result.distanceMeters ?? 0);
  }

  let chosen = bestOverTarget;
  let backtrackRatio = computeBacktrackRatio(chosen.result.path);

  if (options.avoidBacktracking) {
    for (let attempt = 1; attempt <= BACKTRACK_RETRY_ATTEMPTS && backtrackRatio > BACKTRACK_THRESHOLD; attempt++) {
      iterations++;
      const rotation = (attempt * 360) / vertexCount / (BACKTRACK_RETRY_ATTEMPTS + 1);
      const waypoints = buildRegionWaypoints(start, bearingDeg, chosen.radius, vertexCount, rotation);
      const retry = await provider.route(waypoints, "foot", routeOptions);
      if (retry.distanceMeters < targetDistanceMeters) continue;

      const retryBacktrack = computeBacktrackRatio(retry.path);
      if (retryBacktrack < backtrackRatio) {
        chosen = { result: retry, radius: chosen.radius };
        backtrackRatio = retryBacktrack;
      }
    }
  }

  const highwayFraction = options.avoidHighways
    ? estimateHighwayFraction(chosen.result.steps, chosen.result.distanceMeters)
    : 0;

  return {
    ...chosen.result,
    targetDistanceMeters,
    iterations,
    backtrackRatio,
    highwayFraction,
  };
}
