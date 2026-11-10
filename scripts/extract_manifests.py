#!/usr/bin/env python3
"""Extract embedded industry-template JSON manifests into standalone files.

Consolidation utility (see docs/CONSOLIDATION_REGISTER.md, CR-3-F1/F4 group).
Reads each template .md in docs/industries/templates/, extracts the first
fenced ```json block, validates it parses, and writes it to
docs/industries/templates/manifests/manifest.<family>.json.

Run from repository root:  python3 scripts/extract_manifests.py
"""
import json, re, sys
from pathlib import Path

TEMPLATES = {
    "retail.md": "retail",
    "grocery-supermarket.md": "grocery",
    "restaurant-cafe.md": "restaurant",
    "automotive-workshop.md": "automotive",
    "distribution-field-sales.md": "distribution",
    "food-manufacturing.md": "food_manufacturing",
    "professional-services.md": "professional_services",
    "rental-logistics.md": "rental_logistics",
    "wholesale.md": "wholesale",
    "electronics.md": "electronics",
    "healthcare.md": "healthcare",
    "education.md": "education",
    "agriculture.md": "agriculture",
}

def main() -> int:
    base = Path(__file__).resolve().parent.parent / "docs" / "industries" / "templates"
    out = base / "manifests"
    out.mkdir(exist_ok=True)
    failures = []
    for fname, family in TEMPLATES.items():
        text = (base / fname).read_text(encoding="utf-8")
        m = re.search(r"```json\s*\n(.*?)```", text, re.S)
        if not m:
            failures.append(f"{fname}: no fenced json block")
            continue
        raw = m.group(1)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            failures.append(f"{fname}: JSON parse error: {e}")
            continue
        mid = data.get("id", "<missing>")
        if not mid.startswith("industry."):
            failures.append(f"{fname}: manifest id '{mid}' does not start with 'industry.'")
            continue
        target = out / f"manifest.{family}.json"
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"OK  {fname} -> manifests/manifest.{family}.json (id={mid})")
    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(" -", f)
        return 1
    print(f"\nAll {len(TEMPLATES)} manifests extracted and JSON-validated.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
