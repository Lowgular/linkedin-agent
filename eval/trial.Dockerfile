# eval/trial.Dockerfile — a trial's `main`: the agent's image as published, not built again from agent/. Harbor
# always builds `main` (eval/compose.yaml points it here), and a build from agent/ would install whatever
# Antigravity CLI is current that day; this one line keeps every trial on the version the image was published
# with. A local build of the agent image under the same tag (docker compose build agent) is what it takes then.
FROM ghcr.io/lowgular/linkedin-agent:0.2.0
