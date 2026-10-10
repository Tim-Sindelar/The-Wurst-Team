import { createLayerComponent } from '@react-leaflet/core';
import L from 'leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';
import { setWorkerUrl, type Map as MaplibreMap } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';

// Vite's dep prebundling breaks maplibre's worker lookup, so point it at the shipped worker file.
setWorkerUrl(workerUrl);

interface Props {
  children?: import('react').ReactNode;
  /** OpenFreeMap style: free, no API key, no usage limits (https://openfreemap.org). */
  style: 'positron' | 'bright' | 'liberty';
  /** Street names, house numbers, POIs etc. (all symbol layers). Default true. */
  labels?: boolean;
}

type GLLayer = L.Layer & {
  getMaplibreMap(): MaplibreMap | undefined;
  _showLabels?: boolean;
};

/** Shows or hides every symbol layer of the style, now or once the style has loaded. */
function applyLabels(layer: GLLayer) {
  const gl = layer.getMaplibreMap();
  if (!gl) return;
  const run = () => {
    const visibility = layer._showLabels === false ? 'none' : 'visible';
    for (const l of gl.getStyle().layers) {
      if (l.type === 'symbol')
        gl.setLayoutProperty(l.id, 'visibility', visibility);
    }
  };
  // isStyleLoaded() also waits for tiles, which may never flip back before 'style.load' has passed.
  if ((gl as unknown as { style?: { _loaded?: boolean } }).style?._loaded)
    run();
  else gl.once('style.load', run);
}

export const VectorBasemap = createLayerComponent<L.Layer, Props>(
  ({ style, labels }, ctx) => {
    const layer = maplibreGL({
      style: `https://tiles.openfreemap.org/styles/${style}`,
      attributionControl: false,
    } as never) as GLLayer;
    layer._showLabels = labels;
    // The GL map only exists while the layer is on a Leaflet map (it is recreated on every add).
    layer.on('add', () => applyLabels(layer));
    return { instance: layer, context: ctx };
  },
  (instance, { labels }, prev) => {
    if (labels === prev.labels) return;
    const layer = instance as GLLayer;
    layer._showLabels = labels;
    applyLabels(layer);
  },
);

export const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
