import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ACRONYMS = new Set([
  'AI', 'ML', 'API', 'CLI', 'SDK', 'URL', 'URI', 'HTML', 'CSS', 'JS', 'TS',
  'JSON', 'YAML', 'XML', 'SQL', 'CSV', 'PDF', 'UI', 'UX', 'CI', 'CD', 'HTTP',
  'HTTPS', 'REST', 'GraphQL', 'SSH', 'TLS', 'SSL', 'AWS', 'GCP', 'VM', 'OS',
  'LLM', 'GPT', 'NLP', 'RAG', 'LTS', 'PR', 'LGTM',
]);

export const BRANDS: Record<string, string> = {
  agentv: 'AgentV',
  openai: 'OpenAI',
  github: 'GitHub',
  gitlab: 'GitLab',
  vscode: 'VSCode',
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  nodejs: 'Node.js',
  postgresql: 'PostgreSQL',
  mongodb: 'MongoDB',
  graphql: 'GraphQL',
};

export const SMALL_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'into', 'via', 'vs',
]);

export const ALLOWED_INTERFACE_KEYS = new Set([
  'name', 'description', 'type', 'version',
]);

const MAX_SKILL_NAME_LENGTH = 64;

export interface ValidationResult {
  valid: boolean;
  message: string;
}

export interface InitSkillOptions {
  resources?: Array<'scripts' | 'references' | 'assets'>;
  examples?: boolean;
  interfaceOverrides?: string[];
}

export interface OpenAIYamlOptions {
  interfaceOverrides?: string[];
}

export interface ParsedOverrides {
  overrides: Record<string, string>;
  order: string[];
}

// Template content
const SKILL_TEMPLATE = `---
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

Delete this entire "Structuring This Skill" section when done - it's just guidance.]

## [TODO: Replace with the first main section based on chosen structure]

[TODO: Add content here. See examples in existing skills:
- Code samples for technical skills
- Decision trees for complex workflows
- Concrete examples with realistic user requests
- References to scripts/templates/references as needed]

## Resources

This skill includes example resource directories that demonstrate how to organize different types of bundled resources:

### scripts/
Executable code (Python/Bash/etc.) that can be run directly to perform specific operations.

**Examples from other skills:**
- PDF skill: \`fill_fillable_fields.py\`, \`extract_form_field_info.py\` - utilities for PDF manipulation
- DOCX skill: \`document.py\`, \`utilities.py\` - Python modules for document processing

**Appropriate for:** Python scripts, shell scripts, or any executable code that performs automation, data processing, or specific operations.

**Note:** Scripts may be executed without loading into context, but can still be read by Claude for patching or environment adjustments.

### references/
Documentation and reference material intended to be loaded into context to inform Claude's process and thinking.

**Examples from other skills:**
- Product management: \`communication.md\`, \`context_building.md\` - detailed workflow guides
- BigQuery: API reference documentation and query examples
- Finance: Schema documentation, company policies

**Appropriate for:** In-depth documentation, API references, database schemas, comprehensive guides, or any detailed information that Claude should reference while working.

### assets/
Files not intended to be loaded into context, but rather used within the output Claude produces.

**Examples from other skills:**
- Brand styling: PowerPoint template files (.pptx), logo files
- Frontend builder: HTML/React boilerplate project directories
- Typography: Font files (.ttf, .woff2)

**Appropriate for:** Templates, boilerplate code, document templates, images, icons, fonts, or any files meant to be copied or used in the final output.

---

**Any unneeded directories can be deleted.** Not every skill requires all three types of resources.
`;

const EXAMPLE_SCRIPT = `#!/usr/bin/env bun
/**
 * Example helper script for {skillName}
 *
 * This is a placeholder script that can be executed directly.
 * Replace with actual implementation or delete if not needed.
 *
 * Example real scripts from other skills:
 * - pdf/scripts/fill_fillable_fields.py - Fills PDF form fields
 * - pdf/scripts/convert_pdf_to_images.py - Converts PDF pages to images
 */

function main() {
  console.log("This is an example script for {skillName}");
  // TODO: Add actual script logic here
  // This could be data processing, file conversion, API calls, etc.
}

main();
`;

