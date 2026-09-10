#!/usr/bin/env bash
set -euo pipefail

patterns=(
  'SUPABASE_ACCESS_TOKEN[[:space:]]*=[[:space:]]*sbp_[A-Za-z0-9_-]+'
  'sbp_[A-Za-z0-9_-]{20,}'
  'sb_secret_[A-Za-z0-9_-]{20,}'
  'sk-ant-api[0-9A-Za-z_-]+'
  'sk-proj-[A-Za-z0-9_-]+'
)

found=0

for pattern in "${patterns[@]}"; do
  if git grep --untracked -n -E "$pattern" -- \
    ':(exclude)package-lock.json' \
    ':(exclude)pnpm-lock.yaml' \
    ':(exclude)yarn.lock'
  then
    found=1
  fi
done

if [[ "$found" -ne 0 ]]; then
  echo "Secret-looking values found in tracked files. Remove the literal values before committing." >&2
  exit 1
fi

echo "No blocked secret patterns found in tracked files."
