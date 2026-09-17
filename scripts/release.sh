#!/bin/sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIRECTORY=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd)
RELEASE_DIRECTORY="$PROJECT_DIRECTORY/release"

cd "$PROJECT_DIRECTORY"
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "Release packaging requires a clean Git worktree." >&2
  exit 1
fi
npm run package

version=$(node -p "require('./package.json').version")
vsix_name="apple-fm-inline-completion-$version.vsix"
vsix_path="$PROJECT_DIRECTORY/$vsix_name"
if [ ! -f "$vsix_path" ]; then
  echo "Expected package output not found: $vsix_path" >&2
  exit 1
fi

mkdir -p "$RELEASE_DIRECTORY"
rm -f "$RELEASE_DIRECTORY"/*
cp "$vsix_path" "$RELEASE_DIRECTORY/$vsix_name"
cp "$SCRIPT_DIRECTORY/install.sh" "$RELEASE_DIRECTORY/install.sh"
(
  cd "$RELEASE_DIRECTORY"
  shasum -a 256 "$vsix_name" install.sh > SHA256SUMS
)

echo "Release artifacts written to $RELEASE_DIRECTORY:"
ls -lh "$RELEASE_DIRECTORY/$vsix_name" "$RELEASE_DIRECTORY/install.sh" "$RELEASE_DIRECTORY/SHA256SUMS"
