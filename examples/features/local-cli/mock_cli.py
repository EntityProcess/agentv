#!/usr/bin/env python3
"""
Dummy CLI that echoes all detected attachment names.
Usage:
  uv run mock_cli.py "{PROMPT}" --file path1 --file path2
Healthcheck:
  uv run mock_cli.py --healthcheck
"""
import argparse
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mock CLI for AgentV demo")
    parser.add_argument("--prompt", dest="prompt", required=False, help="User prompt")
    parser.add_argument("--file", dest="files", action="append", default=[], help="Attachment path")
    parser.add_argument("--output", dest="output_path", required=False, help="Write response to this file")
    parser.add_argument("--healthcheck", action="store_true", help="Run health check")
    parser.add_argument("extra", nargs="*", help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    # Helpful debug to verify which script is running and arguments passed
    print(f"[mock_cli] running from: {Path(__file__).resolve()}", file=sys.stderr)
    print(f"[mock_cli] argv: {sys.argv}", file=sys.stderr)
    cli_evals_dir = os.environ.get("CLI_EVALS_DIR", "")
    print(f"[mock_cli] CLI_EVALS_DIR: {cli_evals_dir}", file=sys.stderr)

    if args.healthcheck:
        print("cli-provider demo: healthy")
        return 0

    # Accept prompt from flag or positional spillover
    prompt = args.prompt or " ".join(args.extra).strip()
    if not prompt:
        print("No prompt provided.", file=sys.stderr)
        return 1

    # Deduplicate and normalize file list
    files = []
    seen = set()
    for raw in args.files:
        if not raw:
            continue
        path = Path(raw).resolve()
        if path not in seen:
            seen.add(path)
            files.append(path)

    names = sorted(p.name for p in files)
    names_str = ", ".join(names) if names else "none"

    # Echo prompt and attachments for visibility
    print(f"Prompt: {prompt}", file=sys.stderr)
    print(f"Attachments: {names_str}", file=sys.stderr)

    response: str
    if not names:
        response = "No attachments received."
    else:
        response = f"Attachments detected ({len(names)}): {names_str}."

    if args.output_path:
        output_path = Path(args.output_path)
        try:
            print(f"[mock_cli] writing output to: {output_path}", file=sys.stderr)
            output_path.write_text(response, encoding="utf-8")
        except OSError as exc:  # surface a clear failure for AgentV to pick up
            print(f"Failed to write output file: {exc}", file=sys.stderr)
            return 1
    else:
        print(response)

    return 0


if __name__ == "__main__":
    sys.exit(main())
