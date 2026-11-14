"""`docker compose exec eval run`: score this agent folder on the lowgular/browser-use-linkedin dataset with Harbor.

    docker compose exec eval run                          one task (profile-followers), one trial: Antigravity CLI on
                                                          Gemini 4 Hydrogen, low effort
    docker compose exec eval run -i activity-best-post    another task, still one
    docker compose exec eval run -m flash                 another model: an alias below or a provider/model id
    docker compose exec eval run -h claude-code -m haiku  another CLI: claude-code, codex, opencode, gemini-cli (deprecated)
    docker compose exec eval run -x gemini                the grader's extractor on Gemini instead of Claude

A run is one task, once: the key is shared, and all thirteen tasks cost about a dollar. The whole dataset, several
tasks, or more than one trial of a task take --all:

    docker compose exec eval run --all                    all thirteen tasks (with -i, -k, -n as Harbor takes them)

Harbor runs here and starts one container per task on the host's Docker, through its socket. It mounts
each trial's log folder into that container by path, and the host's Docker resolves that path on its
own side — so the jobs live in a named volume, mounted here at the very path where Docker keeps that
volume: the same path means the same folder to both, on macOS, Windows and Linux alike. The grader in
every task reads the agent's answer with an extractor: Claude Haiku by default (ANTHROPIC_API_KEY or
CLAUDE_CODE_OAUTH_TOKEN in .env), Gemini with -x gemini (GEMINI_API_KEY); with only a Gemini key in .env the
grader picks Gemini by itself.

A machine spends no more than SPEND_CAP_USD on the eval (default 1.50, one run of all thirteen tasks on Gemini 4
Hydrogen and a few repeats): the cost of every trial in the jobs volume is added up before a run, and at the
cap nothing starts. SPEND_CAP_USD=off in .env lifts it.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

GEMINI_CLI_VERSION = "0.67.0"  # as agent/Dockerfile.gemini-cli installs it
DEFAULT_TASK = "profile-followers"  # what runs when no task is named
ANTIGRAVITY_EFFORT = "low"  # as agent/.agents/settings.json names the model: Gemini 4 Hydrogen (Low)

ALIASES = {
    "hydrogen": "gemini/gemini-4-hydrogen",
    "flash": "gemini/gemini-3.8-flash",
    "flash-lite": "gemini/gemini-3.5-flash-lite",
    "haiku": "claude-haiku-5-5",
    "sonnet": "claude-sonnet-5-5",
    "luna": "gpt-6-luna",
    "glm-5.3-flash": "opencode-go/glm-5.3-flash",  # OpenCode Go, with OPENCODE_API_KEY
}
DATASET = "lowgular/browser-use-linkedin"
JOBS_VOLUME = os.environ.get("JOBS_VOLUME", "linkedin-agent-jobs")
JOBS_DIR = Path(os.environ.get("JOBS_DIR", f"/var/lib/docker/volumes/{JOBS_VOLUME}/_data"))
AGENT_DIR = os.environ.get("AGENT_DIR", "/app/agent")
TRIAL_COMPOSE = os.environ.get("TRIAL_COMPOSE", "/app/eval/compose.yaml")
SPEND_CAP_USD = os.environ.get("SPEND_CAP_USD", "") or "1.50"


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


def check_spend_cap() -> None:
    """Nothing starts once the trials in the jobs volume have cost SPEND_CAP_USD: one key is shared by a room."""
    if SPEND_CAP_USD.lower() in ("off", "none", "no"):
        return
    try:
        cap = float(SPEND_CAP_USD)
    except ValueError:
        fail(f"SPEND_CAP_USD must be a number of dollars or off, not {SPEND_CAP_USD}")
    if cap <= 0:
        return
    spent = 0.0
    for result in JOBS_DIR.rglob("result.json"):
        try:
            spent += (json.loads(result.read_text()).get("agent_result") or {}).get("cost_usd") or 0
        except (OSError, ValueError, AttributeError):
            continue  # a result half written, or not a trial's
    if spent >= cap:
        fail(f"this machine has spent ${spent:.2f} on the eval, and the cap is ${cap:.2f} (SPEND_CAP_USD in .env). "
             "Ask the presenter before raising it.")
    print(f"▸ ${spent:.2f} of ${cap:.2f} spent on this machine (SPEND_CAP_USD)", file=sys.stderr)


def main(argv: list[str]) -> None:
    harness, model, version, path, extractor, rest, everything = "antigravity-cli", "", "", "", "", [], False
    args = iter(argv)
    for a in args:
        if a == "--all":
            everything = True
        elif a == "-h":
            harness = next(args, "")
        elif a == "-m":
            model = next(args, "")
        elif a == "-v":
            version = next(args, "")
        elif a == "-p":
            path = next(args, "")
        elif a == "-x":
            extractor = next(args, "")
        else:
            rest.append(a)
    if not harness:
        fail("usage: run [--all] [-h antigravity-cli|claude-code|codex|opencode|gemini-cli] [-m model] [-x claude|gemini] [-v dataset version | -p dataset folder] [Harbor options]")
    if extractor and extractor not in ("claude", "gemini"):
        fail(f"-x takes claude or gemini, not {extractor}")
    if extractor:
        os.environ["EXTRACTOR"] = extractor  # Harbor hands it to each task, whose grader reads it
    # One task, once, unless --all: no task named is the default one, and neither several tasks nor several
    # trials of one start.
    if not everything:
        tasks = rest.count("-i") + rest.count("--include-task-name")
        if tasks > 1:
            fail("one task a run: several tasks, or the whole dataset, take --all")
        if not tasks:
            rest += ["-i", DEFAULT_TASK]
        for flags in (("-n", "--n-concurrent"), ("-k", "--n-attempts")):
            for flag in flags:
                if flag in rest and rest[rest.index(flag) + 1:rest.index(flag) + 2] != ["1"]:
                    fail(f"one trial a run: {flag} above 1 takes --all")
    check_jobs_volume()
    check_spend_cap()
    model = ALIASES.get(model, model)
    # A local build of the dataset (dataset/dist, DATASET_DIR), when there is one, wins over the Hub unless -v
    # asks for a published version.
    local = os.environ.get("DATASET_DIR", "")
    if not path and not version and local and Path(local, "dataset.toml").is_file():
        path = local
        print(f"▸ the local dataset build at {local} (DATASET_DIR); -v <version> runs the Hub's", file=sys.stderr)
    dataset = ["-p", path] if path else ["-d", f"{DATASET}@{version}" if version else DATASET]
    if "-n" not in rest and "--n-concurrent" not in rest:
        rest += ["-n", "1"]
    if "-k" not in rest and "--n-attempts" not in rest:
        rest += ["-k", "1"]
    command = [
        "harbor", "run", "--yes", *dataset,
        "-a", f"linkedin_eval.folder:{harness.replace('-', '_')}", "--ak", f"agent_dir={AGENT_DIR}", "--extra-docker-compose", TRIAL_COMPOSE,
        *(["-m", model] if model else []),
        "--jobs-dir", str(JOBS_DIR), *rest,
    ]
    # Codex on a ChatGPT plan: the login `codex login` saved on this machine (compose mounts it), unless a key is set.
    codex_login = Path("/root/.codex-host/auth.json")
    if harness == "codex" and not os.environ.get("OPENAI_API_KEY") and codex_login.is_file():
        os.environ["CODEX_AUTH_JSON_PATH"] = str(codex_login)
        print(f"▸ Codex signs in with this machine's login ({codex_login.name}), not an API key", file=sys.stderr)
    # Antigravity CLI takes a model's effort apart from its slug; the session's, unless --ak reasoning_effort says another.
    if harness == "antigravity-cli" and not any(a.startswith("reasoning_effort=") for a in rest):
        command += ["--ak", f"reasoning_effort={ANTIGRAVITY_EFFORT}"]
    # Gemini CLI at the version its image pins (agent/Dockerfile.gemini-cli), not Harbor's default of the latest.
    if harness == "gemini-cli":
        command += ["--ak", f"version={GEMINI_CLI_VERSION}"]
    # OpenCode Go's provider is not one Harbor passes a key to by itself: its key goes to the agent explicitly.
    secret = os.environ.get("OPENCODE_API_KEY", "")
    if harness == "opencode" and secret:
        command += ["--ae", f"OPENCODE_API_KEY={secret}"]
    print("▸ " + " ".join(command).replace(secret, "***") if secret else "▸ " + " ".join(command), file=sys.stderr)
    if path:
        code = subprocess.run(command).returncode
    else:
        # A dataset the Hub does not show to this container fails deep in Harbor with a traceback; say why instead.
        result = subprocess.run(command, stderr=subprocess.PIPE, text=True)
        code = result.returncode
        if code and ("not found for dataset" in result.stderr or "Dataset" in result.stderr and "not found" in result.stderr):
            fail(f"{dataset[1]} is not on Harbor Hub, or not public: this container has no Hub login. "
                 "Run a local build instead: build dataset/dist (dataset/build.sh), which this container reads")
        sys.stderr.write(result.stderr)
    print(f"\nResults are in the {JOBS_VOLUME} volume; `docker compose exec eval results` lists them.", file=sys.stderr)
    sys.exit(code)


def cli() -> None:
    main(sys.argv[1:])


if __name__ == "__main__":
    cli()
