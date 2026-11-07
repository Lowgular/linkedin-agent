# linkedin-agent

A browser agent for LinkedIn, and the world it is built against. The agent is a folder a coding
CLI starts in: Gemini CLI, Claude Code, Codex or OpenCode read the brief (`AGENTS.md`, with
`GEMINI.md` and `CLAUDE.md` pointing at it), the wiki of pages and procedures under `pages/`, and
reach the browser through one MCP server, dev-browser. The world (`world/`) is a recorded, authored
LinkedIn served as a fake behind the real dev-browser, in a Docker image, so the agent is developed
and scored without touching a live account.

```
AGENTS.md               the brief; GEMINI.md and CLAUDE.md are links to it
pages/                  the wiki: one page document per LinkedIn page, the procedures it offers, their input and output schemas
memories/               what the agent knows about the browser tools
.gemini/ .claude/ .codex/   each CLI's project settings: the dev-browser MCP, the model, the permissions
hooks/                  Codex's stop hook: the response contract, when a schema is asked for
world/                  the world: pages, the loop, the image, how to run it (world/README.md)
```

## Run it

```sh
world/run.sh                       # the world in Docker, the MCP at http://127.0.0.1:9333/mcp
gemini                             # in this folder; or claude, codex, opencode
```

Then ask, as a person would: "How many followers does my profile have?" (2,863 in this world),
"Who reacted to my latest post?", "What did Inês Ferreira write in her About?". The agent must
not change anything on the account; `world/run.sh clicks` shows every click it made.

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

`AGENT_DIR` names this folder when it is elsewhere.
