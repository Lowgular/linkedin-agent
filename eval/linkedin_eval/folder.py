"""A folder as the agent, on Harbor's own CLI harnesses.

Harbor's built-in agents — antigravity-cli, claude-code, codex, gemini-cli, opencode — install their CLI
in the task container, resolve its login, hand it the instruction, and write the ATIF
trajectory and the cost into the trial result. What they cannot do is start from a
folder: they run the CLI bare in /app. A page-object agent is a folder — its brief
(AGENTS.md, which every one of these CLIs reads; CLAUDE.md for Claude), its wiki, its
settings — so these subclasses add one step: once the CLI is installed, the folder
`agent_dir` names is uploaded to /app, minus its secrets, and the CLI starts inside it. Its
tools are the trial's own services (eval/compose.yaml), where the folder's settings find them.

    harbor run -d lowgular/browser-use-linkedin@0.2.3 -a linkedin_eval.folder:antigravity_cli \
        --ak agent_dir=/app/agent --extra-docker-compose /app/eval/compose.yaml -m gemini/gemini-4-hydrogen

Each class also goes by Harbor's agent name with underscores — linkedin_eval.folder:claude_code —
and carries the model it runs when -m is not given. Everything else — login, permissions, logs — is
Harbor's: `harbor agent schema claude-code`.
"""
import json
import shutil
import tempfile
from pathlib import Path

from pydantic import Field

from harbor.agents.installed.antigravity_cli import AntigravityCli as _AntigravityCli, AntigravityCliOptions
from harbor.agents.installed.claude_code import ClaudeCode as _ClaudeCode, ClaudeCodeOptions
from harbor.agents.installed.codex import Codex as _Codex, CodexOptions
from harbor.agents.installed.gemini_cli import GeminiCli as _GeminiCli, GeminiCliOptions
from harbor.agents.installed.opencode import OpenCode as _OpenCode, OpenCodeOptions

# What never leaves the machine when a folder is uploaded: secrets, and what tools install or keep at run time.
EXCLUDES = (".obsidian", ".DS_Store", "settings.local.json", ".env", ".env.*", "node_modules", ".git", ".runtime")
# Codex's own tools, off: what the other CLIs' settings deny them (shell, web, sub-agents) and a browser of its own.
# Code mode stays: Codex calls every tool through it, the MCP's too, and without a shell it runs only tool calls.
CODEX_LOCK = "".join(f"--disable {f} " for f in (
    "shell_tool", "unified_exec", "multi_agent", "browser_use", "browser_use_external",
    "in_app_browser", "computer_use", "image_generation", "apps", "plugins",
)) + "-c web_search=disabled "
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
        await self._upload(environment, source, WORKDIR)
        # Which folder ran, by its own agent.json (name and version), kept with the trial's logs.
        if (source / "agent.json").is_file():
            self.logs_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy(source / "agent.json", self.logs_dir / "agent.json")


    @staticmethod
    async def _upload(environment, source, target):
        staged = Path(tempfile.mkdtemp(prefix="agent-folder-"))
        try:
            shutil.copytree(source, staged / "folder", ignore=shutil.ignore_patterns(*EXCLUDES), symlinks=False)
            await environment.exec(command=f"mkdir -p {target}")
            await environment.upload_dir(staged / "folder", target)
        finally:
            shutil.rmtree(staged, ignore_errors=True)


class AntigravityCli(AgentFolder, _AntigravityCli):
    options_model = _with_agent_dir(AntigravityCliOptions)
    default_model = "gemini/gemini-4-hydrogen"  # the slug without its effort, which is --ak reasoning_effort

    def _build_settings_config(self, *args, **kwargs):
        # Harbor writes the CLI's settings.json itself, in the CLI's home, and starts it with every permission
        # prompt skipped. The folder's own settings (.agents/settings.json) say which tools the agent may not
        # use; their permissions go into Harbor's file, so a trial is locked as a session is. The model and the
        # login stay Harbor's.
        config = super()._build_settings_config(*args, **kwargs)
        settings = Path(self.options.agent_dir).expanduser() / ".agents" / "settings.json"
        if settings.is_file():
            config["permissions"] = json.loads(settings.read_text()).get("permissions", {})
        config.pop("allowNonWorkspaceAccess", None)
        return config


class ClaudeCode(AgentFolder, _ClaudeCode):
    options_model = _with_agent_dir(ClaudeCodeOptions)
    default_model = "claude-haiku-5-5"


class Codex(AgentFolder, _Codex):
    options_model = _with_agent_dir(CodexOptions)
    default_model = "gpt-6-luna"

    async def exec_as_agent(self, environment, command, **kwargs):
        # Harbor starts `codex exec` with the sandbox off and its shell on, and Codex's sandbox cannot start in a
        # trial container. So, like the other CLIs' settings, the agent gets no shell, no code execution, no
        # sub-agents, no browser of its own, no web, no writes: the browser MCP is its one tool.
        return await super().exec_as_agent(environment, command=command.replace("--enable unified_exec ", CODEX_LOCK), **kwargs)


class GeminiCli(AgentFolder, _GeminiCli):
    options_model = _with_agent_dir(GeminiCliOptions)
    default_model = "gemini/gemini-3.5-flash-lite"  # the gemini/ prefix: without a provider Harbor assumes Vertex AI


class Opencode(AgentFolder, _OpenCode):
    options_model = _with_agent_dir(OpenCodeOptions)


# By Harbor's agent names, hyphens as underscores, so the runner can say -a linkedin_eval.folder:<name>.
antigravity_cli, claude_code, codex, gemini_cli, opencode = AntigravityCli, ClaudeCode, Codex, GeminiCli, Opencode
