import { useEffect, useRef, useState } from 'react';
import { fetchDataset } from './repository';
import type { DatasetItem } from './types';

/**
 * The mensa items (with the PolyMaps rooms they are in), fetched once the
 * first time `wanted` is true, whether or not the mensa layer is on: the map
 * needs them to tell which workspaces are also a mensa.
 */
export function useMensaItems(wanted: boolean): DatasetItem[] | null {
  const [items, setItems] = useState<DatasetItem[] | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (!wanted || asked.current) return;
    asked.current = true;
    fetchDataset('mensa').then(
      (r) => setItems(r.document?.items ?? []),
      (err) => {
        // Asked again the next time it is wanted.
        asked.current = false;
        console.warn('Mensa rooms unavailable', err);
      },
    );
  }, [wanted]);
  return items;
}
