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
  COUNTRY_CHIP_OPACITY,
  COUNTRY_CHIP_SORT,
  COUNTRY_INTERACTIVE_LAYERS,
  COUNTRY_LAYERS,
  COUNT_BADGE_TEXT_SIZE,
  COUNTRIES_SOURCE_MAXZOOM,
  COUNTRIES_URL,
  COUNTRY_BEFORE_IDS,
  COUNTRY_FILL_OPACITY,
  COUNTRY_LINE_OPACITY,
  COUNTRY_LINE_WIDTH,
  COUNTRY_MARKS_SOURCE_MAXZOOM,
  DEFAULT_CAMERA,
  FONT_BOLD,
  HALO_RADIUS,
  INTERACTIVE_LAYERS,
  LABEL_OPACITY_DEFAULT,
  LAYER_CLUSTER,
  LAYER_CLUSTER_COUNT,
  LAYER_COUNTRY_CHIP,
  LAYER_COUNTRY_COUNT,
  LAYER_COUNTRY_FILL,
  LAYER_COUNTRY_LINE,
  LAYER_PIN,
  LAYER_PIN_HALO,
  LAYER_PIN_MARKER,
  MARKER_ICON_IMAGE,
  MARKER_ICON_SIZE_DEFAULT,
  PLACES_SOURCE_MAXZOOM,
  SOURCE_COUNTRIES,
  SOURCE_COUNTRY_MARKS,
  SOURCE_ID,
  STYLE_URLS,
  assetUrl,
  clusterIconSize,
  countryChipSize,
  countBadgeOffset,
  countBadgeTextOffset,
  labelOpacity,
  labelSortKey,
  loadMapLibre,
  markerIconSize,
  markerSortKey,
  overlayFor,
  selectedFilter,
  styleFor,
  type MapView,
  type OverlayPalette,
} from "@/lib/maps/basemap";
import { countryMarks, type CountryMark } from "@/lib/maps/countryMarks";
import {
  COUNT_BADGE_IMAGE,
  MARKER_PIXEL_RATIO,
  MARKER_RADIUS,
  drawCountBadge,
  drawMarker,
  markerImageId,
} from "@/lib/maps/flagMarkers";
import { applyBasemapTheme, paletteFor } from "@/lib/maps/theme";
import { flagVariant, type FlagVariant } from "@/lib/ui/flags";
import {
  angularDistance,
  hasValidCoordinates,
  horizonRing,
  largestZoomThatFits,
  placeSubtitle,
  sphericalCentre,
} from "@/lib/utils/geo";
import type { VisitedPlace } from "@/types/place";

export type GlobePoint = { longitude: number; latitude: number };

/** Bumping `token` re-runs the flight, even to coordinates we're already at. */
export type CameraRequest = {
  token: number;
  longitude: number;
  latitude: number;
  zoom?: number;
  duration?: number;
  /**
   * Frame all of these rather than flying to a fixed zoom. Used when the
   * request means "show me what is inside this", where the right distance
   * depends on how far apart the contents are — a country the size of Canada
   * and a weekend in Lisbon are the same request and not the same camera.
   */
  fit?: GlobePoint[];
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
  /**
   * Where the device says it is, when it has been asked. Drawn as its own
   * mark so a pin being placed can be judged against it.
   */
  currentLocation: GlobePoint | null;
  cameraRequest: CameraRequest | null;
  /** Space taken by sheets and the tab bar, so flights centre above them. */
  bottomInset: number;
  onStatusChange?: (status: "loading" | "ready" | "failed") => void;
  handleRef?: React.RefObject<TravelGlobeHandle | null>;
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** How far from the equator a whole-planet view is allowed to look. */
const WORLD_VIEW_LATITUDE = 52;

/** Just inside the silhouette, where the sphere is still drawing itself. */
const HORIZON_DEGREES = 87;

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
        // The sprite this place asks for. Resolved here, next to the code that
        // registers the sprites, so the name can only ever be written once.
        icon: markerImageId(place.countryCode, flagVariant(place)),
      },
    })),
  };
}

/**
 * The countries view's own features: one per country, wearing that country's
 * chip and carrying how many places are in it.
 */
