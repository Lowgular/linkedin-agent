# Linked in PO

- [x] run luna by default, read-only sandbox and auto-approval — `.codex/config.toml` in this folder (project config)
- [x] trim inherited tools — `[features] plugins = false` removes the bundled plugins (computer-use, chrome, browser, documents, …); `dev-browser` MCP still loads from `~/.codex/config.toml`
- skills stay as inherited from `~/.codex` (a full folder-only scoping via `CODEX_HOME` was tried and rolled back; the 4 binary-bundled system skills cannot be turned off in CLI ≤ 0.164.0 anyway)
- [x] remove unnecessary tools (computer use and other inherited)
  - keep only: reading files (questionnable) and the browser mcp (main reason)
  - done via `[features] plugins = false` in project config — one master switch disables ALL bundled plugins (computer-use, chrome, browser, documents, pdf, spreadsheets, presentations, template-creator, visualize, codex-app-tools, node_repl/computer-use bridge); `[mcp_servers.*]` (dev-browser, mailerlite) are not plugins and stay; `view_image` (read-only) remains
  - note: `codex debug prompt-input` (run inside the folder) verifies what the model actually sees
- [x] config to always allow tools from mcp
- [x] wikify procedures
- [x] guardrail schemas
- add nested evals
- explicit codex build step
- build against claude / opencode / gemini
- build marek's MCP (later)
