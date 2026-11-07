# dev-browser — the environment's browser: Playwright's headless Chromium with its CDP on 9222, and nothing for
# the agent: the agent brings its own tools (browser-mcp) and attaches over CDP. With WORLD_URL set, the browser
# resolves the world's hosts (LinkedIn's names) to a small proxy that fetches every page from the site the world
# is published at (world/deploy.sh), so the agent browses www.linkedin.com and gets the world. compose builds
# it from this folder; the dataset's tasks are FROM the same tag.
FROM mcr.microsoft.com/playwright:v1.64.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY proxy.mjs start.sh /opt/dev-browser/
RUN chmod +x /opt/dev-browser/start.sh && mkdir -p /app /logs/agent
WORKDIR /app
EXPOSE 9222 4443
ENTRYPOINT ["/opt/dev-browser/start.sh"]
CMD ["tail", "-f", "/dev/null"]
