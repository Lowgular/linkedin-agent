# dataset/shared/environment — the task image, laid into every task by build.sh: linuxserver.io's Chromium
# (github.com/linuxserver/docker-chromium), a real Chromium with its CDP on 9222, and Node for the agent's tools
# and the grader. Harbor keeps the image's init as the entrypoint, so the browser starts under its command.
# The browser tools are told where the browser is (BROWSER_MCP_CDP). The world: BROWSER_MCP_MAP_HOSTS answers LinkedIn's address from the world's site (world/world.toml names it),
# in the browser's connection, for the browser tools the harness starts here; the environment declares it, the
# tools honour it. Shared memory is Docker's default in a trial, so Chromium is told not to rely on it.
FROM lscr.io/linuxserver/chromium@sha256:59d1bfa98a6ab759fce078e5a714de3920f4c618b8939a0df6e1dec7d25c7aba
COPY --from=node:24-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
# The CLI starts where the harness uploads the agent folder, so the folder's own settings apply; the image's
# own working directory is /, where they would not.
RUN mkdir -p /app
WORKDIR /app
ENV PUID=1000 PGID=1000 \
    CHROME_CLI="--remote-debugging-port=9222 --remote-allow-origins=* --disable-dev-shm-usage" \
    BROWSER_MCP_CDP=http://127.0.0.1:9222 \
    BROWSER_MCP_MAP_HOSTS=www.linkedin.com=https://linkedin-stub.web.app
