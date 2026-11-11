#!/usr/bin/env bash
set -euo pipefail

# BtbN's retained monthly release includes static FFmpeg and FFprobe with libx264.
# Source and checksums: https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/tag/autobuild-2026-10-31-12-59
release="autobuild-2026-10-31-12-59"
case "$(uname -m)" in
  x86_64)
    arch=x64
    target=linux64
    sha256=73e29a56974ae5a651133a04584c7483b21afe941e17dc91d79814a758b608d3
    ;;
  aarch64)
    arch=arm64
    target=linuxarm64
    sha256=6cad88ae5bcec356cfc5d7979a036cc4007128201928a0cf243df3db483276cc
    ;;
  *)
    echo "[coze-media] No pinned FFmpeg bundle for $(uname -m)." >&2
    exit 1
    ;;
esac

name="ffmpeg-n9.0.2-39-g7adfbe40dc-${target}-gpl-9.0"
bundle="assets/wujie-coze-media/${arch}"
mkdir -p "$bundle"
stage="$(mktemp -d)"
archive="${stage}/${name}.tar.xz"
cleanup() {
  rm -f -- "$archive" "$stage/bin/ffmpeg" "$stage/bin/ffprobe" "$stage/LICENSE.txt"
  if [ -d "$stage/bin" ]; then rmdir -- "$stage/bin"; fi
  rmdir -- "$stage"
}
trap cleanup EXIT

curl -q --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 15 --max-time 240 --retry 2 --retry-max-time 300 \
  --output "$archive" "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/${release}/${name}.tar.xz"
if ! printf '%s  %s\n' "$sha256" "$archive" | sha256sum --check --status; then
  echo "[coze-media] SHA-256 mismatch for ${name}." >&2
  exit 1
fi

tar -xJf "$archive" -C "$stage" --strip-components=1 --no-same-owner \
  "$name/bin/ffmpeg" "$name/bin/ffprobe" "$name/LICENSE.txt"
chmod 0755 "$stage/bin/ffmpeg" "$stage/bin/ffprobe"
"$stage/bin/ffmpeg" -version >/dev/null
"$stage/bin/ffprobe" -version >/dev/null
mv -f -- "$stage/bin/ffmpeg" "$stage/bin/ffprobe" "$stage/LICENSE.txt" "$bundle/"
echo "[coze-media] Staged FFmpeg and FFprobe for ${arch}."
