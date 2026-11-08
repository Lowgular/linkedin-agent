# linkedin-agent

A browser agent for LinkedIn, built the way an agent should be built: against a world you can replay,
scored fact by fact, traced turn by turn. The agent is a folder that a coding CLI starts in. Gemini CLI
reads the brief in `AGENTS.md` and the wiki under `pages/`, and drives a browser through its own MCP server,
`browser-mcp/`, which attaches to any browser over CDP. The browser, `dev-browser`, runs in Docker. It does not open the real LinkedIn: it opens `world/`, a recorded and authored
LinkedIn served as a fake, in a Docker container. Nothing in it is a real person, and nothing the agent
clicks reaches a real account.

Everything runs in Docker. You need nothing else on your machine: no Node, no Python, no bash.

## Before you start

1. **Docker.** [Docker Desktop](https://www.docker.com/products/docker-desktop/) on macOS or Windows,
   Docker Engine on Linux. On Windows, Docker Desktop needs WSL 2, which its installer offers to set up.
   On Linux, your user must be in the `docker` group (`sudo usermod -aG docker $USER`, then log in
   again).
2. **A Gemini API key.** Get one at https://aistudio.google.com/apikey. The agent runs on Gemini 3.8
   Flash and is billed per token: one question costs a few cents.
3. **Time for the first build.** The first run downloads the browser image, about 1.3 GB. Do it before
   the workshop, not on the venue's network.

## Set up

The same commands work in a macOS or Linux terminal and in PowerShell, including the terminal inside
VS Code or IntelliJ.

```sh
git clone https://github.com/Lowgular/linkedin-agent
cd linkedin-agent
cp .env.example .env
```

Open `.env` and put your key after `GEMINI_API_KEY=`. Then build everything once:

```sh
docker compose --profile eval build
```

This builds two images from this folder, the agent (Gemini CLI and its browser tools, `browser-mcp`) and
the eval, and pulls one from GitHub's registry: `dev-browser`, the browser. The world itself is not on your machine: the
browser fetches its pages from the site it is published at (`world/README.md`), so the agent needs the
internet, as Gemini does anyway.

## Talk to the agent

```sh
docker compose run --rm agent
```

The browser starts first, then Gemini CLI opens in this folder. Ask what a person would ask:

- How many followers does my profile have?
- Who reacted to my latest post?
- What does Inês Ferreira write about herself?

The agent reads its wiki, opens the pages, and answers. Your folder is mounted into the container, so when
you change `AGENTS.md` or a page in `pages/`, the next session reads the change. `/quit` leaves the CLI.

To see what the agent clicked:

```sh
docker compose exec dev-browser cat /logs/agent/faker-clicks.jsonl
```

To see the world yourself, while the browser runs (`docker compose up -d dev-browser` starts it alone):

- **https://localhost:4443/__world/** lists every recorded page; click through them as you would on LinkedIn.
  The certificate is self-signed: accept it once (Advanced, then Proceed).
- **The agent's own browser, live:** open `chrome://inspect` in Chrome, click Configure..., add
  `localhost:9224`, and click "inspect" under the page that appears. You watch the page while the agent
  clicks through it.

When you are done, `docker compose down` stops the browser.

### Another browser: Steel's cloud

The agent's tools attach to any browser over CDP, so the same agent runs on a browser in
[Steel](https://steel.dev)'s cloud too, where you watch its sessions live and replay them. With a Steel
account (new ones come with free credit), add to `.env`:

```
BROWSER_CDP=steel
STEEL_API_KEY=<your key>
# STEEL_PROFILE=<a profile id>    optional: every session starts from that browser profile
```

`docker compose run --rm agent` then browses through Steel: browser-mcp opens a Steel session on the
first browser step and writes the session's page in Steel's dashboard to its log (`docker compose exec
agent cat /tmp/browser-mcp.log`); every session is listed there as well. The browser is Steel's, the world
is still the world: compose tells browser-mcp to answer `www.linkedin.com` from the world's site
(`BROWSER_MCP_MAP_HOSTS`), in the browser's connection, so the agent still opens `www.linkedin.com`. A session ends after 15 minutes (`STEEL_SESSION_TIMEOUT`, in ms) or when
the agent exits, and costs Steel's per-minute price meanwhile. Remove the two lines to go back to
dev-browser.

## Score it

The dataset `lowgular/linkedin-po` on Harbor Hub holds thirteen questions against this world, each with
the facts a correct answer must contain. Harbor asks the agent each question in a fresh copy of the world,
then a grader reads the answer and compares it fact by fact. A task scores between 0 and 1.

```sh
docker compose run --rm eval -i profile-followers    # one task
docker compose run --rm eval                         # all thirteen, a few minutes, under a złoty or two
docker compose run --rm eval-results                 # the latest runs and their scores
```

Options:

| Flag | Does |
|---|---|
| `-i <task>` | runs one task; repeat it for several |
| `-m flash-lite` | runs the agent on Gemini 3.5 Flash-Lite, cheaper and weaker |
| `-x gemini` | grades with Gemini instead of Claude Haiku |
| `-v <version>` | runs a specific version of the dataset |

The grader reads each answer with a small model that only extracts what the answer says; code does the
comparison. It is Claude Haiku when `.env` has a Claude key (`ANTHROPIC_API_KEY` or
`CLAUDE_CODE_OAUTH_TOKEN`), and Gemini Flash-Lite on your Gemini key otherwise. With only a Gemini key you
need no flag.

The trial files, including every answer and every grade, stay in the Docker volume `linkedin-agent-jobs`.

## Trace it in Google Cloud

Optional, for whoever wants to see the agent's runs as waterfalls. Put a Google Cloud project in `.env`
and turn on the trace profile:

```
GOOGLE_CLOUD_PROJECT=<your project>
COMPOSE_PROFILES=trace
```

Then log in once and enable three APIs on that project:

```sh
gcloud auth application-default login
gcloud services enable cloudtrace.googleapis.com logging.googleapis.com monitoring.googleapis.com --project <your project>
```

`docker compose up -d` now also starts an OpenTelemetry collector, which ships every session to your
project. Each conversation is one trace in Cloud Trace: every model call and every tool call, in order,
with its duration. Open https://console.cloud.google.com/traces/explorer?project=<your project>. A
session's id from the CLI, without its dashes, is its trace id. Without a project in `.env`, nothing
leaves your machine.

## If something does not work

- **The agent cannot reach the browser.** `docker compose logs dev-browser` shows the browser and the fake
  starting; ports 9224 and 4443 on your machine must be free.
- **Pages say "did not answer" or stay empty.** The browser cannot reach the world's site: check the
  internet connection, and `WORLD_URL` in `.env` if you set it.
- **The first build fails pulling `dev-browser`.** The browser image is not reachable from your
  network or not public yet. Tell the presenter.
- **The eval says the dataset is not on Harbor Hub.** The version you asked for is not published, or not
  public.
- **Every task scores 0 but the answers look right.** The grader has no key: check `.env`.
- **Linux: permission denied on the Docker socket.** Your user is not in the `docker` group yet.

## What is in this folder

```
AGENTS.md               the brief; Gemini CLI reads it through .gemini/settings.json, Codex by name,
                        Claude Code through the CLAUDE.md link (GEMINI.md is a link too, for older setups)
pages/                  the wiki: one document per LinkedIn page, the procedures it offers, their schemas
memories/               what the agent knows about the browser tools
browser-mcp/            the browser tools: an MCP server over any browser's CDP (browser-mcp/README.md)
.gemini/                Gemini CLI's settings for this folder: the browser MCP server, the tools the agent may not use, the model
.claude/ .codex/        the same for Claude Code and Codex
world/                  the world: its pages, the loop it is authored for, its deploy to Firebase (world/README.md)
dataset/                the eval's questions and facts, the source of lowgular/linkedin-po (dataset/README.md)
eval/                   the eval image: Harbor, the harness that uploads this folder, the runner
telemetry/              the OpenTelemetry collector for Cloud Trace
compose.yaml            the browser, the agent, the eval, the collector
Dockerfile              the agent image: Node and Gemini CLI
.env.example            the keys, copied to .env, which git ignores
```

Any CLI installed on your own machine works against the world too, with Node: `docker compose up -d
dev-browser` starts the browser alone, `BROWSER_MCP_CDP=http://localhost:9224 npm start` in `browser-mcp/`
(after `npm install`) starts the tools, and `gemini`, `claude`, `codex` or `opencode` in this folder find them
at `127.0.0.1:9333` through their settings here. The same tools attach to a Chrome of your own, or to a cloud
browser's CDP address.
