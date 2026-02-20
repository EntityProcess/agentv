# Example: JSON Messages Input

## Input

```json
[
  {"role": "user", "content": "Convert 72°F to Celsius"},
  {"role": "assistant", "content": "72°F is approximately 22.2°C. The formula is: (°F - 32) × 5/9 = °C"},
  {"role": "user", "content": "What about -40?"},
  {"role": "assistant", "content": "-40°F equals exactly -40°C. This is the unique point where Fahrenheit and Celsius scales intersect."},
  {"role": "user", "content": "Is 0 Kelvin the same as -273.15°C?"},
  {"role": "assistant", "content": "Yes, 0 Kelvin (absolute zero) equals -273.15°C. It's the theoretical lowest possible temperature where all molecular motion stops."}
]
```

## Output

```yaml
description: "Temperature conversion and thermodynamics knowledge"

tests:
  - id: fahrenheit-to-celsius
    criteria: "Convert Fahrenheit to Celsius with correct formula"
    input: "Convert 72°F to Celsius"
    expected_output: "72°F is approximately 22.2°C. The formula is: (°F - 32) × 5/9 = °C"
    rubrics:
      - Provides the correct converted value (approximately 22.2°C)
      - Shows or references the conversion formula
      - Uses appropriate precision

  - id: negative-forty-intersection
    criteria: "Identify the Fahrenheit-Celsius intersection point"
    input_messages:
      - role: user
        content: "Convert 72°F to Celsius"
      - role: assistant
        content: "72°F is approximately 22.2°C."
      - role: user
        content: "What about -40?"
    expected_output: "-40°F equals exactly -40°C. This is the unique point where Fahrenheit and Celsius scales intersect."
    rubrics:
      - States that -40°F equals -40°C
      - Mentions this is the intersection point of both scales

  - id: absolute-zero
    criteria: "Confirm absolute zero equivalence and explain its significance"
    input: "Is 0 Kelvin the same as -273.15°C?"
    expected_output: "Yes, 0 Kelvin (absolute zero) equals -273.15°C. It's the theoretical lowest possible temperature where all molecular motion stops."
    rubrics:
      - Confirms the equivalence of 0K and -273.15°C
      - Explains the physical significance of absolute zero

# Suggested evaluators:
# execution:
#   evaluators:
#     - name: accuracy
#       type: code_judge
#       script: ./scripts/check_conversion.py
#     - name: quality
#       type: llm_judge
#       prompt: ./prompts/quality.md
```
