#!/bin/bash
# Mock agent for testing bug-fix evaluations without API keys

PROMPT_FILE="$1"
OUTPUT_FILE="$2"

# Read the prompt to understand what's being asked
PROMPT=$(cat "$PROMPT_FILE")

# Extract the test case from the prompt
if echo "$PROMPT" | grep -q "null.*check"; then
    # Null check bug
    cat > "$OUTPUT_FILE" << 'EOF'
I'll fix the null check bug by adding a proper null/undefined check before accessing properties.

```python
def process(value):
    # Fixed: Check for None/null before accessing properties
    if value is None:
        return "empty"
    return value.lower() if value else "empty"
```

The fix uses `if value is None` to check for null values before trying to call `.lower()` on the value. This prevents the TypeError when None is passed to the function.
EOF
elif echo "$PROMPT" | grep -q "timeout"; then
    # Timeout fallback bug
    cat > "$OUTPUT_FILE" << 'EOF'
I'll fix the timeout fallback bug by using the null-coalescing operator.

```python
# In django/core/handlers/base.py
DEFAULT_TIMEOUT = 30

# Before (buggy):
timeout = self.timeout  # Crashes when not configured

# After (fixed):
timeout = self.timeout or DEFAULT_TIMEOUT  # Falls back to default
```

The fix uses `or` to provide a fallback to DEFAULT_TIMEOUT when self.timeout is not set.
EOF
elif echo "$PROMPT" | grep -q "property.*access\|duration\|latency"; then
    # Wrong property access bug
    cat > "$OUTPUT_FILE" << 'EOF'
I'll fix the property access bug by using the correct property name.

```python
# In flask/wrappers.py
# Before (buggy):
duration = response.latency  # Wrong property name

# After (fixed):
duration = response.duration  # Correct property name
```

The fix accesses `response.duration` instead of `response.latency` to correctly retrieve the execution time.
EOF
else
    # Generic response
    cat > "$OUTPUT_FILE" << 'EOF'
I'll analyze the bug and provide a fix.

The issue appears to be a missing null check or incorrect property access. I'll add defensive code to handle edge cases:

```python
# Generic fix pattern
def safe_operation(value):
    if value is None:
        return None
    return value.some_method()
```

This prevents crashes when None values are encountered.
EOF
fi

echo "Mock agent response written to $OUTPUT_FILE" >&2
