"""The eval image's entrypoint: score this agent folder on the lowgular/linkedin-po dataset with Harbor.

    docker compose run --rm eval                          all thirteen tasks, Gemini CLI on Gemini 3.8 Flash
    docker compose run --rm eval -i profile-followers     one task (-i again for more)
    docker compose run --rm eval -m flash-lite            another model: an alias below or a provider/model id
    docker compose run --rm eval -h claude-code -m haiku  another CLI: claude-code, codex, gemini-cli, opencode

Harbor runs here and starts one container per task on the host's Docker, through its socket. It mounts
each trial's log folder into that container by path, and the host's Docker resolves that path on its
own side — so the jobs live in a named volume, mounted here at the very path where Docker keeps that
volume: the same path means the same folder to both, on macOS, Windows and Linux alike. The grader in
every task needs a login for its extractor (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in .env).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ALIASES = {
    "flash": "gemini/gemini-3.8-flash",
    "flash-lite": "gemini/gemini-3.5-flash-lite",
    "haiku": "claude-haiku-5-5",
    "sonnet": "claude-sonnet-5-5",
    "luna": "gpt-6-luna",
}
DATASET = "lowgular/linkedin-po"
JOBS_VOLUME = os.environ.get("JOBS_VOLUME", "linkedin-agent-jobs")
JOBS_DIR = Path(os.environ.get("JOBS_DIR", f"/var/lib/docker/volumes/{JOBS_VOLUME}/_data"))
AGENT_DIR = os.environ.get("AGENT_DIR", "/app")


def fail(message: str) -> None:
    print(f"eval: {message}", file=sys.stderr)
    sys.exit(2)


def check_jobs_volume() -> None:
    """The volume must be where Docker says it is, or the trials' logs would land nowhere."""
    try:
        out = subprocess.run(["docker", "volume", "inspect", JOBS_VOLUME], capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError) as e:
        fail(f"cannot reach Docker through its socket, or volume {JOBS_VOLUME} is missing: {e}")
    mountpoint = json.loads(out)[0]["Mountpoint"]
    if Path(mountpoint) != JOBS_DIR:
        fail(f"Docker keeps {JOBS_VOLUME} at {mountpoint}, not at {JOBS_DIR}; set JOBS_DIR to that path in .env")
    if not JOBS_DIR.is_dir():
        fail(f"{JOBS_DIR} is not mounted in this container")


def main(argv: list[str]) -> None:
    harness, model, version, path, rest = "gemini-cli", "", "", "", []
    args = iter(argv)
    for a in args:
        if a == "-h":
            harness = next(args, "")
        elif a == "-m":
            model = next(args, "")
        elif a == "-v":
            version = next(args, "")
        elif a == "-p":
            path = next(args, "")
        else:
            rest.append(a)
    if not harness:
        fail("usage: eval [-h gemini-cli|claude-code|codex|opencode] [-m model] [-v dataset version | -p dataset folder] [Harbor options]")
    check_jobs_volume()
    model = ALIASES.get(model, model)
    dataset = ["-p", path] if path else ["-d", f"{DATASET}@{version}" if version else DATASET]
    if "-n" not in rest and "--n-concurrent" not in rest:
        rest += ["-n", "1"]
    if "-k" not in rest and "--n-attempts" not in rest:
        rest += ["-k", "1"]
    command = [
        "harbor", "run", "--yes", *dataset,
        "-a", f"linkedin_eval.folder:{harness.replace('-', '_')}", "--ak", f"agent_dir={AGENT_DIR}",
        *(["-m", model] if model else []),
        "--jobs-dir", str(JOBS_DIR), *rest,
    ]
    print("▸ " + " ".join(command), file=sys.stderr)
    code = subprocess.run(command).returncode
    print(f"\nResults are in the {JOBS_VOLUME} volume; `docker compose run --rm eval-results` lists them.", file=sys.stderr)
    sys.exit(code)


if __name__ == "__main__":
    main(sys.argv[1:])
