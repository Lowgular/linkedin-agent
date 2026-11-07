# browser-mcp

The agent's browser tools: an MCP server over Streamable HTTP that drives any browser speaking CDP —
sessions, tabs, accessibility captures and actions, nothing site-specific. It belongs to the agent: the
wiki (`../pages`) and `../memories/browser.md` are written against these tools. The browser is not: it is
the environment's, reached by its CDP address, so the same tools work on the `dev-browser` container,
a Chrome on your own machine, or a cloud browser that hands out a CDP endpoint.

```sh
npm install
BROWSER_MCP_CDP=http://127.0.0.1:9222 npm start      # the MCP at http://127.0.0.1:9333/mcp, health at /health
```

In compose the agent's container starts it (`../Dockerfile`, `../agent.sh`); in the eval the harness
starts it in the trial's container from the folder it uploads. Either way it attaches to the
`dev-browser` container's CDP at `127.0.0.1:9222`.

| variable | default | |
|---|---|---|
| `BROWSER_MCP_CDP` | `http://127.0.0.1:9222` | the browser to attach to: an `http(s)` CDP address, or a `ws(s)` one a cloud browser gives |
| `BROWSER_MCP_PORT` | `9333` | where the MCP listens, on loopback only |
| `BROWSER_MCP_STATE_FILE` | `.runtime/state.json` | the sessions and tabs, kept across restarts; it records the CDP address and refuses another, so one file per browser |
| `BROWSER_MCP_HOOKS_BEFORE_NAVIGATION` | | a module whose default export gets `{ url, run }` and returns the address to open |
| `BROWSER_MCP_HOOKS_AFTER_NAVIGATION` | | a module awaited with `{ page, url }` once a page has loaded |
| `BROWSER_MCP_HOOKS_AFTER_ACTION` | | a module awaited with `{ page, action, target }` after a click, fill, type, key press or pick |

The service answers only `127.0.0.1` and `localhost` by Host, and refuses any request with an Origin,
so a web page cannot reach it. `npm test` runs the integration test against a Chromium:
`BROWSER_MCP_TEST_CHROME` names its binary.
