---
name: image-compress-and-docs
description: Capture, optimize, and publish screenshots to Astro docs. Use when asked to take screenshots for docs, update doc images, compress PNG assets, or add visual documentation to the agentv.dev docs site. Triggers on "add screenshots to docs", "update docs images", "compress screenshots", "optimize PNG", "document with screenshots".
---

# Image Compression & Docs Update

Capture browser screenshots, optimize them for the web, and publish to the Astro docs site at `apps/web/src/content/docs/`.

## Prerequisites

Install optimization tools if not present:
```bash
# Ubuntu/Debian (usually pre-installed)
sudo apt-get install -y pngquant optipng

# macOS
brew install pngquant optipng
```

Verify:
```bash
which pngquant optipng
```

## Step 1 — Capture Screenshots

Use `agent-browser` with a named session and 1440×860 viewport for docs-quality screenshots. Always use `--session` to isolate, never `--headed`.

```bash
# Start the target server first (e.g., Studio)
bun apps/cli/src/cli.ts studio --port 14800 &
sleep 3

# Open, set viewport, navigate, screenshot
agent-browser --session docs-shots open http://localhost:14800
agent-browser --session docs-shots wait --load networkidle
agent-browser --session docs-shots set viewport 1440 860
agent-browser --session docs-shots snapshot -i          # discover refs
agent-browser --session docs-shots click <ref>          # navigate if needed
agent-browser --session docs-shots wait --load networkidle
agent-browser --session docs-shots screenshot           # saved to /run/user/1000/agent-browser/tmp/screenshots/

# Clean up
agent-browser --session docs-shots close
kill $(lsof -ti:14800) 2>/dev/null
```

**Screenshots with realistic data:** Studio screenshots must have populated data — multiple runs with varying pass rates and real targets. If results are sparse, create synthetic JSONL files in `.agentv/results/runs/<experiment>/<timestamp>/index.jsonl` with realistic fields before launching Studio.

Synthetic JSONL record format:
```json
{"test_id": "my-test", "score": 0.95, "target": "claude-sonnet", "experiment": "default", "timestamp": "2026-04-08T09:15:44.003Z", "execution_status": "success", "suite": "my-suite", "category": "default", "duration_ms": 3500, "token_usage": {"input_tokens": 1200, "output_tokens": 400}, "scores": [{"type": "llm-grader", "score": 0.95, "passed": true}], "error": null}
```

## Step 2 — Optimize

Always apply both passes: **pngquant** (lossy, 50–70% savings) then **optipng** (lossless polish).

```bash
SHOT="/run/user/1000/agent-browser/tmp/screenshots/screenshot-<id>.png"
OUT="/home/christso/projects/agentv/apps/web/src/assets/screenshots/my-feature.png"

# Pass 1: lossy quantization (creates <name>-fs8.png or use --output)
pngquant --quality 80-95 --force --output /tmp/opt.png "$SHOT"

# Pass 2: lossless polish
optipng -o5 -quiet /tmp/opt.png

# Copy to docs assets
cp /tmp/opt.png "$OUT"

# Check savings
ls -lh "$SHOT" "$OUT"
```

**Typical results:** 116 KB raw → 44 KB optimized (62% reduction).

For multiple files:
```bash
SHOTS_DIR="/run/user/1000/agent-browser/tmp/screenshots"
ASSETS_DIR="/home/christso/projects/agentv/apps/web/src/assets/screenshots"

for f in shot1.png shot2.png shot3.png; do
  pngquant --quality 80-95 --force --output "$SHOTS_DIR/opt-$f" "$SHOTS_DIR/$f"
  optipng -o5 -quiet "$SHOTS_DIR/opt-$f"
  cp "$SHOTS_DIR/opt-$f" "$ASSETS_DIR/$f"
done
ls -lh "$ASSETS_DIR"
```

## Step 3 — Update Astro Docs

Docs live at: `apps/web/src/content/docs/docs/`  
Assets live at: `apps/web/src/assets/screenshots/`

**Import pattern** (Astro `<Image>` for automatic optimization):
```mdx
import { Image } from 'astro:assets';
import myFeature from '../../../../assets/screenshots/my-feature.png';
import myDetail from '../../../../assets/screenshots/my-detail.png';

<Image src={myFeature} alt="Descriptive alt text for accessibility" />
```

**Alt text rules:**
- Describe what the screenshot shows, not just what the feature is
- Include key data visible in the image (e.g., "showing 100% pass rate across 5 tests")
- Never use "screenshot of" — just describe the content

**Placement:**
- Put the hero image directly after the intro paragraph (before ## Usage)
- Put feature-specific images directly after the section that describes them
- Don't cluster all images at the top or bottom

## Step 4 — Commit

```bash
# Feature branch: UI changes
cd /path/to/worktree
git add apps/studio/...
git commit -m "fix(studio): ..."

# Main repo: docs changes  
cd /home/christso/projects/agentv
git add apps/web/src/assets/screenshots/ apps/web/src/content/docs/
git commit -m "docs(<feature>): add screenshots and update documentation"
git push
```

## Checklist

- [ ] Screenshots show realistic data (multiple runs, real targets, varying scores)
- [ ] Viewport set to 1440×860 before capturing
- [ ] Both pngquant and optipng applied
- [ ] File size verified (target: <50 KB per screenshot)
- [ ] Alt text is descriptive and specific
- [ ] Image placed close to the content it illustrates
- [ ] Astro `<Image>` component used (not raw `<img>`)
- [ ] Docs committed separately from code changes
