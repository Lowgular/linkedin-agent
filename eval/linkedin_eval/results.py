"""`docker compose run --rm eval-results`: the latest runs in the jobs volume, each trial with its score."""
import json
import os
import sys
from pathlib import Path

JOBS_DIR = Path(os.environ.get("JOBS_DIR", "/var/lib/docker/volumes/linkedin-agent-jobs/_data"))
count = int(sys.argv[1]) if len(sys.argv) > 1 else 3
jobs = sorted((d for d in JOBS_DIR.iterdir() if d.is_dir()), reverse=True)[:count] if JOBS_DIR.is_dir() else []
if not jobs:
    print("No runs yet: docker compose run --rm eval")
for job in jobs:
    print(f"\n{job.name}")
    scores = []
    for trial in sorted(d for d in job.iterdir() if d.is_dir()):
        reward = trial / "verifier" / "reward.txt"
        score = reward.read_text().strip() if reward.is_file() else "no score"
        failed = (trial / "exception.txt").is_file()
        facts = ""
        result = trial / "verifier" / "result.json"
        if result.is_file():
            r = json.loads(result.read_text())
            facts = f"{r.get('passed', '?')}/{r.get('total', '?')} facts"
        answer = trial / "agent" / "gemini-cli.txt"
        print(f"  {trial.name.split('__')[0]:28} {score:>8}  {facts:12} {'error, see exception.txt' if failed else ''}")
        if score.replace('.', '', 1).isdigit():
            scores.append(float(score))
    if scores:
        print(f"  {'mean':28} {sum(scores) / len(scores):8.3f}  over {len(scores)} task(s)")
print(f"\nThe trials' files are in the volume: docker run --rm -v linkedin-agent-jobs:/jobs alpine ls /jobs")
