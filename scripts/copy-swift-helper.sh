#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_helper="$root/../swift/.build/release/apple-fm-helper"
if [ ! -x "$source_helper" ]; then
  echo "Missing built Swift helper: $source_helper" >&2
  exit 1
fi
mkdir -p "$root/bin"
cp "$source_helper" "$root/bin/apple-fm-helper"
chmod 755 "$root/bin/apple-fm-helper"

xcrun swiftc -parse-as-library -O "$root/native/model-info.swift" -o "$root/bin/apple-fm-info"
