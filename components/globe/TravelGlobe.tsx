"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeatureCollection, Point as GeoPoint } from "geojson";
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  LngLat,
  Map as MapboxMap,
  MapMouseEvent,
  Marker,
} from "mapbox-gl";

import { GlobeFallback } from "@/components/globe/GlobeFallback";
import { usePrefersDark, usePrefersReducedMotion } from "@/lib/hooks/useMediaQuery";
import {
  DEFAULT_CAMERA,
  INTERACTIVE_LAYERS,
  LAYER_CLUSTER,
  LAYER_CLUSTER_COUNT,
  LAYER_CLUSTER_GLOW,
  LAYER_COUNTRY_FILL,
  LAYER_PIN,
  MAPBOX_STYLE,
  PIN_IMAGE,
  PIN_IMAGE_SELECTED,
  SOURCE_ID,
  hasMapboxToken,
  loadMapbox,
  registerPinImages,
} from "@/lib/maps/mapbox";
import { boundsForPlaces, hasValidCoordinates, placeSubtitle } from "@/lib/utils/geo";
import type { VisitedPlace } from "@/types/place";

export type GlobePoint = { longitude: number; latitude: number };

/** Bumping `token` re-runs the flight, even to coordinates we're already at. */
export type CameraRequest = {
  token: number;
  longitude: number;
  latitude: number;
  zoom?: number;
  duration?: number;
};

export type TravelGlobeHandle = {
  /** Current camera centre — used to bias location search toward the view. */
  getCenter: () => GlobePoint | null;
};

type Props = {
  places: VisitedPlace[];
  /** True once the repository has finished loading, so framing waits for data. */
  dataReady: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  /** Long-press anywhere, or a tap while `pickMode` is on. */
  onPointPicked: (point: GlobePoint) => void;
  pickMode: boolean;
  /** When set, a draggable pin is shown at this position. */
  pickerPosition: GlobePoint | null;
  onPickerChange: (point: GlobePoint, final: boolean) => void;
  cameraRequest: CameraRequest | null;
  /** Space taken by sheets and the tab bar, so flights centre above them. */
  bottomInset: number;
  onStatusChange?: (status: "loading" | "ready" | "failed") => void;
  handleRef?: React.RefObject<TravelGlobeHandle | null>;
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Label visibility ramp: pins speak for themselves at world scale. */
const LABEL_RAMP: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  3.4,
  0,
  4.4,
  1,
];

function toFeatureCollection(places: VisitedPlace[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: places.filter(hasValidCoordinates).map((place) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [place.longitude, place.latitude] },
      properties: {
        id: place.id,
        name: place.name,
        subtitle: placeSubtitle(place),
      },
    })),
  };
}

/** Guards against re-attaching hover handlers when a style reloads. */
const wiredMaps = new WeakSet<MapboxMap>();

/**
 * Everything the style owns: the pin sprites, the clustered source, the two
 * cluster layers, the pin layer, and the whisper of colour over visited
 * countries. Runs on every `style.load`, so it must be idempotent.
 */
