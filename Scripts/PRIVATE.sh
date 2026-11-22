#!/bin/bash
# SPDX-License-Identifier: MIT
# 自定义插件源扩展脚本（由官方 Scripts/Packages.sh 末尾自动 source）
# 【小米万兆 BE10000 单机型】一次只编这一台：Config 里只启用 xiaomi_be10000。
#
# 2026-11-22 用户定稿：
#   * Argon 主题照抄 LibWrt 样机新版 —— 直接用 Packages.sh 默认的
#     sbwml/luci-theme-argon openwrt-25.12（新版 26.x，与样机同源），
#     【这里不再用 kenzok8 老版覆盖】，并用 user-files 覆盖样机 91 文件。
#   * 品牌 LibWrt：由 workflow WRT_NAME=LibWrt 设置 hostname（左上/登录页取此值）。
#   * 风扇/RGB：保留上游 luci-app-xiaomi-control 原样，不加任何自研插件。
#   * 配方与 SBE 一致：honk + OAF + iStoreOS + HomeProxyRE + router-tool + OpenClash。
#
# 源码由官方 Scripts/Packages.sh 提供（openclash / honk 等按需克隆）。

echo " "
echo "========== Load PRIVATE.sh (BE10000 single-device, LibWrt argon) =========="

# ---------------- honk（用户指定：kenzok8/openwrt-honk）----------------
rm -rf ./package/honk ./package/luci-app-honk ./package/doona ./package/luci-app-doona 2>/dev/null
find ./feeds -maxdepth 4 -type d \( -iname "honk" -o -iname "luci-app-honk" -o -iname "doona" -o -iname "luci-app-doona" \) -exec rm -rf {} + 2>/dev/null
UPDATE_PACKAGE "honk" "kenzok8/openwrt-honk" "main" "pkg" "luci-app-honk honk doona luci-app-doona"
UPDATE_PACKAGE "luci-app-honk" "kenzok8/openwrt-honk" "main" "pkg"

# v2ray GeoIP / GeoSite（honk 路由数据依赖）
UPDATE_PACKAGE "v2ray-geodata" "kenzok8/small" "master" "" "v2ray-geoip v2ray-geosite"

# ---------------- OAF（destan19 同源一整套版本配套）----------------
# 不要额外克隆 kenzok8/jell 的 luci-app-oaf(版本0)，会和 appfilter 7.0.2 冲突。
UPDATE_PACKAGE "open-app-filter" "destan19/OpenAppFilter" "master" "" "luci-app-appfilter oaf open-app-filter"

# ---------------- iStoreOS 风格（同源保版本一致）----------------
for PKG in quickstart luci-app-quickstart luci-app-istorex luci-app-store taskd luci-lib-taskd luci-lib-xterm; do
  UPDATE_PACKAGE "$PKG" "kenzok8/openwrt-packages" "master" "pkg"
done

# ---------------- Argon：用 Packages.sh 默认的新版 sbwml/luci-theme-argon openwrt-25.12 ----------------
# 不覆盖、不克隆 kenzok8 老版。样机 LibWrt 就是这套新版（片段模板+ucode+rpcd 动态模块）。
# 品牌 LibWrt 由 WRT_NAME=LibWrt 设置 hostname，新版 argon 模板取 hostname 渲染。

# ---------------- HomeProxy（1andrevich/homeproxy-hiddify）----------------
UPDATE_PACKAGE "luci-app-re-homeproxy" "1andrevich/homeproxy-hiddify" "master" "" "luci-app-homeproxy"

