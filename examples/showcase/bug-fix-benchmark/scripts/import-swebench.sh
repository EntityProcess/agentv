#!/bin/bash
# Import SWE-bench instances into AgentV eval format

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_FILE="$SCRIPT_DIR/../evals/swe-bench-imported.eval.yaml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Import SWE-bench instances into AgentV eval format.

Options:
    -f, --file FILE      SWE-bench JSON/JSONL file to import
    -u, --url URL        URL to SWE-bench dataset file
    -n, --count N        Limit to N instances (default: all)
    -r, --repo REPO      Filter by repo (e.g., sympy/sympy)
    -o, --output FILE    Output file (default: evals/swe-bench-imported.eval.yaml)
    -h, --help           Show this help

Examples:
    # Import from local file
    $0 --file data/swe-bench.jsonl

    # Import from HuggingFace (requires Python)
    $0 --url https://huggingface.co/datasets/princeton-nlp/SWE-bench/resolve/main/swebench.jsonl

    # Import only sympy repo, limit to 5 instances
    $0 --repo sympy/sympy --count 5

SWE-bench format:
    Each instance should have: repo, base_commit, problem_statement, FAIL_TO_PASS, PASS_TO_PASS

EOF
    exit 1
}

# Default values
FILE=""
URL=""
COUNT=""
REPO=""
OUTPUT="$OUTPUT_FILE"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--file)
            FILE="$2"
            shift 2
            ;;
        -u|--url)
            URL="$2"
            shift 2
            ;;
        -n|--count)
            COUNT="$2"
            shift 2
            ;;
        -r|--repo)
            REPO="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            usage
            ;;
    esac
done

# Check if file or URL is provided
if [ -z "$FILE" ] && [ -z "$URL" ]; then
    echo -e "${RED}Error: Either --file or --url must be specified${NC}"
    usage
fi

# Create temp directory
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

# Download/get data
if [ -n "$URL" ]; then
    echo -e "${GREEN}Downloading SWE-bench data...${NC}"
    curl -sL "$URL" -o "$TMP_DIR/data.jsonl" || {
        echo -e "${RED}Error: Failed to download data${NC}"
        exit 1
    }
    FILE="$TMP_DIR/data.jsonl"
elif [ ! -f "$FILE" ]; then
    echo -e "${RED}Error: File not found: $FILE${NC}"
    exit 1
fi

# Count lines
TOTAL=$(wc -l < "$FILE")
echo -e "${GREEN}Found $TOTAL instances${NC}"

# Start output YAML
cat > "$OUTPUT" << EOF
# SWE-bench Imported Instances
# Auto-generated from SWE-bench dataset
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

description: |
  SWE-bench instances imported for AgentV evaluation.
  Each test case represents a real GitHub issue from a public repository.

workspace:
  docker:
    image: python:3.11-slim
    timeout: 1800
  repos:
    - path: /testbed
      source:
        type: git
        url: https://github.com/{REPO}
      checkout:
        base_commit: "{BASE_COMMIT}"
      clone:
        depth: 1

tags: [swe-bench, coding, bugfix]

tests:

EOF

# Process JSONL
COUNTED=0
SKIPPED=0

while IFS= read -r line; do
    # Apply repo filter if specified
    if [ -n "$REPO" ]; then
        if ! echo "$line" | grep -q "\"repo\":\s*\"$REPO\""; then
            ((SKIPPED++))
            continue
        fi
    fi

    # Apply count limit
    if [ -n "$COUNT" ] && [ $COUNTED -ge $COUNT ]; then
        break
    fi

    # Extract fields using jq or Python
    INSTANCE=$(echo "$line" | python3 -c "
import json, sys
data = json.load(sys.stdin)
repo = data.get('repo', '').replace('/', '__')
base_commit = data.get('base_commit', '')[:12]
instance_id = data.get('instance_id', f'{repo}__{base_commit}')
problem_statement = data.get('problem_statement', '').replace('\"', '\\\"').replace('\n', ' ')
fail_tests = data.get('FAIL_TO_PASS', [])
pass_tests = data.get('PASS_TO_PASS', [])

test_list = fail_tests + pass_tests
test_cmd = ' '.join(test_list[:3]) if test_list else 'pytest'

print(f'{repo}|{base_commit}|{instance_id}|{problem_statement[:200]}|{test_cmd}')
" 2>/dev/null || echo "||||")

    IFS='|' read -r repo commit instance_id problem test_cmd <<< "$INSTANCE"

    if [ -z "$repo" ] || [ -z "$commit" ]; then
        ((SKIPPED++))
        continue
    fi

    # Write test case
    cat >> "$OUTPUT" << EOF
  - case: $(echo "$instance_id" | tr '_' '-' | head -c 60)
    metadata:
      repo: $repo
      base_commit: "$commit"
      problem_statement: |
        $problem_statement
        (Full problem statement available in SWE-bench dataset)
    input: |
      Fix the bug described in the metadata. Run the tests to verify your fix.
    assertions:
      - type: code-grader
        command: |
          cd /testbed && pytest $test_cmd -v

EOF

    ((COUNTED++))
    echo -ne "\r${GREEN}Processed: $COUNTED instances${NC}"

done < "$FILE"

echo ""
echo -e "${GREEN}✓ Imported $COUNTED instances${NC}"
[ $SKIPPED -gt 0 ] && echo -e "${YELLOW}Skipped: $SKIPPED instances${NC}"
echo -e "${GREEN}✓ Output: $OUTPUT${NC}"

# Show summary
cat << EOF

${YELLOW}Next steps:${NC}
1. Review the imported eval: cat $OUTPUT
2. Run with mock agent: agentv eval $OUTPUT --target mock_agent
3. Run with real agent: agentv eval $OUTPUT --target claude_subscription

${YELLOW}Note:${NC} Some instances may need manual adjustment:
- Verify repo URLs are correct
- Adjust test commands if needed
- Some repos may require additional dependencies
EOF