function installStyleLayers(map: MapboxMap, data: FeatureCollection): void {
  registerPinImages(map);

  if (map.getSource(SOURCE_ID)) {
    (map.getSource(SOURCE_ID) as GeoJSONSource).setData(data);
  } else {
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data,
      cluster: true,
      clusterRadius: 46,
      clusterMaxZoom: 9,
    });
  }

  // Visited countries: barely-there colour at globe scale that fades out
  // completely once you are close enough to read individual pins.
  try {
    if (!map.getSource("country-boundaries")) {
      map.addSource("country-boundaries", {
        type: "vector",
        url: "mapbox://mapbox.country-boundaries-v1",
      });
    }
    if (!map.getLayer(LAYER_COUNTRY_FILL)) {
      map.addLayer({
        id: LAYER_COUNTRY_FILL,
        type: "fill",
        source: "country-boundaries",
        "source-layer": "country_boundaries",
        slot: "middle",
        filter: ["in", ["get", "iso_3166_1"], ["literal", []]] as FilterSpecification,
        paint: {
          "fill-color": "#FF6A4D",
          "fill-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            0.16,
            2.5,
            0.13,
            4.5,
            0.06,
            6,
            0,
          ],
        },
      });
    }
  } catch {
    // Country highlighting is a garnish; never let it break the globe.
  }

  if (!map.getLayer(LAYER_CLUSTER_GLOW)) {
    map.addLayer({
      id: LAYER_CLUSTER_GLOW,
      type: "circle",
      source: SOURCE_ID,
      slot: "top",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#FF6A4D",
        "circle-opacity": 0.18,
        "circle-radius": ["step", ["get", "point_count"], 26, 5, 31, 15, 37, 40, 43],
      },
    });
  }

  if (!map.getLayer(LAYER_CLUSTER)) {
    map.addLayer({
      id: LAYER_CLUSTER,
      type: "circle",
      source: SOURCE_ID,
      slot: "top",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#F04A28",
        "circle-radius": ["step", ["get", "point_count"], 17, 5, 21, 15, 26, 40, 31],
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "rgba(255,255,255,0.92)",
      },
    });
  }

  if (!map.getLayer(LAYER_CLUSTER_COUNT)) {
    map.addLayer({
      id: LAYER_CLUSTER_COUNT,
      type: "symbol",
      source: SOURCE_ID,
      slot: "top",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-size": ["step", ["get", "point_count"], 13, 15, 14, 40, 15],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": "#FFFFFF" },
    });
  }

  if (!map.getLayer(LAYER_PIN)) {
    map.addLayer({
      id: LAYER_PIN,
      type: "symbol",
      source: SOURCE_ID,
      slot: "top",
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": PIN_IMAGE,
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-size": 1,
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-size": 12.5,
        "text-anchor": "top",
        "text-offset": [0, 0.5],
        "text-max-width": 9,
        "text-optional": true,
        "text-padding": 6,
      },
      paint: {
        "text-color": "#14161C",
        "text-halo-color": "rgba(255,255,255,0.92)",
        "text-halo-width": 1.4,
        "text-halo-blur": 0.4,
        "text-opacity": LABEL_RAMP,
      },
    });
  }

  // Pointer feedback on desktop. Registered once per map instance.
  if (!wiredMaps.has(map)) {
    wiredMaps.add(map);
    for (const layer of INTERACTIVE_LAYERS) {
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }
  }
}

