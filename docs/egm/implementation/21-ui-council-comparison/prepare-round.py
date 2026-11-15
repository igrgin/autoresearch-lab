"""Record a comparison prompt after capture; paths are historical after cleanup."""
import hashlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
number = int(sys.argv[1])
changes = sys.argv[2]
current = root / f"round-{number}"
previous = root / f"round-{number - 1}"
prompt = (root / "round-1/prompt.txt").read_text().split("Already changed:")[0]
prompt += "Already changed: " + changes + "\n\n"
prompt += """Grade the CURRENT design independently on two requirements, 1–10 (decimals allowed):
- UI functionality: clarity of visible controls, tasks, flow, feedback, privacy cues and failure/recovery states. Judge only what the screenshots demonstrate.
- UI appearance: hierarchy, layout, typography, spacing, contrast, consistency and visual polish.

Scale: 1 = unusable or incoherent; 10 = exemplary, clear and polished throughout.

Return both numerical grades and concise reasons, plus specific visible issues and concrete improvements. Distinguish visible evidence from behavior the images cannot establish. The previous screenshots provide comparison; grade the current design on its own merits.
"""
for name, directory in [("PREVIOUS", previous), ("CURRENT", current)]:
    capture = json.loads((directory / "capture.json").read_text())
    prompt += "\n" + name + " screenshots:\n"
    for record in capture["images"]:
        image = directory / record["file"]
        assert image.is_file()
        prompt += str(image) + "\n"
assert "9.5" not in prompt and "goal" not in prompt and "threshold" not in prompt
(current / "prompt.txt").write_text(prompt)
checkout = Path.cwd()
files = ["src/renderer/credential-entry.tsx", "src/renderer/credential-entry.css", "src/main.ts", "scripts/smoke.mjs"]
record = {file: hashlib.sha256((checkout / file).read_bytes()).hexdigest() for file in files}
record["packagedAppAsar"] = hashlib.sha256((checkout / "out/Autoresearch Lab-darwin-arm64/Autoresearch Lab.app/Contents/Resources/app.asar").read_bytes()).hexdigest()
(current / "sources.json").write_text(json.dumps(record, indent=2) + "\n")
