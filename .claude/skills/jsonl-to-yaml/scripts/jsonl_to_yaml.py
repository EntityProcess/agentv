#!/usr/bin/env python3
"""
Convert JSONL (JSON Lines) files to human-readable YAML format.
Uses | for multiline strings to improve readability.
"""

import json
import sys
from pathlib import Path
from typing import Any, Dict, List


def format_multiline_string(value: str, indent: int = 0) -> str:
    """
    Format a string value as a YAML literal block scalar (|) if it contains newlines.
    
    Args:
        value: The string to format
        indent: Current indentation level
        
    Returns:
        Formatted YAML string
    """
    if not isinstance(value, str):
        return value
    
    # Use literal block scalar for multiline strings
    if '\n' in value:
        lines = value.split('\n')
        indent_str = '  ' * (indent + 1)
        formatted_lines = [f'{indent_str}{line}' for line in lines]
        return '|\n' + '\n'.join(formatted_lines)
    
    # Escape single-line strings that need quoting
    if any(c in value for c in [':', '#', '@', '`', '"', "'", '{', '}', '[', ']', '&', '*', '!', '|', '>', '%']):
        # Escape double quotes and backslashes
        escaped = value.replace('\\', '\\\\').replace('"', '\\"')
        return f'"{escaped}"'
    
    return value


def yaml_dump_value(value: Any, indent: int = 0) -> str:
    """
    Convert a Python value to YAML format with proper indentation.
    
    Args:
        value: The value to convert
        indent: Current indentation level
        
    Returns:
        YAML-formatted string
    """
    indent_str = '  ' * indent
    
    if value is None:
        return 'null'
    elif isinstance(value, bool):
        return 'true' if value else 'false'
    elif isinstance(value, (int, float)):
        return str(value)
    elif isinstance(value, str):
        formatted = format_multiline_string(value, indent)
        if formatted.startswith('|'):
            return formatted
        return formatted
    elif isinstance(value, list):
        if not value:
            return '[]'
        lines = []
        for item in value:
            item_yaml = yaml_dump_value(item, indent + 1)
            if '\n' in item_yaml:
                lines.append(f'{indent_str}- {item_yaml}')
            else:
                lines.append(f'{indent_str}- {item_yaml}')
        return '\n' + '\n'.join(lines)
    elif isinstance(value, dict):
        if not value:
            return '{}'
        lines = []
        for key, val in value.items():
            val_yaml = yaml_dump_value(val, indent + 1)
            if val_yaml.startswith('\n'):
                lines.append(f'{indent_str}{key}:{val_yaml}')
            elif val_yaml.startswith('|'):
                lines.append(f'{indent_str}{key}: {val_yaml}')
            else:
                lines.append(f'{indent_str}{key}: {val_yaml}')
        return '\n' + '\n'.join(lines)
    else:
        return str(value)


def convert_jsonl_to_yaml(jsonl_path: Path, output_path: Path = None) -> None:
    """
    Convert a JSONL file to YAML format.
    
    Args:
        jsonl_path: Path to the input JSONL file
        output_path: Path to the output YAML file (defaults to input with .yaml extension)
    """
    if output_path is None:
        output_path = jsonl_path.with_suffix('.yaml')
    
    with open(jsonl_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    documents = []
    for line_num, line in enumerate(lines, 1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            documents.append(obj)
        except json.JSONDecodeError as e:
            print(f"Warning: Skipping invalid JSON on line {line_num}: {e}", file=sys.stderr)
    
    # Write YAML with document separators
    with open(output_path, 'w', encoding='utf-8') as f:
        for i, doc in enumerate(documents):
            if i > 0:
                f.write('\n---\n')
            yaml_content = yaml_dump_value(doc, 0)
            # Remove leading newline if present
            if yaml_content.startswith('\n'):
                yaml_content = yaml_content[1:]
            f.write(yaml_content)
            f.write('\n')
    
    print(f"Converted {len(documents)} records from {jsonl_path} to {output_path}")


def main():
    """CLI entry point."""
    if len(sys.argv) < 2:
        print("Usage: jsonl_to_yaml.py <input.jsonl> [output.yaml]")
        print("\nConvert JSONL files to human-readable YAML format.")
        print("Multiline strings are formatted using | (literal block scalar).")
        sys.exit(1)
    
    input_path = Path(sys.argv[1])
    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)
    
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    
    try:
        convert_jsonl_to_yaml(input_path, output_path)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
