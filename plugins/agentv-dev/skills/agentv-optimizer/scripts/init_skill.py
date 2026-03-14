#!/usr/bin/env python3
"""Scaffold a new skill directory."""

import argparse
import os
import sys
from pathlib import Path

# Import from sibling script
sys.path.insert(0, str(Path(__file__).parent))
from generate_openai_yaml import write_openai_yaml, format_display_name

MAX_SKILL_NAME_LENGTH = 64

SKILL_TEMPLATE = '''---
name: {skill_name}
description: [TODO: Complete and informative explanation of what the skill does and when to use it. Include WHEN to use this skill - specific scenarios, file types, or tasks that trigger it.]
---

# {skill_title}

## Overview

[TODO: 1-2 sentences explaining what this skill enables]

## Structuring This Skill

[TODO: Choose the structure that best fits this skill's purpose. Common patterns:

**1. Workflow-Based** (best for sequential processes)
- Works well when there are clear step-by-step procedures
- Example: DOCX skill with "Workflow Decision Tree" → "Reading" → "Creating" → "Editing"
- Structure: ## Overview → ## Workflow Decision Tree → ## Step 1 → ## Step 2...

**2. Task-Based** (best for tool collections)
- Works well when the skill offers different operations/capabilities
- Example: PDF skill with "Quick Start" → "Merge PDFs" → "Split PDFs" → "Extract Text"
- Structure: ## Overview → ## Quick Start → ## Task Category 1 → ## Task Category 2...

**3. Reference/Guidelines** (best for standards or specifications)
- Works well for brand guidelines, coding standards, or requirements
- Example: Brand styling with "Brand Guidelines" → "Colors" → "Typography" → "Features"
- Structure: ## Overview → ## Guidelines → ## Specifications → ## Usage...

**4. Capabilities-Based** (best for integrated systems)
- Works well when the skill provides multiple interrelated features
- Example: Product Management with "Core Capabilities" → numbered capability list
- Structure: ## Overview → ## Core Capabilities → ### 1. Feature → ### 2. Feature...

Patterns can be mixed and matched as needed. Most skills combine patterns (e.g., start with task-based, add workflow for complex operations).

Delete this entire "Structuring This Skill" section when done - it\'s just guidance.]

## [TODO: Replace with the first main section based on chosen structure]

[TODO: Add content here.]

## Resources

### scripts/
Executable code that can be run directly to perform specific operations.

### references/
Documentation and reference material intended to be loaded into context.

### assets/
Files not intended to be loaded into context, but rather used within the output.

---

**Any unneeded directories can be deleted.**
'''

EXAMPLE_SCRIPT = '''#!/usr/bin/env bun
// Example helper script for {skill_name}
// Replace with actual implementation or delete if not needed.
console.log("This is an example script for {skill_name}");
'''

EXAMPLE_REFERENCE = '''# Reference Documentation for {skill_title}

This is a placeholder for detailed reference documentation.
Replace with actual reference content or delete if not needed.
'''

EXAMPLE_ASSET = '''# Example Asset File

This placeholder represents where asset files would be stored.
Replace with actual asset files (templates, images, fonts, etc.) or delete if not needed.
'''


def format_title_case(skill_name: str) -> str:
    return ' '.join(word.capitalize() for word in skill_name.split('-'))


def normalize_skill_name(name: str) -> str:
    import re
    return re.sub(r'-{2,}', '-', re.sub(r'\s+', '-', name.lower())).strip('-')


