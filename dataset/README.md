# linkedin-po dataset

Thirteen LinkedIn asks in plain language — open my profile, go to my posts, open this post — played
against one recorded, authored LinkedIn world, no live LinkedIn, and scored 0 to 1 fact by fact. The
source lives here, in `dataset/` of github.com/Lowgular/linkedin-agent; the releases live on Harbor Hub as `lowgular/linkedin-po`, one immutable revision
per version, tagged with the version from `dataset.toml`. The world is not part of the dataset: it is
`world/` beside this folder, published as a static site (`world/deploy.sh`) that every task's browser
fetches its pages from; its README says how it is made and published.

Each task is two things:

- **the ask**, `instruction.md`: the question alone, the way a person would put it, with a link
  only where a person would paste one — a post. Anything of the member's own — their profile,
  their posts — is named, never linked. Nothing else goes into the instruction: the browser is the
  task's MCP server, and who is signed in is the browser's to show (`/in/me/` opens their profile, as
  on LinkedIn). The answer is prose, as to the person asking: no answer format is asked;
- **the answer**, `tests/expected.json`: the facts a correct answer must contain — no more than the
  question asks for — as a careful reader of the world's pages would state them, built from the
  shapes in `shared/tests/shapes.json`: an account is a name, a link and a headline; a post is a link,
  its age, its opening words and its counts; a position is a title, a company with its link, from,
  to; and so on. An object carries the fields the question asks for, plus what identifies it (name
  or link, a post also its opening words): an answer that gives one of those identifies the thing.
  `"ordered": true` beside the answer makes its lists compare in order. One question per task.

The acceptance test for a task: could a person with the world's pages and the ask, and nothing
else, write `expected.json`? If a value is on no page, the task is wrong, not the agent.

```
dataset.toml                  the dataset's name and version — bump it when a change can move a score
tasks/<case>/                 what differs per case, and nothing else:
  instruction.md                the question
  tests/expected.json           the facts
shared/                       what every case gets, in the case's own layout, laid over it by the build:
  task.toml                     Harbor's manifest; {{currentFolder}} renders to the case's folder name
  environment/Dockerfile        FROM the browser runtime, by its tag, and the site the world is at
  tests/test.sh                 runs the grader
  tests/correctness.mjs         the grader: extraction into the facts' shape, comparison fact by fact
  tests/shapes.json             the vocabulary of the facts: account, profile, company, school, position, education, post;
                                the extractor's schema and the comparison are derived from it
check.sh                      probes the grader on every case: the facts score 1, altered or missing facts less
build.sh                      lays shared/ over every case into dist/, the dataset as Harbor runs it
publish.sh                    publishes what dist/ holds to Harbor Hub, tagged with its version
```

Harbor builds and grades each task from its own folder, so `build.sh` lays the shared files over
every case before anything runs or ships. The task image is the browser runtime and nothing more, its
fake proxying LinkedIn's names to the world's site; the build refuses when that image is neither built
on this machine nor pushed. Every shared file is a template: `{{name}}` is replaced from the build context — the
dataset's name and version, and `currentFolder` while a case is assembled — and a token with no
value fails the build. A case without facts is skipped with a note, and `publish.sh` refuses while a
case under `tasks/` is missing from `dist/`. `dist/` holds one build, the latest, and is ignored by
git.

To add a task: a folder under `tasks/` with the ask in `instruction.md` and the facts in
`tests/expected.json`, the facts read off the world's pages (the world's `world.json` for the
people and the reactions, the pages themselves for the rest) and written in the shapes of
`shared/tests/shapes.json`, with the fields the question asks for. Nothing else: the manifest, the
image and the grader come from `shared/` at build time. `./check.sh` then proves the grader scores
the facts 1, nothing found 0, and altered facts between; the extraction probes need the extractor's
login in the environment (`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`), `--offline` runs the
comparison probes alone. When the world changes, its image gets a new tag (the world's `world.toml`)
and `shared/environment/Dockerfile` is pointed at it.

```sh
./build.sh              # dist/, with a manifest whose digests match the assembled tasks
./check.sh --offline    # the comparison probes; without --offline, the extraction probes too
./publish.sh            # what dist/ holds, to Harbor Hub as lowgular/linkedin-po@<version>, private
```

The eval in this repository's compose runs the build in `dist/` when there is one, the Hub's otherwise
(`-v <version>` asks for a published one):

```sh
docker compose run --rm eval -i profile-followers    # this build, once ./build.sh made it
docker compose run --rm eval -v 0.2.1                # a published version
```

The build, the check and the publish are bash, for whoever maintains the dataset; nobody needs them
to run the eval. Publishing needs a Harbor Hub login (`harbor auth login`).

## Cases

Thirteen asks, each a short instruction in plain language and a question the world's loop answers —
my profile, my posts, the people who reacted, their profiles. All against the one world; the facts
are what its pages show.

| Where | Cases |
|---|---|
| my profile | followers; education; the first position in Experience; the latest post (age, text, reactions, comments); its impressions |
| all my posts | the posts of the last 7 days with reactions and impressions and their totals; the post with the most reactions and its impressions |
| one post | reactors by the post's opening words; reactors by its link; a post nobody reacted to; age, reactions, comments, reposts and impressions by link |
| the loop | the reactors' headlines from the dialog; one reactor's profile — name, headline, location, About |

## The environment

The agent is told nothing about where it is: the instruction is the question. The environment is a
browser and nothing more — linuxserver.io's Chromium, its CDP on 9222 — and the agent brings its own tools for it:
this repository's eval lays every trial out as its compose does (`eval/compose.yaml`: the same browser, `browser-mcp` as a service of its own, `main` the agent's image), attached to that CDP, and the CLI finds
it through the folder's settings, so the agent has a browser tool the way it has file tools. The browser is signed in; `https://www.linkedin.com/in/me/`
opens the member's own profile, as on LinkedIn. What the agent may and may not do with it is the
agent's own brief. The image holds the world, no agent and no CLI; Harbor installs the harness at trial
start. What the agent then sees, and how a click moves through the recording, is the world's
README: `../world/README.md`.