export function TravelGlobe({
  places,
  dataReady,
  selectedId,
  onSelect,
  onDeselect,
  onPointPicked,
  pickMode,
  pickerPosition,
  onPickerChange,
  cameraRequest,
  bottomInset,
  onStatusChange,
  handleRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerRef = useRef<Marker | null>(null);

  const [styleReady, setStyleReady] = useState(false);
  const [failure, setFailure] = useState<"missing-token" | "load-failed" | null>(
    hasMapboxToken ? null : "missing-token",
  );
  const [attempt, setAttempt] = useState(0);

  const prefersDark = usePrefersDark();
  const reduceMotion = usePrefersReducedMotion();

  // Callbacks and fast-changing values are read through refs so the map is
  // created exactly once and is never torn down by a parent re-render.
  const onSelectRef = useRef(onSelect);
  const onDeselectRef = useRef(onDeselect);
  const onPointPickedRef = useRef(onPointPicked);
  const onPickerChangeRef = useRef(onPickerChange);
  const pickModeRef = useRef(pickMode);
  const bottomInsetRef = useRef(bottomInset);
  const reduceMotionRef = useRef(reduceMotion);
  const placesRef = useRef(places);
  const draggingRef = useRef(false);
  const framedRef = useRef(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onDeselectRef.current = onDeselect;
    onPointPickedRef.current = onPointPicked;
    onPickerChangeRef.current = onPickerChange;
    pickModeRef.current = pickMode;
    bottomInsetRef.current = bottomInset;
    reduceMotionRef.current = reduceMotion;
    placesRef.current = places;
  });

  /**
   * Padding keeps flights centred above whatever sheet is open, but it must
   * always leave room for a camera: in landscape the tab bar and a preview
   * sheet together can exceed the canvas height.
   */
  const cameraPadding = useCallback(() => {
    const height = mapRef.current?.getContainer().clientHeight ?? 800;
    const width = mapRef.current?.getContainer().clientWidth ?? 400;
    return {
      top: Math.min(96, Math.round(height * 0.18)),
      bottom: Math.min(Math.max(bottomInsetRef.current, 40), Math.round(height * 0.42)),
      left: Math.min(32, Math.round(width * 0.08)),
      right: Math.min(32, Math.round(width * 0.08)),
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Create the map — once                                                    */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!hasMapboxToken) return;

    let cancelled = false;
    let map: MapboxMap | null = null;
    let loadTimer = 0;
    let detachPress: (() => void) | undefined;

    void (async () => {
      let mapboxgl: Awaited<ReturnType<typeof loadMapbox>>;
      try {
        mapboxgl = await loadMapbox();
      } catch {
        if (!cancelled) setFailure("load-failed");
        return;
      }
      if (cancelled || !containerRef.current) return;

      try {
        map = new mapboxgl.Map({
          container: containerRef.current,
          style: MAPBOX_STYLE,
          projection: "globe",
          center: DEFAULT_CAMERA.center,
          zoom: DEFAULT_CAMERA.zoom,
          minZoom: 0.4,
          maxZoom: 17,
          attributionControl: false,
          logoPosition: "bottom-left",
          // A travel globe should spin and zoom, not tilt and rotate: free
          // bearing on a sphere is disorienting and easy to trigger by accident.
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          fadeDuration: 180,
        });
      } catch {
        if (!cancelled) setFailure("load-failed");
        return;
      }

      mapRef.current = map;
      map.touchZoomRotate.disableRotation();
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

      // A bad or missing token surfaces as an auth error on the first request.
      map.on("error", (event) => {
        const message = String((event as { error?: { message?: string } })?.error?.message ?? "");
        if (/401|403|Unauthorized|access token|Not Authorized/i.test(message)) {
          if (!cancelled) setFailure("missing-token");
        }
      });

      loadTimer = window.setTimeout(() => {
        if (!cancelled && !map?.isStyleLoaded()) setFailure("load-failed");
      }, 20_000);

      map.on("style.load", () => {
        if (cancelled || !map) return;
        window.clearTimeout(loadTimer);
        installStyleLayers(map, toFeatureCollection(placesRef.current));
        setStyleReady(true);
      });

      /* Long-press to drop a pin. Mapbox's `contextmenu` covers desktop
         right-click; touch needs a timer because Safari won't fire it. */
      const canvasContainer = map.getCanvasContainer();
      let pressTimer = 0;
      let origin: { x: number; y: number } | null = null;
      let lastFired = 0;

      const fire = (lngLat: LngLat) => {
        const now = Date.now();
        if (now - lastFired < 700) return;
        lastFired = now;
        onPointPickedRef.current({ longitude: lngLat.lng, latitude: lngLat.lat });
      };

      const clearPress = () => {
        window.clearTimeout(pressTimer);
        pressTimer = 0;
        origin = null;
      };

      const onTouchStart = (event: TouchEvent) => {
        if (event.touches.length !== 1 || !map) {
          clearPress();
          return;
        }
        const touch = event.touches[0];
        origin = { x: touch.clientX, y: touch.clientY };
        pressTimer = window.setTimeout(() => {
          if (!origin || !map) return;
          const rect = canvasContainer.getBoundingClientRect();
          fire(map.unproject([origin.x - rect.left, origin.y - rect.top]));
          clearPress();
        }, 520);
      };

      const onTouchMove = (event: TouchEvent) => {
        if (!origin) return;
        const touch = event.touches[0];
        if (!touch) {
          clearPress();
          return;
        }
        if (Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) > 12) clearPress();
      };

      canvasContainer.addEventListener("touchstart", onTouchStart, { passive: true });
      canvasContainer.addEventListener("touchmove", onTouchMove, { passive: true });
      canvasContainer.addEventListener("touchend", clearPress, { passive: true });
      canvasContainer.addEventListener("touchcancel", clearPress, { passive: true });
      detachPress = () => {
        clearPress();
        canvasContainer.removeEventListener("touchstart", onTouchStart);
        canvasContainer.removeEventListener("touchmove", onTouchMove);
        canvasContainer.removeEventListener("touchend", clearPress);
        canvasContainer.removeEventListener("touchcancel", clearPress);
      };

      map.on("contextmenu", (event: MapMouseEvent) => {
        event.preventDefault();
        fire(event.lngLat);
      });

      /* One click handler for the whole map: pick mode, pins, clusters, then
         empty space to dismiss — decided in that order. */
      map.on("click", (event: MapMouseEvent) => {
        if (!map) return;

        if (pickModeRef.current) {
          onPointPickedRef.current({ longitude: event.lngLat.lng, latitude: event.lngLat.lat });
          return;
        }

        // Query a small box rather than one pixel: fingers aren't precise.
        const pad = 14;
        const box: [[number, number], [number, number]] = [
          [event.point.x - pad, event.point.y - pad],
          [event.point.x + pad, event.point.y + pad],
        ];
        const layers = INTERACTIVE_LAYERS.filter((id) => map?.getLayer(id));
        const features = layers.length > 0 ? map.queryRenderedFeatures(box, { layers }) : [];

        const pin = features.find((feature) => feature.layer?.id === LAYER_PIN);
        if (pin?.properties?.id) {
          onSelectRef.current(String(pin.properties.id));
          return;
        }

        const cluster = features.find((feature) => feature.properties?.cluster);
        if (cluster) {
          const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
          const clusterId = Number(cluster.properties?.cluster_id);
          const coordinates = (cluster.geometry as GeoPoint).coordinates as [number, number];
          if (source && Number.isFinite(clusterId)) {
            source.getClusterExpansionZoom(clusterId, (error, zoom) => {
              if (error || !map || typeof zoom !== "number") return;
              map.easeTo({
                center: coordinates,
                zoom: Math.min(zoom + 0.35, 16),
                duration: reduceMotionRef.current ? 0 : 900,
                padding: cameraPadding(),
              });
            });
          }
          return;
        }

        onDeselectRef.current();
      });
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(loadTimer);
      detachPress?.();
      markerRef.current?.remove();
      markerRef.current = null;
      setStyleReady(false);
      mapRef.current = null;
      map?.remove();
    };
    // `attempt` exists so the error state can offer a genuine retry.
  }, [attempt, cameraPadding]);

  /* ---------------------------------------------------------------------- */
  /* Theme                                                                    */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    try {
      map.setConfigProperty("basemap", "lightPreset", prefersDark ? "night" : "day");
      map.setConfigProperty("basemap", "showPointOfInterestLabels", false);
      map.setConfigProperty("basemap", "showTransitLabels", false);
      map.setConfigProperty("basemap", "showRoadLabels", false);
      map.setConfigProperty("basemap", "showPlaceLabels", true);
    } catch {
      // Older or custom styles may not expose these knobs.
    }

    try {
      map.setFog({
        color: prefersDark ? "rgb(16,20,32)" : "rgb(214,228,246)",
        "high-color": prefersDark ? "rgb(26,46,80)" : "rgb(136,178,232)",
        "horizon-blend": 0.045,
        "space-color": prefersDark ? "rgb(3,5,11)" : "rgb(9,13,24)",
        "star-intensity": prefersDark ? 0.35 : 0.08,
      });
    } catch {
      // Fog is decoration.
    }

    try {
      if (map.getLayer(LAYER_PIN)) {
        map.setPaintProperty(LAYER_PIN, "text-color", prefersDark ? "#F4F5F8" : "#14161C");
        map.setPaintProperty(
          LAYER_PIN,
          "text-halo-color",
          prefersDark ? "rgba(4,6,12,0.85)" : "rgba(255,255,255,0.92)",
        );
      }
    } catch {
      // Style may be mid-reload.
    }
  }, [prefersDark, styleReady]);

  /* ---------------------------------------------------------------------- */
  /* Data                                                                     */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(toFeatureCollection(places));

    try {
      const codes = [
        ...new Set(
          places
            .map((place) => place.countryCode)
            .filter((code): code is string => Boolean(code && code.length === 2)),
        ),
      ];
      if (map.getLayer(LAYER_COUNTRY_FILL)) {
        map.setFilter(LAYER_COUNTRY_FILL, [
          "in",
          ["get", "iso_3166_1"],
          ["literal", codes],
        ] as FilterSpecification);
      }
    } catch {
      // Highlighting is optional.
    }
  }, [places, styleReady]);

  /* Frame the traveller's world once the data has arrived, with a gentle
     arrival rather than a jump-cut. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !dataReady || framedRef.current) return;
    framedRef.current = true;

    const bounds = boundsForPlaces(places);
    if (!bounds) {
      map.jumpTo({ center: DEFAULT_CAMERA.center, zoom: DEFAULT_CAMERA.zoom });
      return;
    }

    try {
      // Let Mapbox solve the framing, then rewind and fly into it.
      map.fitBounds(bounds, { padding: cameraPadding(), maxZoom: 3.4, duration: 0 });
      const center = map.getCenter();
      const zoom = map.getZoom();

      if (reduceMotion) return;

      map.jumpTo({ center, zoom: Math.max(0.45, zoom - 1.15) });
      map.easeTo({ center, zoom, duration: 2000, easing: easeOutCubic });
    } catch {
      map.jumpTo({ center: DEFAULT_CAMERA.center, zoom: DEFAULT_CAMERA.zoom });
    }
  }, [places, dataReady, styleReady, reduceMotion, cameraPadding]);

  /* ---------------------------------------------------------------------- */
  /* Selection                                                                */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !map.getLayer(LAYER_PIN)) return;

    const isSelected: ExpressionSpecification = [
      "==",
      ["get", "id"],
      selectedId ?? "__none__",
    ];

    try {
      map.setLayoutProperty(LAYER_PIN, "icon-image", [
        "case",
        isSelected,
        PIN_IMAGE_SELECTED,
        PIN_IMAGE,
      ] as ExpressionSpecification);
      map.setLayoutProperty(LAYER_PIN, "symbol-sort-key", [
        "case",
        isSelected,
        1,
        0,
      ] as ExpressionSpecification);
      // The selected place always shows its name, whatever the zoom.
      map.setPaintProperty(LAYER_PIN, "text-opacity", [
        "case",
        isSelected,
        1,
        LABEL_RAMP,
      ] as ExpressionSpecification);
    } catch {
      // Style may be mid-reload.
    }
  }, [selectedId, styleReady]);

  /* ---------------------------------------------------------------------- */
  /* Camera requests                                                          */
  /* ---------------------------------------------------------------------- */

  const cameraToken = cameraRequest?.token ?? null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !cameraRequest || cameraToken === null) return;

    map.flyTo({
      center: [cameraRequest.longitude, cameraRequest.latitude],
      zoom: cameraRequest.zoom ?? 6.5,
      duration: reduceMotion ? 0 : (cameraRequest.duration ?? 1800),
      curve: 1.5,
      speed: 1.1,
      padding: cameraPadding(),
      essential: true,
    });
    // Only a new token should retrigger a flight — not an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraToken, styleReady]);

  /* ---------------------------------------------------------------------- */
  /* Draggable picker pin                                                     */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    if (!pickerPosition) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    if (markerRef.current) {
      // Writing the position back mid-drag would fight the user's finger.
      if (!draggingRef.current) {
        markerRef.current.setLngLat([pickerPosition.longitude, pickerPosition.latitude]);
      }
      return;
    }

    let cancelled = false;
    void loadMapbox().then((mapboxgl) => {
      if (cancelled || !mapRef.current || markerRef.current) return;

      const element = document.createElement("div");
      element.className = "picker-pin";
      element.setAttribute("aria-hidden", "true");
      element.innerHTML =
        '<span class="picker-pin__pulse"></span><span class="picker-pin__body"></span>';

      const marker = new mapboxgl.Marker({
        element,
        anchor: "bottom",
        draggable: true,
      })
        .setLngLat([pickerPosition.longitude, pickerPosition.latitude])
        .addTo(mapRef.current);

      marker.on("dragstart", () => {
        draggingRef.current = true;
      });
      marker.on("drag", () => {
        const { lng, lat } = marker.getLngLat();
        onPickerChangeRef.current({ longitude: lng, latitude: lat }, false);
      });
      marker.on("dragend", () => {
        draggingRef.current = false;
        const { lng, lat } = marker.getLngLat();
        onPickerChangeRef.current({ longitude: lng, latitude: lat }, true);
      });

      markerRef.current = marker;
    });

    return () => {
      cancelled = true;
    };
  }, [pickerPosition, styleReady]);

  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    onStatusChange?.(failure ? "failed" : styleReady ? "ready" : "loading");
  }, [styleReady, failure, onStatusChange]);

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      getCenter: () => {
        const map = mapRef.current;
        if (!map) return null;
        const center = map.getCenter();
        return { longitude: center.lng, latitude: center.lat };
      },
    };
  }, [handleRef]);

  if (failure) {
    return (
      <GlobeFallback
        reason={failure}
        onRetry={
          failure === "load-failed"
            ? () => {
                setFailure(null);
                setStyleReady(false);
                framedRef.current = false;
                setAttempt((value) => value + 1);
              }
            : undefined
        }
      />
    );
  }

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className="size-full"
        // Mapbox handles its own gestures; telling the browser to keep its
        // hands off keeps a pinch from scrolling the page underneath.
        style={{ touchAction: "none" }}
      />

      {/* A calm stand-in while the first tiles arrive. */}
      <div
        aria-hidden={styleReady}
        className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${
          styleReady ? "opacity-0" : "opacity-100"
        }`}
        style={{
          background:
            "radial-gradient(circle at 50% 42%, #22355c 0%, #131f38 42%, #0a0f1c 72%, #06080f 100%)",
        }}
      />
      <span className="sr-only" role="status">
        {styleReady ? "Globe ready" : "Loading the globe"}
      </span>
    </div>
  );
}
