#!/bin/sh
# The grader. Its Claude extractor without an API key goes through the Claude Code CLI on the subscription token:
# installed here when needed, since the task image is a browser and nothing more.
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ "${EXTRACTOR:-}" != gemini ] && ! command -v claude >/dev/null 2>&1; then
  npm install -g --silent --no-audit --no-fund @anthropic-ai/claude-code@2.1.316 >/dev/null 2>&1
fi
node /tests/correctness.mjs /tests/expected.json /logs/agent/trajectory.json
