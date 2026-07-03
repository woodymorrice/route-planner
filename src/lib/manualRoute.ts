import type { LatLng } from "./geo";

/**
 * Shared indexing helpers for the manually-drawn route model used by
 * App.tsx (editing) and MapView.tsx (live drag previews). A manual route is
 * `points[0..n-1]` with `segments[i]` connecting `points[i]` to
 * `points[i+1]` — except when the route is closed (`segments.length ===
 * points.length`), in which case the last segment wraps from the last point
 * back to `points[0]`. Keeping the wrap-around math in one place avoids
 * subtly disagreeing copies in the two files that need it.
 */
function isClosed(pointsLen: number, segmentsLen: number): boolean {
  return segmentsLen === pointsLen;
}

/** The point immediately before `index`, wrapping to the last point on a closed loop. Null if there is none (open path, index 0). */
export function manualPointBefore(points: LatLng[], segmentsLen: number, index: number): LatLng | null {
  if (index > 0) return points[index - 1];
  return isClosed(points.length, segmentsLen) ? points[points.length - 1] : null;
}

/** The point immediately after `index`, wrapping to the first point on a closed loop. Null if there is none (open path, last index). */
export function manualPointAfter(points: LatLng[], segmentsLen: number, index: number): LatLng | null {
  if (index < points.length - 1) return points[index + 1];
  return isClosed(points.length, segmentsLen) ? points[0] : null;
}

/** Index into `segments` of the leg arriving at `index`, or null if there is none. */
export function manualSegmentIndexBefore(points: LatLng[], segmentsLen: number, index: number): number | null {
  if (index > 0) return index - 1;
  return isClosed(points.length, segmentsLen) ? segmentsLen - 1 : null;
}

/** Index into `segments` of the leg departing `index`, or null if there is none. */
export function manualSegmentIndexAfter(segmentsLen: number, index: number): number | null {
  return index < segmentsLen ? index : null;
}
