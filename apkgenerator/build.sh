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

# 拆分方案（两套风格各自独立模块，SBE 同款界面，共用 xiaomi-control 上游后端）：
#  - 风扇包 = 同名升级 luci-app-xiaomi-control（版本更高 r8），自带完整后端 + 风扇控制视图/菜单。
#            同名确保覆盖当前 r7、不冲突、旧的单体菜单自动消失。
#  - 灯包   = 独立新包 luci-app-be10000-led，纯界面，复用风扇包/固件的后端，零文件冲突。
# 两个包可同时装、也可分开装；菜单严格为「风扇控制」「RGB 状态灯」。
mk_one be10000-fan luci-app-xiaomi-control 20261122-r8 \
  "BE10000 fan control - SBE1V1K style UI, with upstream backend" \
  "https://github.com/VIKINGYFY/immortalwrt" \
  "GPL-2.0-or-later" \
  "luci-base rpcd-mod-file ucode ucode-mod-ubus"

mk_one be10000-led luci-app-be10000-led 1.0.0-r1 \
  "BE10000 RGB status light - SBE1V1K style UI, reuses xiaomi-control backend" \
  "https://github.com/VIKINGYFY/immortalwrt" \
  "GPL-2.0-or-later" \
  "luci-base rpcd-mod-file ucode ucode-mod-ubus"

# 旧单体精致版/经典版作为回退保留（低版本，需要时用 --allow-downgrade 装回）
mk_one be10000-fanrgb luci-app-xiaomi-control 20261122-r7 \
  "BE10000 Fan and RGB control - refined SBE-style UI (legacy single panel)" \
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
# 决定性验证：旧单体 r7 -> 拆分的 风扇包 r8 + 灯包，确认零冲突、一份后端、两个独立菜单/视图
echo "--- 决定性验证: 桩包 + eMMC + 旧单体 r7 ---"
VROOT=/work/vroot
rm -rf "$VROOT"; mkdir -p "$VROOT"
apk add --root "$VROOT" --initdb --allow-untrusted 2>&1 || true
apk add --root "$VROOT" --allow-untrusted --no-scripts \
  "$STUB"/*.apk \
  "$OUT"/luci-app-emmc-health_*.apk \
  "$OUT"/luci-app-xiaomi-control_20261122-r7.apk 2>&1 || echo "  [安装返回非0]"
echo "--- 已装(应为 r7) ---"
apk info --root "$VROOT" 2>/dev/null | grep -E 'xiaomi-control|emmc' || true

echo "--- 升级到拆分风扇包(r8)，同名覆盖应无 conflict ---"
apk add --root "$VROOT" --allow-untrusted --no-scripts \
  "$OUT"/luci-app-xiaomi-control_20261122-r8.apk 2>&1 || echo "  [升级返回非0]"

echo "--- 再装独立灯包，应与风扇包零冲突共存 ---"
apk add --root "$VROOT" --allow-untrusted --no-scripts \
  "$OUT"/luci-app-be10000-led_1.0.0-r1.apk 2>&1 || echo "  [灯包返回非0]"

echo "--- 已装(应为 xiaomi-control-r8 + be10000-led-r1 + emmc) ---"
apk info --root "$VROOT" 2>/dev/null | grep -E 'xiaomi-control|be10000-led|emmc' || true
echo "--- 落地文件：一份后端 + 两个菜单 + 两个视图 ---"
find "$VROOT" -type f | grep -E 'xiaomi-control.uc|xiaomi-nfc.uc|init.d/xiaomi-control|config/xiaomi-control|menu.d|luci-static' | sort | head -40
echo "--- 后端份数（uc 应为1）---"
find "$VROOT" -type f -name 'xiaomi-control.uc' | wc -l
echo "--- 视图数量（应为2: fan + led）---"
find "$VROOT" -type f -path '*luci-static/resources/view/be10000/*' | sort
echo "VERIFY DONE"
