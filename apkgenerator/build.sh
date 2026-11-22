#!/bin/sh
# 在 alpine:3.23 容器内运行（apk-tools 3.0.x，ADB/v3 包格式）
# 用 apk mkpkg 从 rootfs 目录生成真正的 apkv3 包，并本地验证可安装。
set -e

echo "===== apk 版本 ====="
apk --version

OUT=/work/out
mkdir -p "$OUT"

mk_one() {
  KEY="$1"; PKG="$2"; VER="$3"; DESC="$4"; URL="$5"; LIC="$6"; DEPENDS="$7"
  P="/work/plugins/$KEY"
  echo
  echo "===== 打包 $KEY -> $PKG-$VER ====="

  # rootfs 可执行位
  find "$P/rootfs" -type f \( -name 'emmc-health' -o -name 'emmc-health-install-mmc' -o -name 'fanctl' -o -name 'ledctl' -o -path '*/uci-defaults/*' \) -exec chmod 755 {} + 2>/dev/null || true

  set -- mkpkg \
    --info "name:$PKG" \
    --info "version:$VER" \
    --info "arch:noarch" \
    --info "description:$DESC" \
    --info "url:$URL" \
    --info "license:$LIC" \
    --info "origin:$PKG" \
    --info "depends:$DEPENDS"

  for s in pre-install post-install pre-deinstall post-deinstall; do
    if [ -f "$P/scripts/$s" ]; then
      chmod 755 "$P/scripts/$s"
      set -- "$@" --script "$s:$P/scripts/$s"
    fi
  done

  set -- "$@" --files "$P/rootfs"
  set -- "$@" --output "$OUT/${PKG}_${VER}.apk"
  apk "$@"
  ls -la "$OUT/${PKG}_${VER}.apk"
}

mk_one emmc-health luci-app-emmc-health 1.1.3-r1 \
  "LuCI eMMC health detection" \
  "https://github.com/adminchenyu/eMMC-Health" \
  "GPL-3.0-only" \
  "luci-base rpcd-mod-file"

mk_one be10000-fanrgb luci-app-be10000-fanrgb 1.0.0-r1 \
  "BE10000 Fan and RGB control SBE1V1K style UI" \
  "https://github.com/VIKINGYFY/immortalwrt" \
  "GPL-2.0-or-later" \
  "luci-base rpcd-mod-file ucode ucode-mod-ubus"

echo
echo "===== 验证：apk add --allow-untrusted 实测安装到临时 root ====="
TROOT=/work/testroot
rm -rf "$TROOT"; mkdir -p "$TROOT"
for A in "$OUT"/*.apk; do
  echo "--- 安装测试: $(basename "$A") ---"
  apk add --root "$TROOT" --allow-untrusted --no-scripts --initdb "$A" 2>&1 || {
    echo "  [WARN] 直接失败, 尝试 --force-depends"
    apk add --root "$TROOT" --allow-untrusted --no-scripts --initdb --force-depends "$A" 2>&1 || true
  }
done

echo
echo "===== 已安装包 ====="
apk info --root "$TROOT" 2>/dev/null || true
echo "===== 落地文件 ====="
find "$TROOT" -type f | head -40
echo "BUILD DONE"


echo
echo "===== 决定性验证：依赖桩 + 一起安装(无需仓库索引) ====="
STUB=/work/stub
rm -rf "$STUB"; mkdir -p "$STUB"
for dep in luci-base rpcd-mod-file ucode ucode-mod-ubus; do
  mkdir -p "$STUB/root_$dep"
  apk mkpkg --info "name:$dep" --info "version:1.0-r0" --info "arch:noarch" \
    --info "description:stub $dep" --files "$STUB/root_$dep" \
    --output "$STUB/${dep}-1.0-r0.apk"
done
VROOT=/work/vroot
rm -rf "$VROOT"; mkdir -p "$VROOT"
# 初始化 apk 数据库
apk add --root "$VROOT" --initdb --allow-untrusted 2>&1 || true
echo "--- 一起安装 桩包 + 插件包 ---"
apk add --root "$VROOT" --allow-untrusted --no-scripts \
  "$STUB"/*.apk "$OUT"/*.apk 2>&1 || echo "  [安装返回非0]"
echo "--- 已安装列表 ---"
apk info --root "$VROOT" 2>/dev/null || true
echo "--- 插件文件落地 ---"
find "$VROOT" -type f | grep -E 'emmc-health|fanrgb|menu.d|luci-static' | head -30
echo "VERIFY DONE"
