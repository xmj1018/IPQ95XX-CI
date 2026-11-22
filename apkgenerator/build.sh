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
  find "$P/rootfs" -type f \( -name 'emmc-health' -o -name 'emmc-health-install-mmc' -o -name 'fanctl' -o -name 'ledctl' -o -name '*.uc' -o -path '*/init.d/*' -o -path '*/uci-defaults/*' \) -exec chmod 755 {} + 2>/dev/null || true

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

mk_one be10000-fanrgb luci-app-be10000-fanrgb 1.0.0-r6 \
  "BE10000 Fan and RGB control SBE1V1K style UI" \
  "https://github.com/VIKINGYFY/immortalwrt" \
  "GPL-2.0-or-later" \
  "luci-base rpcd-mod-file ucode ucode-mod-ubus"

mk_one xiaomi-control-classic luci-app-xiaomi-control 20261122-r6 \
  "BE10000 Fan and RGB control - OWRT native style improved UI" \
  "https://github.com/VIKINGYFY/immortalwrt" \
  "GPL-2.0-or-later" \
  "luci-base rpcd-mod-file ucode ucode-mod-ubus"

echo
echo "===== 验证：apk add --allow-untrusted 实测安装到临时 root ====="
i=0
for A in "$OUT"/*.apk; do
  i=$((i+1))
  TROOT="/work/testroot_$i"
  rm -rf "$TROOT"; mkdir -p "$TROOT"
  echo "--- 安装测试(独立root): $(basename "$A") ---"
  apk add --root "$TROOT" --allow-untrusted --no-scripts --initdb "$A" 2>&1 || {
    echo "  [WARN] 直接失败, 尝试 --force-depends"
    apk add --root "$TROOT" --allow-untrusted --no-scripts --initdb --force-depends "$A" 2>&1 || true
  }
done
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
# 经典版与精致版后端文件同名（二者二选一，不可同装），故各自独立 root 验证
for PKG_KEY in xiaomi-control-classic be10000-fanrgb; do
  VROOT="/work/vroot_$PKG_KEY"
  rm -rf "$VROOT"; mkdir -p "$VROOT"
  apk add --root "$VROOT" --initdb --allow-untrusted 2>&1 || true
  echo "--- 决定性验证 $PKG_KEY: 桩包 + eMMC + $PKG_KEY ---"
  case "$PKG_KEY" in
    xiaomi-control-classic) APKS="$STUB"/*.apk "$OUT"/luci-app-emmc-health_*.apk "$OUT"/luci-app-xiaomi-control_*.apk ;;
    be10000-fanrgb) APKS="$STUB"/*.apk "$OUT"/luci-app-emmc-health_*.apk "$OUT"/luci-app-be10000-fanrgb_*.apk ;;
  esac
  apk add --root "$VROOT" --allow-untrusted --no-scripts $APKS 2>&1 || echo "  [安装返回非0]"
  echo "--- 已安装列表($PKG_KEY) ---"
  apk info --root "$VROOT" 2>/dev/null || true
  echo "--- 后端文件落地($PKG_KEY) ---"
  find "$VROOT" -type f | grep -E 'xiaomi-control.uc|xiaomi-nfc.uc|init.d/xiaomi-control|config/xiaomi-control|menu.d|luci-static' | head -30
done
echo "VERIFY DONE"
