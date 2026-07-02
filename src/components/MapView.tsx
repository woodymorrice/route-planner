import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Circle, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "../lib/leafletIconFix";
import { bearingDegrees, distanceMeters, midpoint, type LatLng } from "../lib/geo";
import type { MapProvider } from "../lib/providers/types";
import type { LoopRouteResult } from "../lib/routeGenerator";

export const DEFAULT_CENTER: LatLng = { lat: 40.785091, lng: -73.968285 }; // Central Park, NYC
const DEFAULT_ZOOM = 15;

export interface FlyToTarget {
  position: LatLng;
  key: number;
}

interface MapViewProps {
  provider: MapProvider;
  startPoint: LatLng | null;
  onSetStartPoint: (p: LatLng) => void;
  onDragComplete: (bearingDeg: number) => void;
  route: LoopRouteResult | null;
  interactionsDisabled: boolean;
  flyToTarget: FlyToTarget | null;
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
          onDragComplete(bearingDegrees(startPoint, end));
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

export function MapView({
  provider,
  startPoint,
  onSetStartPoint,
  onDragComplete,
  route,
  interactionsDisabled,
  flyToTarget,
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
      <RouteLayer
        startPoint={startPoint}
        onSetStartPoint={onSetStartPoint}
        onDragComplete={onDragComplete}
        route={route}
        interactionsDisabled={interactionsDisabled}
      />
    </MapContainer>
  );
}
