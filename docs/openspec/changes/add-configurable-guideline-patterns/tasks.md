## 1. Config Loading

- [ ] 1.1 Add `loadConfig(evalFilePath: string)` function in yaml-parser.ts
- [ ] 1.2 Check for `.agentv.yaml` in same directory as eval file
- [ ] 1.3 Parse YAML and extract `guideline_patterns` array (or return null)

## 2. Pattern Matching with Glob

- [ ] 2.1 Add micromatch dependency to packages/core/package.json
- [ ] 2.2 Update `isGuidelineFile()` to accept optional `patterns: string[]` parameter
- [ ] 2.3 Normalize file paths to forward slashes before matching
- [ ] 2.4 When patterns provided, use micromatch.isMatch() to test each pattern
- [ ] 2.5 When patterns not provided, use hardcoded defaults as glob patterns

## 3. Integration

- [ ] 3.1 Call `loadConfig()` once at start of `loadTestCases()`
- [ ] 3.2 Pass patterns to `isGuidelineFile()` during file processing
- [ ] 3.3 Convert current hardcoded checks to glob patterns for consistency

## 4. Testing & Docs

- [ ] 4.1 Add test: config file with custom glob patterns
- [ ] 4.2 Add test: no config file uses default glob patterns
- [ ] 4.3 Add test: cross-platform path matching (Windows/Unix)
- [ ] 4.4 Add example `.agentv.yaml` to docs/examples/simple/
- [ ] 4.5 Update README with glob pattern examples
