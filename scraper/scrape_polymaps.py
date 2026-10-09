"""Scrape the ETH PolyMaps (ArcGIS Indoors) web map layers into GeoJSON files.

Usage: python scrape_polymaps.py [out_dir]
"""
import json, sys, time, urllib.parse, urllib.request
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

def fetch_layer(url):
    meta = get(url, {"f": "json"})
    page = min(meta.get("maxRecordCount") or 1000, 2000)
    ids = get(url + "/query", {"where": "1=1", "returnIdsOnly": "true", "f": "json"})
    oids = sorted(ids.get("objectIds") or [])
    oid_field = ids.get("objectIdFieldName", "OBJECTID")
    feats = []
    for i in range(0, len(oids), page):
        chunk = oids[i:i + page]
        res = get(url + "/query", {
            "where": f"{oid_field} >= {chunk[0]} AND {oid_field} <= {chunk[-1]}",
            "outFields": "*", "returnGeometry": "true", "outSR": 4326, "f": "geojson",
        })
        feats.extend(res.get("features", []))
        print(f"  {len(feats)}/{len(oids)}", file=sys.stderr)
    return meta, {"type": "FeatureCollection", "features": feats}

def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "polymaps_data")
    out.mkdir(parents=True, exist_ok=True)
    app = get(f"{PORTAL}/{APP_ID}/data", {"f": "json"})
    webmap = get(f"{PORTAL}/{app['values']['webmap']}/data", {"f": "json"})
    (out / "webmap.json").write_text(json.dumps(webmap, indent=1), encoding="utf-8")
    done = {}
    for l in flatten(webmap["operationalLayers"]):
        url = l["url"]
        if url in done:  # several web map layers share one service with different filters
            continue
        name = url.split("/services/")[1].replace("/FeatureServer/", "_").replace("/", "_")
        print(f"{l['title']} -> {name}", file=sys.stderr)
        meta, fc = fetch_layer(url)
        (out / f"{name}.geojson").write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
        (out / f"{name}.meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
        done[url] = {"title": l["title"], "file": f"{name}.geojson", "count": len(fc["features"])}
    (out / "index.json").write_text(json.dumps(done, indent=1, ensure_ascii=False), encoding="utf-8")
    for u, d in done.items():
        print(f"{d['count']:>8}  {d['file']}")

if __name__ == "__main__":
    main()
