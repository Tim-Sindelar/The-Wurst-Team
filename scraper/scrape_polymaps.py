"""Scrape the ETH PolyMaps (ArcGIS Indoors) web map layers into GeoJSON files.

Usage: python scrape_polymaps.py [out_dir] [workers]
"""
import json, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PORTAL = "https://arcgis-prd-web.ethz.ch/portal/sharing/rest/content/items"
APP_ID = "603556f36a91438f8418f5d28c98bc1e"

def get(url, params=None):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.load(r)
        except Exception as e:
            if attempt == 3:
                raise
            print(f"  retry ({e})", file=sys.stderr)
            time.sleep(2 * (attempt + 1))

def flatten(layers):
    for l in layers:
        if l.get("layerType") == "GroupLayer":
            yield from flatten(l.get("layers", []))
        elif l.get("url"):
            yield l

def plan_layer(url):
    """Fetch layer metadata and object IDs, and split them into page queries."""
    meta = get(url, {"f": "json"})
    page = min(meta.get("maxRecordCount") or 1000, 2000)
    ids = get(url + "/query", {"where": "1=1", "returnIdsOnly": "true", "f": "json"})
    oids = sorted(ids.get("objectIds") or [])
    oid_field = ids.get("objectIdFieldName", "OBJECTID")
    pages = [(oids[i], oids[min(i + page, len(oids)) - 1]) for i in range(0, len(oids), page)]
    return meta, oid_field, pages

def fetch_page(url, oid_field, lo, hi):
    res = get(url + "/query", {
        "where": f"{oid_field} >= {lo} AND {oid_field} <= {hi}",
        "outFields": "*", "returnGeometry": "true", "outSR": 4326, "f": "geojson",
    })
    return res.get("features", [])

def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "scraper\\polymaps_data")
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    out.mkdir(parents=True, exist_ok=True)
    app = get(f"{PORTAL}/{APP_ID}/data", {"f": "json"})
    webmap = get(f"{PORTAL}/{app['values']['webmap']}/data", {"f": "json"})
    (out / "webmap.json").write_text(json.dumps(webmap, indent=1), encoding="utf-8")

    # Several web map layers share one service with different filters; fetch each once.
    layers = {}
    for l in flatten(webmap["operationalLayers"]):
        layers.setdefault(l["url"], l["title"])

    with ThreadPoolExecutor(workers) as pool:
        plans = dict(zip(layers, pool.map(plan_layer, layers)))
        # Submit every page of every layer to the same pool so large layers don't serialize.
        futures = {url: [pool.submit(fetch_page, url, oid_field, lo, hi) for lo, hi in pages]
                   for url, (meta, oid_field, pages) in plans.items()}
        total = sum(len(f) for f in futures.values())
        print(f"{len(layers)} layers, {total} pages, {workers} workers", file=sys.stderr)

        done = {}
        for url, page_futures in futures.items():
            name = url.split("/services/")[1].replace("/FeatureServer/", "_").replace("/", "_")
            feats = [f for fut in page_futures for f in fut.result()]
            fc = {"type": "FeatureCollection", "features": feats}
            (out / f"{name}.geojson").write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
            (out / f"{name}.meta.json").write_text(
                json.dumps(plans[url][0], indent=1, ensure_ascii=False), encoding="utf-8")
            done[url] = {"title": layers[url], "file": f"{name}.geojson", "count": len(feats)}
            print(f"{len(feats):>8}  {name}.geojson", file=sys.stderr)

    (out / "index.json").write_text(json.dumps(done, indent=1, ensure_ascii=False), encoding="utf-8")

if __name__ == "__main__":
    main()
