# Cross-Repo Sync

Synchronize agentevals spec docs when agentv implementation changes.

## Process

1. **Read the prompt** to understand what changed in agentv
2. **Examine the agentv checkout** to see the actual implementation changes
3. **Find corresponding spec/docs files** in the agentevals checkout
4. **Make updates** preserving existing Starlight/MDX conventions

## Conventions

- MDX files use Starlight frontmatter (`title`, `description`, `sidebar`)
- Code examples use fenced code blocks with language tags
- Schema fields are documented in definition lists or tables
- Cross-references use relative MDX links
- Keep existing section structure; add/modify within sections

## Common Sync Patterns

### Schema field renames
- Search agentevals docs for all occurrences of the old field name
- Replace with the new name in prose, code examples, and schema definitions
- Update any YAML/JSON examples that show the field

### New evaluator types
- Add to the evaluators list in `evaluators.mdx`
- Add configuration schema to `eval-format.mdx`
- Include usage example

### Structural changes (e.g., nesting changes)
- Update schema documentation
- Update all code/YAML examples showing the old structure
- Update any prose that describes the structure
