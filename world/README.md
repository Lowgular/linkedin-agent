# The world

A small slice of LinkedIn, recorded from the live site and then authored, that this agent runs
against and the `lowgular/linkedin-po` dataset plays: my profile, my posts, the people who reacted
to them and their profiles. Nothing in it is a real person: every name, headline, post and
identifier is invented or replaced. It is published as a static site on Firebase Hosting
(`world.toml` names it), and the agent's browser tools answer LinkedIn's address from there, in the
browser's connection, so whatever browser runs sees it under LinkedIn's own name.

```
world.toml      the world's version, the runtime image, and the Firebase site it is published at
world/          the pages, as the fake serves them: one DOM state per page and per click, keyed by URL
world.json      the loop the world is authored for: four invented people, and for every post who reacted, its age, its impressions
templates/      what compose.mjs composes from, harvested once from the recording and committed
compose.mjs     rewrites the world from world.json: counts, dialogs and facepiles on every page a post is seen on, a profile per person
walk.mjs        walks the loop against a served world and says what holds
deploy.sh       exports world/ as a static site (site/, ignored) with the runtime image and deploys it to Firebase
```

On disk the characters Windows cannot hold in a file name are percent-encoded: a post's folder is
`urn%3Ali%3Aactivity%3A…`, its address `urn:li:activity:…`.

The recording, the scrub that anonymizes it and the map from the people recorded to the people
invented are not here: they live in `worlds/linkedin-po` of the private `marek` repository, whose
import writes into this folder. What is here is the result, and the tools that compose and check it.

## How it is served

```
any browser over CDP (compose's Chromium, a dataset task's, Steel's cloud); browser-mcp attaches to it
   BROWSER_MCP_MAP_HOSTS=www.linkedin.com=<site>: every request to www.linkedin.com fetched from the site
        │  www.linkedin.com/<path>  →  <site>/<path>;   another recorded host, as the pages address it, under
        │  www.linkedin.com/__h/<host>/<path>  →  <site>/__h/<host>/<path>
        ▼
Firebase Hosting: a shell per page, its states as JSON, the assets; the shell rebuilds the state in the browser
```

An agent opens `https://www.linkedin.com/…` through the MCP and sees the recorded page, with the
accessibility tree the live page had; a click the recording holds moves to the recorded next state, a
click it does not hold does nothing; a page that was never walked is answered "Not recorded". `/in/me/`
redirects to the signed-in member's profile, as on LinkedIn. The site has no index of what is recorded: every
path of it is reachable from the agent's browser as LinkedIn, so a list would hand the agent the pages instead of
letting it find them (`world/` is the list). In compose, http://localhost:3000 shows the browser the agent clicks in.

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
Then deploy (below) and prove the loop holds, against a browser's CDP — a Chrome of your own started
with `--remote-debugging-port=9222`, opened on the site's own address:

```sh
(cd mcp/browser-mcp && npm install)     # walk.mjs drives the browser with the playwright-core installed there
node world/walk.mjs --cdp http://localhost:9222 --base https://linkedin-stub.web.app
```

## Publishing it

```sh
./deploy.sh --dry-run   # site/public: what would be deployed
./deploy.sh             # exported and deployed to the Firebase site world.toml names
```

The export runs in the runtime image, so it needs Docker only; the deploy needs Node for `npx
firebase-tools` and a Firebase login once (`npx firebase-tools login`). When `world/` changes: bump the
version in `world.toml` and deploy. The site holds one world, the latest: the dataset's tasks fetch
whatever is deployed, so a change that moves a fact needs the dataset's expectations changed with it.
The pages carry `noindex` and the site's root says it is a test fixture.

## Versions

- (export) every recorded host but a page's own is addressed under the site's `/__h/<host>`, so one
  address map — the site's own host — is all a browser needs; needs a deploy to go live.
- 0.3.3: `/in/me/` redirects to the signed-in member's profile, as on LinkedIn, so an agent finds
  "my profile" without being told its address. Published as a static site instead of an image; the
  `dev-browser` 0.3.0 proxies to it. Folder names percent-encoded for Windows.
- 0.3.2: the same pages on runtime `browser-use-faker` 0.2.2, whose entrypoint relays the MCP to the
  container's interfaces, so `-p 127.0.0.1:9333:9333` is all a host needs; built for linux/amd64 and
  linux/arm64. Dockerfile in this folder.
- 0.3.1: the same pages with LinkedIn's member and company identifiers scrubbed: profile URNs,
  numeric member ids and ad pixel company ids replaced by invented ones, slugs replaced where they
  were glued into element ids. No fact changed. Runtime `browser-use-faker` 0.2.1.
- 0.3.0: the loop as above: four people, seven posts, reactor counts 0 to 4, ages and impressions
  normalized across pages. Runtime `browser-use-faker` 0.2.1.
