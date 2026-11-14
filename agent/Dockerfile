# Dockerfile — the agent image: Antigravity CLI (agy), nothing else. compose.yaml runs it with this folder mounted
# at /app, so the CLI starts in the agent folder and reads its brief, wiki and settings from the checkout, where
# you edit them; its browser tools are their own service (mcp/browser-mcp), at 127.0.0.1:9333 as
# .agents/mcp_config.json says. The key comes from .env. The CLI keeps its settings in its home, not in the
# folder, so the entrypoint copies .agents/settings.json there on every start: it chooses the Gemini API key as
# the login, so the CLI never asks, trusts /app, names the model (by its label, as /model saves it: a slug is
# ignored) and says which tools the agent may not use. mcp_config.json is copied to the home as well: from the
# folder alone an interactive session gives the browser tools to a subagent only, not to the agent itself.
# In an eval trial /app starts empty and Harbor writes the settings itself, so a missing file is not an error.
# The CLI is the installer's current release, a single binary; its self-update is off, so a container runs the
# version its image was built with.
# Gemini CLI, which this image held before, is deprecated: Dockerfile.gemini-cli, the gemini-cli profile in compose.
FROM debian:stable-slim
LABEL org.opencontainers.image.source="https://github.com/Lowgular/linkedin-agent" \
      org.opencontainers.image.description="Antigravity CLI for the linkedin-agent folder, mounted at /app"
ENV AGY_CLI_DISABLE_AUTO_UPDATE=true
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir /usr/local/bin \
 && agy --version
WORKDIR /app
ENTRYPOINT ["sh", "-c", "mkdir -p /root/.gemini/antigravity-cli /root/.gemini/config; cp .agents/settings.json /root/.gemini/antigravity-cli/ 2>/dev/null; cp .agents/mcp_config.json /root/.gemini/config/ 2>/dev/null; exec \"$@\"", "--"]
CMD ["agy"]
