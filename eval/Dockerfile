# eval/Dockerfile — the eval image: Python, Harbor, the harnesses that upload the agent folder (each trial laid
# out by eval/compose.yaml, read from the repository mounted at /app), and the
# Docker CLI with compose, through which Harbor starts each task's container on the host's Docker.
# compose.yaml runs it as the `eval` service; nothing but Docker is needed on the host.
FROM python:3.13-slim
LABEL org.opencontainers.image.source="https://github.com/Lowgular/linkedin-agent" \
      org.opencontainers.image.description="Harbor and the linkedin-agent harnesses, scoring the agent on lowgular/linkedin-po"
COPY --from=docker:28.5.1-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:28.5.1-cli /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
COPY pyproject.toml /opt/eval/
COPY linkedin_eval/ /opt/eval/linkedin_eval/
RUN pip install --no-cache-dir /opt/eval
ENV HARBOR_TELEMETRY=0 PYTHONUNBUFFERED=1
WORKDIR /app
ENTRYPOINT ["python", "-m", "linkedin_eval.run"]
