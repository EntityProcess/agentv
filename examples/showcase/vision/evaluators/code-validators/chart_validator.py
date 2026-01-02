#!/usr/bin/env python3
"""
Chart Data Validator
Code-based evaluator for validating data extraction from charts and graphs
"""

import sys
import json
import re
from typing import Dict, Any, List, Tuple


def extract_currency_values(text: str) -> List[float]:
    """Extract monetary values from text (e.g., $2.4M, $1,500)"""
    # Pattern for currency with K/M/B suffixes
    pattern = r'\$?\s*(\d+\.?\d*)\s*([KMB])?'
    
    values = []
    for match in re.finditer(pattern, text, re.IGNORECASE):
        value = float(match.group(1))
        suffix = match.group(2)
        
        if suffix:
            multipliers = {'K': 1_000, 'M': 1_000_000, 'B': 1_000_000_000}
            value *= multipliers.get(suffix.upper(), 1)
        
        values.append(value)
    
    return values


def extract_percentages(text: str) -> List[float]:
    """Extract percentage values from text"""
    pattern = r'(\d+\.?\d*)\s*%'
    return [float(match.group(1)) for match in re.finditer(pattern, text)]


def extract_quarters(text: str) -> List[str]:
    """Extract quarter references (Q1, Q2, etc.)"""
    pattern = r'Q[1-4]\s+\d{4}'
    return re.findall(pattern, text)


def validate_numeric_accuracy(
    found_values: List[float],
    expected_values: List[float],
    tolerance: float = 0.1
) -> Tuple[int, List[float], List[float]]:
    """
    Validate numeric values with tolerance
    
    Returns:
        (matches_count, matched_values, missing_values)
    """
    matched = []
    missing = expected_values.copy()
    
    for expected in expected_values:
        for found in found_values:
            # Check if within tolerance (percentage)
            if abs(found - expected) / expected <= tolerance:
                matched.append(expected)
                if expected in missing:
                    missing.remove(expected)
                break
    
    return len(matched), matched, missing


def validate_chart_data(
    output: str,
    expected_output: str,
    input_text: str = "",
    tolerance: float = 0.15
) -> Dict[str, Any]:
    """
    Validate data extraction from charts/graphs
    
    Args:
        output: AI's chart analysis
        expected_output: Expected data points and insights
        input_text: Original question
        tolerance: Acceptable error margin (default 15%)
    
    Returns:
        Evaluation result
    """
    
    # Extract values from both outputs
    output_currency = extract_currency_values(output)
    expected_currency = extract_currency_values(expected_output)
    
    output_percentages = extract_percentages(output)
    expected_percentages = extract_percentages(expected_output)
    
    output_quarters = extract_quarters(output)
    expected_quarters = extract_quarters(expected_output)
    
    # Validate currency values
    currency_matches = 0
    if expected_currency:
        currency_matches, matched_curr, missing_curr = validate_numeric_accuracy(
            output_currency, expected_currency, tolerance
        )
        currency_accuracy = currency_matches / len(expected_currency)
    else:
        currency_accuracy = 1.0
        matched_curr = []
        missing_curr = []
    
    # Validate percentages
    percentage_matches = 0
    if expected_percentages:
        percentage_matches, matched_pct, missing_pct = validate_numeric_accuracy(
            output_percentages, expected_percentages, tolerance
        )
        percentage_accuracy = percentage_matches / len(expected_percentages)
    else:
        percentage_accuracy = 1.0
        matched_pct = []
        missing_pct = []
    
    # Validate quarter references
    if expected_quarters:
        quarter_matches = len(set(output_quarters) & set(expected_quarters))
        quarter_accuracy = quarter_matches / len(expected_quarters)
    else:
        quarter_accuracy = 1.0
        quarter_matches = 0
    
    # Calculate overall score (weighted average)
    weights = {
        'currency': 0.5,
        'percentage': 0.3,
        'quarters': 0.2
    }
    
    overall_score = (
        currency_accuracy * weights['currency'] +
        percentage_accuracy * weights['percentage'] +
        quarter_accuracy * weights['quarters']
    )
    
    passed = overall_score >= 0.7  # 70% threshold
    
    # Build detailed reasoning
    reasoning_parts = []
    if expected_currency:
        reasoning_parts.append(
            f"Currency values: {currency_matches}/{len(expected_currency)} matched"
        )
    if expected_percentages:
        reasoning_parts.append(
            f"Percentages: {percentage_matches}/{len(expected_percentages)} matched"
        )
    if expected_quarters:
        reasoning_parts.append(
            f"Quarters: {quarter_matches}/{len(expected_quarters)} matched"
        )
    
    return {
        "status": "processed",
        "score": round(overall_score, 3),
        "passed": passed,
        "details": {
            "currency_validation": {
                "accuracy": round(currency_accuracy, 3),
                "expected": expected_currency,
                "found": output_currency,
                "matched": matched_curr,
                "missing": missing_curr
            },
            "percentage_validation": {
                "accuracy": round(percentage_accuracy, 3),
                "expected": expected_percentages,
                "found": output_percentages,
                "matched": matched_pct,
                "missing": missing_pct
            },
            "quarter_validation": {
                "accuracy": round(quarter_accuracy, 3),
                "expected": expected_quarters,
                "found": output_quarters
            },
            "tolerance": tolerance,
            "reasoning": "; ".join(reasoning_parts)
        }
    }


def main():
    """Main entry point for CLI usage"""
    if len(sys.argv) > 1:
        eval_data = json.loads(sys.argv[1])
    else:
        eval_data = json.load(sys.stdin)
    
    output = eval_data.get("output", "")
    expected_output = eval_data.get("expected_output", "")
    input_text = eval_data.get("input", "")
    tolerance = eval_data.get("tolerance", 0.15)
    
    result = validate_chart_data(output, expected_output, input_text, tolerance)
    
    print(json.dumps(result, indent=2))
    
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