const EXAMPLE_REFERENCE = `# Reference Documentation for {skillTitle}

This is a placeholder for detailed reference documentation.
Replace with actual reference content or delete if not needed.

Example real reference docs from other skills:
- product-management/references/communication.md - Comprehensive guide for status updates
- product-management/references/context_building.md - Deep-dive on gathering context
- bigquery/references/ - API references and query examples

## When Reference Docs Are Useful

Reference docs are ideal for:
- Comprehensive API documentation
- Detailed workflow guides
- Complex multi-step processes
- Information too lengthy for main SKILL.md
- Content that's only needed for specific use cases

## Structure Suggestions

### API Reference Example
- Overview
- Authentication
- Endpoints with examples
- Error codes
- Rate limits

### Workflow Guide Example
- Prerequisites
- Step-by-step instructions
- Common patterns
- Troubleshooting
- Best practices
`;

const EXAMPLE_ASSET = `# Example Asset File

This placeholder represents where asset files would be stored.
Replace with actual asset files (templates, images, fonts, etc.) or delete if not needed.

Asset files are NOT intended to be loaded into context, but rather used within
the output Claude produces.

Example asset files from other skills:
- Brand guidelines: logo.png, slides_template.pptx
- Frontend builder: hello-world/ directory with HTML/React boilerplate
- Typography: custom-font.ttf, font-family.woff2
- Data: sample_data.csv, test_dataset.json

## Common Asset Types

- Templates: .pptx, .docx, boilerplate directories
- Images: .png, .jpg, .svg, .gif
- Fonts: .ttf, .otf, .woff, .woff2
- Boilerplate code: Project directories, starter files
- Icons: .ico, .svg
- Data files: .csv, .json, .xml, .yaml

Note: This is a text placeholder. Actual assets can be any file type.
`;

