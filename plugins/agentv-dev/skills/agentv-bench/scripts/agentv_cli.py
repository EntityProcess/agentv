"""Resolve and invoke the agentv CLI.

Centralises CLI resolution so individual scripts don't duplicate
the lookup logic. Also usable as a standalone wrapper:

    uv run agentv_cli.py eval evals/my.eval.yaml --artifacts out/

Resolution order:
1. AGENTV_CLI environment variable
2. AGENTV_CLI in nearest .env file (searching upward from cwd)
3. `agentv` on PATH
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path


def _find_env_key(key: str) -> str | None:
    """Search up from cwd for .env and return a specific key value."""
    current = Path(os.getcwd())
    while True:
        env_file = current / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if line.startswith(f"{key}="):
                    return line[len(key) + 1 :]
        parent = current.parent
        if parent == current:
            break
        current = parent
    return None


def find_agentv() -> list[str]:
    """Resolve the agentv CLI command.

    Checks AGENTV_CLI env var first (supports multi-word commands like
    'bun /path/to/cli.ts' for running from source). If not in environment,
    also searches the nearest .env file. Falls back to PATH lookup.
    """
    cli = os.environ.get("AGENTV_CLI") or _find_env_key("AGENTV_CLI")
    if cli:
        parts = cli.split()
        if parts:
            return parts
    path = shutil.which("agentv")
    if not path:
        print(
            "agentv CLI not found. Set AGENTV_CLI in .env or install: bun install -g agentv",
            file=sys.stderr,
        )
        sys.exit(1)
    return [path]


def main() -> None:
    """Pass-through wrapper: resolve agentv and forward all arguments."""
    cmd = find_agentv() + sys.argv[1:]
    sys.exit(subprocess.call(cmd))


if __name__ == "__main__":
    main()
