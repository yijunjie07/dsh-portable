#!/bin/bash
# DeepSeek Harness 便携版 — Apple Silicon Mac
# 挂载 U 盘上的只读程序镜像，DSH_HOME 指向 U 盘的 home/，运行官方的 dsh web。
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
IMAGE="$ROOT/dsh-mac-arm64.dmg"

fail() { echo; echo "启动失败：$*"; read -r -p "按回车关闭…" _; exit 1; }

[ "$(uname -m)" = arm64 ] || fail "只支持 Apple Silicon Mac。"
[ -f "$IMAGE" ] || fail "找不到 $IMAGE"

# 先顺序读一遍整个镜像：U 盘顺序读很快、零散小读很慢，读过之后挂载走系统缓存
cat "$IMAGE" > /dev/null
# -noverify：不做整盘校验（校验要把整个镜像从 U 盘读一遍）
MOUNT="$(hdiutil attach -nobrowse -readonly -noverify -noautoopen "$IMAGE" | awk -F'\t' '/\/Volumes\//{print $NF; exit}')"
[ -n "$MOUNT" ] || fail "无法挂载 $IMAGE"
# 退出时卸载镜像，并删掉 macOS 在 exFAT 上生成的 ._ 文件（Windows 上看着乱）
trap 'hdiutil detach -quiet "$MOUNT" 2>/dev/null; dot_clean -m "$ROOT" 2>/dev/null' EXIT

export DSH_HOME="$ROOT/home"
export DSH_PRIMARY_RUNTIME="$MOUNT/runtime/primary-runtime"
# 这台电脑的标识：用户名-硬件 UUID 前 8 位，工作区登记表按它分开存
# （不要写成 "$(… awk -F'"' …)"：macOS 自带的 bash 3.2 会解析错）
uuid=$(ioreg -rd1 -c IOPlatformExpertDevice | awk -F'"' '/IOPlatformUUID/{print $4}')
export DSH_MACHINE="$(id -un)-${uuid:0:8}"
mkdir -p "$DSH_HOME"

# dsh 输出原样显示，碰到网址时额外用醒目的框再打印一遍
show_url() {
  local line url
  while IFS= read -r line; do
    printf '%s\n' "$line"
    case "$line" in *http://*)
      url="http://${line#*http://}"; url="${url%% *}"
      printf '\n\033[1;32m════════════════════════════════════════════════════════\033[0m\n'
      printf ' DeepSeek Harness 已启动。浏览器关了的话，用这个地址重新打开：\n\n'
      printf '   \033[1;36m%s\033[0m\n\n' "$url"
      printf ' （按住 Cmd 点一下地址就能打开）  用完关掉这个窗口即可退出。\n'
      printf '\033[1;32m════════════════════════════════════════════════════════\033[0m\n\n'
    esac
  done
}

cd "$HOME"
# exfat-link.mjs：exFAT 不支持硬链接，链接失败时改为不覆盖的复制
"$DSH_PRIMARY_RUNTIME/dependencies/node/bin/node" --expose-internals \
  --import "$MOUNT/exfat-link.mjs" \
  "$MOUNT/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js" \
  web --patch "$MOUNT/python.patch.yml" --patch "$MOUNT/per-machine.patch.yml" \
  --patch "$MOUNT/share-space.patch.yml" "$@" | show_url
