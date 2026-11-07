"""A folder as the agent, on Harbor's own CLI harnesses.

Harbor's built-in agents — claude-code, codex, gemini-cli, opencode — install their CLI
in the task container, resolve its login, hand it the instruction, and write the ATIF
trajectory and the cost into the trial result. What they cannot do is start from a
folder: they run the CLI bare in /app. A page-object agent is a folder — its brief
(AGENTS.md, which every one of these CLIs reads; CLAUDE.md for Claude), its wiki, its
settings — so these subclasses add one step: once the CLI is installed, the folder
`agent_dir` names is uploaded to /app, minus its secrets, and the CLI starts inside it.

    harbor run -d lowgular/linkedin-po@0.2.1 -a linkedin_eval.folder:gemini_cli \
        --ak agent_dir=/app -m gemini/gemini-3.8-flash

Each class also goes by Harbor's agent name with underscores — linkedin_eval.folder:claude_code —
and carries the model it runs when -m is not given. Everything else — login, permissions, logs — is
Harbor's: `harbor agent schema claude-code`.
"""
import shutil
import tempfile
from pathlib import Path

from pydantic import Field

from harbor.agents.installed.claude_code import ClaudeCode as _ClaudeCode, ClaudeCodeOptions
from harbor.agents.installed.codex import Codex as _Codex, CodexOptions
from harbor.agents.installed.gemini_cli import GeminiCli as _GeminiCli, GeminiCliOptions
from harbor.agents.installed.opencode import OpenCode as _OpenCode, OpenCodeOptions

# What never leaves the machine when a folder is uploaded.
EXCLUDES = (".obsidian", ".DS_Store", "settings.local.json", ".env", ".env.*", "node_modules", ".git", "world", "eval", "telemetry", "dataset")  # the world, the eval, the tracing and the dataset are this repository's, not the agent's; the task image already has the world, and the dataset holds the answers
WORKDIR = "/app"


def _with_agent_dir(base):
    class Options(base):
        agent_dir: str = Field(description="The agent folder, uploaded to /app before the CLI starts there.")
    Options.__name__ = base.__name__
    return Options


class AgentFolder:
    """Once the CLI is installed, put the folder where the CLI will start."""

    default_model = None  # what runs when -m is not given; None leaves it to the CLI

    def __init__(self, *args, model_name=None, **kwargs):
        super().__init__(*args, model_name=model_name or self.default_model, **kwargs)

    async def setup(self, environment):
        await super().setup(environment)
        source = Path(self.options.agent_dir).expanduser()
        if not source.is_dir():
            raise ValueError(f"agent_dir must name a folder: {source}")
        staged = Path(tempfile.mkdtemp(prefix="agent-folder-"))
        try:
            shutil.copytree(source, staged / "agent", ignore=shutil.ignore_patterns(*EXCLUDES), symlinks=False)
            await environment.exec(command=f"mkdir -p {WORKDIR}")
            await environment.upload_dir(staged / "agent", WORKDIR)
        finally:
            shutil.rmtree(staged, ignore_errors=True)
        # The agent's browser tools: started from the folder, attached to the task's browser over CDP.
        if (source / "browser-mcp" / "start.sh").is_file():
            started = await environment.exec(command=f"sh {WORKDIR}/browser-mcp/start.sh", env={"BROWSER_MCP_LOG": "/logs/agent/browser-mcp.log"})
            if started.return_code:
                raise RuntimeError(f"browser-mcp did not start: {started.stderr or started.stdout}")
        # Which folder ran, by its own agent.json (name and version), kept with the trial's logs.
        if (source / "agent.json").is_file():
            self.logs_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy(source / "agent.json", self.logs_dir / "agent.json")


class ClaudeCode(AgentFolder, _ClaudeCode):
    options_model = _with_agent_dir(ClaudeCodeOptions)
    default_model = "claude-haiku-5-5"


class Codex(AgentFolder, _Codex):
    options_model = _with_agent_dir(CodexOptions)
    default_model = "gpt-6-luna"


class GeminiCli(AgentFolder, _GeminiCli):
    options_model = _with_agent_dir(GeminiCliOptions)
    default_model = "gemini/gemini-3.8-flash"  # the gemini/ prefix: without a provider Harbor assumes Vertex AI


class Opencode(AgentFolder, _OpenCode):
    options_model = _with_agent_dir(OpenCodeOptions)


# By Harbor's agent names, hyphens as underscores, so the runner can say -a linkedin_eval.folder:<name>.
claude_code, codex, gemini_cli, opencode = ClaudeCode, Codex, GeminiCli, Opencode
