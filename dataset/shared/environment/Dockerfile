# dataset/shared/environment — the task image, laid into every task by build.sh: dev-browser, a Chromium with
# its CDP on 9222 whose proxy fetches LinkedIn's names from the world's site (world/world.toml names it); the
# agent brings its own browser tools. compose builds the image from dev-browser/ in github.com/Lowgular/linkedin-agent;
# the build fails when it is neither built on this machine nor pushed.
FROM ghcr.io/lowgular/dev-browser:0.3.0
ENV WORLD_URL=https://linkedin-stub.web.app
