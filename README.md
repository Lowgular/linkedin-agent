# linkedin-agent

A browser agent for LinkedIn, and the world it is built against. The agent is a folder a coding
CLI starts in: Gemini CLI, Claude Code, Codex or OpenCode read the brief (`AGENTS.md`, with
`GEMINI.md` and `CLAUDE.md` pointing at it), the wiki of pages and procedures under `pages/`, and
reach the browser through one MCP server, dev-browser. The world (`world/`) is a recorded, authored
LinkedIn served as a fake behind the real dev-browser, in a Docker image, so the agent is developed
and scored without touching a live account. Nothing in the world is a real person.

```
AGENTS.md               the brief; GEMINI.md and CLAUDE.md are links to it
pages/                  the wiki: one page document per LinkedIn page, the procedures it offers, their input and output schemas
memories/               what the agent knows about the browser tools
.gemini/ .claude/ .codex/   each CLI's project settings: the dev-browser MCP, the model, the permissions
hooks/                  Codex's stop hook: the response contract, when a schema is asked for
world/                  the world: pages, the loop, the image, how it is built (world/README.md)
compose.yaml            the agent and the world on any machine with Docker
Dockerfile              the agent image: Node and Gemini CLI, this folder mounted at /app
```

## Run it with Docker, nothing else

Docker Desktop (or Docker Engine on Linux) is the only install. The world and the CLI run in
containers; this folder is mounted into the agent's, so what you edit here is what the agent reads.

```sh
git clone https://github.com/Lowgular/linkedin-agent && cd linkedin-agent
cp .env.example .env               # put your Gemini API key in it: https://aistudio.google.com/apikey
docker compose run --rm agent      # Gemini CLI in this folder; the world starts first
```

The same three lines in a macOS terminal, a Linux shell or a PowerShell tab in VS Code. The first
run pulls the world image, about 1.3 GB, so do it before you need it. Then ask, as a person would:
"Open my profile and tell me how many followers I have" (2,863 in this world), "Who reacted to my
latest post?", "What did Inês Ferreira write in her About?". The agent must not change anything on
the account; the fake logs every click:

```sh
docker compose exec world cat /logs/agent/faker-clicks.jsonl
docker compose down                # stop the world; `-v` also forgets the CLI's sessions
```

The model is Gemini 3.8 Flash (`.gemini/settings.json`), billed per token on the key: a task is a
few cents, a few seconds a turn. Gemma, free on the same API, is capped at 16k input tokens a
minute, less than one turn of this agent, so it stalls on retries; `/model` in the CLI switches
models for a session.

If something does not come up: port 9333 on your machine must be free, since the MCP is reachable
only as `127.0.0.1:9333`; on Linux your user must be in the `docker` group; on Windows, Docker
Desktop needs WSL 2. `docker compose logs world` shows the world's three services starting.

## Trace it in Google Cloud

With a project in `.env` (`GOOGLE_CLOUD_PROJECT=`), the agent container exports every session to
that project: the prompt, each model request and each tool call as events in Cloud Logging (log
`gemini_cli`), the same as spans in Cloud Trace, token counts in Cloud Monitoring. It authenticates
with your Application Default Credentials, mounted read-only from gcloud's folder:

```sh
gcloud auth application-default login
gcloud services enable cloudtrace.googleapis.com logging.googleapis.com monitoring.googleapis.com --project <project>
```

Without a project in `.env` nothing leaves the machine.

## Run it with a CLI on this machine

Any CLI that speaks MCP works against the world alone:

```sh
docker compose up -d world         # the dev-browser MCP at http://127.0.0.1:9333/mcp
gemini                             # in this folder; or claude, codex, opencode
```

Each CLI's project settings in this folder already name the server, so there is nothing to
configure. Gemini CLI reads the brief through `GEMINI.md`, the others through `AGENTS.md` or
`CLAUDE.md`.

## Score it

The dataset `lowgular/linkedin-po` on Harbor Hub holds thirteen asks against this world, each
graded fact by fact; its source and the runners live in the `marek` repository
(`datasets/linkedin-po`, `evals/linkedin-po`). From there, with this repository checked out beside
it:

```sh
cd ../marek/evals/linkedin-po
./run.sh -h gemini-cli -v 0.2.1 -i lowgular/profile-followers    # one task
./run.sh -h gemini-cli -v 0.2.1                                   # all thirteen
```

`AGENT_DIR` names this folder when it is elsewhere. An `eval` service in `compose.yaml`, so the
scoring runs in Docker too, is the next step.

## Images

Two images, both under `ghcr.io/lowgular`, both built for linux/amd64 and linux/arm64:

- `linkedin-world:<version>`, the world (`world/image.sh --push`; the version is in `world/world.toml`),
  on the runtime image of `browser-use-faker`, the fake and the dev-browser service, which lives in
  `marek`;
- `linkedin-agent:<version>`, Gemini CLI (`docker compose build agent`); compose builds it locally
  when it is not pulled.
