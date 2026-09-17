#!/bin/sh
set -eu

REPOSITORY="StoneHub/apple-fm-vscode"
API_URL="https://api.github.com/repos/$REPOSITORY/releases/latest"

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "Apple FM Inline Completion requires macOS on Apple Silicon (arm64)." >&2
  exit 1
fi
macos_major=$(sw_vers -productVersion | cut -d. -f1)
case "$macos_major" in
  ''|*[!0-9]*)
    echo "Could not determine the macOS version." >&2
    exit 1
    ;;
esac
if [ "$macos_major" -lt 27 ]; then
  echo "Apple FM Inline Completion requires macOS 27 or later (found macOS $macos_major)." >&2
  exit 1
fi

for command_name in curl shasum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

code_cli=""
if command -v code >/dev/null 2>&1; then
  code_cli=$(command -v code)
else
  for candidate in \
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
    "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"; do
    if [ -x "$candidate" ]; then
      code_cli="$candidate"
      break
    fi
  done
fi
if [ -z "$code_cli" ]; then
  echo "Could not find the VS Code 'code' command. Install VS Code and enable its shell command first." >&2
  exit 1
fi

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/apple-fm-vscode.XXXXXX")
cleanup() {
  rm -rf "$temporary_directory"
}
trap cleanup EXIT HUP INT TERM

metadata="$temporary_directory/release.json"
curl --fail --silent --show-error --location \
  --header "Accept: application/vnd.github+json" \
  "$API_URL" --output "$metadata"

# The public GitHub API returns asset objects in one JSON document. Keep this
# installer dependency-free by extracting the two fixed release asset URLs.
vsix_url=$(tr ',' '\n' < "$metadata" | sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*\.vsix\)".*/\1/p' | head -n 1)
checksums_url=$(tr ',' '\n' < "$metadata" | sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*SHA256SUMS\)".*/\1/p' | head -n 1)
if [ -z "$vsix_url" ] || [ -z "$checksums_url" ]; then
  echo "The latest GitHub release is missing a VSIX or SHA256SUMS asset." >&2
  exit 1
fi

vsix_name=${vsix_url##*/}
vsix_path="$temporary_directory/$vsix_name"
checksums_path="$temporary_directory/SHA256SUMS"
curl --fail --silent --show-error --location "$vsix_url" --output "$vsix_path"
curl --fail --silent --show-error --location "$checksums_url" --output "$checksums_path"

expected_checksum=$(awk -v name="$vsix_name" '$2 == name { print $1; exit }' "$checksums_path")
if [ -z "$expected_checksum" ]; then
  echo "SHA256SUMS has no entry for $vsix_name." >&2
  exit 1
fi
printf '%s  %s\n' "$expected_checksum" "$vsix_path" | shasum -a 256 -c - >/dev/null

echo "Installing $vsix_name with $code_cli"
"$code_cli" --install-extension "$vsix_path" --force
echo "Installed Apple FM Inline Completion. Reload the VS Code window to use the update."
