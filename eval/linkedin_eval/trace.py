"""`docker compose exec telemetry trace`: what the agent did, for a person or for an agent that improves it.

    trace                    the latest traces, newest first: an id, the question, how it went, what went wrong
    trace <id>               one trace: what is worth a look, then every step with its tool calls and their results
    trace <id> <step>        one step in full: the reasoning, every argument, every result uncut
    trace summary            the listed traces added up: each tool's calls and errors, repeats, the questions asked
    trace last               the newest trace, as `trace <id>`

    --json                   the same as JSON, for an agent to read (results cut at 2,000 characters; --full keeps them)
    --all                    every trace, not only the latest fifteen
    --evals | --sessions     one kind of trace only
    --failed                 only traces with a score below 1, a tool error or an exception

A trace is one question and what the agent did to answer it. Antigravity CLI exports no telemetry, so there is
no collector to ask: traces are read from what a run leaves behind. An eval trial leaves Harbor's ATIF trajectory
in the jobs volume, with its score and cost beside it, and its id is the trial's own (the letters after the
task's name). A session with the agent leaves the CLI's step transcript in its home (the agy-home volume, mounted
here at AGY_HOME); each question in it is a trace, its id the session's first eight characters, with -2, -3 for
the questions after the first.

The three levels are there to be read in order, each as long as it must be and no longer: the list says which
trace to open, a trace says which step to open, a step holds everything. What the levels above leave out is
counted (a result's size, a step's tokens), so nothing is hidden, only folded. `signals` is what a reader
would otherwise have to find by reading every step: the calls that failed or were denied, the same call made
twice, one tool called many times in a row, the largest results, the slowest steps.
"""
import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

JOBS_DIR = Path(os.environ.get("JOBS_DIR", "/var/lib/docker/volumes/linkedin-agent-jobs/_data"))
AGY_HOME = Path(os.environ.get("AGY_HOME", "/agy"))
LATEST = 15  # how many traces the list shows
CUT = 2000  # where --json cuts a result, unless --full
COLOR = sys.stdout.isatty()
DIM, BOLD, RED, GREEN, CYAN, YELLOW = ("\033[2m", "\033[1m", "\033[31m", "\033[32m", "\033[36m", "\033[33m")
STAMPS = re.compile(r"^(?:(?:Created|Completed) At: \S+\n)+")  # Antigravity heads every result with its times


def paint(text: str, *codes: str) -> str:
    return f"{''.join(codes)}{text}\033[0m" if COLOR and codes else text