function toCountryCollection(marks: CountryMark[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: marks.map((mark) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [mark.longitude, mark.latitude] },
      properties: {
        code: mark.code,
        name: mark.name,
        count: mark.count,
        // Only worth saying when there is more than one; a badge reading "1"
        // on every country is a row of badges saying nothing.
        label: mark.count > 1 ? String(mark.count) : "",
        icon: markerImageId(mark.code, "visited"),
      },
    })),
  };
}

/** Guards against re-attaching hover handlers when a style reloads. */
const wiredMaps = new WeakSet<MapLibreMap>();

/**
 * Puts a chip in the sprite atlas for every country on the map.
 *
 * One image per country-and-variant rather than per place, so a fortnight in
 * Japan costs the renderer one texture and not fourteen. Must run *before* the
 * layers go on, and again after every style swap — `setStyle` discards the
 * atlas along with everything else, and a symbol layer pointing at an image
 * that isn't there draws nothing at all.
 */
function registerMarkerImages(
  map: MapLibreMap,
  places: VisitedPlace[],
  overlay: OverlayPalette,
): void {
  const drawn = new Set<string>();

  const add = (countryCode: string | undefined, variant: FlagVariant) => {
    const id = markerImageId(countryCode, variant);
    if (drawn.has(id)) return;
    drawn.add(id);
    try {
      if (map.hasImage(id)) return;
      const image = drawMarker(countryCode, variant, overlay);
      if (!image) return;
      map.addImage(id, image, { pixelRatio: MARKER_PIXEL_RATIO });
    } catch {
      // A style reloading underneath us can add the same id first. Either
      // copy is the same picture.
    }
  };

  try {
    if (!map.hasImage(COUNT_BADGE_IMAGE)) {
      const badge = drawCountBadge(overlay);
      if (badge) map.addImage(COUNT_BADGE_IMAGE, badge, { pixelRatio: MARKER_PIXEL_RATIO });
    }
  } catch {
    // Same reasoning as the chips below.
  }

  // Somewhere the geocoder could not name a country for still gets a mark.
  add(undefined, "visited");
  for (const place of places) add(place.countryCode, flagVariant(place));
}

/**
 * Everything the style owns: the clustered source, the country polygons, and
 * the layers over both. Runs on every `style.load` — including after a
 * light/dark style swap, which discards all of it — so it must be idempotent.
 */
