# The world

A small slice of LinkedIn, recorded from the live site and then authored, that this agent runs
against and the `lowgular/linkedin-po` dataset plays: my profile, my posts, the people who reacted
to them and their profiles. Nothing in it is a real person: every name, headline, post and
identifier is invented or replaced. It ships as a Docker image, `ghcr.io/lowgular/linkedin-world:<version>`
(`world.toml`), that every task of the dataset is FROM: `browser-use-faker`'s runtime image with
`world/` at `/opt/world`.

```
world.toml      the image's name and version, and the runtime image it is built on — bump the version when world/ changes
world/          the pages, as browser-use-faker serves them: one DOM state per page and per click, keyed by URL
world.json      the loop the world is authored for: four invented people, and for every post who reacted, its age, its impressions
templates/      what compose.mjs composes from, harvested once from the recording and committed
compose.mjs     rewrites the world from world.json: counts, dialogs and facepiles on every page a post is seen on, a profile per person
walk.mjs        walks the loop against a served world and says what holds
Dockerfile      the image: the runtime world.toml names, plus world/ at /opt/world
image.sh        builds the image, --push builds it for both architectures and pushes it
run.sh          runs the image here without compose: the dev-browser MCP at http://127.0.0.1:9333/mcp
```

The recording, the scrub that anonymizes it and the map from the people recorded to the people
invented are not here: they live in `worlds/linkedin-po` of the private `marek` repository, whose
import writes into this folder. What is here is the result, and the tools that compose and check it.

## Running it

```sh
docker compose up -d world    # from the repository root; or, here, ./run.sh
./run.sh clicks               # what the agent clicked so far, by accessible name
docker compose down
```

The container starts three things: the fake serving `world/` over HTTPS under LinkedIn's own host
names, a headless Chromium whose resolver maps those names to the fake, and the real dev-browser
service attached to that Chromium. An agent opens `https://www.linkedin.com/…` through the MCP and
sees the recorded page, with the accessibility tree the live page had; a click the recording holds
moves to the recorded next state, a click it does not hold does nothing and is logged, a page that
was never walked is answered "Not recorded". The MCP inside binds loopback and checks the Host
header; the entrypoint relays it to the container's other interfaces, so the host maps 9333 onto
9333 and nothing else: another host port fails the Host check.

## The loop

`world.json` names four invented people and, for each of the seven posts, which of them reacted
(none, for two of the posts); `compose.mjs` makes the world say so everywhere. On my profile's
Activity cards, on the Activity page's cards and on each post's own page the reactions link shows
that count and opens a dialog listing those people, one dialog state per post per page; Dismiss
leads back; a post nobody reacted to has no reactions link and an empty facepile. Every row and
every facepile avatar leads to that person's profile page: a name, a headline, a location and an
About, composed from a recorded profile with every other section removed. A post's age (`6d`, `1w`)
and impressions are set from `world.json` too, so every page agrees. The parts composed from are
harvested once into `templates/`.

In the accessibility tree a reactions link has no name of its own: the agent sees `link` with a
child `generic "2 reactions"`, the count also as the Like button's text beside it. That is how the
live page reads too.

To change who reacted, or a post's age or impressions, edit `world.json` and run `node compose.mjs`;
to add a person, add them to `world.json` with a name, a headline, a location, a connections count
and an About. The composed dialog and profile states are marked `synth` and remade on every run.
Then prove the loop holds, inside the container `run.sh` started, since its services bind loopback:

```sh
docker cp walk.mjs linkedin-world:/tmp/ && docker cp world.json linkedin-world:/tmp/
docker exec linkedin-world node /tmp/walk.mjs --cdp http://127.0.0.1:9222 --base https://www.linkedin.com
```

## The image

```sh
./image.sh            # ghcr.io/lowgular/linkedin-world:<version>, for this machine's architecture
./image.sh --push     # for linux/amd64 and linux/arm64, pushed under one tag, so it runs anywhere
```

When `world/` changes: bump the version in `world.toml`, `./image.sh --push`, then point the
dataset's `shared/environment/Dockerfile` (marek, `datasets/linkedin-po`) at the new tag and
republish the dataset. Images are never moved: a tag names one world for good. Pulling needs no
login once the package is public on GHCR; pushing needs a GitHub token with `write:packages`
(`docker login ghcr.io`).

## Versions

- 0.3.2: the same pages on runtime `browser-use-faker` 0.2.2, whose entrypoint relays the MCP to the
  container's interfaces, so `-p 127.0.0.1:9333:9333` is all a host needs; built for linux/amd64 and
  linux/arm64. Dockerfile in this folder.
- 0.3.1: the same pages with LinkedIn's member and company identifiers scrubbed: profile URNs,
  numeric member ids and ad pixel company ids replaced by invented ones, slugs replaced where they
  were glued into element ids. No fact changed. Runtime `browser-use-faker` 0.2.1.
- 0.3.0: the loop as above: four people, seven posts, reactor counts 0 to 4, ages and impressions
  normalized across pages. Runtime `browser-use-faker` 0.2.1.
