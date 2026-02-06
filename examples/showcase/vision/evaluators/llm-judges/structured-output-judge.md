# Structured Output Judge for Vision Tasks
# Evaluates quality of structured JSON outputs from vision analysis

You are evaluating an AI assistant's ability to return structured, well-formatted JSON from vision analysis tasks.

## Evaluation Criteria

### 1. JSON Validity (30%)
- Is the output valid, parseable JSON?
- Are there any syntax errors?
- Is the structure consistent?

### 2. Schema Compliance (35%)
- Does it match the requested structure?
- Are all required fields present?
- Are field types correct?
- Are array structures appropriate?

### 3. Data Accuracy (25%)
- Are the values extracted from the image accurate?
- Are counts, positions, and attributes correct?
- Are confidence scores reasonable?

### 4. Completeness (10%)
- Are all relevant visual elements captured?
- Is the level of detail appropriate?
- Are optional but useful fields included?

## Input Data

**User's Question**: {{input}}

**AI Response**: {{output}}

**Expected Structure**: {{expected_output}}

**Image Reference**: {{image_reference}}

## Evaluation Task

Assess the quality of the structured JSON output from vision analysis.

## Output Format

```json
{
  "score": 0.88,
  "passed": true,
  "details": {
    "json_validity": 1.0,
    "schema_compliance": 0.9,
    "data_accuracy": 0.85,
    "completeness": 0.8
  },
  "reasoning": "Valid JSON with correct schema. Object detection mostly accurate. Some optional details missing.",
  "issues": {
    "parsing_errors": [],
    "schema_violations": ["Missing 'confidence' field in one object"],
    "accuracy_issues": ["Count slightly off for 'can' objects"],
    "missing_data": ["Object colors not included"]
  },
  "extracted_data": {
    "objects_detected": 16,
    "confidence_range": [0.85, 0.98],
    "categories_present": ["bottle", "can", "box"]
  },
  "strengths": [
    "Perfect JSON syntax",
    "Correct array structure",
    "Accurate position descriptions",
    "Reasonable confidence scores"
  ],
  "improvements": [
    "Include confidence for all objects",
    "Add color information",
    "Consider bounding boxes"
  ]
}
```

## JSON Validation Checks

### Required Structure Elements
- All specified fields present
- Correct data types (string, number, boolean, array, object)
- Proper nesting for hierarchical data
- Consistent array item structure

### Common Issues to Check
- **Missing fields**: Required properties not included
- **Type mismatches**: String instead of number, etc.
- **Empty arrays**: When data should be present
- **Inconsistent structures**: Different objects in same array with different schemas
- **Invalid values**: Negative confidence scores, impossible counts

### Visual Data Accuracy
- Object counts match image
- Positions/locations accurate
- Attributes (color, size) correct
- Relationships properly described
- Confidence scores calibrated

## Scoring Guidelines

**0.9-1.0: Excellent**
- Perfect JSON syntax
- Full schema compliance
- Accurate visual data
- Complete information

**0.7-0.89: Good**
- Valid JSON
- Minor schema issues
- Mostly accurate data
- Key information present

**0.5-0.69: Acceptable**
- Parseable JSON
- Some schema violations
- Several accuracy issues
- Important data missing

**0.3-0.49: Poor**
- JSON issues or major schema violations
- Significant inaccuracies
- Incomplete data

**0.0-0.29: Failed**
- Invalid JSON or completely wrong structure
- Grossly inaccurate data

## Special Considerations

- **Flexibility**: Accept reasonable variations in structure if data is complete
- **Confidence scores**: Should be between 0.0 and 1.0 (or 0-100 for percentages)
- **Positions**: Various formats acceptable (coordinates, descriptions, regions)
- **Arrays**: Empty arrays acceptable if no objects of that type present
- **Additional fields**: Extra fields are fine, don't penalize
- **Formatting**: Whitespace and formatting don't matter, focus on structure and data

## Example Good Response

```json
{
  "objects": [
    {
      "name": "laptop",
      "count": 1,
      "position": "center desk",
      "confidence": 0.98,
      "color": "silver",
      "attributes": ["open", "powered on"]
    },
    {
      "name": "coffee mug",
      "count": 2,
      "position": "desk right side",
      "confidence": 0.95,
      "color": "white"
    }
  ],
  "scene": "office workspace",
  "dominant_colors": ["white", "gray", "brown"],
  "lighting": "natural, well-lit"
}
```

## Example Poor Response

```json
{
  "objects": "laptop and coffee mugs",  // Should be array
  "scene": "office workspace",
  // Missing dominant_colors field
  "extra_field": null
}
```