def init_skill(
    skill_name: str,
    path: str,
    resources: list[str] | None = None,
    examples: bool = True,
    interface_overrides: list[str] | None = None,
) -> str | None:
    normalized = normalize_skill_name(skill_name)
    if normalized != skill_name:
        print(f"❌ Skill name '{skill_name}' is not normalized. Did you mean '{normalized}'?", file=sys.stderr)
        return None

    if len(skill_name) > MAX_SKILL_NAME_LENGTH:
        print(f"❌ Skill name too long ({len(skill_name)} characters). Maximum is {MAX_SKILL_NAME_LENGTH}.", file=sys.stderr)
        return None

    skill_dir = Path(path) / skill_name

    if skill_dir.exists():
        print(f"❌ Error: Skill directory already exists: {skill_dir}", file=sys.stderr)
        return None

    try:
        skill_dir.mkdir(parents=True, exist_ok=True)
        print(f"✅ Created skill directory: {skill_dir}")
    except OSError as e:
        print(f"❌ Error creating directory: {e}", file=sys.stderr)
        return None

    # Create SKILL.md
    skill_title = format_title_case(skill_name)
    skill_content = SKILL_TEMPLATE.replace('{skill_name}', skill_name).replace('{skill_title}', skill_title)

    try:
        (skill_dir / 'SKILL.md').write_text(skill_content)
        print('✅ Created SKILL.md')
    except OSError as e:
        print(f"❌ Error creating SKILL.md: {e}", file=sys.stderr)
        return None

    # Write agents/openai.yaml
    yaml_result = write_openai_yaml(str(skill_dir), skill_name, interface_overrides)
    if yaml_result is None:
        return None
    print('✅ Created agents/openai.yaml')

    # Create resource directories
    if resources is None:
        resources = ['scripts', 'references', 'assets']

    try:
        if 'scripts' in resources:
            scripts_dir = skill_dir / 'scripts'
            scripts_dir.mkdir(parents=True, exist_ok=True)
            if examples:
                script_path = scripts_dir / 'example.ts'
                script_content = EXAMPLE_SCRIPT.replace('{skill_name}', skill_name)
                script_path.write_text(script_content)
                script_path.chmod(0o755)
                print('✅ Created scripts/example.ts')

        if 'references' in resources:
            refs_dir = skill_dir / 'references'
            refs_dir.mkdir(parents=True, exist_ok=True)
            if examples:
                ref_path = refs_dir / 'api_reference.md'
                ref_path.write_text(EXAMPLE_REFERENCE.replace('{skill_title}', skill_title))
                print('✅ Created references/api_reference.md')

        if 'assets' in resources:
            assets_dir = skill_dir / 'assets'
            assets_dir.mkdir(parents=True, exist_ok=True)
            if examples:
                asset_path = assets_dir / 'example_asset.txt'
                asset_path.write_text(EXAMPLE_ASSET)
                print('✅ Created assets/example_asset.txt')
    except OSError as e:
        print(f"❌ Error creating resource directories: {e}", file=sys.stderr)
        return None

    print(f"\n✅ Skill '{skill_name}' initialized successfully at {skill_dir}")
    print('\nNext steps:')
    print('1. Edit SKILL.md to complete the TODO items and update the description')
    print('2. Customize or delete the example files in scripts/, references/, and assets/')
    print('3. Run the validator when ready to check the skill structure')

    return str(skill_dir)


def main() -> None:
    parser = argparse.ArgumentParser(description="Scaffold a new skill directory")
    parser.add_argument("skill_name", help="Name of the skill (kebab-case)")
    parser.add_argument("--path", required=True, help="Directory where skill will be created")
    parser.add_argument(
        "--resources", default=None,
        help="Comma-separated: scripts,references,assets"
    )
    parser.add_argument("--no-examples", action="store_true", help="Omit example files")
    parser.add_argument(
        "--interface", action="append", default=[], metavar="KEY=VALUE",
        help="Interface override (repeatable)"
    )
    args = parser.parse_args()

    resources = None
    if args.resources:
        valid = {'scripts', 'references', 'assets'}
        resources = [r.strip() for r in args.resources.split(',')]
        for r in resources:
            if r not in valid:
                print(f"❌ Invalid resource type '{r}'. Valid: scripts, references, assets", file=sys.stderr)
                sys.exit(1)

    result = init_skill(
        args.skill_name,
        args.path,
        resources=resources,
        examples=not args.no_examples,
        interface_overrides=args.interface or None,
    )
    if result is None:
        sys.exit(1)


if __name__ == "__main__":
    main()
