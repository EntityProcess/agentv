#!/usr/bin/env bash

set -euo pipefail

installed_cli="no"

if ! command -v agentv >/dev/null 2>&1; then
  echo "agentv CLI not found on PATH."
  if command -v bun >/dev/null 2>&1; then
    echo "Installing agentv with bun..."
    bun add -g agentv@latest
  elif command -v npm >/dev/null 2>&1; then
    echo "Installing agentv with npm..."
    npm install -g agentv@latest
  else
    echo "Error: neither bun nor npm is available to install agentv." >&2
    exit 1
  fi
  installed_cli="yes"
fi

if ! command -v agentv >/dev/null 2>&1; then
  echo "Error: agentv is still not available on PATH after installation." >&2
  exit 1
fi

agentv_version="$(agentv --version)"
echo "agentv version: ${agentv_version}"

echo "Running agentv init..."
agentv init

required_files=(
  ".env.example"
  ".agentv/config.yaml"
  ".agentv/targets.yaml"
)

missing_files=()
for file_path in "${required_files[@]}"; do
  if [[ ! -f "${file_path}" ]]; then
    missing_files+=("${file_path}")
  fi
done

if [[ ${#missing_files[@]} -gt 0 ]]; then
  echo "Missing setup artifacts after first init run:"
  printf "  - %s\n" "${missing_files[@]}"
  echo "Re-running agentv init..."
  agentv init

  missing_files=()
  for file_path in "${required_files[@]}"; do
    if [[ ! -f "${file_path}" ]]; then
      missing_files+=("${file_path}")
    fi
  done
fi

if [[ ${#missing_files[@]} -gt 0 ]]; then
  echo "Setup verification failed. Missing files:" >&2
  printf "  - %s\n" "${missing_files[@]}" >&2
  exit 1
fi

echo "ONBOARDING_SUMMARY version=${agentv_version} installed_cli=${installed_cli} init_completed=yes verification_passed=yes"