## Grading

The final message — read from the ATIF `trajectory.json` Harbor writes for every
harness — is prose: no format is asked of the agent. The grader reads it into the shape
of the task's facts and compares, fact by fact.

1. **Extraction.** Claude Haiku is made to call one tool, `answer`, whose input schema is
   derived from `tests/expected.json`: the same keys, every field nullable, each field
   described from `shapes.json`. A tiny prompt: fill it with what the message states,
   null for what it does not say, the members of a list as the message gives them as its answer,
   in the message's order, leaving out what it mentions only as context. Haiku extracts; it
   does not judge. Through the API when `ANTHROPIC_API_KEY` is set, else through the Claude
   Code CLI in the task image with `CLAUDE_CODE_OAUTH_TOKEN`; each `task.toml` passes both
   from the host into the container. A call costs well under a cent.
2. **Comparison**, in code, 1 or 0 per fact: numbers after thousands separators, strings
   after whitespace, quotes, dashes and case, dates with month names spelled or short and
   `Present` as now or current, a post's age in LinkedIn's form or spelled out (`6d`, `6
   days ago`), a quoted text when its opening matches, a linked thing when its name or its
   link matches — one fact for the identity, unless the question itself names the thing —
   and a list by its members: one fact per member, plus one for having exactly those
   members, in order when the task's `expected.json` says `"ordered": true`.
3. **The score** is the mean, every fact weighing the same; `reward.txt` holds it, 0 to 1.

The answer is all that is graded. How the agent got there — its tool calls, its turns, what it
clicked — is in the trial's `trajectory.json`, for reading, not for the score.

The answer, what was extracted from it and every fact with what it got are kept in the
trial's `verifier/result.json`. `check.sh` probes the comparison offline on every task —
the facts score 1, without links 1, nothing found 0, every value altered below 1, a list one
member wider below 1, loosely phrased 1 — and, given the extractor's login, that the facts
as a message extract to 1 and a message that found nothing to 0.

## Versions

Publishes are permanent and content-addressed: a changed task is a new revision,
tags move, nothing is deleted. Patch for wording that changes no score, minor for
added cases, major for changed grading or expectations. A leaderboard is created
per version once that version is stable.

- 0.0.x spoke the agent's own contract: an operations call in, an envelope out, the
  route graded by required calls and refs.
- 0.1.0 is a question as a person would ask it, an answer in prose graded pass or fail
  by a judge against the facts; one recorded world per task, keyed by URL; writes
  recorded instead of routes graded.
- 0.2.0 is one authored world (`world/` in linkedin-agent, built into an image every task is FROM)
  and thirteen instruction-driven asks on its loop: my profile, my posts, one post, who
  reacted and who they are; the facts in shapes (`shared/tests/shapes.json`); the grade a
  score 0 to 1, the mean over the facts, each extracted from the answer by Haiku and
  compared in code.
- 0.2.1 is the same thirteen asks on world image 0.3.2: the pages with LinkedIn's member and
  company identifiers scrubbed. No fact changed. The grade is the answer alone: the click log no
  longer zeroes a score. Gemini can be the extractor.
- 0.2.2 is the same thirteen asks and facts on world 0.3.3, now a site the runtime
  `dev-browser` 0.3.0 proxies to rather than an image, no MCP server in the task (the agent brings
  `browser-mcp`), with the instruction the question
  alone: no environment paragraph, the MCP server named `browser-mcp`, the member's profile found
  through `/in/me/`.
- 0.2.3 is the same thirteen asks and facts on linuxserver.io's Chromium rather than `dev-browser`: the
  environment declares the world's address map (`BROWSER_MCP_MAP_HOSTS`) and the agent's browser tools,
  uploaded beside the agent folder, answer LinkedIn's address from the world's site; no proxy, no click log.
