"""Run the API shared-schema smoke check from the repository root."""

from __future__ import annotations

from pathlib import Path
import sys

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.shared_schema_smoke import main


if __name__ == "__main__":
    raise SystemExit(main())
