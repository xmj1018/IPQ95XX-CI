#!/bin/bash
# 从 iStoreOS 官方源码编译 quickstart 后端二进制（11-25 socket 版），
# 替换官方预编译 tarball 里滞后的旧二进制，让后端创建 /var/run/quickstart/http.sock，
# 与 luci-app-quickstart r3 前端（连 http.sock）配套 —— 彻底不需要 backend 补丁。
#
# 背景（2026-11-27 查实）：
#   - 官方源码 istoreos/quickstart 主仓 11-25 提交 e3a79b6b 让 Go 后端走 Unix socket。
#   - 但官方 GitHub release 只发到 11-12 的 v0.17.1-rc20261028（二进制只听 TCP 3038），
#     app-hub 的 quickstart 打包层正是下载这个旧 tarball → 前后端错配、首页读不到配置。
#   - 官方自己从源码一起编，前后端天然配套，不会踩坑。我们这里对齐官方做法。
#
# 调用方式：$GITHUB_WORKSPACE/Scripts/build-quickstart-source.sh "$GITHUB_WORKSPACE/wrt"
# 参数 $1 = OpenWrt 源码树根目录（HG5585F 是 wrt/，IPQ95XX 是 ./wrt/）
# 依赖：curl tar gzip；Go 由本脚本下载官方 1.26.11（不污染系统）。

set -euo pipefail

OWRT_ROOT="${1:-.}"
WS="${GITHUB_WORKSPACE:-$(pwd)}"
QS_VER="0.17.1-rc20261028"           # 与 app-hub Makefile 的 PKG_VERSION 一致，避免改版本号
GO_VER="1.26.11"
QS_SRC="$WS/_qs_src"                 # 官方源码临时目录
DL_DIR="$OWRT_ROOT/dl"
# HG5585F 的 wrt 树可能还没有 dl/（WRT-CORE 机型则已存在），写 tarball 前必须先建好
mkdir -p "$DL_DIR"
# ★必须绝对化：后面第 98 行 cd 到 _qs_build/unpack 后，第 100 行还会用 $DL_DIR 写 tarball。
#   若 DL_DIR 是相对路径（HG5585F 传 "." → "./dl"），此时会解析成 unpack/dl（不存在），
#   报 "./dl/quickstart-binary-*.tar.gz: No such file or directory"（#22 就是这么挂的）。
DL_DIR="$(cd "$DL_DIR" && pwd)"
WORK="$WS/_qs_build"

echo "=== build-quickstart-source: 从官方源码编译配套二进制 ==="
echo "OWRT_ROOT=$OWRT_ROOT  QS_VER=$QS_VER  GO_VER=$GO_VER"

# 1) 下载/复用 Go 1.26.11（官方 .mise.toml 指定版本）
GO_ROOT="$WS/_go1226"
if [ ! -x "$GO_ROOT/bin/go" ]; then
  echo "--- 下载 Go $GO_VER ---"
  mkdir -p "$GO_ROOT"
  curl -fsSL "https://go.dev/dl/go${GO_VER}.linux-amd64.tar.gz" \
    | tar -xz -C "$GO_ROOT" --strip-components=1
fi
GO_BIN="$GO_ROOT/bin/go"
"$GO_BIN" version

# 2) clone 官方 quickstart 源码（main，含 11-25 socket 修复）
rm -rf "$QS_SRC"
git clone --depth=1 --single-branch --branch main \
  https://github.com/istoreos/quickstart.git "$QS_SRC"
QS_SHA=$(git -C "$QS_SRC" rev-parse HEAD)
echo "--- 官方源码 commit: $QS_SHA ---"
grep -q 'ISTOREOS_SOCKET\|http.sock\|unix' "$QS_SRC/backend/cmd/backend/backend-main.go" \
  && echo "OK: 源码含 Unix socket 支持" \
  || echo "WARN: 未在 backend-main.go 直接匹配到 socket 关键字（检查 unix_listener.go）"

# 3) 用官方脚本编译三个架构二进制（CGO_ENABLED=0 交叉编译，无需目标工具链）
mkdir -p "$WORK/bin" "$GO_ROOT/pkg/mod"
export GOROOT="$GO_ROOT"
export GOPATH="$WS/_go_path"
export PATH="$GO_ROOT/bin:$PATH"
export GO="$GO_BIN"          # 官方 common.sh 用 GO="${GO:-go}"，显式指定避免 PATH 解析歧义
mkdir -p "$GOPATH"
cd "$QS_SRC"
for ARCH in amd64 arm64 arm; do
  if [ "$ARCH" = "arm" ]; then
    GOARCH=arm GOARM=7 ./scripts/ops/build-backend.sh
  else
    GOARCH="$ARCH" ./scripts/ops/build-backend.sh
  fi