# ---------------- 自定义文件覆盖（样机新版 Argon 91 文件）----------------
if [ -d "$GITHUB_WORKSPACE/user-files" ]; then
  mkdir -p ./files
  cp -af "$GITHUB_WORKSPACE/user-files/." ./files/

  # GitHub REST API 上传的文件一律 100644，会丢可执行位。
  # 新版 argon 的 rpcd 脚本 / uci-defaults 必须补回 755，否则动态模块/初始化失败。
  chmod 755 \
    ./files/usr/libexec/rpcd/luci.argon \
    ./files/usr/libexec/rpcd/luci.argon_appearance \
    ./files/usr/libexec/rpcd/luci.argon_branding \
    ./files/usr/libexec/rpcd/luci.argon_update \
    ./files/usr/libexec/rpcd/luci.argon_wallpaper \
    ./files/etc/uci-defaults/30_luci-theme-argon \
    ./files/etc/uci-defaults/990_set_argon_primary \
    ./files/etc/uci-defaults/91-ssid-model-prefix \
    ./files/usr/libexec/emmc-health \
    ./files/usr/libexec/emmc-health-install-mmc 2>/dev/null || :

  # 双保险：远程 user-files 是全仓库共用的，切机型时上一版 SBE 残留会被整包卷进来。
  # 这里把 SBE1V1K 那一套全部清掉，万兆固件里连文件都不带。
  rm -f ./files/etc/config/fan ./files/etc/config/led \
        ./files/etc/init.d/fanctl ./files/etc/init.d/ledctl \
        ./files/usr/sbin/fanctl ./files/usr/sbin/ledctl \
        ./files/usr/share/luci/menu.d/luci-app-sbe1v1k.json \
        ./files/usr/share/rpcd/acl.d/luci-app-sbe1v1k.json \
        ./files/etc/uci-defaults/99-hwctrl-enable \
        ./files/usr/share/luci/menu.d/luci-app-fan.json \
        ./files/usr/share/luci/menu.d/luci-app-led.json \
        ./files/usr/share/luci/menu.d/luci-app-sbehw.json \
        ./files/usr/share/rpcd/acl.d/luci-app-fan.json \
        ./files/usr/share/rpcd/acl.d/luci-app-led.json \
        ./files/usr/share/rpcd/acl.d/luci-app-sbehw.json \
        ./files/etc/board.d/01_leds \
        ./files/etc/modules.d/60-hwmon-pwmfan \
        ./files/lib/functions/leds.sh \
        ./files/sbin/led.sh 2>/dev/null || :
  rm -rf ./files/usr/lib/sbe1v1k \
         ./files/www/luci-static/resources/view/sbe1v1k \
         ./files/www/luci-static/resources/view/sbehw \
         ./files/www/luci-static/resources/view/system/led-trigger 2>/dev/null || :

  echo "LibWrt argon (91 files) overlaid: $(find ./files -type f | wc -l) files"
else
  echo "WARN: user-files not found, skip overlay"
fi

# ---------------- 品牌 / 无线 / SSID / 密码 / 后台地址 ----------------
# 本脚本【不修改任何上游源码文件】，完全照抄 VIKINGYFY/immortalwrt 默认机制：
#   * 主机名 / 左上角 / 登录页品牌：workflow WRT_NAME=LibWrt -> Settings.sh 设 hostname。
#   * 无线：wifi-scripts 输出 wifi-iface disabled='0'（默认开启）。
#   * SSID：机型前缀 BE10000-2.4G / BE10000-5.2G（/ 5.8G）+ 12345678，
#     由 user-files/etc/uci-defaults/91-ssid-model-prefix 填 router-tool.defaults.ssid=BE10000，
#     交给上游 router-tool 自带机制生成；品牌 LibWrt 只管左上角/登录页，与 SSID 前缀无关。
#   * 后台地址：Settings.sh 按 WRT_IP 设为 192.168.10.1。
# 【OWRT 是上游 wireless.uc 内部判断用的字面量，严禁 sed 替换】
# 上游 luci-app-router-tool 靠 wireless.uc 的 "iface.ssid != 'OWRT'" 判断未改过的默认 AP；
# 已彻底不做任何源码 sed 替换，只用 uci-defaults 覆盖 SSID。
#
# ---------------- 本次新增：编进固件的两个 LuCI 插件（APK 装不上，改为直接内置）----------------
#   * BE10000 风扇/RGB【SBE 同款精致版】：只放新界面/菜单/ACL，后端复用上游 xiaomi-control.uc。
#     user-files/usr/share/luci/menu.d/luci-app-be10000-fanrgb.json
#     user-files/usr/share/rpcd/acl.d/be10000-fanrgb.json
#     user-files/www/luci-static/resources/view/be10000-fanrgb.js
#   * eMMC 健康检测：后端+前端+菜单+ACL 全套内置（mmc-utils 上游已编译进来）。
#     user-files/usr/libexec/emmc-health + emmc-health-install-mmc
#     user-files/usr/share/luci/menu.d/luci-app-emmc-health.json
#     user-files/usr/share/rpcd/acl.d/luci-app-emmc-health.json
#     user-files/www/luci-static/resources/view/emmc-health.js
# 这些文件名与上游 xiaomi-control 不冲突，两套菜单并存、共用同一后端。

echo "========== PRIVATE.sh done =========="
