# browser-mcp

The agent's browser tools: an MCP server over Streamable HTTP that drives any browser speaking CDP —
sessions, tabs, accessibility captures and actions, nothing site-specific. It belongs to the agent: the
wiki (`../pages`) and `../memories/browser.md` are written against these tools. The browser is not: it is
the environment's, reached by its CDP address, so the same tools work on a Chromium in a container,
a Chrome on your own machine, or a cloud browser that hands out a CDP endpoint.

```sh
npm install
BROWSER_MCP_CDP=http://127.0.0.1:9222 npm start      # the MCP at http://127.0.0.1:9333/mcp, health at /health
```

`npm run dev` restarts it on every edit (`node --watch`). In the repository's compose it is a service of its
own, `browser-mcp`, built from this folder (`Dockerfile`) and run with the folder mounted and watched, so an
edit here is live on the next tool call; in the eval the harness uploads this folder to the trial's container
and starts it there (`start.sh`). Either way it attaches to the browser's CDP at `127.0.0.1:9222`,
the browser's container sharing its network.

| variable | default | |
|---|---|---|
| `BROWSER_MCP_CDP` | required | the browser to attach to, no default — health and the log say which: Chrome's `http(s)` CDP address, a `ws(s)` endpoint a browser service gives, or a session API, an address ending in `/v1/sessions` (Steel's cloud: `https://api.steel.dev/v1/sessions`, or a self-hosted Steel), where a session is opened on the first browser step |
| `STEEL_API_KEY` | | with a session API, the account's key (`steel-api-key`); never shown to the agent |
| `BROWSER_MCP_PROFILE` | | with a session API, a profile id of the account to start each session from; the session does not save back to it. A browser attached by its CDP address has the profile it was started with |
| `STEEL_SESSION_TIMEOUT` | `900000` | with a session API, how long a session lives, in ms; the plan caps it |
| `BROWSER_MCP_PORT` | `9333` | where the MCP listens |
| `BROWSER_MCP_HOST` | `127.0.0.1` | the address it listens on; `0.0.0.0` in a container whose port is published (the Host check still admits only localhost) |
| `BROWSER_MCP_STATE_FILE` | `.runtime/<the CDP address>.json` | the sessions and tabs, kept across restarts, one file per browser: a file records its CDP address and refuses another |
| `BROWSER_MCP_MAP_HOSTS` | | `host=base`, comma-separated: every request to the host answered from the same path under the base (`mapHosts`, below) |
| `BROWSER_MCP_HOOKS_ON_CONNECT` | | a module awaited with `{ browser, context, mapHosts }` each time the service attaches to the browser |
| `BROWSER_MCP_HOOKS_BEFORE_NAVIGATION` | | a module whose default export gets `{ url, run }` and returns the address to open |
| `BROWSER_MCP_HOOKS_AFTER_NAVIGATION` | | a module awaited with `{ page, url }` once a page has loaded |
| `BROWSER_MCP_HOOKS_AFTER_ACTION` | | a module awaited with `{ page, action, target }` after a click, fill, type, key press or pick |

A hook is how a setup puts itself around the tools without them knowing it. `mapHosts(context, { host:
base })` — what `BROWSER_MCP_MAP_HOSTS` sets up, and handed to the on-connect hook for anything more — answers every request to a host from the same path under the base, so
the page keeps the host's address on any browser, a cloud one too; a redirect to a base comes back as its host.

The service answers only `127.0.0.1` and `localhost` by Host, and refuses any request with an Origin,
so a web page cannot reach it. `npm test` runs the integration test against a Chromium:
`BROWSER_MCP_TEST_CHROME` names its binary.
