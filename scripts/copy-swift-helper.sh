#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
swift_dir=${APPLE_FM_SWIFT_DIR:-"$root/../apple-fm-swift"}
source_helper="$swift_dir/.build/release/apple-fm-helper"
if [ -x "$source_helper" ]; then
  cp "$source_helper" "$root/bin/apple-fm-helper"
  chmod 755 "$root/bin/apple-fm-helper"
  # Name the Swift commit so a helper update can say which build it ships.
  commit=$(git -C "$swift_dir" rev-parse --short HEAD 2>/dev/null || echo unknown)
  [ -n "$(git -C "$swift_dir" status --porcelain -- Sources Package.swift 2>/dev/null)" ] && commit="$commit (uncommitted changes)"
  echo "Copied apple-fm-helper from $swift_dir at $commit" >&2
elif [ -x "$root/bin/apple-fm-helper" ]; then
  echo "warning: no Swift build at $source_helper; keeping the committed bin/apple-fm-helper" >&2
else
  echo "Missing built Swift helper: $source_helper and no bundled helper at $root/bin/apple-fm-helper" >&2
  exit 1
fi

xcrun swiftc -parse-as-library -O "$root/native/model-info.swift" -o "$root/bin/apple-fm-info"
