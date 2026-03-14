import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_SKILL_NAME_LENGTH = 64;

export interface ValidationResult {
  valid: boolean;
  message: string;
}

export function validateSkill(skillPath: string): ValidationResult {
  const skillMd = resolve(skillPath, 'SKILL.md');
  if (!existsSync(skillMd)) {
    return { valid: false, message: 'SKILL.md not found' };
  }

  const content = readFileSync(skillMd, 'utf-8');
  if (!content.startsWith('---')) {
    return { valid: false, message: 'No YAML frontmatter found' };
  }

  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { valid: false, message: 'Invalid frontmatter format' };
  }

  const frontmatterText = match[1];

  // Extract top-level keys (lines starting with a letter at column 0 followed by colon)
  const topLevelKeys: string[] = [];
  const frontmatter: Record<string, string> = {};
  const lines = frontmatterText.split('\n');
  for (const line of lines) {
    // Only process top-level keys (no leading whitespace)
    if (/^[a-zA-Z]/.test(line)) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const rawValue = line.slice(colonIdx + 1).trim();
      topLevelKeys.push(key);
      // Strip YAML block scalar indicators and quotes
      const value = rawValue
        .replace(/^[|>][-+]?\s*$/, '') // block scalar: "|-", ">-", "|", ">" etc.
        .replace(/^["']|["']$/g, ''); // strip leading/trailing quotes
      frontmatter[key] = value;
    }
  }

  const allowedProperties = new Set([
    'name',
    'description',
    'license',
    'allowed-tools',
    'metadata',
  ]);
  const unexpectedKeys = topLevelKeys.filter((k) => !allowedProperties.has(k));
  if (unexpectedKeys.length > 0) {
    const allowed = [...allowedProperties].sort().join(', ');
    const unexpected = [...new Set(unexpectedKeys)].sort().join(', ');
    return {
      valid: false,
      message: `Unexpected key(s) in SKILL.md frontmatter: ${unexpected}. Allowed properties are: ${allowed}`,
    };
  }

  if (!('name' in frontmatter)) {
    return { valid: false, message: "Missing 'name' in frontmatter" };
  }
  if (!('description' in frontmatter)) {
    return { valid: false, message: "Missing 'description' in frontmatter" };
  }

  const name = frontmatter.name.trim();
  if (name) {
    if (!/^[a-z0-9-]+$/.test(name)) {
      return {
        valid: false,
        message: `Name '${name}' should be hyphen-case (lowercase letters, digits, and hyphens only)`,
      };
    }
    if (name.startsWith('-') || name.endsWith('-') || name.includes('--')) {
      return {
        valid: false,
        message: `Name '${name}' cannot start/end with hyphen or contain consecutive hyphens`,
      };
    }
    if (name.length > MAX_SKILL_NAME_LENGTH) {
      return {
        valid: false,
        message: `Name is too long (${name.length} characters). Maximum is ${MAX_SKILL_NAME_LENGTH} characters.`,
      };
    }
  }

  const description = frontmatter.description.trim();
  if (description) {
    if (description.includes('<') || description.includes('>')) {
      return { valid: false, message: 'Description cannot contain angle brackets (< or >)' };
    }
    if (description.length > 1024) {
      return {
        valid: false,
        message: `Description is too long (${description.length} characters). Maximum is 1024 characters.`,
      };
    }
  }

  // Warn if agents/openai.yaml is missing (non-fatal)
  const openaiYaml = resolve(skillPath, 'agents', 'openai.yaml');
  if (!existsSync(openaiYaml)) {
    return { valid: true, message: 'Skill is valid! (Warning: agents/openai.yaml not found)' };
  }

  return { valid: true, message: 'Skill is valid!' };
}
