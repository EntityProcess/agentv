# Vision Examples Test Images

This directory is for placing test images used by the vision evaluation examples.

## Required Images

To run the vision evaluation examples, you'll need to provide the following test images:

### Basic Image Analysis (`basic-image-analysis.yaml`)
1. **sample-office.jpg** - Office workspace scene with desk, computer, chair
2. **objects-scene.jpg** - Scene with multiple countable objects (e.g., fruits, toys)
3. **spatial-layout.jpg** - Image with clear spatial relationships between objects
4. **text-document.jpg** - Image containing readable text (receipt, sign, document)
5. **comparison-before.jpg** - "Before" image for comparison task
6. **comparison-after.jpg** - "After" image showing changes from before
7. **colorful-scene.jpg** - Image with distinct, identifiable colors

### Advanced Vision Tasks (`advanced-vision-tasks.yaml`)
1. **street-scene.jpg** - Complex outdoor scene for structured detection
2. **chess-puzzle.jpg** - Chess board position for visual reasoning
3. **activity-photo.jpg** - People performing activities
4. **quality-test.jpg** - Image for quality assessment (any photo)
5. **bar-chart.jpg** - Bar chart or graph for data extraction
6. **complex-scene.jpg** - Rich scene for context inference
7. **instruction-reference.jpg** - Image referenced in instruction-following task

## Image Requirements

- **Formats:** JPEG, PNG, WEBP, GIF (non-animated), BMP
- **Size:** 50x50 to 16,000x16,000 pixels
- **File Size:** Maximum 20MB per image
- **Naming:** Use descriptive filenames matching the eval case expectations

## Alternative: Using URLs

Instead of local files, you can use publicly accessible image URLs:
- Update the YAML files to reference URLs instead of local paths
- Example: `value: https://example.com/images/sample-office.jpg`
- Ensure URLs are stable and accessible

## Test Image Sources

You can create or obtain test images from:
- **Your own photos** - Best for realistic testing
- **Free stock photo sites** - Unsplash, Pexels, Pixabay (check licenses)
- **Generated images** - AI image generators for specific scenarios
- **Public domain** - Wikimedia Commons, NASA image library

## Privacy & Copyright

⚠️ **Important:**
- Do not commit copyrighted images to git repositories
- Ensure you have rights to use any test images
- This directory contains `.gitkeep` only - images are user-provided
- Add test images to `.gitignore` if sharing repositories

## Usage

Place your test images in this directory, then run evaluations from the parent directory:

```bash
# Run basic vision evals
agentv run datasets/basic-image-analysis.yaml

# Run advanced vision evals
agentv run datasets/advanced-vision-tasks.yaml
```
