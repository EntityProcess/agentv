#!/usr/bin/env python3
"""
Governance compliance lint script.

Reads each changed *.eval.yaml file, extracts governance: blocks, and calls
the Claude API with the agentv-compliance skill loaded to lint them.
Posts violations as a PR comment and exits non-zero on any failure.

Environment variables:
  ANTHROPIC_API_KEY  - required
  CHANGED_FILES      - space-separated list of changed eval file paths
  SKILL_PATH         - path to the agentv-compliance skill directory
  GITHUB_TOKEN       - for posting PR comments (optional; skipped if absent)
  PR_NUMBER          - GitHub PR number (optional)
  REPO               - GitHub repo in "owner/repo" form (optional)

Cost target: under 5 cents per 10-file PR using claude-haiku-4-5.
"""

import json
import os
import re
import sys
import textwrap
from pathlib import Path

import anthropic
import yaml

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MODEL = "claude-haiku-4-5-20251001"
SKILL_PATH = Path(os.environ.get("SKILL_PATH", "plugins/agentv-dev/skills/agentv-compliance"))
CHANGED_FILES = os.environ.get("CHANGED_FILES", "").split()


def load_skill_content() -> str:
    """Concatenate SKILL.md and all references/ into a single context string."""
    parts: list[str] = []

    skill_md = SKILL_PATH / "SKILL.md"
    if skill_md.exists():
        parts.append(f"# Skill: agentv-compliance\n\n{skill_md.read_text()}")

    refs_dir = SKILL_PATH / "references"
    if refs_dir.is_dir():
        for ref_file in sorted(refs_dir.glob("*.md")):
            parts.append(f"\n\n---\n## {ref_file.stem}\n\n{ref_file.read_text()}")

    return "\n".join(parts)


def extract_governance_blocks(eval_path: Path) -> list[dict]:
    """
    Extract governance blocks from an eval file.
    Returns a list of dicts: {location, block}.
    """
    try:
        text = eval_path.read_text()
        doc = yaml.safe_load(text)
    except Exception as exc:
        print(f"  Warning: failed to parse {eval_path}: {exc}", file=sys.stderr)
        return []

    if not isinstance(doc, dict):
        return []

    blocks: list[dict] = []

    # Suite-level governance (top-level key)
    if isinstance(doc.get("governance"), dict):
        blocks.append({"location": "governance", "block": doc["governance"]})

    # Case-level governance (tests[n].metadata.governance)
    for i, case in enumerate(doc.get("tests") or []):
        if not isinstance(case, dict):
            continue
        meta = case.get("metadata")
        if not isinstance(meta, dict):
            continue
        gov = meta.get("governance")
        if isinstance(gov, dict):
            blocks.append({"location": f"tests[{i}].metadata.governance", "block": gov})

    return blocks


def lint_block(client: anthropic.Anthropic, skill_context: str, location: str, block: dict) -> dict:
    """Call Claude to lint one governance block. Returns structured lint report."""
    block_yaml = yaml.dump(block, default_flow_style=False, allow_unicode=True)

    prompt = textwrap.dedent(f"""
        You are linting a governance block from an AgentV eval file.
        Apply the rules in references/lint-rules.md and return ONLY a JSON object.

        Governance block at location `{location}`:
        ```yaml
        {block_yaml}
        ```

        Return ONLY valid JSON in this exact shape — no markdown, no explanation:
        {{
          "pass": <true|false>,
          "violations": [
            {{
              "rule": "<rule_id>",
              "key": "<field_name>",
              "value": "<offending_value>",
              "message": "<human readable message>",
              "suggestion": "<how to fix>"
            }}
          ]
        }}

        If there are no violations, return {{"pass": true, "violations": []}}.
    """).strip()

    message = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=f"You are a governance compliance linter. Load this skill:\n\n{skill_context}",
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\n?", "", raw)
    raw = re.sub(r"\n?```$", "", raw)

    try:
        report = json.loads(raw)
    except json.JSONDecodeError:
        return {
            "pass": False,
            "violations": [
                {
                    "rule": "parse_error",
                    "key": "response",
                    "value": raw[:200],
                    "message": "Linter returned non-JSON response",
                    "suggestion": "Check ANTHROPIC_API_KEY and model availability",
                }
            ],
        }

    return report


def post_pr_comment(body: str) -> None:
    """Post a comment on the PR if GITHUB_TOKEN, PR_NUMBER, and REPO are set."""
    token = os.environ.get("GITHUB_TOKEN")
    pr_number = os.environ.get("PR_NUMBER")
    repo = os.environ.get("REPO")
    if not (token and pr_number and repo):
        return

    try:
        import urllib.request

        url = f"https://api.github.com/repos/{repo}/issues/{pr_number}/comments"
        payload = json.dumps({"body": body}).encode()
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "Content-Type": "application/json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10):
            pass
    except Exception as exc:
        print(f"  Warning: failed to post PR comment: {exc}", file=sys.stderr)


def main() -> int:
    if not CHANGED_FILES:
        print("No changed eval files to lint.")
        return 0

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY is not set.", file=sys.stderr)
        return 1

    client = anthropic.Anthropic(api_key=api_key)
    skill_context = load_skill_content()

    all_pass = True
    comment_lines: list[str] = ["## Governance Compliance Lint\n"]

    for file_str in CHANGED_FILES:
        eval_path = Path(file_str)
        if not eval_path.exists():
            continue

        print(f"\nLinting {eval_path}...")
        blocks = extract_governance_blocks(eval_path)

        if not blocks:
            print(f"  No governance blocks found — skipping.")
            comment_lines.append(f"**{eval_path}**: no `governance:` block — skipped.\n")
            continue

        file_pass = True
        file_lines: list[str] = []
        for entry in blocks:
            location = entry["location"]
            block = entry["block"]
            print(f"  Linting {location}...")
            report = lint_block(client, skill_context, location, block)

            if report.get("pass"):
                print(f"    ✓ pass")
                file_lines.append(f"  - `{location}`: ✅ pass")
            else:
                file_pass = False
                all_pass = False
                violations = report.get("violations", [])
                print(f"    ✗ {len(violations)} violation(s)")
                file_lines.append(f"  - `{location}`: ❌ {len(violations)} violation(s)")
                for v in violations:
                    msg = v.get("message", "")
                    sug = v.get("suggestion", "")
                    print(f"      [{v.get('rule')}] {v.get('key')}: {msg}")
                    file_lines.append(f"    - **{v.get('rule')}** `{v.get('key')}`: {msg}")
                    if sug:
                        file_lines.append(f"      *Suggestion:* {sug}")

        status = "✅" if file_pass else "❌"
        comment_lines.append(f"**{eval_path}** {status}")
        comment_lines.extend(file_lines)
        comment_lines.append("")

    if all_pass:
        comment_lines.append("\n✅ All governance blocks passed.")
    else:
        comment_lines.append("\n❌ Some governance blocks have violations. See details above.")

    comment_body = "\n".join(comment_lines)
    post_pr_comment(comment_body)
    print("\n" + comment_body)

    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
