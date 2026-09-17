#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_helper="$root/../swift/.build/release/apple-fm-helper"
if [ -x "$source_helper" ]; then
  cp "$source_helper" "$root/bin/apple-fm-helper"
  chmod 755 "$root/bin/apple-fm-helper"
elif [ ! -x "$root/bin/apple-fm-helper" ]; then
  echo "Missing built Swift helper: $source_helper and no bundled helper at $root/bin/apple-fm-helper" >&2
  exit 1
fi

xcrun swiftc -parse-as-library -O "$root/native/model-info.swift" -o "$root/bin/apple-fm-info"
