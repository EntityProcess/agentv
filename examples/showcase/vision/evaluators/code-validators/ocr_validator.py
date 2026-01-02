#!/usr/bin/env python3
"""
OCR Text Accuracy Validator
Code-based evaluator for validating text extraction (OCR) from images
"""

import sys
import json
import re
from typing import Dict, Any, List, Set
from difflib import SequenceMatcher


def normalize_text(text: str) -> str:
    """Normalize text for comparison"""
    # Remove extra whitespace, convert to lowercase
    return re.sub(r'\s+', ' ', text.lower().strip())


def extract_keywords(text: str) -> Set[str]:
    """Extract significant words from text"""
    # Remove common words and extract keywords
    words = set(text.lower().split())
    # Remove very short words (likely articles, prepositions)
    return {w for w in words if len(w) > 2}


def calculate_text_similarity(text1: str, text2: str) -> float:
    """Calculate similarity ratio between two texts"""
    norm1 = normalize_text(text1)
    norm2 = normalize_text(text2)
    return SequenceMatcher(None, norm1, norm2).ratio()


def validate_keyword_presence(output: str, expected_keywords: List[str]) -> Dict[str, Any]:
    """Validate that expected keywords are present in output"""
    output_lower = output.lower()
    found_keywords = [kw for kw in expected_keywords if kw.lower() in output_lower]
    
    accuracy = len(found_keywords) / len(expected_keywords) if expected_keywords else 0.0
    
    return {
        "keyword_accuracy": accuracy,
        "found_keywords": found_keywords,
        "missing_keywords": [kw for kw in expected_keywords if kw not in found_keywords],
        "total_expected": len(expected_keywords),
        "total_found": len(found_keywords)
    }


def validate_ocr_accuracy(
    output: str,
    expected_output: str,
    input_text: str = "",
    threshold: float = 0.7
) -> Dict[str, Any]:
    """
    Validate OCR text extraction accuracy
    
    Args:
        output: AI's extracted text
        expected_output: Expected extracted text or keywords
        input_text: Original user question (optional)
        threshold: Minimum similarity threshold for passing
    
    Returns:
        Evaluation result with score, passed status, and details
    """
    
    # Calculate overall text similarity
    similarity = calculate_text_similarity(output, expected_output)
    
    # Extract and validate keywords
    expected_keywords_line = re.search(
        r'keywords?:\s*([^\n]+)', 
        expected_output, 
        re.IGNORECASE
    )
    
    if expected_keywords_line:
        # Parse expected keywords
        keywords_text = expected_keywords_line.group(1)
        expected_keywords = [
            kw.strip() 
            for kw in re.split(r'[,;]', keywords_text)
        ]
        keyword_validation = validate_keyword_presence(output, expected_keywords)
    else:
        # Use all significant words as keywords
        expected_words = extract_keywords(expected_output)
        output_words = extract_keywords(output)
        matched_words = expected_words & output_words
        
        keyword_validation = {
            "keyword_accuracy": len(matched_words) / len(expected_words) if expected_words else 0.0,
            "found_keywords": list(matched_words),
            "missing_keywords": list(expected_words - matched_words),
            "total_expected": len(expected_words),
            "total_found": len(matched_words)
        }
    
    # Combine metrics
    # Weight: 60% overall similarity, 40% keyword accuracy
    combined_score = (similarity * 0.6) + (keyword_validation["keyword_accuracy"] * 0.4)
    passed = combined_score >= threshold
    
    return {
        "status": "processed",
        "score": round(combined_score, 3),
        "passed": passed,
        "details": {
            "text_similarity": round(similarity, 3),
            "keyword_validation": keyword_validation,
            "threshold": threshold,
            "reasoning": f"Text similarity: {similarity:.2%}, Keyword accuracy: {keyword_validation['keyword_accuracy']:.2%}"
        }
    }


def main():
    """Main entry point for CLI usage"""
    # Read evaluation data from stdin or args
    if len(sys.argv) > 1:
        eval_data = json.loads(sys.argv[1])
    else:
        eval_data = json.load(sys.stdin)
    
    # Extract fields
    output = eval_data.get("output", "")
    expected_output = eval_data.get("expected_output", "")
    input_text = eval_data.get("input", "")
    threshold = eval_data.get("threshold", 0.7)
    
    # Run validation
    result = validate_ocr_accuracy(output, expected_output, input_text, threshold)
    
    # Output JSON result
    print(json.dumps(result, indent=2))
    
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
