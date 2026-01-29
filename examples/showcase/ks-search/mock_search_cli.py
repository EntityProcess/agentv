#!/usr/bin/env python3
"""
Mock CLI that simulates a knowledge search API with filtering and summary generation.
Demonstrates CLI target usage for evaluating search-based AI summaries.

Usage:
  uv run mock_search_cli.py --prompt "{PROMPT}" --limit 10 --datasource wta.subjectcontent --output-file {OUTPUT_FILE}
  uv run mock_search_cli.py --prompt "{PROMPT}" --filter product=Cargowise --membership-level premium
Healthcheck:
  uv run mock_search_cli.py --healthcheck
"""
import argparse
import json
import sys
from pathlib import Path
from typing import Any

# Mock search results database
MOCK_CONTENT_DB: list[dict[str, Any]] = [
    {
        "id": "qs-001",
        "type": "quickstart",
        "title": "Getting Started with CargoWise",
        "url": "https://academy.example.com/quickstarts/cargowise-intro",
        "product": "Cargowise",
        "membership_level": "free",
        "content": "Introduction to CargoWise logistics software.",
        "has_video": True,
    },
    {
        "id": "course-001",
        "type": "course",
        "title": "Dangerous Goods Handling (IATA DGR)",
        "url": "https://academy.example.com/courses/dangerous-goods-iata",
        "product": "Cargowise",
        "membership_level": "premium",
        "content": "Comprehensive training on IATA dangerous goods regulations.",
        "duration": "4 hours",
    },
    {
        "id": "qs-002",
        "type": "quickstart",
        "title": "Customs Module Overview",
        "url": "https://academy.example.com/quickstarts/customs-module",
        "product": "Cargowise",
        "membership_level": "free",
        "content": "Learn how to use the CargoWise customs module.",
        "has_video": False,
    },
    {
        "id": "course-002",
        "type": "course",
        "title": "Supply Chain Fundamentals",
        "url": "https://academy.example.com/courses/supply-chain",
        "product": "General",
        "membership_level": "free",
        "content": "Basic concepts of supply chain management.",
        "duration": "2 hours",
    },
    {
        "id": "program-001",
        "type": "program",
        "title": "CargoWise Certification Program",
        "url": "https://academy.example.com/programs/cw-certification",
        "product": "Cargowise",
        "membership_level": "enterprise",
        "content": "Full certification track for CargoWise professionals.",
        "duration": "40 hours",
    },
    {
        "id": "qs-003",
        "type": "quickstart",
        "title": "Invoice Generation Guide",
        "url": "https://academy.example.com/quickstarts/invoice-generation",
        "product": "Cargowise",
        "membership_level": "premium",
        "content": "Step-by-step guide to generating invoices in CargoWise.",
        "has_video": True,
    },
    {
        "id": "course-003",
        "type": "course",
        "title": "Chain of Responsibility Compliance",
        "url": "https://academy.example.com/courses/chain-of-responsibility",
        "product": "Cargowise",
        "membership_level": "premium",
        "content": "Training on Chain of Responsibility regulations for logistics.",
        "duration": "3 hours",
    },
]

# Fallback message (exact text from prompt requirements)
FALLBACK_MESSAGE = (
    "This overview does not have information on this topic. "
    "It is designed to answer only questions related to WiseTech Academy content. "
    "Try refining the search terms or browse the catalog to find available learning."
)

