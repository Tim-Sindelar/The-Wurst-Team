import argparse
import json
from pathlib import Path

from app.main import app


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export the FastAPI OpenAPI schema without a server"
    )
    parser.add_argument(
        "--output", type=Path, default=Path(__file__).resolve().parents[1] / "openapi.json"
    )
    args = parser.parse_args()
    args.output.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")
    print(f"Exported OpenAPI schema to {args.output}")


if __name__ == "__main__":
    main()
