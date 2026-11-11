#!/usr/bin/env bash
# Provision one explicitly pinned, trusted FP32 ONNX checkpoint.
set -euo pipefail

model_dir="${ONNX_MODELS_DIR:-onnx-models}"
target="$model_dir/realesrgan-x4plus.onnx"
digest="${ONNX_MODEL_SHA256:-}"
if [[ ! "$digest" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "Set ONNX_MODEL_SHA256 to a trusted checkpoint digest." >&2
  exit 2
fi

verify() {
  local actual
  [[ -f "$1" && -s "$1" ]] || return 1
  [[ $(wc -c < "$1") -le 134217728 ]] || return 1
  actual=$(sha256sum < "$1") || return 1
  [[ "${actual%% *}" == "${digest,,}" ]]
}

if [[ $# != 1 ]]; then
  echo "Usage: bash scripts/download-upscale-models.sh --check|HTTPS_URL|LOCAL_FILE" >&2
  exit 2
fi
if verify "$target"; then
  echo "Verified $target"
  exit 0
fi
if [[ "$1" == --check ]]; then
  echo "Checkpoint missing or failed verification." >&2
  exit 1
fi

mkdir -p -- "$model_dir"
stage=$(mktemp "$model_dir/.realesrgan-x4plus.XXXXXX")
trap 'rm -f -- "$stage"' EXIT
if [[ "$1" == https://* ]]; then
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --max-time 300 --max-filesize 134217728 --output "$stage" -- "$1"
else
  [[ -f "$1" && $(wc -c < "$1") -le 134217728 ]]
  cp -- "$1" "$stage"
fi
if ! verify "$stage"; then
  echo "Checkpoint failed SHA-256 verification." >&2
  exit 1
fi
mv -fT -- "$stage" "$target"
echo "Verified and provisioned $target"
