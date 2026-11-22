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

# 精致风格 = 经典版的同名升级替换包（包名同为 luci-app-xiaomi-control，版本更高 r7）。
# 这样 apk 当作升级覆盖：不再有文件冲突、不再出现两个菜单、无需手动卸载。
mk_one be10000-fanrgb luci-app-xiaomi-control 20261122-r7 \
  "BE10000 Fan and RGB control - refined SBE-style UI (replaces classic)" \
  "https://github.com/VIKINGYFY/immortalwrt" \
  "GPL-2.0-or-later" \
  "luci-base rpcd-mod-file ucode ucode-mod-ubus"

# 经典风格保留为回退包（低版本 r6，需要时用 --allow-downgrade 装回去）
mk_one xiaomi-control-classic luci-app-xiaomi-control 20261122-r6 \
  "BE10000 Fan and RGB control - OWRT native style improved UI" \
  "https://github.com/VIKINGYFY/immortalwrt" \
  "GPL-2.0-or-later" \
  "luci-base rpcd-mod-file ucode ucode-mod-ubus"

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
# 决定性验证：先装经典版再升级到精致版（同名包覆盖），确认零冲突、只剩一份菜单/视图
echo "--- 决定性验证: 桩包 + eMMC + 经典版(r6) ---"
VROOT=/work/vroot
rm -rf "$VROOT"; mkdir -p "$VROOT"
apk add --root "$VROOT" --initdb --allow-untrusted 2>&1 || true
apk add --root "$VROOT" --allow-untrusted --no-scripts \
  "$STUB"/*.apk \
  "$OUT"/luci-app-emmc-health_*.apk \
  "$OUT"/luci-app-xiaomi-control_20261122-r6.apk 2>&1 || echo "  [安装返回非0]"
echo "--- 已装(应为 r6) ---"
apk info --root "$VROOT" 2>/dev/null | grep -E 'xiaomi-control|emmc' || true

echo "--- 升级到精致版(r7)，同名覆盖，应无 conflict ---"
apk add --root "$VROOT" --allow-untrusted --no-scripts \
  "$OUT"/luci-app-xiaomi-control_20261122-r7.apk 2>&1 || echo "  [升级返回非0]"
echo "--- 已装(应为 r7，且只有一个 xiaomi-control) ---"
apk info --root "$VROOT" 2>/dev/null | grep -E 'xiaomi-control|emmc' || true
echo "--- 后端+菜单落地（应只有一份 be10000-fanrgb 视图，无重复菜单）---"
find "$VROOT" -type f | grep -E 'xiaomi-control.uc|xiaomi-nfc.uc|init.d/xiaomi-control|config/xiaomi-control|menu.d|luci-static' | sort | head -30
echo "--- menu 视图数量（应为1）---"
find "$VROOT" -type f -path '*luci-static/resources/view/*' | grep -cE 'fanrgb|xiaomi-control' || true
echo "VERIFY DONE"