function installStyleLayers(
  map: MapLibreMap,
  data: FeatureCollection,
  countryData: FeatureCollection,
  overlay: OverlayPalette,
): void {
  if (map.getSource(SOURCE_ID)) {
    (map.getSource(SOURCE_ID) as GeoJSONSource).setData(data);
  } else {
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data,
      /*
       * Stop re-tiling the pins long before the map stops zooming.
       *
       * A GeoJSON source builds a fresh set of tiles at every zoom level up to
       * this, and the default is the renderer's maximum — so zooming from the
       * globe down to a street rebuilt these points thirteen times over, every
       * rebuild a worker parse and a buffer upload landing mid-gesture. Past
       * the cap the renderer reuses the tiles it already has, and a point does
       * not lose anything by being reused: at this zoom a tile unit is under a
       * metre, which is finer than the coordinates themselves.
       */
      maxzoom: PLACES_SOURCE_MAXZOOM,
      cluster: true,
      /* Tuned to the chip, not to the dot it replaced. A 46px radius was the
         right distance to keep 9px dots from touching; against a 21–32px chip
         it swallows most of a continent at globe zoom, and the point of a flag
         is that you can see it from up there. */
      clusterRadius: 36,
      clusterMaxZoom: 9,
      /* Carry one of the members' chips up to the cluster. `coalesce` keeps
         whichever arrived first rather than the last, so the flag a cluster
         wears does not flicker between its members as the map moves. */
      clusterProperties: {
        icon: [["coalesce", ["accumulated"], ["get", "icon"]], ["get", "icon"]],
      },
    });
  }

  // OpenStreetMap tiles carry boundary lines but not country polygons, so the
  // Countries view brings its own geometry — public-domain Natural Earth at
  // 1:110m, which is a shape meant to be read at globe zoom and carries a
  // vertex every few tens of kilometres.
  try {
    if (!map.getSource(SOURCE_COUNTRIES)) {
      map.addSource(SOURCE_COUNTRIES, {
        type: "geojson",
        data: assetUrl(COUNTRIES_URL),
        /*
         * The same cap, and here it costs nothing measurable at all: these
         * polygons carry a vertex every few tens of kilometres, and a tile at
         * this zoom resolves to a few hundred metres. Every level above it was
         * the worker re-cutting 174 polygons into detail the file has never
         * contained.
         */
        maxzoom: COUNTRIES_SOURCE_MAXZOOM,
      });
    }
    // Under the borders and labels, over the land, water, roads and buildings.
    const before = COUNTRY_BEFORE_IDS.find((id) => map.getLayer(id));

    if (!map.getLayer(LAYER_COUNTRY_FILL)) {
      map.addLayer(
        {
          id: LAYER_COUNTRY_FILL,
          type: "fill",
          source: SOURCE_COUNTRIES,
          filter: ["in", ["get", "code"], ["literal", []]] as FilterSpecification,
          paint: {
            "fill-color": overlay.country,
            "fill-opacity": COUNTRY_FILL_OPACITY.cities,
            "fill-opacity-transition": { duration: 320 },
          },
        },
        before,
      );
    }
    if (!map.getLayer(LAYER_COUNTRY_LINE)) {
      map.addLayer(
        {
          id: LAYER_COUNTRY_LINE,
          type: "line",
          source: SOURCE_COUNTRIES,
          filter: ["in", ["get", "code"], ["literal", []]] as FilterSpecification,
          paint: {
            "line-color": overlay.countryLine,
            "line-width": COUNTRY_LINE_WIDTH,
            "line-opacity": 0,
            "line-opacity-transition": { duration: 320 },
          },
        },
        before,
      );
    }
  } catch {
    // Country highlighting is a garnish; never let it break the globe.
  }

  /*
   * The countries view's marks, over the fills and under everything the cities
   * view draws. A country you have been to says which country it is and how
   * much of your life is in it, rather than being a shape you have to
   * recognise.
   */
  try {
    if (!map.getSource(SOURCE_COUNTRY_MARKS)) {
      map.addSource(SOURCE_COUNTRY_MARKS, {
        type: "geojson",
        data: countryData,
        // These marks have faded out entirely by zoom 5.6 (`COUNTRY_CHIP_OPACITY`),
        // so tiling them past that is work for something nobody can see.
        maxzoom: COUNTRY_MARKS_SOURCE_MAXZOOM,
      });
    } else {
      (map.getSource(SOURCE_COUNTRY_MARKS) as GeoJSONSource).setData(countryData);
    }

    if (!map.getLayer(LAYER_COUNTRY_CHIP)) {
      map.addLayer({
        id: LAYER_COUNTRY_CHIP,
        type: "symbol",
        source: SOURCE_COUNTRY_MARKS,
        layout: {
          "icon-image": MARKER_ICON_IMAGE,
          "icon-size": countryChipSize(),
          "icon-allow-overlap": true,
          "symbol-sort-key": COUNTRY_CHIP_SORT,
        },
        paint: { "icon-opacity": COUNTRY_CHIP_OPACITY },
      });
    }

    if (!map.getLayer(LAYER_COUNTRY_COUNT)) {
      map.addLayer({
        id: LAYER_COUNTRY_COUNT,
        type: "symbol",
        source: SOURCE_COUNTRY_MARKS,
        filter: ["!=", ["get", "label"], ""],
        layout: {
          "icon-image": COUNT_BADGE_IMAGE,
          "icon-offset": countBadgeOffset(),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": ["get", "label"],
          "text-font": FONT_BOLD,
          "text-size": COUNT_BADGE_TEXT_SIZE,
          "text-offset": countBadgeTextOffset(),
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "symbol-sort-key": COUNTRY_CHIP_SORT,
        },
        paint: {
          "text-color": "#FFFFFF",
          "icon-opacity": COUNTRY_CHIP_OPACITY,
          "text-opacity": COUNTRY_CHIP_OPACITY,
        },
      });
    }
  } catch {
    // The marks are the garnish on the fills; never let them break the globe.
  }

  /*
   * A cluster wears the flag of one of the places inside it.
   *
   * Which one is whichever the source happened to reduce first — there is no
   * "most common country" to be had out of a clustering index, and it does not
   * matter: places this close together are nearly always in the same country,
   * and where they are not, the flag is a fair sample rather than a claim. The
   * count badge is what carries the number.
   */
  if (!map.getLayer(LAYER_CLUSTER)) {
    map.addLayer({
      id: LAYER_CLUSTER,
      type: "symbol",
      source: SOURCE_ID,
      filter: ["has", "point_count"],
      layout: {
        "icon-image": MARKER_ICON_IMAGE,
        "icon-size": clusterIconSize(),
        "icon-allow-overlap": true,
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
        "icon-image": COUNT_BADGE_IMAGE,
        "icon-offset": countBadgeOffset(),
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": FONT_BOLD,
        "text-size": COUNT_BADGE_TEXT_SIZE,
        "text-offset": countBadgeTextOffset(),
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": "#FFFFFF" },
    });
  }

  // Under the chips, and only ever under one of them: the light behind the
  // place you last tapped.
  if (!map.getLayer(LAYER_PIN_HALO)) {
    map.addLayer({
      id: LAYER_PIN_HALO,
      type: "circle",
      source: SOURCE_ID,
      filter: ["all", ["!", ["has", "point_count"]], selectedFilter(null)],
      paint: {
        "circle-color": overlay.pinSelected,
        "circle-opacity": 0.42,
        "circle-radius": HALO_RADIUS,
        "circle-blur": 0.45,
        "circle-opacity-transition": { duration: 180 },
      },
    });
  }

  if (!map.getLayer(LAYER_PIN_MARKER)) {
    map.addLayer({
      id: LAYER_PIN_MARKER,
      type: "symbol",
      source: SOURCE_ID,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": MARKER_ICON_IMAGE,
        "icon-size": MARKER_ICON_SIZE_DEFAULT,
        /* A place that has been dropped from the map is a place the traveller
           cannot tap, and there is no second way to reach it from here. Density
           is the cluster's job, not the collision grid's, so every chip that
           survives clustering is drawn. */
        "icon-allow-overlap": true,
        // It still takes its space out of the label grid, so a basemap city
        // name never prints through a flag.
        "icon-ignore-placement": false,
        "icon-padding": 1,
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
        // Clear of the chip rather than of a 5px dot: in ems of the text size,
        // which is what this property is measured in.
        "text-offset": [0, 1.75],
        "text-max-width": 9,
        "text-padding": 6,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": overlay.label,
        "text-halo-color": overlay.labelHalo,
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
  const { sky } = paletteFor(dark);
  try {
    map.setSky({
      "sky-color": sky.sky,
      /* Deeper than the default: the rim is the only thing saying "air" now
         that the planet hangs among stars, so the blue is given room to
         graduate instead of stopping at a thin line. */
      "sky-horizon-blend": 0.8,
      "horizon-color": sky.horizon,
      "horizon-fog-blend": 0.55,
      "fog-color": sky.fog,
      "fog-ground-blend": 0.02,
      /* Full atmosphere while the Earth is a planet, holding on longer as it
         becomes a map, and gone before street level — a city block in fog is
         weather, not wonder. */
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 4, 0.72, 6, 0.35, 8, 0],
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
  currentLocation,
  cameraRequest,
  bottomInset,
  onStatusChange,
  handleRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const locationMarkerRef = useRef<Marker | null>(null);

  const [styleReady, setStyleReady] = useState(false);
  /**
   * Ticks on every `style.load`.
   *
   * Switching between light and dark replaces the entire style, which discards
   * our sources and layers; `installStyleLayers` puts them back, but everything
   * that had been *applied* to them since — which countries are painted, which
   * pin is selected, whether the city layers are hidden — lived in effects keyed
   * on `styleReady`, and `styleReady` was already true, so none of them re-ran.
   * The re-added layers kept their empty defaults. A device in dark mode
   * therefore showed no visited countries at all.
   */
  const [styleEpoch, setStyleEpoch] = useState(0);
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

        // Recolour the vendor style before our own layers go on top of it, so
        // the pins are always drawn against the ground they were designed for.
        applyBasemapTheme(map, paletteFor(prefersDarkRef.current));

        // Before the layers, always: a chip layer whose sprites are missing
        // draws an empty planet.
        const overlay = overlayFor(prefersDarkRef.current);
        registerMarkerImages(map, placesRef.current, overlay);
        installStyleLayers(
          map,
          toFeatureCollection(placesRef.current),
          toCountryCollection(countryMarks(placesRef.current)),
          overlay,
        );
        setStyleReady(true);
        setStyleEpoch((epoch) => epoch + 1);
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
          /* The chip first, and with a finger's worth of slack around it: it
             is a small target over a large one, and someone reaching for the
             flag of a country means the same thing as someone reaching for the
             country — but missing the flag and hitting the sea next to it
             should not dismiss what they were aiming at. */
          const pad = 16;
          const box: [[number, number], [number, number]] = [
            [event.point.x - pad, event.point.y - pad],
            [event.point.x + pad, event.point.y + pad],
          ];
          const layers = COUNTRY_INTERACTIVE_LAYERS.filter((id) => map?.getLayer(id));
          if (layers.length === 0) return;

          const chip = map
            .queryRenderedFeatures(box, { layers: [LAYER_COUNTRY_CHIP] })
            .find((feature) => feature.properties?.code);
          const fill = map
            .queryRenderedFeatures(event.point, { layers: [LAYER_COUNTRY_FILL] })
            .find((feature) => feature.properties?.code);

          const code = chip?.properties?.code ?? fill?.properties?.code;
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

        const pin = features.find((feature) => feature.layer?.id === LAYER_PIN_MARKER);
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
      locationMarkerRef.current?.remove();
      locationMarkerRef.current = null;
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

  /* The scheme swap replaces the whole style, so every overlay colour is
     re-applied here as well as at install time — the swap and this effect can
     land in either order. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const overlay = overlayFor(prefersDark);
    try {
      if (map.getLayer(LAYER_PIN)) {
        map.setPaintProperty(LAYER_PIN, "text-color", overlay.label);
        map.setPaintProperty(LAYER_PIN, "text-halo-color", overlay.labelHalo);
      }
      if (map.getLayer(LAYER_PIN_HALO)) {
        map.setPaintProperty(LAYER_PIN_HALO, "circle-color", overlay.pinSelected);
      }
      if (map.getLayer(LAYER_COUNTRY_FILL)) {
        map.setPaintProperty(LAYER_COUNTRY_FILL, "fill-color", overlay.country);
      }
      if (map.getLayer(LAYER_COUNTRY_LINE)) {
        map.setPaintProperty(LAYER_COUNTRY_LINE, "line-color", overlay.countryLine);
      }
    } catch {
      // Style may be mid-reload.
    }
  }, [prefersDark, styleReady, styleEpoch]);

  /* ---------------------------------------------------------------------- */
  /* Data                                                                     */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    // A place saved in a country the map has never drawn needs its chip in the
    // atlas before the feature that names it arrives.
    registerMarkerImages(map, places, overlayFor(prefersDark));

    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(toFeatureCollection(places));

    const marks = map.getSource(SOURCE_COUNTRY_MARKS) as GeoJSONSource | undefined;
    marks?.setData(toCountryCollection(countryMarks(places)));

    try {
      const codes = [
        ...new Set(
          places
            // A country you want to go to is not a country you have been to,
            // and painting it as visited would answer the map's own question
            // — "how much of the world have I seen" — with a wish.
            .filter((place) => !place.wantToGo)
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
  }, [places, prefersDark, styleReady, styleEpoch]);

  /**
   * Frame the traveller's world once the data has arrived.
   *
   * Centre and zoom are answered separately because they are different kinds
   * of question. The centre is spherical geometry and belongs in a pure
   * function; the zoom depends on how this renderer draws a sphere, so the
   * renderer is asked — `jumpTo` and `project` inside one task, which the
   * browser never paints between, so the search is invisible.
   */
  const frameOn = useCallback(
    (points: GlobePoint[], maxZoom: number): { center: [number, number]; zoom: number } | null => {
      const map = mapRef.current;
      const centre = sphericalCentre(points);
      if (!map || !centre) return null;

      /* A place more than a quarter turn from the centre is behind the planet,
         and no zoom brings it round — `project` still returns a coordinate for
         it, which would otherwise read as "fits". */
      const overHorizon = points.some((point) => angularDistance(centre, point) >= 88);

      /*
       * When the collection wraps the planet there is no frame that holds all
       * of it, and the honest answer is the whole globe. Which face of it,
       * though, is a matter of taste rather than arithmetic: a traveller with
       * Svalbard, Iceland and the Faroes on the list has a mean direction well
       * inside the Arctic circle, and a globe seen down its own axis reads as a
       * diagram of the pole rather than as anybody's world. Easing the latitude
       * back towards the equator costs nothing — those northern places are
       * still comfortably in view — and buys a picture that looks like Earth.
       */
      const latitude = overHorizon
        ? Math.max(-WORLD_VIEW_LATITUDE, Math.min(WORLD_VIEW_LATITUDE, centre.latitude))
        : centre.latitude;
      const center: [number, number] = [centre.longitude, latitude];

      /* Nothing to frame but the planet itself, so frame the planet: its own
         horizon, as a ring of points, goes through the same search as any
         other collection and comes back with the zoom that fills the screen
         with Earth instead of leaving it adrift in the middle. */
      const framed = overHorizon
        ? horizonRing({ longitude: centre.longitude, latitude }, HORIZON_DEGREES)
        : points;

      const padding = cameraPadding();
      const container = map.getContainer();
      /* The planet is allowed nearly the full width of the phone. A sphere on
         a screen this narrow is width-bound whatever else is on it, and the
         side margin that keeps a *pin* off the edge only shrinks the Earth —
         which is the one thing this screen is for. */
      const side = overHorizon ? 10 : padding.left;
      /* A place is a chip, not a point. Fitting the coordinates alone puts the
         outermost one's *centre* on the edge of the box, which leaves half its
         flag — and most of its name — off the side of the phone. */
      const mark = overHorizon ? 0 : MARKER_RADIUS + 8;
      const box = {
        left: side + mark,
        right: container.clientWidth - side - mark,
        top: padding.top + mark,
        bottom: container.clientHeight - padding.bottom - mark,
      };

      const fits = (zoom: number) => {
        map.jumpTo({ center, zoom });
        return framed.every((point) => {
          const at = map.project([point.longitude, point.latitude]);
          return at.x >= box.left && at.x <= box.right && at.y >= box.top && at.y <= box.bottom;
        });
      };

      try {
        const before = { center: map.getCenter(), zoom: map.getZoom() };
        const zoom = largestZoomThatFits(fits, map.getMinZoom(), maxZoom);
        // Put the camera back: the caller decides how it travels to the frame.
        map.jumpTo({ center: before.center, zoom: before.zoom });
        return { center, zoom };
      } catch {
        return null;
      }
    },
    [cameraPadding],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !dataReady || framedRef.current) return;
    framedRef.current = true;

    // A lone place would otherwise be framed from its own rooftop.
    const frame = frameOn(places.filter(hasValidCoordinates), 5.6);
    if (!frame) {
      map.jumpTo({ center: DEFAULT_CAMERA.center, zoom: DEFAULT_CAMERA.zoom });
      return;
    }

    try {
      if (reduceMotion) {
        map.jumpTo({ center: frame.center, zoom: frame.zoom, padding: cameraPadding() });
        return;
      }
      // Rewind and fly in, so the planet arrives rather than appearing.
      map.jumpTo({ center: frame.center, zoom: Math.max(map.getMinZoom(), frame.zoom - 1.1) });
      map.easeTo({
        center: frame.center,
        zoom: frame.zoom,
        padding: cameraPadding(),
        duration: 2000,
        easing: easeOutCubic,
      });
    } catch {
      map.jumpTo({ center: DEFAULT_CAMERA.center, zoom: DEFAULT_CAMERA.zoom });
    }
  }, [places, dataReady, styleReady, reduceMotion, cameraPadding, frameOn]);

  /* ---------------------------------------------------------------------- */
  /* Selection                                                                */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !map.getLayer(LAYER_PIN_MARKER)) return;

    const selected = selectedFilter(selectedId);

    try {
      /* `icon-size` and `symbol-sort-key` are *layout* properties, not paint:
         written through `setPaintProperty` they are accepted, ignored, and the
         chip never grows. */
      map.setLayoutProperty(LAYER_PIN_MARKER, "icon-size", markerIconSize(selected));
      map.setLayoutProperty(LAYER_PIN_MARKER, "symbol-sort-key", markerSortKey(selected));

      if (map.getLayer(LAYER_PIN_HALO)) {
        map.setFilter(LAYER_PIN_HALO, [
          "all",
          ["!", ["has", "point_count"]],
          selected,
        ] as FilterSpecification);
      }

      if (map.getLayer(LAYER_PIN)) {
        // The selected place always shows its name, whatever the zoom.
        map.setPaintProperty(LAYER_PIN, "text-opacity", labelOpacity(selected));
        map.setLayoutProperty(LAYER_PIN, "symbol-sort-key", labelSortKey(selected));
      }
    } catch {
      // Style may be mid-reload.
    }
  }, [selectedId, styleReady, styleEpoch]);

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
      for (const layer of COUNTRY_LAYERS) {
        if (map.getLayer(layer)) {
          map.setLayoutProperty(
            layer,
            "visibility",
            mapView === "countries" ? "visible" : "none",
          );
        }
      }
    } catch {
      // Style may be mid-reload.
    }
  }, [mapView, styleReady, styleEpoch]);

  /* ---------------------------------------------------------------------- */
  /* Camera requests                                                          */
  /* ---------------------------------------------------------------------- */

  const cameraToken = cameraRequest?.token ?? null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !cameraRequest || cameraToken === null) return;

    // Never closer than a neighbourhood, however tightly the places cluster.
    const frame = cameraRequest.fit?.length ? frameOn(cameraRequest.fit, 9) : null;

    map.flyTo({
      center: frame?.center ?? [cameraRequest.longitude, cameraRequest.latitude],
      zoom: frame?.zoom ?? cameraRequest.zoom ?? 6.5,
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
      locationMarkerRef.current?.remove();
      locationMarkerRef.current = null;
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

  /**
   * The "you are here" dot.
   *
   * A marker rather than a layer, like the picker pin above it: the paint
   * expressions on the pin layers are validated against the style spec in a
   * test, and a one-off dot has no business joining that. It is not draggable
   * and never intercepts a tap, so it can never be mistaken for the pin being
   * placed or get in the way of placing it.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    if (!currentLocation) {
      locationMarkerRef.current?.remove();
      locationMarkerRef.current = null;
      return;
    }

    if (locationMarkerRef.current) {
      locationMarkerRef.current.setLngLat([
        currentLocation.longitude,
        currentLocation.latitude,
      ]);
      return;
    }

    let cancelled = false;
    void loadMapLibre().then((maplibregl) => {
      if (cancelled || !mapRef.current || locationMarkerRef.current) return;

      const element = document.createElement("div");
      element.className = "here-dot";
      element.setAttribute("aria-hidden", "true");
      element.innerHTML = '<span class="here-dot__halo"></span><span class="here-dot__core"></span>';

      locationMarkerRef.current = new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat([currentLocation.longitude, currentLocation.latitude])
        .addTo(mapRef.current);
    });

    return () => {
      cancelled = true;
    };
  }, [currentLocation, styleReady]);

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
    /* The space the planet sits in — and it is space, not a backdrop colour.
       The canvas is transparent everywhere the Earth and its atmosphere are
       not, so this is what a globe view is seen against, and it stops being
       visible the moment the map fills the screen. */
    <div className="globe-space absolute inset-0">
      {/* The rest of the solar system, behind the transparent canvas: the
          Earth eclipses each body as you zoom in, and zooming out is what
          reveals them — no thresholds, just occlusion doing its job. */}
      <div aria-hidden="true" className="globe-space__scene">
        <span className="globe-space__star globe-space__star--a" />
        <span className="globe-space__star globe-space__star--b" />
        <span className="globe-space__star globe-space__star--c" />
        <span className="globe-space__star globe-space__star--d" />
        <span className="planet planet--saturn" />
        <span className="planet planet--moon" />
        <span className="planet planet--mars" />
      </div>
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
        /* A planet-shaped hint of what is coming, in the colours of the space
           it will arrive in — never a flash of a scheme the globe does not
           use. */
        style={{
          background:
            "radial-gradient(circle at 50% 42%, rgba(86, 122, 190, 0.22) 0%, rgba(28, 44, 78, 0.14) 46%, rgba(0, 0, 0, 0) 68%)",
        }}
      />
      <span className="sr-only" role="status">
        {styleReady ? "Globe ready" : "Loading the globe"}
      </span>
    </div>
  );
}
