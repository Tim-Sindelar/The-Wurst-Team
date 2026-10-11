"""Read only catalogue COPY data from a pg_dump; never execute the supplied SQL."""
import argparse
import json
import re
import subprocess
from pathlib import Path

TABLES = {
    "study_spaces", "seats", "space_opening_intervals", "space_closures",
    "map_entities", "map_overrides", "map_documents",
}
ROOT = Path(__file__).resolve().parent.parent


def copy_value(value):
    if value == r"\N":
        return None
    escapes = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v"}

    def replace(match):
        token = match.group()[1:]
        if token.startswith("x") and len(token) > 1:
            return chr(int(token[1:], 16))
        if token[0] in "01234567":
            return chr(int(token, 8))
        return escapes.get(token, token)

    return re.sub(r"\\(?:[0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)", replace, value)


def catalogue(path):
    data = {}
    columns = None
    table = None
    with path.open(encoding="utf-8") as source:
        for line in source:
            match = re.fullmatch(r"COPY public\.(\w+) \((.*?)\) FROM stdin;\n?", line)
            if match:
                table = match[1] if match[1] in TABLES else None
                columns = [column.strip().strip('"') for column in match[2].split(",")]
                if table:
                    data[table] = []
                continue
            if line.rstrip("\n") == r"\.":
                table = None
                continue
            if table:
                values = line.rstrip("\n").split("\t")
                if len(values) != len(columns):
                    raise ValueError(f"Wrong column count in {table}")
                data[table].append(dict(zip(columns, map(copy_value, values))))
    if not data.get("study_spaces") or not data.get("seats") or not data.get("map_documents"):
        raise ValueError("The export needs rooms, seats and campus-map documents.")
    return data


def run(*args, input=None):
    return subprocess.run(["docker", "compose", *args], cwd=ROOT, input=input,
                          text=True, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export", type=Path)
    parser.add_argument("--database", default="pitch_catalogue_20261011")
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"pitch_[a-z0-9_]+", args.database):
        parser.error("Use a new local database named pitch_…")
    data = catalogue(args.export)
    print(json.dumps({table: len(rows) for table, rows in data.items()}), flush=True)
    if args.inspect:
        return
    # createdb deliberately refuses to replace a database that already exists.
    run("exec", "-T", "db", "createdb", "-U", "hackathon", args.database)
    url = f"postgresql+psycopg://hackathon:hackathon@db:5432/{args.database}"
    run("run", "--rm", "--no-deps", "-e", f"DATABASE_URL={url}",
        "backend", "alembic", "upgrade", "head")
    code = Path(__file__).with_name("seed-crowd.py").read_text() + "\n" + Path(__file__).with_name("import-catalogue-db.py").read_text()
    run("run", "--rm", "--no-deps", "-T", "-e", f"DATABASE_URL={url}",
        "backend", "python", "-c", code, input=json.dumps(data))
    print(f"Imported catalogue into {args.database}. Set PITCH_DATABASE_NAME={args.database} "
          "in the root .env, then run docker compose up -d --wait backend.")


if __name__ == "__main__":
    main()