# Topics that should trigger fallback
OUT_OF_SCOPE_TOPICS = [
    "competitor",
    "alternative",
    "oracle",
    "sap",
    "personal",
    "political",
    "religious",
    "staff",
    "employee",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mock KS Search CLI for AgentV demo")
    parser.add_argument("--prompt", dest="prompt", required=False, help="Search query/prompt")
    parser.add_argument("--limit", dest="limit", type=int, default=10, help="Max results to return")
    parser.add_argument(
        "--datasource",
        dest="datasource",
        default="wta.subjectcontent",
        help="Data source (wta.subjectcontent, wta.course, wta.program)",
    )
    parser.add_argument(
        "--filter",
        dest="filters",
        action="append",
        default=[],
        help="Filter in key=value format (e.g., product=Cargowise)",
    )
    parser.add_argument(
        "--membership-level",
        dest="membership_level",
        default="free",
        choices=["free", "premium", "enterprise"],
        help="User membership level for access control",
    )
    parser.add_argument(
        "--output-file", dest="output_file", required=False, help="Write response to this file"
    )
    parser.add_argument("--healthcheck", action="store_true", help="Run health check")
    return parser.parse_args()


def should_return_fallback(prompt: str) -> bool:
    """Check if the prompt should trigger the fallback message."""
    prompt_lower = prompt.lower()
    return any(topic in prompt_lower for topic in OUT_OF_SCOPE_TOPICS)


def filter_by_membership(results: list[dict], level: str) -> list[dict]:
    """Filter results based on membership level access."""
    level_hierarchy = {"free": 0, "premium": 1, "enterprise": 2}
    user_level = level_hierarchy.get(level, 0)
    return [r for r in results if level_hierarchy.get(r.get("membership_level", "free"), 0) <= user_level]


def filter_by_params(results: list[dict], filters: list[str]) -> list[dict]:
    """Filter results based on key=value filter parameters."""
    if not filters:
        return results
    filtered = results
    for f in filters:
        if "=" not in f:
            continue
        key, value = f.split("=", 1)
        key = key.strip().lower()
        value = value.strip().lower()
        filtered = [r for r in filtered if r.get(key, "").lower() == value]
    return filtered


def search_content(prompt: str, limit: int, datasource: str) -> list[dict]:
    """Simple keyword search in mock database."""
    prompt_lower = prompt.lower()
    keywords = prompt_lower.split()

    # Filter by datasource type
    type_map = {
        "wta.subjectcontent": None,  # All types
        "wta.course": "course",
        "wta.program": "program",
    }
    target_type = type_map.get(datasource)

    results = []
    for item in MOCK_CONTENT_DB:
        if target_type and item["type"] != target_type:
            continue

        # Simple relevance: count keyword matches
        text = f"{item['title']} {item['content']}".lower()
        score = sum(1 for kw in keywords if kw in text)
        if score > 0:
            results.append({**item, "_score": score})

    # Sort by score and limit
    results.sort(key=lambda x: x["_score"], reverse=True)
    return results[:limit]


def generate_summary(results: list[dict], prompt: str) -> str:
    """Generate a mock AI summary based on search results."""
    if not results:
        return FALLBACK_MESSAGE

    # Build overview
    top_result = results[0]
    overview = f"*{top_result['title']}* provides relevant information for your query about {prompt.lower()[:50]}."

    # Top result card
    card_suffix = ' "Card video"' if top_result.get("has_video") else ' "Card"'
    card = f"**Top result:** [{top_result['title']}]({top_result['url']}{card_suffix})"

    # Further details (if more than 1 result)
    further_details = ""
    if len(results) > 1:
        bullets = []
        for r in results[1:4]:
            bullets.append(f"- **{r['title']}:** {r['content'][:80]}...")
        further_details = "#### **Related topics**\n" + "\n".join(bullets)

    # Further learning table
    learning_rows = []
    for r in results[:5]:
        duration = r.get("duration", "Self-paced")
        learning_rows.append(f"| [{r['title']}]({r['url']}) | {r['content'][:60]}... Duration: {duration} |")

    further_learning = """#### **Further learning**
| Learning title | Description |
| --- | --- |
""" + "\n".join(
        learning_rows
    )

    # Combine sections
    sections = [overview, "", card]
    if further_details:
        sections.extend(["", further_details])
    sections.extend(["", further_learning])

    return "\n".join(sections)


def main() -> int:
    args = parse_args()

    # Debug output
    print(f"[mock_search_cli] argv: {sys.argv}", file=sys.stderr)

    if args.healthcheck:
        print("ks-search demo: healthy")
        return 0

    if not args.prompt:
        print("No prompt provided.", file=sys.stderr)
        return 1

    # Check for out-of-scope topics
    if should_return_fallback(args.prompt):
        response = FALLBACK_MESSAGE
    else:
        # Search and filter
        results = search_content(args.prompt, args.limit, args.datasource)
        results = filter_by_params(results, args.filters)
        results = filter_by_membership(results, args.membership_level)

        # Generate summary
        response = generate_summary(results, args.prompt)

    # Output
    if args.output_file:
        output_path = Path(args.output_file)
        try:
            print(f"[mock_search_cli] writing output to: {output_path}", file=sys.stderr)
            output_path.write_text(response, encoding="utf-8")
        except OSError as exc:
            print(f"Failed to write output file: {exc}", file=sys.stderr)
            return 1
    else:
        print(response)

    return 0


if __name__ == "__main__":
    sys.exit(main())
