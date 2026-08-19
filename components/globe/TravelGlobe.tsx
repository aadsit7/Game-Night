"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeatureCollection, Point as GeoPoint } from "geojson";
import type {
  FilterSpecification,
  GeoJSONSource,
  LngLat,
  Map as MapLibreMap,
  MapMouseEvent,
  Marker,
} from "maplibre-gl";

import { GlobeFallback } from "@/components/globe/GlobeFallback";
import { usePrefersDark, usePrefersReducedMotion } from "@/lib/hooks/useMediaQuery";
import {
  CITY_LAYERS,
  CLUSTER_COLOR,
  COUNTRIES_URL,
  COUNTRY_COLOR,
  COUNTRY_FILL_OPACITY,
  COUNTRY_LINE_OPACITY,
  DEFAULT_CAMERA,
  FONT_BOLD,
  INTERACTIVE_LAYERS,
  LAYER_CLUSTER,
  LAYER_CLUSTER_COUNT,
  LAYER_CLUSTER_GLOW,
  LAYER_COUNTRY_FILL,
  LAYER_COUNTRY_LINE,
  LAYER_PIN,
  LAYER_PIN_DOT,
  LABEL_OPACITY_DEFAULT,
  PIN_COLOR,
  PIN_RADIUS_DEFAULT,
  SOURCE_COUNTRIES,
  SOURCE_ID,
  STYLE_URLS,
  assetUrl,
  labelOpacity,
  labelSortKey,
  loadMapLibre,
  pinColor,
  pinRadius,
  pinStrokeWidth,
  selectedFilter,
  styleFor,
  type MapView,
} from "@/lib/maps/basemap";
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
  /** Countries paints whole visited countries; Cities shows individual pins. */
  mapView: MapView;
  /** Tapping a filled country in Countries mode. */
  onCountryTap?: (code: string) => void;
  cameraRequest: CameraRequest | null;
  /** Space taken by sheets and the tab bar, so flights centre above them. */
  bottomInset: number;
  onStatusChange?: (status: "loading" | "ready" | "failed") => void;
  handleRef?: React.RefObject<TravelGlobeHandle | null>;
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

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
const wiredMaps = new WeakSet<MapLibreMap>();

/**
 * Everything the style owns: the clustered source, the country polygons, and
 * the layers over both. Runs on every `style.load` — including after a
 * light/dark style swap, which discards all of it — so it must be idempotent.
 */
