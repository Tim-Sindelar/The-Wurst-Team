import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Position } from 'geojson';
import { useMap } from 'react-leaflet';
import type { MultiPolygon } from '../domain/types';
import { outlineToLatLngs } from './geo';
import './geoman';

const EDIT_STYLE: L.PathOptions = { color: '#e0a020', weight: 2, fillOpacity: 0.15, dashArray: '6 4' };

interface Props {
  /** Read once on mount; remount (key) to edit another library. */
  outline: MultiPolygon | null;
  onChange: (outline: MultiPolygon | null) => void;
}

/**
 * Shows Geoman's drawing toolbar and makes one library's outline editable.
 * Every change (draw, vertex edit, drag, rotate, cut, remove) is reported
 * as a full MultiPolygon.
 */
export function OutlineEditor({ outline, onChange }: Props) {
  const map = useMap();
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const group = L.featureGroup().addTo(map);

    const emit = () => {
      const coordinates: Position[][][] = [];
      group.eachLayer((layer) => {
        if (!(layer instanceof L.Polygon)) return;
        const { geometry } = layer.toGeoJSON();
        if (geometry.type === 'Polygon') coordinates.push(geometry.coordinates);
        else if (geometry.type === 'MultiPolygon') coordinates.push(...geometry.coordinates);
      });
      onChangeRef.current(coordinates.length ? { type: 'MultiPolygon', coordinates } : null);
    };

    const adopt = (layer: L.Layer) => {
      if (!group.hasLayer(layer)) group.addLayer(layer);
      (layer.options as { pmIgnore?: boolean }).pmIgnore = false;
      L.PM.reInitLayer(layer);
      layer.on('pm:edit pm:rotateend', emit);
    };

    for (const polygon of outline ? outlineToLatLngs(outline) : []) {
      adopt(L.polygon(polygon, { ...EDIT_STYLE, pmIgnore: false }));
    }

    map.pm.setGlobalOptions({ layerGroup: group, snappable: true, allowSelfIntersection: false, pathOptions: EDIT_STYLE });
    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawCircle: false,
      drawText: false,
    });

    const onCreate: L.PM.CreateEventHandler = (e) => {
      adopt(e.layer);
      emit();
    };
    const onCut: L.PM.CutEventHandler = (e) => {
      group.removeLayer(e.originalLayer);
      adopt(e.layer);
      emit();
    };
    const onRemove: L.PM.RemoveEventHandler = (e) => {
      group.removeLayer(e.layer);
      emit();
    };
    map.on('pm:create', onCreate);
    map.on('pm:cut', onCut);
    map.on('pm:remove', onRemove);

    // Start where the admin most likely wants to be.
    if (outline) map.pm.enableGlobalEditMode();
    else map.pm.enableDraw('Polygon');

    return () => {
      map.pm.disableDraw();
      map.pm.disableGlobalEditMode();
      map.pm.disableGlobalDragMode();
      map.pm.disableGlobalRemovalMode();
      map.pm.disableGlobalCutMode();
      map.pm.disableGlobalRotateMode();
      map.pm.removeControls();
      map.off('pm:create', onCreate);
      map.off('pm:cut', onCut);
      map.off('pm:remove', onRemove);
      group.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- outline is initial state only
  }, [map]);

  return null;
}
