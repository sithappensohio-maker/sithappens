#!/usr/bin/env python3
"""Static guardrail for mobile viewport and modal-scroll regressions."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
files = [p for p in SRC.rglob("*") if p.suffix in {".js", ".jsx", ".css"}]
text_by_file = {p: p.read_text(encoding="utf-8", errors="ignore") for p in files}
errors = []

for path, text in text_by_file.items():
    rel = path.relative_to(ROOT)
    if path.suffix in {".js", ".jsx"}:
        if "max-h-[calc(100vh" in text:
            errors.append(f"{rel}: static 100vh modal height remains")
        if re.search(r"max-h-\[(?:88|90|92|95)vh\]", text):
            errors.append(f"{rel}: static viewport modal max-height remains")
        for line_no, line in enumerate(text.splitlines(), 1):
            if "flex flex-col" in line and "max-h-[" in line and "min-h-0" not in line:
                errors.append(f"{rel}:{line_no}: constrained flex modal is missing min-h-0")

css = text_by_file[SRC / "index.css"]
for required in (
    "--app-height",
    ".app-scroll-root",
    ".fixed.inset-0.flex.items-center.justify-center",
    "overscroll-behavior-y: contain",
):
    if required not in css:
        errors.append(f"frontend/src/index.css: missing {required}")

app = text_by_file[SRC / "App.js"]
for required in ("app-shell", "app-scroll-root", "min-h-0"):
    if required not in app:
        errors.append(f"frontend/src/App.js: missing {required}")

overlays = sum(text.count("fixed inset-0") for p, text in text_by_file.items() if p.suffix in {".js", ".jsx"})
print(f"Audited {len(files)} source files and {overlays} full-screen overlays.")
if errors:
    print("FAILED")
    for error in errors:
        print(f" - {error}")
    sys.exit(1)
print("PASS: mobile viewport and modal-scroll guardrails are present.")