function formatTitleCase(skillName: string): string {
  return skillName
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function formatDisplayName(skillName: string): string {
  const words = skillName.split('-');
  return words
    .map((word, index) => {
      const upper = word.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      if (BRANDS[word.toLowerCase()]) return BRANDS[word.toLowerCase()];
      if (index > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export function generateShortDescription(skillName: string): string {
  const displayName = formatDisplayName(skillName);
  return `${displayName} skill`;
}

export function parseInterfaceOverrides(overrides: string[]): ParsedOverrides | null {
  const result: Record<string, string> = {};
  const order: string[] = [];

  for (const override of overrides) {
    const eqIdx = override.indexOf('=');
    if (eqIdx === -1) {
      console.error(`❌ Invalid interface override (missing '='): ${override}`);
      return null;
    }
    const key = override.slice(0, eqIdx).trim();
    const value = override.slice(eqIdx + 1).trim();

    if (!ALLOWED_INTERFACE_KEYS.has(key)) {
      const allowed = [...ALLOWED_INTERFACE_KEYS].sort().join(', ');
      console.error(`❌ Invalid interface key '${key}'. Allowed keys: ${allowed}`);
      return null;
    }

    result[key] = value;
    if (!order.includes(key)) order.push(key);
  }

  return { overrides: result, order };
}

export function normalizeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function writeOpenAIYaml(
  skillDir: string,
  skillName: string,
  options: OpenAIYamlOptions = {},
): string | null {
  const agentsDir = resolve(skillDir, 'agents');
  const yamlPath = resolve(agentsDir, 'openai.yaml');

  try {
    mkdirSync(agentsDir, { recursive: true });
  } catch (e) {
    console.error(`❌ Error creating agents/ directory: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }

  const displayName = formatDisplayName(skillName);
  const shortDescription = generateShortDescription(skillName);

  // Build base interface
  const iface: Record<string, string> = {
    name: displayName,
    description: shortDescription,
  };

  // Apply overrides
  if (options.interfaceOverrides && options.interfaceOverrides.length > 0) {
    const parsed = parseInterfaceOverrides(options.interfaceOverrides);
    if (!parsed) return null;
    for (const [k, v] of Object.entries(parsed.overrides)) {
      iface[k] = v;
    }
  }

  // Serialize to YAML manually (no yaml library)
  const lines: string[] = [];
  for (const [k, v] of Object.entries(iface)) {
    // Use block scalar for multi-line values
    if (v.includes('\n')) {
      lines.push(`${k}: |-`);
      for (const line of v.split('\n')) {
        lines.push(`  ${line}`);
      }
    } else {
      lines.push(`${k}: ${v}`);
    }
  }

  const content = lines.join('\n') + '\n';

  try {
    writeFileSync(yamlPath, content, 'utf-8');
  } catch (e) {
    console.error(`❌ Error writing agents/openai.yaml: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }

  return yamlPath;
}

export function initSkill(
  skillName: string,
  path: string,
  options: InitSkillOptions = {},
): string | null {
  const normalized = normalizeSkillName(skillName);
  if (normalized !== skillName) {
    console.error(
      `❌ Skill name '${skillName}' is not normalized. Did you mean '${normalized}'?`,
    );
    return null;
  }

  if (skillName.length > MAX_SKILL_NAME_LENGTH) {
    console.error(
      `❌ Skill name too long (${skillName.length} characters). Maximum is ${MAX_SKILL_NAME_LENGTH}.`,
    );
    return null;
  }

  const skillDir = resolve(path, skillName);

  if (existsSync(skillDir)) {
    console.error(`❌ Error: Skill directory already exists: ${skillDir}`);
    return null;
  }

  try {
    mkdirSync(skillDir, { recursive: true });
    console.log(`✅ Created skill directory: ${skillDir}`);
  } catch (e) {
    console.error(`❌ Error creating directory: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }

  // Create SKILL.md
  const skillTitle = formatTitleCase(skillName);
  const skillContent = SKILL_TEMPLATE
    .replace(/\{skill_name\}/g, skillName)
    .replace(/\{skill_title\}/g, skillTitle);

  try {
    writeFileSync(resolve(skillDir, 'SKILL.md'), skillContent, 'utf-8');
    console.log('✅ Created SKILL.md');
  } catch (e) {
    console.error(`❌ Error creating SKILL.md: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }

  // Write agents/openai.yaml
  const yamlResult = writeOpenAIYaml(skillDir, skillName, {
    interfaceOverrides: options.interfaceOverrides,
  });
  if (!yamlResult) return null;
  console.log('✅ Created agents/openai.yaml');

  // Create resource directories
  const resources = options.resources ?? ['scripts', 'references', 'assets'];
  const createExamples = options.examples !== false;

  try {
    if (resources.includes('scripts')) {
      const scriptsDir = resolve(skillDir, 'scripts');
      mkdirSync(scriptsDir, { recursive: true });
      if (createExamples) {
        const scriptPath = resolve(scriptsDir, 'example.ts');
        const scriptContent = EXAMPLE_SCRIPT.replace(/\{skillName\}/g, skillName);
        writeFileSync(scriptPath, scriptContent, 'utf-8');
        chmodSync(scriptPath, 0o755);
        console.log('✅ Created scripts/example.ts');
      }
    }

    if (resources.includes('references')) {
      const refsDir = resolve(skillDir, 'references');
      mkdirSync(refsDir, { recursive: true });
      if (createExamples) {
        const refPath = resolve(refsDir, 'api_reference.md');
        writeFileSync(refPath, EXAMPLE_REFERENCE.replace(/\{skillTitle\}/g, skillTitle), 'utf-8');
        console.log('✅ Created references/api_reference.md');
      }
    }

    if (resources.includes('assets')) {
      const assetsDir = resolve(skillDir, 'assets');
      mkdirSync(assetsDir, { recursive: true });
      if (createExamples) {
        const assetPath = resolve(assetsDir, 'example_asset.txt');
        writeFileSync(assetPath, EXAMPLE_ASSET, 'utf-8');
        console.log('✅ Created assets/example_asset.txt');
      }
    }
  } catch (e) {
    console.error(
      `❌ Error creating resource directories: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }

  console.log(`\n✅ Skill '${skillName}' initialized successfully at ${skillDir}`);
  console.log('\nNext steps:');
  console.log('1. Edit SKILL.md to complete the TODO items and update the description');
  console.log('2. Customize or delete the example files in scripts/, references/, and assets/');
  console.log('3. Run the validator when ready to check the skill structure');

  return skillDir;
}