function installStyleLayers(map: MapLibreMap, data: FeatureCollection): void {
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

  // OpenStreetMap tiles carry boundary lines but not country polygons, so the
  // Countries view brings its own geometry — public-domain Natural Earth,
  // simplified to about a kilometre, which is invisible at these zooms.
  try {
    if (!map.getSource(SOURCE_COUNTRIES)) {
      map.addSource(SOURCE_COUNTRIES, { type: "geojson", data: assetUrl(COUNTRIES_URL) });
    }
    if (!map.getLayer(LAYER_COUNTRY_FILL)) {
      map.addLayer({
        id: LAYER_COUNTRY_FILL,
        type: "fill",
        source: SOURCE_COUNTRIES,
        filter: ["in", ["get", "code"], ["literal", []]] as FilterSpecification,
        paint: {
          "fill-color": COUNTRY_COLOR,
          "fill-opacity": COUNTRY_FILL_OPACITY.cities,
          "fill-opacity-transition": { duration: 320 },
        },
      });
    }
    if (!map.getLayer(LAYER_COUNTRY_LINE)) {
      map.addLayer({
        id: LAYER_COUNTRY_LINE,
        type: "line",
        source: SOURCE_COUNTRIES,
        filter: ["in", ["get", "code"], ["literal", []]] as FilterSpecification,
        paint: {
          "line-color": COUNTRY_COLOR,
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 4, 1.4],
          "line-opacity": 0,
          "line-opacity-transition": { duration: 320 },
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
      filter: ["has", "point_count"],
      paint: {
        "circle-color": PIN_COLOR,
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
      filter: ["has", "point_count"],
      paint: {
        "circle-color": CLUSTER_COLOR,
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
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": FONT_BOLD,
        "text-size": ["step", ["get", "point_count"], 13, 15, 14, 40, 15],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": "#FFFFFF" },
    });
  }

  if (!map.getLayer(LAYER_PIN_DOT)) {
    map.addLayer({
      id: LAYER_PIN_DOT,
      type: "circle",
      source: SOURCE_ID,
      filter: ["!", ["has", "point_count"]],
      paint: {
        // Small, round and dense on purpose: a hundred places should still
        // read as a constellation rather than a pile of overlapping markers.
        "circle-radius": PIN_RADIUS_DEFAULT,
        "circle-color": PIN_COLOR,
        "circle-stroke-width": 2,
        "circle-stroke-color": "rgba(255,255,255,0.95)",
        "circle-radius-transition": { duration: 180 },
      },
    });
  }

  if (!map.getLayer(LAYER_PIN)) {
    map.addLayer({
      id: LAYER_PIN,
      type: "symbol",
      source: SOURCE_ID,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": ["get", "name"],
        "text-font": FONT_BOLD,
        "text-size": 12.5,
        "text-anchor": "top",
        "text-offset": [0, 0.7],
        "text-max-width": 9,
        "text-padding": 6,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#14161C",
        "text-halo-color": "rgba(255,255,255,0.92)",
        "text-halo-width": 1.4,
        "text-halo-blur": 0.4,
        "text-opacity": LABEL_OPACITY_DEFAULT,
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

/** Atmosphere around the globe — decoration, and safe to skip if unsupported. */
function applySky(map: MapLibreMap, dark: boolean): void {
  try {
    map.setSky({
      "sky-color": dark ? "#0a1020" : "#8cb6e8",
      "sky-horizon-blend": 0.6,
      "horizon-color": dark ? "#1a2e50" : "#d6e4f6",
      "horizon-fog-blend": 0.6,
      "fog-color": dark ? "#101420" : "#dceafa",
      "fog-ground-blend": 0.02,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 5, 0.5, 8, 0],
    });
  } catch {
    // Older renderers simply don't draw one.
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
  mapView,
  onCountryTap,
  cameraRequest,
  bottomInset,
  onStatusChange,
  handleRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);

  const [styleReady, setStyleReady] = useState(false);
  const [failure, setFailure] = useState<"load-failed" | null>(null);
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
  const mapViewRef = useRef(mapView);
  const onCountryTapRef = useRef(onCountryTap);
  const bottomInsetRef = useRef(bottomInset);
  const reduceMotionRef = useRef(reduceMotion);
  const prefersDarkRef = useRef(prefersDark);
  const placesRef = useRef(places);
  const draggingRef = useRef(false);
  const framedRef = useRef(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onDeselectRef.current = onDeselect;
    onPointPickedRef.current = onPointPicked;
    onPickerChangeRef.current = onPickerChange;
    pickModeRef.current = pickMode;
    mapViewRef.current = mapView;
    onCountryTapRef.current = onCountryTap;
    bottomInsetRef.current = bottomInset;
    reduceMotionRef.current = reduceMotion;
    prefersDarkRef.current = prefersDark;
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
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let loadTimer = 0;
    let detachPress: (() => void) | undefined;

    void (async () => {
      let maplibregl: Awaited<ReturnType<typeof loadMapLibre>>;
      try {
        maplibregl = await loadMapLibre();
      } catch {
        if (!cancelled) setFailure("load-failed");
        return;
      }
      if (cancelled || !containerRef.current) return;

      try {
        map = new maplibregl.Map({
          container: containerRef.current,
          style: styleFor(prefersDarkRef.current),
          center: DEFAULT_CAMERA.center,
          zoom: DEFAULT_CAMERA.zoom,
          minZoom: 0.4,
          maxZoom: 17,
          attributionControl: false,
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
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

      // The backstop, for a style request that neither answers nor fails.
      loadTimer = window.setTimeout(() => {
        if (!cancelled && !map?.isStyleLoaded()) setFailure("load-failed");
      }, 20_000);

      // Individual tiles fail all the time — a slow connection, a gap in
      // coverage — and the map carries on regardless. A style that can't be
      // fetched is different: there is no map at all, and waiting out the
      // backstop just to say so leaves someone staring at nothing.
      map.on("error", (event) => {
        // The renderer swallows these by design; in development they are the
        // only way to find out why a layer or a tile silently didn't draw.
        if (process.env.NODE_ENV !== "production") {
          console.warn("[globe]", event?.error ?? event);
        }
        if (cancelled || !map || map.isStyleLoaded()) return;
        const url = (event?.error as { url?: string } | undefined)?.url;
        if (!url || !STYLE_URLS.includes(url)) return;
        window.clearTimeout(loadTimer);
        setFailure("load-failed");
      });

      map.on("style.load", () => {
        if (cancelled || !map) return;
        window.clearTimeout(loadTimer);

        // The whole point of the thing.
        try {
          map.setProjection({ type: "globe" });
        } catch {
          // An older renderer falls back to a flat map, which still works.
        }
        applySky(map, prefersDarkRef.current);

        installStyleLayers(map, toFeatureCollection(placesRef.current));
        setStyleReady(true);
      });

      /* Long-press to drop a pin. `contextmenu` covers desktop right-click;
         touch needs a timer because Safari won't fire it. */
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

      /* One click handler for the whole map: pick mode, countries, pins,
         clusters, then empty space to dismiss — decided in that order. */
      map.on("click", (event: MapMouseEvent) => {
        if (!map) return;

        if (pickModeRef.current) {
          onPointPickedRef.current({ longitude: event.lngLat.lng, latitude: event.lngLat.lat });
          return;
        }

        // In Countries mode a tap means "show me this country", so pins and
        // clusters are not in play at all.
        if (mapViewRef.current === "countries") {
          if (!map.getLayer(LAYER_COUNTRY_FILL)) return;
          const hit = map.queryRenderedFeatures(event.point, {
            layers: [LAYER_COUNTRY_FILL],
          })[0];
          const code = hit?.properties?.code;
          if (code) {
            onCountryTapRef.current?.(String(code));
          } else {
            onDeselectRef.current();
          }
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

        const pin = features.find((feature) => feature.layer?.id === LAYER_PIN_DOT);
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
            void source
              .getClusterExpansionZoom(clusterId)
              .then((zoom) => {
                if (!map || typeof zoom !== "number") return;
                map.easeTo({
                  center: coordinates,
                  zoom: Math.min(zoom + 0.35, 16),
                  duration: reduceMotionRef.current ? 0 : 900,
                  padding: cameraPadding(),
                });
              })
              .catch(() => {
                // A cluster that can't expand is not worth an error.
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
  /* Theme — a whole style swap, which discards and re-adds our layers        */
  /* ---------------------------------------------------------------------- */

  const themedOnce = useRef(prefersDark);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || themedOnce.current === prefersDark) return;
    themedOnce.current = prefersDark;
    // `style.load` fires again afterwards and reinstalls every layer.
    map.setStyle(styleFor(prefersDark));
  }, [prefersDark, styleReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !map.getLayer(LAYER_PIN)) return;
    try {
      map.setPaintProperty(LAYER_PIN, "text-color", prefersDark ? "#F4F5F8" : "#14161C");
      map.setPaintProperty(
        LAYER_PIN,
        "text-halo-color",
        prefersDark ? "rgba(4,6,12,0.85)" : "rgba(255,255,255,0.92)",
      );
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
            .map((place) => place.countryCode?.toUpperCase())
            .filter((code): code is string => Boolean(code && code.length === 2)),
        ),
      ];
      const filter = ["in", ["get", "code"], ["literal", codes]] as FilterSpecification;
      if (map.getLayer(LAYER_COUNTRY_FILL)) map.setFilter(LAYER_COUNTRY_FILL, filter);
      if (map.getLayer(LAYER_COUNTRY_LINE)) map.setFilter(LAYER_COUNTRY_LINE, filter);
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
      // Let the renderer solve the framing, then rewind and fly into it.
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
    if (!map || !styleReady || !map.getLayer(LAYER_PIN_DOT)) return;

    const selected = selectedFilter(selectedId);

    try {
      map.setPaintProperty(LAYER_PIN_DOT, "circle-color", pinColor(selected));
      map.setPaintProperty(LAYER_PIN_DOT, "circle-radius", pinRadius(selected));
      map.setPaintProperty(LAYER_PIN_DOT, "circle-stroke-width", pinStrokeWidth(selected));

      if (map.getLayer(LAYER_PIN)) {
        // The selected place always shows its name, whatever the zoom.
        map.setPaintProperty(LAYER_PIN, "text-opacity", labelOpacity(selected));
        map.setLayoutProperty(LAYER_PIN, "symbol-sort-key", labelSortKey(selected));
      }
    } catch {
      // Style may be mid-reload.
    }
  }, [selectedId, styleReady]);

  /* ---------------------------------------------------------------------- */
  /* Countries vs Cities                                                      */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    try {
      if (map.getLayer(LAYER_COUNTRY_FILL)) {
        map.setPaintProperty(LAYER_COUNTRY_FILL, "fill-opacity", COUNTRY_FILL_OPACITY[mapView]);
      }
      if (map.getLayer(LAYER_COUNTRY_LINE)) {
        map.setPaintProperty(LAYER_COUNTRY_LINE, "line-opacity", COUNTRY_LINE_OPACITY[mapView]);
      }
      for (const layer of CITY_LAYERS) {
        if (map.getLayer(layer)) {
          map.setLayoutProperty(
            layer,
            "visibility",
            mapView === "cities" ? "visible" : "none",
          );
        }
      }
    } catch {
      // Style may be mid-reload.
    }
  }, [mapView, styleReady]);

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
    void loadMapLibre().then((maplibregl) => {
      if (cancelled || !mapRef.current || markerRef.current) return;

      const element = document.createElement("div");
      element.className = "picker-pin";
      element.setAttribute("aria-hidden", "true");
      element.innerHTML =
        '<span class="picker-pin__pulse"></span><span class="picker-pin__body"></span>';

      const marker = new maplibregl.Marker({ element, anchor: "bottom", draggable: true })
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
        onRetry={() => {
          setFailure(null);
          setStyleReady(false);
          framedRef.current = false;
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className="size-full"
        // The renderer handles its own gestures; telling the browser to keep
        // its hands off keeps a pinch from scrolling the page underneath.
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
