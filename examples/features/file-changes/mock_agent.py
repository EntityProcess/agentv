#!/usr/bin/env python3
"""
Mock agent that modifies files in the workspace.
Simulates an agent that edits files naturally (via tool calls) instead of
writing diffs in its response.
"""
import os
import sys
from pathlib import Path


def main() -> int:
    # The workspace is set as CWD by AgentV
    cwd = Path.cwd()

    # Read the prompt from --prompt flag
    prompt = ""
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == "--prompt" and i + 1 < len(args):
            prompt = args[i + 1]
            break

    # Modify existing file
    hello_file = cwd / "hello.txt"
    if hello_file.exists():
        hello_file.write_text("Hello, AgentV!\nThis file was modified by the agent.\n")

    # Create a new file
    new_file = cwd / "result.txt"
    new_file.write_text("Agent completed the task successfully.\n")

    # Write response to stdout (or output file if specified)
    output_path = None
    for i, arg in enumerate(args):
        if arg == "--output" and i + 1 < len(args):
            output_path = args[i + 1]
            break

    response = "I modified hello.txt and created result.txt in the workspace."
    if output_path:
        Path(output_path).write_text(response)
    else:
        print(response)

    return 0


if __name__ == "__main__":
    sys.exit(main())
