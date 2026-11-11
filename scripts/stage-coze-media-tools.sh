#!/usr/bin/env bash
set -euo pipefail

# BtbN's retained monthly release includes static FFmpeg and FFprobe with libx264.
# Source and checksums: https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/tag/autobuild-2026-10-31-12-59
release="autobuild-2026-10-31-12-59"
mirror=
case "$(uname -m)" in
  x86_64)
    arch=x64
    target=linux64
    sha256=73e29a56974ae5a651133a04584c7483b21afe941e17dc91d79814a758b608d3
    mirror="https://bin.ffmpeg.download/btbn_ffmpeg_builds/linux/x86_64/gpl/9.0/n9.0.2-39"
    ffmpeg_sha256=384742b75419584d065bbf372613f9f7e8ccf22525b421c16a2ee679a78ee748
    ffprobe_sha256=ae9051af68f52e7ad5706b442577689c74c02da618ca1590caf1ac7199f2931c
    license_sha256=8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903
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
for directory in assets assets/wujie-coze-media "$bundle"; do
  if [[ -L "$directory" ]]; then
    echo "[coze-media] Expected a local directory at ${directory}." >&2
    exit 1
  fi
done

verify_x64_cache() (
  cd "./$bundle" || return 1
  for file in ffmpeg ffprobe LICENSE.txt; do
    [[ -f "$file" && ! -L "$file" ]] || return 1
  done
  [[ -x ffmpeg && -x ffprobe ]] || return 1
  printf '%s  %s\n' "$ffmpeg_sha256" ffmpeg "$ffprobe_sha256" ffprobe "$license_sha256" LICENSE.txt \
    | sha256sum --check --status || return 1
  ./ffmpeg -version >/dev/null && ./ffprobe -version >/dev/null
)

if [[ "$arch" == x64 && -d "$bundle" ]] && verify_x64_cache; then
  echo "[coze-media] Reused verified FFmpeg and FFprobe for ${arch}."
  exit 0
fi

stage="$(mktemp -d)"
archive="${stage}/${name}.tar.xz"
cleanup() {
  rm -f -- "$archive" "$stage/bin/ffmpeg" "$stage/bin/ffprobe" "$stage/LICENSE.txt"
  if [ -d "$stage/bin" ]; then rmdir -- "$stage/bin"; fi
  rmdir -- "$stage"
}
trap cleanup EXIT

download_archive() {
  curl -q --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --speed-limit 65536 --speed-time 60 --max-time "$1" --output "$archive" "$2"
}

# The x64 mirror serves the byte-identical release at a usable rate from Coze.
# Both download paths still have to match the publisher's pinned archive digest.
if [[ -z "$mirror" ]] || ! download_archive 900 "${mirror}/${name}.tar.xz"; then
  download_archive 240 "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/${release}/${name}.tar.xz"
fi
if ! printf '%s  %s\n' "$sha256" "$archive" | sha256sum --check --status; then
  echo "[coze-media] SHA-256 mismatch for ${name}." >&2
  exit 1
fi

tar -xJf "$archive" -C "$stage" --strip-components=1 --no-same-owner \
  "$name/bin/ffmpeg" "$name/bin/ffprobe" "$name/LICENSE.txt"
chmod 0755 "$stage/bin/ffmpeg" "$stage/bin/ffprobe"
"$stage/bin/ffmpeg" -version >/dev/null
"$stage/bin/ffprobe" -version >/dev/null
mkdir -p "$bundle"
for file in ffmpeg ffprobe; do
  mv -fT -- "$stage/bin/$file" "$bundle/$file"
done
mv -fT -- "$stage/LICENSE.txt" "$bundle/LICENSE.txt"
echo "[coze-media] Staged FFmpeg and FFprobe for ${arch}."
