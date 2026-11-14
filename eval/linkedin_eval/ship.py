"""`ship`: the telemetry service's own process, sending every new trace to Google Cloud Trace.

Antigravity CLI exports no telemetry, so nothing reaches the collector by itself. This reads what `trace` reads —
a session with the agent, an eval trial — and sends each finished question as spans over OTLP to the collector
(telemetry/collector.yaml), which ships them to the project GOOGLE_CLOUD_PROJECT names. Without a project it
only waits: `docker compose exec telemetry trace` works either way.

One conversation is one trace, as with Gemini CLI: a session's questions share the session's id as their trace
id, each question a root span named after it. Under it, a span a model step, and under that a span a tool
call, with its arguments, its status and the size of what it returned. The ids are derived from the trace's,
so sending a trace twice writes the same spans.
"""
import hashlib
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

from linkedin_eval.trace import short, traces

ENDPOINT = os.environ.get("OTLP_HTTP_ENDPOINT", "http://127.0.0.1:4318") + "/v1/traces"
EVERY = 5  # seconds between looks
IDLE = 45  # a question with no answer yet is sent once nothing was added to it for this long
LABEL = 250  # Cloud Trace cuts a longer attribute


def digest(*parts: str, size: int) -> str:
    return hashlib.md5("/".join(parts).encode()).hexdigest()[:size]


def nanos(at: datetime) -> str:
    return str(int(at.timestamp() * 1_000_000_000))


def attributes(values: dict) -> list[dict]:
    out = []
    for key, value in values.items():
        if value is None or value == "":
            continue
        kind = "boolValue" if isinstance(value, bool) else "intValue" if isinstance(value, int) else "doubleValue" if isinstance(value, float) else "stringValue"
        out.append({"key": key, "value": {kind: str(value) if kind == "intValue" else value if kind != "stringValue" else short(value, LABEL)}})
    return out


def span(trace_id: str, key: str, parent: str | None, name: str, start: datetime, end: datetime, values: dict, error: str = "") -> dict:
    made = {"traceId": trace_id, "spanId": digest(trace_id, key, size=16), "name": short(name, 100), "kind": 1,
            "startTimeUnixNano": nanos(start), "endTimeUnixNano": nanos(max(end, start + timedelta(milliseconds=1))),
            "attributes": attributes(values)}
    if parent:
        made["parentSpanId"] = parent
    if error:
        made["status"] = {"code": 2, "message": short(error, LABEL)}
    return made


def spans(trace: dict) -> list[dict]:
    """A trace as spans: the question, its steps, their tool calls."""
    # A session's questions are one trace, the session's; an eval trial is its own.
    trace_id = digest(trace["kind"], trace["id"].split("-")[0] if trace["kind"] == "session" else trace["id"], size=32)
    tokens = trace["tokens"]
    root = span(trace_id, trace["id"], None, f"user: {trace['question']}", trace["started"], trace["end"], {
        "trace.id": trace["id"], "trace.kind": trace["kind"], "eval.task": trace["task"], "eval.score": trace["score"],
        "gen_ai.agent.name": trace["harness"], "gen_ai.request.model": trace["model"], "cost_usd": trace["cost"],
        "gen_ai.usage.input_tokens": tokens.get("in"), "gen_ai.usage.cached_tokens": tokens.get("cached"),
        "gen_ai.usage.output_tokens": tokens.get("out"), "answer": trace["answer"], "tool_calls": trace["signals"]["tool_calls"],
        "tool_errors": len(trace["signals"]["errors"]) + len(trace["signals"]["denied"]),
    }, trace["exception"] or "")
    out = [root]
    for made in trace["steps"]:
        if made["user"]:
            continue
        start, end = made["at"], made["at"] + timedelta(seconds=made["seconds"])
        name = "answer" if made["text"] and not made["calls"] else "model: " + ", ".join(dict.fromkeys(c["tool"].split("/")[-1] for c in made["calls"])) if made["calls"] else "model"
        parent = span(trace_id, f"{trace['id']}/{made['step']}", root["spanId"], name, start, end, {
            "step": made["step"], "thinking": made["thinking"], "says": made["text"],
            "gen_ai.usage.input_tokens": made["tokens"].get("in"), "gen_ai.usage.output_tokens": made["tokens"].get("out")})
        out.append(parent)
        # The model answers first, then its tools run: the calls sit at the step's end, one after another.
        known = sum(c["seconds"] or 0 for c in made["calls"])
        at = max(start, end - timedelta(seconds=known))
        for n, c in enumerate(made["calls"]):
            until = at + timedelta(seconds=c["seconds"] or 0)
            failed = c["result"] if c["status"] in ("error", "denied") else ""
            out.append(span(trace_id, f"{trace['id']}/{made['step']}/{n}", parent["spanId"], c["tool"], at, until, {
                "tool.arguments": json.dumps(c["args"], ensure_ascii=False), "tool.status": c["status"], "tool.result_chars": c["chars"]}, failed))
            at = until
    return out


def send(trace: dict) -> None:
    body = {"resourceSpans": [{"resource": {"attributes": attributes({"service.name": "linkedin-agent"})},
                               "scopeSpans": [{"scope": {"name": "linkedin_eval.ship"}, "spans": spans(trace)}]}]}
    request = urllib.request.Request(ENDPOINT, json.dumps(body).encode(), {"Content-Type": "application/json"})
    urllib.request.urlopen(request, timeout=10).close()


def finished(trace: dict) -> bool:
    last = trace["steps"][-1]
    answered = bool(last["text"]) and not last["user"] and not last["calls"]
    return answered or trace["score"] is not None or (datetime.now(timezone.utc) - trace["end"]).total_seconds() > IDLE


def main() -> None:
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    if not project:
        print("No GOOGLE_CLOUD_PROJECT in .env: traces stay here (docker compose exec telemetry trace).", flush=True)
        while True:
            time.sleep(3600)
    print(f"Sending new traces to Cloud Trace, project {project}, through {ENDPOINT}", flush=True)
    since, sent = datetime.now(timezone.utc), {}
    while True:
        for trace in reversed(traces(10)):
            mark = (len(trace["steps"]), trace["end"])
            if trace["started"] < since or sent.get(trace["id"]) == mark or not finished(trace):
                continue
            try:
                send(trace)
            except OSError as e:  # the collector is not up (no trace profile), or not yet
                print(f"trace {trace['id']} not sent: {e}", file=sys.stderr, flush=True)
                continue
            sent[trace["id"]] = mark
            print(f"trace {trace['id']} sent: {short(trace['question'], 70)}", flush=True)
        time.sleep(EVERY)


if __name__ == "__main__":
    main()
