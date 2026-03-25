#!/usr/bin/env python3
"""Lint AI plugin structure for common issues.

Usage: python lint_plugin.py <plugin-dir> [--evals-dir <evals-dir>] [--json]

Checks:
  - Every skills/*/SKILL.md has a corresponding eval file
  - SKILL.md frontmatter has name and description
  - No hardcoded local paths (drive letters, absolute OS paths)
  - No version printing instructions
  - Commands reference existing skills
  - Path style consistency across commands
  - Referenced files (references/*.md) exist

Exit code: 0 if no issues, 1 if issues found.
"""

import json
import os
import re
import sys
from pathlib import Path


def find_skills(plugin_dir: Path) -> list[Path]:
    """Find all SKILL.md files in the plugin."""
    return sorted(plugin_dir.rglob("skills/*/SKILL.md"))


def find_evals(evals_dir: Path, plugin_name: str) -> list[Path]:
    """Find eval files for a plugin."""
    plugin_evals = evals_dir / plugin_name
    if not plugin_evals.exists():
        return []
    return sorted(plugin_evals.rglob("*.yaml")) + sorted(plugin_evals.rglob("*.yml"))


def find_commands(plugin_dir: Path) -> list[Path]:
    """Find command files."""
    commands_dir = plugin_dir / "commands"
    if not commands_dir.exists():
        return []
    return sorted(commands_dir.glob("*.md"))


def lint_plugin(plugin_dir: Path, evals_dir: Path | None = None) -> list[dict]:
    issues = []

    def issue(severity: str, msg: str, file: str | None = None, line: int | None = None):
        issues.append({
            "file": file or str(plugin_dir),
            "severity": severity,
            "message": msg,
            "line": line,
        })

    plugin_name = plugin_dir.name
    skills = find_skills(plugin_dir)
    commands = find_commands(plugin_dir)

    # Collect skill names
    skill_names = set()
    for skill_path in skills:
        skill_name = skill_path.parent.name
        skill_names.add(skill_name)

    # Check each SKILL.md
    for skill_path in skills:
        skill_name = skill_path.parent.name
        text = skill_path.read_text(encoding="utf-8")
        lines = text.splitlines()

        # Check frontmatter
        if not text.startswith("---"):
            issue("error", "Missing YAML frontmatter", str(skill_path))
        else:
            fm_end = text.find("---", 3)
            if fm_end == -1:
                issue("error", "Unclosed YAML frontmatter", str(skill_path))
            else:
                fm = text[3:fm_end]
                if "name:" not in fm:
                    issue("error", "Frontmatter missing 'name' field", str(skill_path))
                if "description:" not in fm:
                    issue("error", "Frontmatter missing 'description' field", str(skill_path))

        # Check for hardcoded paths
        drive_letter_pat = re.compile(r'[A-Z]:\\[A-Za-z]')
        for i, line in enumerate(lines, 1):
            if drive_letter_pat.search(line):
                # Skip if it's in a table header or obviously an example
                if "Override" not in line and "Example" not in line:
                    issue("warning", f"Hardcoded local path detected", str(skill_path), i)

        # Check for version printing
        version_pat = re.compile(r'print.*version|version \d{8}', re.IGNORECASE)
        for i, line in enumerate(lines, 1):
            if version_pat.search(line):
                issue("warning", "Version printing instruction — rely on git history", str(skill_path), i)

        # Check referenced files exist
        ref_pat = re.compile(r'`(references/[^`]+)`')
        skill_dir = skill_path.parent
        for i, line in enumerate(lines, 1):
            for match in ref_pat.finditer(line):
                ref_path = skill_dir / match.group(1)
                if not ref_path.exists():
                    issue("error", f"Referenced file does not exist: {match.group(1)}", str(skill_path), i)

        # Check for non-existent command references
        cmd_pat = re.compile(r'/([a-z][a-z0-9-]+)')
        cmd_names = {c.stem for c in commands}
        for i, line in enumerate(lines, 1):
            for match in cmd_pat.finditer(line):
                cmd_ref = match.group(1)
                # Skip common false positives
                if cmd_ref in ("dev", "null", "tmp", "etc", "usr", "bin", "opsx"):
                    continue
                if cmd_ref.startswith("opsx:") or cmd_ref.startswith("ce:"):
                    continue
                if cmd_ref not in cmd_names and cmd_ref not in skill_names:
                    # Only flag if it looks like a slash command (preceded by whitespace or start of line)
                    before = line[:match.start()].rstrip()
                    if before == "" or before.endswith((" ", "\t", '"', "'", ":")):
                        issue("info", f"References /{cmd_ref} — not found in commands/ or skills/", str(skill_path), i)

    # Check eval coverage
    if evals_dir:
        eval_files = find_evals(evals_dir, plugin_name)
        eval_stems = set()
        for ef in eval_files:
            stem = ef.stem.replace(".eval", "")
            eval_stems.add(stem)

        for skill_name in sorted(skill_names):
            # Check various naming patterns
            has_eval = (
                skill_name in eval_stems
                or skill_name.replace(plugin_name + "-", "") in eval_stems
                or any(skill_name in s for s in eval_stems)
            )
            if not has_eval:
                issue("warning", f"Skill '{skill_name}' has no corresponding eval file", str(plugin_dir / "skills" / skill_name / "SKILL.md"))

    # Check command path consistency
    path_styles = set()
    for cmd_path in commands:
        text = cmd_path.read_text(encoding="utf-8")
        if "plugins/" in text:
            path_styles.add("absolute")
        if re.search(r'skills/[a-z]', text) and "plugins/" not in text.split("skills/")[0][-20:]:
            path_styles.add("relative")
    if len(path_styles) > 1:
        issue("info", "Commands use mixed path styles (some relative, some absolute)", str(plugin_dir / "commands"))

    return issues


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <plugin-dir> [--evals-dir <evals-dir>] [--json]", file=sys.stderr)
        sys.exit(2)

    plugin_dir = Path(sys.argv[1])
    output_json = "--json" in sys.argv

    evals_dir = None
    if "--evals-dir" in sys.argv:
        idx = sys.argv.index("--evals-dir")
        if idx + 1 < len(sys.argv):
            evals_dir = Path(sys.argv[idx + 1])

    if not plugin_dir.is_dir():
        print(f"Error: {plugin_dir} is not a directory", file=sys.stderr)
        sys.exit(2)

    issues = lint_plugin(plugin_dir, evals_dir)

    if output_json:
        print(json.dumps(issues, indent=2))
    else:
        for iss in issues:
            line = f":{iss['line']}" if iss.get("line") else ""
            print(f"[{iss['severity'].upper()}] {iss['file']}{line}: {iss['message']}")

        counts = {}
        for iss in issues:
            counts[iss["severity"]] = counts.get(iss["severity"], 0) + 1
        if issues:
            print(f"\n{len(issues)} issues: {', '.join(f'{v} {k}' for k, v in sorted(counts.items()))}")
        else:
            print("No issues found.")

    sys.exit(1 if any(i["severity"] == "error" for i in issues) else 0)


if __name__ == "__main__":
    main()
