#!/usr/bin/env python3
"""Generate agents/openai.yaml for a skill directory."""

import argparse
import os
import re
import sys
from pathlib import Path

ACRONYMS = {
    'AI', 'ML', 'API', 'CLI', 'SDK', 'URL', 'URI', 'HTML', 'CSS', 'JS',
    'TS', 'JSON', 'YAML', 'XML', 'SQL', 'CSV', 'PDF', 'UI', 'UX', 'CI',
    'CD', 'HTTP', 'HTTPS', 'REST', 'GraphQL', 'SSH', 'TLS', 'SSL', 'AWS',
    'GCP', 'VM', 'OS', 'LLM', 'GPT', 'NLP', 'RAG', 'LTS', 'PR', 'LGTM',
}

BRANDS = {
    'agentv': 'AgentV',
    'openai': 'OpenAI',
    'github': 'GitHub',
    'gitlab': 'GitLab',
    'vscode': 'VSCode',
    'typescript': 'TypeScript',
    'javascript': 'JavaScript',
    'nodejs': 'Node.js',
    'postgresql': 'PostgreSQL',
    'mongodb': 'MongoDB',
    'graphql': 'GraphQL',
}

SMALL_WORDS = {
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'into', 'via', 'vs',
}

ALLOWED_INTERFACE_KEYS = {'name', 'description', 'type', 'version'}


def format_display_name(skill_name: str) -> str:
    words = skill_name.split('-')
    result = []
    for i, word in enumerate(words):
        upper = word.upper()
        if upper in ACRONYMS:
            result.append(upper)
        elif word.lower() in BRANDS:
            result.append(BRANDS[word.lower()])
        elif i > 0 and word.lower() in SMALL_WORDS:
            result.append(word.lower())
        else:
            result.append(word.capitalize())
    return ' '.join(result)


def generate_short_description(skill_name: str) -> str:
    return f"{format_display_name(skill_name)} skill"


def parse_interface_overrides(overrides: list[str]) -> dict[str, str] | None:
    result = {}
    for override in overrides:
        if '=' not in override:
            print(f"❌ Invalid interface override (missing '='): {override}", file=sys.stderr)
            return None
        key, _, value = override.partition('=')
        key = key.strip()
        value = value.strip()
        if key not in ALLOWED_INTERFACE_KEYS:
            allowed = ', '.join(sorted(ALLOWED_INTERFACE_KEYS))
            print(f"❌ Invalid interface key '{key}'. Allowed keys: {allowed}", file=sys.stderr)
            return None
        result[key] = value
    return result


def write_openai_yaml(skill_dir: str, skill_name: str, interface_overrides: list[str] | None = None) -> str | None:
    agents_dir = Path(skill_dir) / 'agents'
    yaml_path = agents_dir / 'openai.yaml'

    try:
        agents_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        print(f"❌ Error creating agents/ directory: {e}", file=sys.stderr)
        return None

    display_name = format_display_name(skill_name)
    short_description = generate_short_description(skill_name)

    iface = {
        'name': display_name,
        'description': short_description,
    }

    if interface_overrides:
        parsed = parse_interface_overrides(interface_overrides)
        if parsed is None:
            return None
        iface.update(parsed)

    # Serialize to YAML manually (no yaml library dependency)
    lines = []
    for k, v in iface.items():
        if '\n' in v:
            lines.append(f"{k}: |-")
            for line in v.split('\n'):
                lines.append(f"  {line}")
        else:
            lines.append(f"{k}: {v}")

    content = '\n'.join(lines) + '\n'

    try:
        yaml_path.write_text(content)
    except OSError as e:
        print(f"❌ Error writing agents/openai.yaml: {e}", file=sys.stderr)
        return None

    return str(yaml_path)


def read_frontmatter_name(skill_dir: str) -> str | None:
    skill_md = Path(skill_dir) / 'SKILL.md'
    if not skill_md.exists():
        return None
    content = skill_md.read_text()
    match = re.match(r'^---\n([\s\S]*?)\n---', content)
    if not match:
        return None
    name_match = re.search(r'^name:\s*(.+)', match.group(1), re.MULTILINE)
    if not name_match:
        return None
    return name_match.group(1).strip().strip('"\'')


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate agents/openai.yaml for a skill")
    parser.add_argument("skill_dir", help="Path to the skill directory")
    parser.add_argument("--name", "-n", default=None, help="Skill name (defaults to name from SKILL.md)")
    parser.add_argument(
        "--interface", action="append", default=[], metavar="KEY=VALUE",
        help="Interface override (repeatable, e.g. --interface description='My skill')"
    )
    args = parser.parse_args()

    skill_dir = str(Path(args.skill_dir).resolve())
    skill_name = args.name

    if not skill_name:
        skill_name = read_frontmatter_name(skill_dir)

    if not skill_name:
        print("❌ Could not determine skill name. Use --name or ensure SKILL.md has a name field.", file=sys.stderr)
        sys.exit(1)

    result = write_openai_yaml(skill_dir, skill_name, args.interface or None)
    if result is None:
        sys.exit(1)

    print(f"✅ Generated {result}")


if __name__ == "__main__":
    main()
