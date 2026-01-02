# vision-input Specification

## Purpose
Enable AgentV to accept image inputs in evaluation test cases, supporting local files, URLs, and base64 data URIs. This capability allows testing of vision-capable AI agents with multimodal (text + image) inputs.

## ADDED Requirements

### Requirement: Image Content Type MUST be supported in messages
The YAML schema and message structure SHALL support `type: image` content items alongside text content, allowing images to be included in evaluation input messages.

#### Scenario: Parse image content from local file
Given an eval YAML file with:
```yaml
input_messages:
  - role: user
    content:
      - type: text
        value: "Describe this image"
      - type: image
        value: ./test-images/photo.jpg
        detail: high
```
When parsed by the eval loader
Then the message SHALL contain an `ImageContentItem` with `value: "./test-images/photo.jpg"` and `detail: "high"`.

#### Scenario: Parse image content from URL
Given an eval YAML file with:
```yaml
input_messages:
  - role: user
    content:
      - type: image_url
        value: https://example.com/image.jpg
```
When parsed by the eval loader
Then the message SHALL contain an `ImageContentItem` with `value: "https://example.com/image.jpg"`.

#### Scenario: Parse image content from base64 data URI
Given an eval YAML file with:
```yaml
input_messages:
  - role: user
    content:
      - type: image
        value: data:image/jpeg;base64,/9j/4AAQSkZJRg...
```
When parsed by the eval loader
Then the message SHALL contain an `ImageContentItem` with the full data URI as the value.

---

### Requirement: Image Detail Level MUST be configurable
The image content item SHALL support an optional `detail` parameter to control the resolution/quality trade-off for vision models.

#### Scenario: Specify low detail for cost optimization
Given an image content item with `detail: low`
When passed to a vision provider
Then the provider SHALL receive the `low` detail parameter, resulting in ~85 tokens per image.

#### Scenario: Specify high detail for complex analysis
Given an image content item with `detail: high`
When passed to a vision provider
Then the provider SHALL receive the `high` detail parameter, resulting in ~765-1360 tokens per image.

#### Scenario: Use auto detail for automatic selection
Given an image content item with `detail: auto`
When passed to a vision provider
Then the provider SHALL receive the `auto` detail parameter, allowing the model to choose based on the task.

#### Scenario: Default to high detail when not specified
Given an image content item without a `detail` parameter
When passed to a vision provider
Then the provider SHALL use `high` detail by default.

---

### Requirement: MIME Type Detection MUST be automatic with manual override
The system SHALL automatically detect image MIME types from file extensions or content, while allowing explicit specification for edge cases.

#### Scenario: Detect MIME type from file extension
Given an image with path `./photo.jpg`
When loading the image
Then the MIME type SHALL be detected as `image/jpeg`.

#### Scenario: Detect MIME type from data URI
Given a data URI `data:image/png;base64,...`
When parsing the URI
Then the MIME type SHALL be extracted as `image/png`.

#### Scenario: Override MIME type explicitly
Given an image content item with:
```yaml
type: image
value: ./file.img
mimeType: image/webp
```
When loading the image
Then the MIME type SHALL be `image/webp` as specified.

---

### Requirement: Image Loading MUST support multiple sources
The system SHALL load images from local file paths, HTTP/HTTPS URLs, and base64-encoded data URIs.

#### Scenario: Load image from local file system
Given an image path `./test-images/sample.jpg` that exists
When loading the image
Then the image file SHALL be read into a Buffer successfully.

#### Scenario: Load image from HTTP URL
Given an image URL `https://example.com/image.png`
When loading the image
Then the image SHALL be fetched via HTTP and loaded into a Buffer.

#### Scenario: Parse base64 data URI
Given a data URI `data:image/jpeg;base64,/9j/4AAQ...`
When parsing the URI
Then the base64 data SHALL be decoded into a Buffer.

#### Scenario: Reject invalid file paths
Given an image path `./nonexistent.jpg` that does not exist
When attempting to load the image
Then the system SHALL throw an error with message "Image file not found: ./nonexistent.jpg".

#### Scenario: Reject invalid URLs
Given an invalid URL `https://invalid-domain-xyz/image.jpg`
When attempting to load the image
Then the system SHALL throw an error indicating the URL is unreachable.

---

### Requirement: Image Validation MUST enforce size and format constraints
The system SHALL validate that images meet provider requirements for format, dimensions, and file size before attempting evaluation.

#### Scenario: Validate supported image formats
Given an image with format JPEG, PNG, WEBP, GIF, or BMP
When validating the image
Then the image SHALL pass format validation.

#### Scenario: Reject unsupported image formats
Given an image with format TIFF or SVG
When validating the image
Then the system SHALL throw an error "Unsupported image format: image/tiff".

#### Scenario: Validate image dimensions
Given an image with dimensions 1920x1080 pixels
When validating the image
Then the image SHALL pass dimension validation (within 50x50 to 16,000x16,000 range).

#### Scenario: Reject oversized images by dimensions
Given an image with dimensions 20,000x20,000 pixels
When validating the image
Then the system SHALL throw an error "Image dimensions exceed maximum: 16,000x16,000 pixels".

#### Scenario: Reject oversized images by file size
Given an image file larger than 20MB
When validating the image
Then the system SHALL throw an error "Image file size exceeds maximum: 20MB".

---

### Requirement: Multiple Images per Message MUST be supported
A single message content array SHALL support multiple image content items, allowing comparison and multi-image analysis tasks.

#### Scenario: Include multiple images in one message
Given a message with content:
```yaml
content:
  - type: text
    value: "Compare these images"
  - type: image
    value: ./before.jpg
  - type: image
    value: ./after.jpg
```
When parsed
Then the message SHALL contain 2 image content items in the correct order.

---

### Requirement: Image Context MUST persist in multi-turn conversations
When an image is included in a message, it SHALL remain part of the conversation context for subsequent turns, following the `conversation_id` pattern.

#### Scenario: Maintain image context across conversation turns
Given an eval case with `conversation_id: vision-chat-001` containing an image in turn 1
When loading turn 2 of the same conversation
Then the full conversation history including the image SHALL be available to the model.

---

## Cross-References

**Related Capabilities:**
- `yaml-schema` - Requires extension to parse image content types
- `vision-evaluators` - Depends on images being loaded and passed to evaluators
- `eval-execution` - Needs to handle image loading during eval runs
- `multiturn-messages-lm-provider` - Multi-turn conversations with images

**Sequence:**
1. This capability (image input) must be implemented first
2. Then `vision-evaluators` can be implemented
3. Finally `vision-evaluation` examples can be used

---

## Implementation Notes

### TypeScript Type Definitions
```typescript
interface ImageContentItem {
  type: 'image' | 'image_url';
  value: string;  // file path, URL, or data URI
  detail?: 'low' | 'high' | 'auto';
  mimeType?: string;
}

type ContentItem = TextContentItem | ImageContentItem | FileContentItem;
```

### Image Loader Interface
```typescript
interface ImageLoader {
  load(source: string): Promise<Buffer>;
  detectMimeType(buffer: Buffer): string;
  validate(buffer: Buffer): ValidationResult;
}
```

### Supported MIME Types
- `image/jpeg`
- `image/png`
- `image/webp`
- `image/gif`
- `image/bmp`

### Size Constraints
- **Minimum**: 50x50 pixels
- **Maximum**: 16,000x16,000 pixels
- **File Size**: 20MB maximum

---

## Future Enhancements (Out of Scope)
- Cloud storage URLs (gs://, s3://)
- Automatic image resizing/optimization
- Image caching to reduce redundant loads
- Progressive image loading
- Video input support
