import { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  CircleMarker,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "../lib/leafletIconFix";
import { distanceMeters, midpoint, type LatLng } from "../lib/geo";
import { manualPointAfter, manualPointBefore } from "../lib/manualRoute";
import type { MapProvider, RouteResult } from "../lib/providers/types";
import type { LoopRouteResult } from "../lib/routeGenerator";

export const DEFAULT_CENTER: LatLng = { lat: 40.785091, lng: -73.968285 }; // Central Park, NYC
const DEFAULT_ZOOM = 15;

export interface FlyToTarget {
  position: LatLng;
  key: number;
}

interface MapViewProps {
  provider: MapProvider;
  planningMode: "auto" | "manual";
  startPoint: LatLng | null;
  onSetStartPoint: (p: LatLng) => void;
  /** Called with the point the user released the drag on — opposite end of the diameter from startPoint. */
  onDragComplete: (dragEnd: LatLng) => void;
  route: LoopRouteResult | null;
  interactionsDisabled: boolean;
  flyToTarget: FlyToTarget | null;
  manualPoints: LatLng[];
  manualSegments: RouteResult[];
  manualFinished: boolean;
  isAddingSegment: boolean;
  onManualPointClick: (p: LatLng) => void;
  onCloseLoop: () => void;
  /** Called when the user drags a segment out and releases — segmentIndex identifies which leg to split. */
  onInsertPoint: (segmentIndex: number, point: LatLng) => void;
  /** Called when the user drags an existing point to a new location. */
  onMovePoint: (index: number, point: LatLng) => void;
  /** Called on double-click of a non-start point — the two legs on either side are bridged directly. */
  onRemovePoint: (index: number) => void;
}

function FlyToController({ target }: { target: FlyToTarget | null }) {
  const map = useMap();
  const lastKey = useRef<number | null>(null);

  useEffect(() => {
    if (target && target.key !== lastKey.current) {
      lastKey.current = target.key;
      map.flyTo([target.position.lat, target.position.lng], 15);
    }
  }, [target, map]);

  return null;
}

function RouteLayer({
  startPoint,
  onSetStartPoint,
  onDragComplete,
  route,
  interactionsDisabled,
}: Pick<
  MapViewProps,
  "startPoint" | "onSetStartPoint" | "onDragComplete" | "route" | "interactionsDisabled"
>) {
  const [dragging, setDragging] = useState(false);
  const [dragCurrent, setDragCurrent] = useState<LatLng | null>(null);
  const suppressNextClick = useRef(false);

  const map = useMapEvents({
    click(e) {
      if (dragging || interactionsDisabled) return;
      if (suppressNextClick.current) {
        suppressNextClick.current = false;
        return;
      }
      onSetStartPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
    mousemove(e) {
      if (!dragging) return;
      setDragCurrent({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
    mouseup(e) {
      if (!dragging) return;
      map.dragging.enable();
      setDragging(false);
      setDragCurrent(null);
      suppressNextClick.current = true;
      setTimeout(() => {
        suppressNextClick.current = false;
      }, 0);

      if (startPoint) {
        const end = { lat: e.latlng.lat, lng: e.latlng.lng };
        if (distanceMeters(startPoint, end) > 5) {
          onDragComplete(end);
        }
      }
    },
  });

  const previewCircle =
    dragging && startPoint && dragCurrent
      ? {
          center: midpoint(startPoint, dragCurrent),
          radiusMeters: distanceMeters(startPoint, dragCurrent) / 2,
        }
      : null;

  return (
    <>
      {startPoint && (
        <Marker
          position={[startPoint.lat, startPoint.lng]}
          eventHandlers={{
            mousedown: (e) => {
              if (interactionsDisabled) return;
              L.DomEvent.stopPropagation(e.originalEvent);
              map.dragging.disable();
              setDragging(true);
              setDragCurrent(startPoint);
            },
          }}
        />
      )}

      {previewCircle && (
        <Circle
          center={[previewCircle.center.lat, previewCircle.center.lng]}
          radius={previewCircle.radiusMeters}
          pathOptions={{ color: "#2563eb", weight: 2, dashArray: "6 6", fillOpacity: 0.08 }}
        />
      )}

      {route && (
        <Polyline
          positions={route.path.map((p): [number, number] => [p.lat, p.lng])}
          pathOptions={{ color: "#dc2626", weight: 4, opacity: 0.85 }}
        />
      )}
    </>
  );
}

function ManualDrawLayer({
  points,
  segments,
  finished,
  isAddingSegment,
  onPointClick,
  onCloseLoop,
  onInsertPoint,
  onMovePoint,
  onRemovePoint,
}: {
  points: LatLng[];
  segments: RouteResult[];
  finished: boolean;
  isAddingSegment: boolean;
  onPointClick: (p: LatLng) => void;
  onCloseLoop: () => void;
  onInsertPoint: (segmentIndex: number, point: LatLng) => void;
  onMovePoint: (index: number, point: LatLng) => void;
  onRemovePoint: (index: number) => void;
}) {
  const [draggingSegment, setDraggingSegment] = useState<number | null>(null);
  const [draggingPoint, setDraggingPoint] = useState<number | null>(null);
  const [dragPreview, setDragPreview] = useState<LatLng | null>(null);
  const suppressNextClick = useRef(false);

  const map = useMapEvents({
    click(e) {
      if (finished || isAddingSegment || draggingSegment !== null || draggingPoint !== null) return;
      if (suppressNextClick.current) {
        suppressNextClick.current = false;
        return;
      }
      onPointClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
    mousemove(e) {
      if (draggingSegment === null && draggingPoint === null) return;
      setDragPreview({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
    mouseup(e) {
      if (draggingSegment === null && draggingPoint === null) return;
      map.dragging.enable();
      const release = { lat: e.latlng.lat, lng: e.latlng.lng };
      suppressNextClick.current = true;
      setTimeout(() => {
        suppressNextClick.current = false;
      }, 0);

      if (draggingSegment !== null) {
        const index = draggingSegment;
        setDraggingSegment(null);
        setDragPreview(null);
        onInsertPoint(index, release);
      } else if (draggingPoint !== null) {
        const index = draggingPoint;
        setDraggingPoint(null);
        setDragPreview(null);
        if (distanceMeters(points[index], release) > 3) {
          onMovePoint(index, release);
        }
      }
    },
  });

  const canClose = !finished && points.length >= 2;

  function segmentEnd(i: number): LatLng {
    return i + 1 < points.length ? points[i + 1] : points[0];
  }

  function beginPointDrag(index: number, e: L.LeafletMouseEvent) {
    if (isAddingSegment || draggingSegment !== null) return;
    L.DomEvent.stopPropagation(e.originalEvent);
    map.dragging.disable();
    setDraggingPoint(index);
    setDragPreview(points[index]);
  }

  const dragPointNeighbors =
    draggingPoint !== null
      ? {
          before: manualPointBefore(points, segments.length, draggingPoint),
          after: manualPointAfter(points, segments.length, draggingPoint),
        }
      : null;

  return (
    <>
      {points.length > 0 && (
        <Marker
          position={[points[0].lat, points[0].lng]}
          eventHandlers={{
            mousedown: (e) => beginPointDrag(0, e),
            click: (e) => {
              L.DomEvent.stopPropagation(e.originalEvent);
              if (!canClose || isAddingSegment || draggingPoint !== null) return;
              onCloseLoop();
            },
          }}
        />
      )}

      {segments.map((seg, i) => (
        <Polyline
          key={i}
          positions={seg.path.map((p): [number, number] => [p.lat, p.lng])}
          pathOptions={{
            color: "#16a34a",
            weight: 4,
            opacity: draggingSegment === i ? 0.25 : 0.85,
            dashArray: finished ? undefined : "8 6",
          }}
          eventHandlers={{
            mousedown: (e) => {
              if (isAddingSegment || draggingPoint !== null) return;
              L.DomEvent.stopPropagation(e.originalEvent);
              map.dragging.disable();
              setDraggingSegment(i);
              setDragPreview({ lat: e.latlng.lat, lng: e.latlng.lng });
            },
          }}
        />
      ))}

      {points.slice(1).map((p, i) => {
        const index = i + 1;
        return (
          <CircleMarker
            key={index}
            center={[p.lat, p.lng]}
            radius={5}
            pathOptions={{ color: "#15803d", fillColor: "#16a34a", fillOpacity: 1, weight: 2 }}
            eventHandlers={{
              mousedown: (e) => beginPointDrag(index, e),
              click: (e) => L.DomEvent.stopPropagation(e.originalEvent),
              dblclick: (e) => {
                L.DomEvent.stopPropagation(e.originalEvent);
                if (isAddingSegment) return;
                onRemovePoint(index);
              },
            }}
          />
        );
      })}

      {draggingSegment !== null && dragPreview && (
        <Polyline
          positions={[
            [points[draggingSegment].lat, points[draggingSegment].lng],
            [dragPreview.lat, dragPreview.lng],
            [segmentEnd(draggingSegment).lat, segmentEnd(draggingSegment).lng],
          ]}
          pathOptions={{ color: "#16a34a", weight: 3, dashArray: "4 4" }}
        />
      )}

      {draggingPoint !== null && dragPreview && dragPointNeighbors && (
        <>
          {dragPointNeighbors.before && (
            <Polyline
              positions={[
                [dragPointNeighbors.before.lat, dragPointNeighbors.before.lng],
                [dragPreview.lat, dragPreview.lng],
              ]}
              pathOptions={{ color: "#16a34a", weight: 3, dashArray: "4 4" }}
            />
          )}
          {dragPointNeighbors.after && (
            <Polyline
              positions={[
                [dragPreview.lat, dragPreview.lng],
                [dragPointNeighbors.after.lat, dragPointNeighbors.after.lng],
              ]}
              pathOptions={{ color: "#16a34a", weight: 3, dashArray: "4 4" }}
            />
          )}
        </>
      )}
    </>
  );
}

export function MapView({
  provider,
  planningMode,
  startPoint,
  onSetStartPoint,
  onDragComplete,
  route,
  interactionsDisabled,
  flyToTarget,
  manualPoints,
  manualSegments,
  manualFinished,
  isAddingSegment,
  onManualPointClick,
  onCloseLoop,
  onInsertPoint,
  onMovePoint,
  onRemovePoint,
}: MapViewProps) {
  return (
    <MapContainer
      center={[DEFAULT_CENTER.lat, DEFAULT_CENTER.lng]}
      zoom={DEFAULT_ZOOM}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        key={provider.id}
        url={provider.tileLayer.url}
        attribution={provider.tileLayer.attribution}
        maxZoom={provider.tileLayer.maxZoom}
      />
      <FlyToController target={flyToTarget} />
      {planningMode === "auto" ? (
        <RouteLayer
          startPoint={startPoint}
          onSetStartPoint={onSetStartPoint}
          onDragComplete={onDragComplete}
          route={route}
          interactionsDisabled={interactionsDisabled}
        />
      ) : (
        <ManualDrawLayer
          points={manualPoints}
          segments={manualSegments}
          finished={manualFinished}
          isAddingSegment={isAddingSegment}
          onPointClick={onManualPointClick}
          onCloseLoop={onCloseLoop}
          onInsertPoint={onInsertPoint}
          onMovePoint={onMovePoint}
          onRemovePoint={onRemovePoint}
        />
      )}
    </MapContainer>
  );
}