def when(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def short(text, width: int = 96) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= width else text[: width - 1] + "…"


def ago(at: datetime) -> str:
    seconds = (datetime.now(timezone.utc) - at).total_seconds()
    for size, unit in ((86400, "d"), (3600, "h"), (60, "m")):
        if seconds >= size:
            return f"{seconds // size:.0f}{unit} ago"
    return "just now"


def asked(text: str) -> str:
    """What the person asked: Antigravity wraps it in tags and adds the time and its settings."""
    request = re.search(r"<USER_REQUEST>\s*(.*?)\s*</USER_REQUEST>", text, re.S)
    return (request.group(1) if request else text).strip()


def tool(name: str, args: dict) -> tuple[str, dict]:
    """A call by the tool's own name, whatever the CLI wraps it in, and its arguments."""
    args = args or {}
    if name == "call_mcp_tool":  # Antigravity's wrapper around every MCP tool
        return f"{args.get('ServerName', 'mcp')}/{args.get('ToolName', '')}", args.get("Arguments") or {}
    if "_" in name and name.split("_", 1)[0].endswith("-mcp"):  # other CLIs: server_tool
        server, _, inner = name.partition("_")
        return f"{server}/{inner}", args
    return name, args


def outcome(body: str, status: str | None) -> tuple[str, float | None, str]:
    """A result's status, how long the tool took when the result says, and its text without the timestamps."""
    times = re.findall(r"(Created|Completed) At: (\S+)", STAMPS.match(body).group(0)) if STAMPS.match(body) else []
    seconds = None
    if times:
        created = [when(t) for kind, t in times if kind == "Created"]
        completed = [when(t) for kind, t in times if kind == "Completed"]
        if created and completed:
            seconds = max((max(completed) - min(created)).total_seconds(), 0)
    text = STAMPS.sub("", body)
    failed = status == "ERROR" or text.startswith("Encountered error")
    if failed and "ermission" in text[:300]:
        return "denied", seconds, text
    return ("error" if failed else "ok"), seconds, text


def step(n: int, at: datetime, user: bool, text: str, thinking: str = "", tokens: dict | None = None) -> dict:
    return {"step": n, "at": at, "user": user, "text": text.strip(), "thinking": thinking.strip(), "tokens": tokens or {}, "calls": []}


def opencode_calls(log: Path) -> dict:
    """OpenCode's own record of each tool call, by its id: Harbor's trajectory keeps a call that failed but not its
    error, nor how long any call took."""
    calls = {}
    for line in log.read_text(errors="replace").splitlines() if log.is_file() else []:
        try:
            part = json.loads(line).get("part") or {}
        except (ValueError, AttributeError):
            continue
        state = part.get("state") or {}
        if part.get("type") == "tool" and part.get("callID"):
            took = state.get("time") or {}
            calls[part["callID"]] = {"error": state.get("error") if state.get("status") == "error" else None,
                                     "seconds": (took["end"] - took["start"]) / 1000 if took.get("start") and took.get("end") else None}
    return calls


def from_trial(trial: Path) -> list[dict]:
    """An eval trial, one trace: Harbor's ATIF trajectory, with the result and the grade beside it."""
    trajectory = json.loads((trial / "agent" / "trajectory.json").read_text())
    result = json.loads((trial / "result.json").read_text()) if (trial / "result.json").is_file() else {}
    grade = trial / "verifier" / "result.json"
    grade = json.loads(grade.read_text()) if grade.is_file() else {}
    recorded, steps = trajectory.get("steps", []), []
    logged = opencode_calls(trial / "agent" / "opencode.txt")
    for i, record in enumerate(recorded):
        # Some CLIs give the question no time of its own: it was asked when the first step after it began.
        stamp = record.get("timestamp") or next((s["timestamp"] for s in recorded[i + 1:] if s.get("timestamp")), None)
        if not stamp:
            continue
        user = record.get("source") == "user"
        text = str(record.get("message") or "")
        metrics = record.get("metrics") or {}
        tokens = {k: metrics[m] for k, m in (("in", "prompt_tokens"), ("cached", "cached_tokens"), ("out", "completion_tokens"), ("cost", "cost_usd")) if metrics.get(m)}
        made = step(len(steps) + 1, when(stamp), user, asked(text) if user else text, str(record.get("reasoning_content") or ""), tokens)
        results = {r.get("source_call_id"): r for r in (record.get("observation") or {}).get("results", [])}
        for c in record.get("tool_calls") or []:
            name, args = tool(c.get("function_name", ""), c.get("arguments"))
            got = results.get(c.get("tool_call_id"))
            status, seconds, body = outcome(str(got.get("content", "")), (got.get("extra") or {}).get("status")) if got else ("no result", None, "")
            own = logged.get(c.get("tool_call_id")) or {}
            if own.get("error"):
                status, body = ("denied" if "ermission" in own["error"] else "error"), str(own["error"])
            seconds = own.get("seconds") if seconds is None else seconds
            made["calls"].append({"tool": name, "args": args, "status": status, "seconds": seconds, "chars": len(body), "result": body})
        steps.append(made)
    if not steps:
        return []
    usage, agent = trajectory.get("final_metrics") or {}, trajectory.get("agent") or {}
    task, _, trial_id = trial.name.partition("__")
    crashed = result.get("exception_info") or {}
    finished = (result.get("agent_execution") or {}).get("finished_at")
    return [finish({
        "id": trial_id, "kind": "eval", "task": task, "harness": agent.get("name"), "model": str(agent.get("model_name", "")).split("/")[-1],
        "steps": steps, "end": when(finished) if finished else steps[-1]["at"],
        "tokens": {"in": usage.get("total_prompt_tokens"), "cached": usage.get("total_cached_tokens"), "out": usage.get("total_completion_tokens")},
        "cost": usage.get("total_cost_usd"),
        "score": ((result.get("verifier_result") or {}).get("rewards") or {}).get("reward"),
        "facts": grade.get("facts", []), "extracted": grade.get("extracted"), "grader_error": grade.get("error"),
        "exception": f"{crashed.get('exception_type')}: {crashed.get('exception_message')}" if crashed else None,
    })]


def from_session(transcript: Path) -> list[dict]:
    """A session with the agent, one trace a question: the CLI's step transcript, which repeats a step in progress."""
    records = {}
    for line in transcript.read_text().splitlines():
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if isinstance(record, dict) and "step_index" in record:
            records[record["step_index"]] = record  # the last snapshot of a step is the finished one
    session, traces, waiting = transcript.parents[2].name[:8], [], []
    for _, record in sorted(records.items()):
        kind = record.get("type")
        if kind == "USER_INPUT" and record.get("created_at"):
            turn = len(traces) + 1
            traces.append({"id": session if turn == 1 else f"{session}-{turn}", "kind": "session", "task": None, "harness": "antigravity-cli",
                           "model": None, "steps": [], "tokens": {"in": 0, "cached": 0, "out": 0}, "cost": None, "score": None, "facts": [],
                           "extracted": None, "grader_error": None, "exception": None})
            traces[-1]["steps"].append(step(1, when(record["created_at"]), True, asked(str(record.get("content") or ""))))
            waiting = []
        elif kind == "PLANNER_RESPONSE" and traces and record.get("created_at"):
            trace = traces[-1]
            tokens = {"in": (record.get("input_tokens") or 0) + (record.get("cache_read_tokens") or 0),
                      "cached": record.get("cache_read_tokens") or 0, "out": record.get("output_tokens") or 0}
            for key in tokens:
                trace["tokens"][key] += tokens[key]
            made = step(len(trace["steps"]) + 1, when(record["created_at"]), False, str(record.get("content") or ""), str(record.get("thinking") or ""), tokens)
            for c in record.get("tool_calls") or []:
                name, args = tool(c.get("name", ""), c.get("args"))
                made["calls"].append({"tool": name, "args": args, "status": "no result", "seconds": None, "chars": 0, "result": ""})
            trace["steps"].append(made)
            waiting = list(made["calls"])  # the results follow, one record a call, in the calls' order
        elif kind not in ("SYSTEM_MESSAGE", "USER_INPUT", "PLANNER_RESPONSE") and waiting:
            body = str(record.get("content") or record.get("error") or "")
            made = waiting.pop(0)
            made["status"], made["seconds"], made["result"] = outcome(body, record.get("status"))
            made["chars"] = len(made["result"])
    for trace in traces:
        trace["end"] = max([trace["steps"][-1]["at"]] + [when(r["created_at"]) for _, r in records.items() if r.get("created_at")
                                                         and trace["steps"][0]["at"] <= when(r["created_at"])
                                                         and (trace is traces[-1] or when(r["created_at"]) < traces[traces.index(trace) + 1]["steps"][0]["at"])])
    return [finish(trace) for trace in traces]


def finish(trace: dict) -> dict:
    """What every trace has whatever it was read from: the question, the answer, each step's length, the signals."""
    steps = trace["steps"]
    trace["started"] = steps[0]["at"]
    trace["seconds"] = max((trace["end"] - steps[0]["at"]).total_seconds(), 0)
    for i, made in enumerate(steps):
        made["offset"] = (made["at"] - steps[0]["at"]).total_seconds()
        made["seconds"] = max(((steps[i + 1]["at"] if i + 1 < len(steps) else trace["end"]) - made["at"]).total_seconds(), 0)
    trace["question"] = next((s["text"] for s in steps if s["user"]), "")
    trace["answer"] = next((s["text"] for s in reversed(steps) if not s["user"] and s["text"]), "")
    calls = [(s["step"], c) for s in steps for c in s["calls"]]
    same = Counter((c["tool"], json.dumps(c["args"], sort_keys=True)) for _, c in calls)
    streaks, run = [], []
    for n, c in calls + [(None, {"tool": None})]:
        if run and c["tool"] != run[-1][1]["tool"]:
            if len(run) >= 4:
                streaks.append({"tool": run[0][1]["tool"], "times": len(run), "steps": [run[0][0], run[-1][0]]})
            run = []
        run.append((n, c))
    trace["signals"] = {
        "steps": len(steps), "tool_calls": len(calls),
        "errors": [{"step": n, "tool": c["tool"], "args": c["args"], "error": short(c["result"], 300)} for n, c in calls if c["status"] == "error"],
        "denied": [{"step": n, "tool": c["tool"], "args": c["args"]} for n, c in calls if c["status"] == "denied"],
        "repeated_calls": [{"tool": name, "args": json.loads(args), "times": times, "steps": [n for n, c in calls if c["tool"] == name and json.dumps(c["args"], sort_keys=True) == args]}
                           for (name, args), times in same.items() if times > 1],
        "streaks": streaks,
        "largest_results": [{"step": n, "tool": c["tool"], "chars": c["chars"]} for n, c in sorted(calls, key=lambda x: -x[1]["chars"])[:3] if c["chars"] >= 5000],
        "slowest_steps": [{"step": s["step"], "seconds": s["seconds"]} for s in sorted(steps, key=lambda s: -s["seconds"])[:3] if s["seconds"] >= 20],
    }
    return trace


def troubled(trace: dict) -> bool:
    signals = trace["signals"]
    return bool(signals["errors"] or signals["denied"] or trace["exception"] or trace["grader_error"] or (trace["score"] is not None and trace["score"] < 1))


def newest(paths, count: int | None) -> list[Path]:
    """The files changed last, so a long history costs a stat a file and a read of only those shown."""
    return sorted(paths, key=lambda p: p.stat().st_mtime, reverse=True)[:count]


def load(read, path: Path) -> list[dict]:
    try:
        return read(path)
    except (OSError, ValueError, KeyError):
        return []  # a run still writing its files, or cut off


def traces(count: int | None, kind: str | None = None, failed: bool = False) -> list[dict]:
    """The latest traces, newest first."""
    found, reach = [], None if failed else count  # a filter on what went wrong has to read them all
    if kind != "session" and JOBS_DIR.is_dir():
        for path in newest(JOBS_DIR.glob("*/*/agent/trajectory.json"), reach):
            found += load(from_trial, path.parents[1])
    if kind != "eval":
        for path in newest((AGY_HOME / "antigravity-cli" / "brain").glob("*/.system_generated/logs/transcript_full.jsonl"), reach):
            found += load(from_session, path)
    found = [t for t in found if not failed or troubled(t)]
    return sorted(found, key=lambda t: t["started"], reverse=True)[:count]


def find(trace_id: str) -> dict | None:
    """One trace by its id, whatever its case: a trial's folder ends with it, a session's starts with it."""
    wanted = trace_id.lower()
    for trial in JOBS_DIR.glob("*/*__*") if JOBS_DIR.is_dir() else []:
        if trial.name.lower().endswith(f"__{wanted}") and (trial / "agent" / "trajectory.json").is_file():
            return next(iter(load(from_trial, trial)), None)
    session = wanted.split("-")[0]
    for transcript in (AGY_HOME / "antigravity-cli" / "brain").glob(f"{session}*/.system_generated/logs/transcript_full.jsonl"):
        for trace in load(from_session, transcript):
            if trace["id"].lower() == wanted:
                return trace
    return None


def plain(value, cut: int | None):
    """A trace as JSON holds it: times as text, and a result no longer than `cut`, its real length kept in chars."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: (v[:cut] if k == "result" and cut and isinstance(v, str) else plain(v, cut)) for k, v in value.items() if k != "end"}
    if isinstance(value, list):
        return [plain(v, cut) for v in value]
    return value


def brief(trace: dict) -> dict:
    """A trace as the list holds it: everything but its steps, the signals as counts."""
    signals = trace["signals"]
    return {**{k: trace[k] for k in ("id", "kind", "task", "harness", "model", "started", "seconds", "question", "answer", "score", "cost", "tokens", "exception", "grader_error")},
            "steps": signals["steps"], "tool_calls": signals["tool_calls"], "errors": len(signals["errors"]), "denied": len(signals["denied"]),
            "repeated_calls": len(signals["repeated_calls"]), "failed_facts": [f.get("fact") for f in trace["facts"] if not f.get("pass")]}


def listing(found: list[dict]) -> None:
    if not found:
        print("No traces: talk to the agent (docker compose exec agent agy) or score it (docker compose exec eval run).")
        return
    width = max(len(t["task"] or "session") for t in found)
    print(paint(f"{'ID':10} {'WHEN':8} {'WHAT':{width}}  {'TOOK':>5} {'CALLS':>5} {'ERR':>3}  {'QUESTION':56} RESULT", DIM))
    for trace in found:
        signals = trace["signals"]
        wrong = len(signals["errors"]) + len(signals["denied"])
        result = [f"score {trace['score']}"] if trace["score"] is not None else []
        result += [f"${trace['cost']:.4f}"] if trace["cost"] else [f"{trace['tokens']['in']:,} tokens"] if trace["tokens"].get("in") else []
        result += [paint(trace["exception"].split(":")[0], RED)] if trace["exception"] else []
        print(f"{paint(f'{trace['id']:10}', BOLD)} {ago(trace['started']):8} {trace['task'] or 'session':{width}}  {trace['seconds']:>4.0f}s "
              f"{signals['tool_calls']:>5} {paint(f'{wrong:>3}', RED) if wrong else '  ·'}  {short(trace['question'], 54):56} {' · '.join(result)}")
    print(paint("\nOne of them: docker compose exec telemetry trace <id>      All of them added up: docker compose exec telemetry trace summary", DIM))


def args_line(args: dict, width: int = 110) -> str:
    return short(json.dumps(args, ensure_ascii=False), width) if args else ""


def show(trace: dict) -> None:
    signals, tokens = trace["signals"], trace["tokens"]
    head = [trace["kind"], trace["task"], trace["harness"], trace["model"]]
    print(paint(f"Trace {trace['id']} · {' · '.join(h for h in head if h)}", BOLD))
    facts = [f for f in trace["facts"]]
    line = [f"score {trace['score']} ({sum(1 for f in facts if f.get('pass'))}/{len(facts)} facts)"] if trace["score"] is not None else []
    line += [f"${trace['cost']:.4f}"] if trace["cost"] else []
    line += [f"{tokens['in']:,} tokens in ({tokens.get('cached') or 0:,} cached), {tokens.get('out') or 0:,} out"] if tokens.get("in") else []
    print(" · ".join(line + [f"{trace['seconds']:.0f}s", f"{signals['steps']} steps", f"{signals['tool_calls']} tool calls"]))
    print(f"\n{paint('Question', BOLD)}  {trace['question']}")

    worth = []
    if trace["exception"]:
        worth.append(paint(f"the run ended with {short(trace['exception'], 150)}", RED))
    if trace["grader_error"]:
        worth.append(paint(f"the grader failed: {short(trace['grader_error'], 150)}", RED))
    for e in signals["errors"]:
        worth.append(f"step {e['step']}: {e['tool']} failed: {short(e['error'], 130)}")
    for d in signals["denied"]:
        worth.append(f"step {d['step']}: {d['tool']} denied {args_line(d['args'], 100)}")
    for r in signals["repeated_calls"]:
        worth.append(f"{r['tool']} called {r['times']} times with the same arguments (steps {', '.join(map(str, r['steps']))}) {args_line(r['args'], 70)}")
    for s in signals["streaks"]:
        worth.append(f"{s['tool']} called {s['times']} times in a row (steps {s['steps'][0]}–{s['steps'][1]})")
    for big in signals["largest_results"]:
        worth.append(f"step {big['step']}: {big['tool']} returned {big['chars']:,} characters")
    for slow in signals["slowest_steps"]:
        worth.append(f"step {slow['step']} took {slow['seconds']:.0f}s")
    if worth:
        print(f"\n{paint('Worth a look', BOLD)}")
        for item in worth:
            print(f"  · {item}")

    print(f"\n{paint('Steps', BOLD)}")
    for made in trace["steps"]:
        spent = made["tokens"]
        cost = f" · {spent['in']:,} in, {spent.get('out', 0):,} out" if spent.get("in") else ""
        print(paint(f"{made['step']:>3}  +{made['offset']:.0f}s  {made['seconds']:.0f}s{cost}", DIM) + ("  " + paint("user", BOLD) if made["user"] else ""))
        if made["thinking"]:
            print(paint(f"       thinks  {short(made['thinking'], 150)}", DIM))
        for c in made["calls"]:
            took = f" {c['seconds']:.0f}s" if c["seconds"] is not None else ""
            mark = {"ok": paint("ok", GREEN), "error": paint("error", RED), "denied": paint("denied", RED)}.get(c["status"], paint(c["status"], YELLOW))
            print(f"       {paint(c['tool'], CYAN)} {args_line(c['args'])}  → {mark}{took}, {c['chars']:,} chars")
            if c["status"] in ("error", "denied"):
                print(paint(f"         {short(c['result'], 200)}", RED))
        if made["text"] and not made["user"]:
            print(f"       {paint('says', BOLD)}    {short(made['text'], 150)}")

    print(f"\n{paint('Answer', BOLD)}\n{trace['answer'] or '(none)'}")
    if facts:
        print(f"\n{paint('Graded', BOLD)}")
        for fact in facts:
            ok = fact.get("pass")
            got = "" if ok else f"  expected {json.dumps(fact.get('expected'), ensure_ascii=False)}, got {json.dumps(fact.get('got'), ensure_ascii=False)}"
            print(paint(f"  {'✓' if ok else '✗'} {fact.get('fact')}{got}", GREEN if ok else RED))
    print(paint(f"\nA step in full: docker compose exec telemetry trace {trace['id']} <step>", DIM))


def show_step(trace: dict, number: int) -> None:
    made = next((s for s in trace["steps"] if s["step"] == number), None)
    if not made:
        sys.exit(f"Trace {trace['id']} has steps 1 to {len(trace['steps'])}.")
    print(paint(f"Trace {trace['id']} · step {number} of {len(trace['steps'])} · +{made['offset']:.0f}s · {made['seconds']:.0f}s", BOLD))
    if made["thinking"]:
        print(f"\n{paint('Thinks', BOLD)}\n{made['thinking']}")
    if made["text"]:
        print(f"\n{paint('Asks' if made['user'] else 'Says', BOLD)}\n{made['text']}")
    for c in made["calls"]:
        print(f"\n{paint(c['tool'], CYAN, BOLD)} → {c['status']}, {c['chars']:,} chars\n{json.dumps(c['args'], indent=2, ensure_ascii=False)}\n{paint('result', DIM)}\n{c['result']}")


def summary(found: list[dict]) -> dict:
    """The listed traces added up: what a reader looks for across runs, not in one."""
    tools: dict[str, dict] = {}
    errors, repeats, files, questions = Counter(), Counter(), Counter(), []
    for trace in found:
        used = set()
        for made in trace["steps"]:
            for c in made["calls"]:
                row = tools.setdefault(c["tool"], {"calls": 0, "errors": 0, "denied": 0, "traces": 0, "chars": 0, "seconds": 0.0, "timed": 0})
                row["calls"] += 1
                row["errors"] += c["status"] == "error"
                row["denied"] += c["status"] == "denied"
                row["chars"] += c["chars"]
                if c["seconds"] is not None:
                    row["seconds"] += c["seconds"]
                    row["timed"] += 1
                used.add(c["tool"])
                if c["status"] == "error":
                    errors[(c["tool"], short(re.sub(r"[0-9a-f]{8,}|\d+", "N", c["result"]), 140))] += 1
                path = c["args"].get("Path") or c["args"].get("filePath") or c["args"].get("file_path")
                if path and str(path).startswith("/app/"):
                    files[str(path).removeprefix("/app/")] += 1
        for name in used:
            tools[name]["traces"] += 1
        for r in trace["signals"]["repeated_calls"]:
            # Without the browser session's own ids, so the same repeat in two traces is one row.
            args = {k: v for k, v in r["args"].items() if k not in ("run", "tab")}
            repeats[(r["tool"], json.dumps(args, sort_keys=True, ensure_ascii=False))] += 1
        if trace["kind"] == "session":
            questions.append({"id": trace["id"], "question": trace["question"]})
    graded = [t for t in found if t["score"] is not None]
    return {
        "traces": len(found), "evals": len(graded), "sessions": len(found) - len(graded),
        "mean_score": round(sum(t["score"] for t in graded) / len(graded), 3) if graded else None,
        "failed_evals": [{"id": t["id"], "task": t["task"], "score": t["score"], "exception": t["exception"] or t["grader_error"],
                          "failed_facts": [f.get("fact") for f in t["facts"] if not f.get("pass")]} for t in graded if t["score"] < 1],
        "tools": [{"tool": name, "calls": r["calls"], "errors": r["errors"], "denied": r["denied"], "traces": r["traces"],
                   "mean_chars": round(r["chars"] / r["calls"]), "mean_seconds": round(r["seconds"] / r["timed"], 1) if r["timed"] else None}
                  for name, r in sorted(tools.items(), key=lambda x: -x[1]["calls"])],
        "errors": [{"tool": name, "error": text, "times": n} for (name, text), n in errors.most_common(12)],
        "repeated_calls": [{"tool": name, "args": json.loads(args), "traces": n} for (name, args), n in repeats.most_common(10)],
        "files_read": [{"file": name, "reads": n} for name, n in files.most_common(15)],
        "session_questions": questions,
    }


def show_summary(total: dict) -> None:
    score = f", mean score {total['mean_score']}" if total["mean_score"] is not None else ""
    print(paint(f"{total['traces']} traces: {total['evals']} evals{score}, {total['sessions']} sessions", BOLD))
    print(f"\n{paint('Tools', BOLD)}\n" + paint(f"  {'TOOL':34} {'CALLS':>5} {'ERR':>4} {'DENIED':>6} {'TRACES':>6} {'CHARS':>8} {'SECONDS':>7}", DIM))
    for r in total["tools"]:
        wrong = paint(f"{r['errors']:>4}", RED) if r["errors"] else "   ·"
        denied = paint(f"{r['denied']:>6}", RED) if r["denied"] else "     ·"
        seconds = f"{r['mean_seconds']:>7}" if r["mean_seconds"] is not None else "      ·"
        print(f"  {r['tool']:34} {r['calls']:>5} {wrong} {denied} {r['traces']:>6} {r['mean_chars']:>8,} {seconds}")
    for title, rows, line in (
        ("Evals below 1", total["failed_evals"], lambda r: f"{r['id']}  {r['task']}  score {r['score']}  {short(r['exception'], 80) if r['exception'] else ', '.join(r['failed_facts'])}"),
        ("Errors", total["errors"], lambda r: f"{r['times']:>3}×  {r['tool']}: {r['error']}"),
        ("The same call twice in a trace", total["repeated_calls"], lambda r: f"{r['traces']:>3} traces  {r['tool']} {args_line(r['args'], 90)}"),
        ("Files read", total["files_read"], lambda r: f"{r['reads']:>3}×  {r['file']}"),
        ("Asked in sessions", total["session_questions"], lambda r: f"{r['id']:10} {short(r['question'], 110)}"),
    ):
        if rows:
            print(f"\n{paint(title, BOLD)}")
            for row in rows:
                print(f"  {short(line(row), 150)}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="trace", description="What the agent did: the latest traces, one trace, one step, or all of them added up.")
    parser.add_argument("id", nargs="?", help="a trace's id, `last`, or `summary`")
    parser.add_argument("step", nargs="?", type=int, help="a step of that trace, in full")
    parser.add_argument("--json", action="store_true", help="JSON, for an agent to read")
    parser.add_argument("--full", action="store_true", help="with --json, results uncut")
    parser.add_argument("--all", action="store_true", help="every trace, not only the latest")
    parser.add_argument("--evals", action="store_const", const="eval", dest="kind", help="eval trials only")
    parser.add_argument("--sessions", action="store_const", const="session", dest="kind", help="sessions with the agent only")
    parser.add_argument("--failed", action="store_true", help="only traces where something went wrong")
    options = parser.parse_args()
    dump = lambda value, cut=None: print(json.dumps(plain(value, cut), indent=1, ensure_ascii=False))  # noqa: E731

    if options.id in (None, "summary"):
        found = traces(None if options.all else LATEST, options.kind, options.failed)
        if options.id == "summary":
            total = summary(found)
            dump(total) if options.json else show_summary(total)
        else:
            dump([brief(t) for t in found]) if options.json else listing(found)
        return
    trace = next(iter(traces(1, options.kind)), None) if options.id == "last" else find(options.id)
    if not trace:
        sys.exit(f"No trace {options.id}: `trace` lists the ids.")
    if options.step is not None:
        made = next((s for s in trace["steps"] if s["step"] == options.step), None)
        dump(made) if options.json and made else show_step(trace, options.step)
    elif options.json:
        dump(trace, None if options.full else CUT)
    else:
        show(trace)


if __name__ == "__main__":
    main()
