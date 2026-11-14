# linkedin-agent

A browser agent for LinkedIn that you can talk to, watch and score. The agent is a folder (`agent/`) that
Antigravity CLI (`agy`) starts in: it reads a brief and a wiki, and drives a real Chromium through its own
MCP server. The LinkedIn it opens is a recorded copy, so nothing it clicks reaches a real account.

Everything runs in Docker.

## Set up

You need [Docker](https://www.docker.com/products/docker-desktop/) and a Gemini API key
(https://aistudio.google.com/apikey, or the one the presenter gives you). The first start downloads about
1.5 GB, so do it before the workshop.

```sh
cp .env.example .env
# then put the key after
GEMINI_API_KEY=
```

Now download all the servers

```sh
docker compose up --build -d
```

## Browser

Open http://localhost:3023 to watch the browser while it works.


## Talk to the agent

> Requires setting up GEMINI_API_KEY

```sh
docker compose exec agent agy
```

Ask what a person would ask:
- How many followers does my profile have?
- Who reacted to my latest post?
- What does Inês Ferreira write about herself?

## Check Traces

> Requires setting up Cloud Trace

```sh
docker compose exec telemetry trace
docker compose exec telemetry trace <id>
```

Add `--json` to any of them for an agent to read; `trace --help` lists the filters.

## Eval it

```sh
docker compose exec eval run
```

## What is in this folder

```
agent/            the agent: its brief (AGENTS.md), wiki (pages/), settings (.agents/) and image (Dockerfile)
mcp/browser-mcp/  the browser tools, an MCP server over any browser's CDP
world/            the recorded LinkedIn and its deploy
dataset/          the eval's questions and expected facts
eval/             the eval runner, on Harbor, and the trace command
telemetry/        the OpenTelemetry collector for tracing to Google Cloud
compose.yaml      the browser, the agent, the eval and the telemetry
.env.example      the keys, copied to .env
```