done
ls -l "$QS_SRC/bin"/quickstart.*

# 4) 下载官方旧 tarball，替换三个二进制 + 更新 MANIFEST，重打同结构包
mkdir -p "$WORK/unpack"
OLD_TAR="$WORK/old-${QS_VER}.tar.gz"
curl -fsSL \
  "https://github.com/istoreos/quickstart/releases/download/v${QS_VER}/quickstart-binary-${QS_VER}.tar.gz" \
  -o "$OLD_TAR"
tar -xzf "$OLD_TAR" -C "$WORK/unpack"
TAR_TOP="quickstart-binary-${QS_VER}"
TAR_DIR="$WORK/unpack/$TAR_TOP"

cp "$QS_SRC/bin/quickstart.amd64"  "$TAR_DIR/quickstart.x86_64"
cp "$QS_SRC/bin/quickstart.arm64"  "$TAR_DIR/quickstart.aarch64"
# 官方 build-backend.sh 的 armv7 产物文件名是 quickstart.armv7，
# 而 tarball/MANIFEST 里的目标名是 quickstart.arm —— 源名与目标名不同，别写错。
cp "$QS_SRC/bin/quickstart.armv7"  "$TAR_DIR/quickstart.arm"
chmod 755 "$TAR_DIR"/quickstart.*

# MANIFEST：更新三个二进制 sha256 与 git_sha，其余 web 哈希保持（web 资源未变）
MF="$TAR_DIR/MANIFEST"
sed -i "s|^git_sha=.*|git_sha=${QS_SHA}|" "$MF"
for pair in "x86_64:quickstart.x86_64" "aarch64:quickstart.aarch64" "arm:quickstart.arm"; do
  key="${pair%%:*}"; fn="${pair##*:}"
  sha=$(sha256sum "$TAR_DIR/$fn" | awk '{print $1}')
  sed -i "s|^quickstart.${key}=.*|quickstart.${key}=${sha}|" "$MF"
done
echo "--- 新 MANIFEST ---"
cat "$MF"

# 5) 重打包（保持顶层目录名一致，mtime/owner 归零可复现）
cd "$WORK/unpack"
tar --sort=name --mtime="@$(date +%s)" --owner=0 --group=0 --numeric-owner \
  -cf - "$TAR_TOP" | gzip -n > "$DL_DIR/quickstart-binary-${QS_VER}.tar.gz"
NEW_HASH=$(sha256sum "$DL_DIR/quickstart-binary-${QS_VER}.tar.gz" | awk '{print $1}')
echo "NEW_TARBALL_HASH=$NEW_HASH"

# 6) 改写 app-hub 的 quickstart 包 Makefile：本地 file:// 源 + 新 hash
#    IPQ95XX 路径 ./package/quickstart；HG5585F 路径 $OWRT_ROOT/package/quickstart
QS_PKG=""
for base in "$OWRT_ROOT/package/quickstart" "$OWRT_ROOT/package/_istoreos-app-hub/apps/quickstart/quickstart" "./package/quickstart"; do
  [ -f "$base/Makefile" ] && QS_PKG="$base/Makefile" && break
done
if [ -z "$QS_PKG" ]; then
  echo "ERROR: 找不到 quickstart 包 Makefile，无法改写源地址"
  exit 1
fi
echo "--- patching $QS_PKG ---"
# download.pl 的 file:// 后面必须是一个【目录】（它 find -name $PKG_SOURCE 找文件），
# 不能指向具体文件。这里指向 dl 目录的绝对路径，靠 PKG_SOURCE 匹配文件名。
DL_ABS=$(cd "$DL_DIR" && pwd)
sed -i "s|^PKG_SOURCE_URL:=.*|PKG_SOURCE_URL:=file://${DL_ABS}|" "$QS_PKG"
sed -i "s|^PKG_HASH:=.*|PKG_HASH:=${NEW_HASH}|" "$QS_PKG"
grep -n -E 'PKG_SOURCE_URL|PKG_HASH|PKG_VERSION|PKG_SOURCE:=' "$QS_PKG"

echo "=== build-quickstart-source: DONE (前后端均为 11-25 官方源码版，无需 backend 补丁) ==="
