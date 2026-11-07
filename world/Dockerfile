# world/Dockerfile — the world image: the runtime (world.toml names it; image.sh passes it in) with world/
# at /opt/world. The runtime's entrypoint starts the fake serving /opt/world under LinkedIn's names, a headless
# Chromium resolving those names to it, and the dev-browser MCP on 9333, relayed to the container's other
# interfaces so `-p 127.0.0.1:9333:9333` reaches it from the host. Built for linux/amd64 and linux/arm64.
ARG RUNTIME=ghcr.io/lowgular/browser-use-faker:0.2.2
FROM ${RUNTIME}
LABEL org.opencontainers.image.source="https://github.com/Lowgular/linkedin-agent" \
      org.opencontainers.image.description="A recorded, authored LinkedIn behind the dev-browser MCP, for the linkedin-agent and the lowgular/linkedin-po dataset"
COPY world/ /opt/world/
EXPOSE 9333
