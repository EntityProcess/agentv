#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: materialize-repo.sh <destination> <owner/repo> <commit>" >&2
  exit 2
fi

destination="$1"
repository="$2"
commit="$3"

git clone --quiet "https://github.com/${repository}.git" "$destination"
git -C "$destination" checkout --quiet "$commit"
