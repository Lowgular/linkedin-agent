# Dockerfile — the agent image: Node and Gemini CLI, nothing else. compose.yaml runs it with this folder
# mounted at /app, so the CLI starts in the agent folder and reads its brief, wiki and settings from the
# checkout, where you edit them. The key comes from .env; the auth method is chosen here once, so the CLI
# never asks, and /app is trusted, since the CLI disables a folder's MCP servers until its folder is. The CLI's
# self-update is off: the version is the one pinned here, and a fresh container would otherwise update every run. Published as ghcr.io/lowgular/linkedin-agent for anyone who prefers a pull to a build.
FROM node:24-slim
LABEL org.opencontainers.image.source="https://github.com/Lowgular/linkedin-agent" \
      org.opencontainers.image.description="Gemini CLI for the linkedin-agent folder, mounted at /app"
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && npm install -g @google/gemini-cli@0.67.0 \
 && mkdir -p /root/.gemini \
 && echo '{"security":{"auth":{"selectedType":"gemini-api-key"},"folderTrust":{"enabled":false}},"general":{"disableAutoUpdate":true,"disableUpdateNag":true}}' > /root/.gemini/settings.json \
 && echo '{"/app":"TRUST_FOLDER"}' > /root/.gemini/trustedFolders.json
WORKDIR /app
CMD ["gemini"]
