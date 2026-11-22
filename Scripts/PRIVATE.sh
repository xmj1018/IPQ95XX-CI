#!/bin/bash
# SPDX-License-Identifier: MIT
# 自定义插件源扩展脚本（由官方 Scripts/Packages.sh 末尾自动 source）
# 【SBE1V1K 单机型精简版】一次只编这一台：Config 里只启用 askey_sbe1v1k，
# files/ 里只有 luci-app-sbe1v1k，完全没有万兆 BE10000 的插件/后端/菜单/驱动。
# 界面只有一个「风扇控制」+ 一个「RGB 状态灯」。
#
# 配方照旧（用户：正常保留这个配置就行）：
#   honk + OAF + iStoreOS 风格 + HomeProxyRE + bootstrap 主题
#   + luci-app-sbe1v1k + luci-app-router-tool(上游自带) + OpenClash
# 2026-11-23 用户指令：不再编译 luci-theme-argon / luci-app-argon-config，
#   默认主题改 bootstrap；从万兆提取的 woff2 字体与全套模板文件仍原样保留进 rootfs。
# OpenClash 源码由官方 Scripts/Packages.sh 的
#   UPDATE_PACKAGE "openclash" "vernesong/OpenClash" "dev" "pkg"
# 克隆，这里【不要重复克隆】，只需在 PRIVATE.txt 里把
# CONFIG_PACKAGE_luci-app-openclash 选成 y。
# 旧版 OW 自带风扇/LED 界面、LED 触发器、旧 sbehw 全部移除。
# 不加 Docker / emmc-health / 36 插件全集 —— 控制体积确保能启动。

echo " "
echo "========== Load PRIVATE.sh (SBE1V1K single-device lite) =========="

# ---------------- honk（用户指定：kenzok8/openwrt-honk）----------------
rm -rf ./package/honk ./package/luci-app-honk ./package/doona ./package/luci-app-doona 2>/dev/null
find ./feeds -maxdepth 4 -type d \( -iname "honk" -o -iname "luci-app-honk" -o -iname "doona" -o -iname "luci-app-doona" \) -exec rm -rf {} + 2>/dev/null
UPDATE_PACKAGE "honk" "kenzok8/openwrt-honk" "main" "pkg" "luci-app-honk honk doona luci-app-doona"
UPDATE_PACKAGE "luci-app-honk" "kenzok8/openwrt-honk" "main" "pkg"

# v2ray GeoIP / GeoSite（honk 路由数据依赖）
UPDATE_PACKAGE "v2ray-geodata" "kenzok8/small" "master" "" "v2ray-geoip v2ray-geosite"

# ---------------- OAF（应用过滤，destan19 同源一整套版本配套）----------------
# 不要额外克隆 kenzok8/jell 的 luci-app-oaf(版本0)，它和 appfilter 7.0.2 都提供
# usr/share/rpcd/acl.d/luci-app-oaf.json，会 trying to overwrite 导致打包失败。
UPDATE_PACKAGE "open-app-filter" "destan19/OpenAppFilter" "master" "" "luci-app-appfilter oaf open-app-filter"

# ---------------- iStoreOS 风格（同源保版本一致）----------------
for PKG in quickstart luci-app-quickstart luci-app-istorex luci-app-store taskd luci-lib-taskd luci-lib-xterm; do
  UPDATE_PACKAGE "$PKG" "kenzok8/openwrt-packages" "master" "pkg"
done

# ---------------- Argon 主题：用 Packages.sh 默认的新版 sbwml/luci-theme-argon openwrt-25.12 ----------------
# 2026-11-22 用户指令：Argon 更新到最新，字体沿用小米万兆那套（新版 woff2）。
# 不再克隆 kenzok8 老版覆盖（老版 2.4.2 + woff 字体已弃用）；CI 的 Packages.sh
# 默认 UPDATE_PACKAGE "argon" "sbwml/luci-theme-argon" "openwrt-25.12" 就是新版，
# user-files 覆盖万兆同款新版 91 文件（11 模板 + woff2 字体 + rpcd/ucode/js/icon）。
# 品牌 SBE1V1K 由 WRT_NAME=SBE1V1K 设 hostname，新版模板取 hostname 渲染。

# ---------------- HomeProxy（用户指定：1andrevich/homeproxy-hiddify）----------------
UPDATE_PACKAGE "luci-app-re-homeproxy" "1andrevich/homeproxy-hiddify" "master" "" "luci-app-homeproxy"

# ---------------- 自定义文件覆盖（新版 Argon 全套 + 仅 luci-app-sbe1v1k）----------------
if [ -d "$GITHUB_WORKSPACE/user-files" ]; then
  mkdir -p ./files
  cp -af "$GITHUB_WORKSPACE/user-files/." ./files/

  # GitHub REST API 上传的文件一律 100644，会丢可执行位。
  # 后端脚本、init、uci-defaults、新版 Argon 的 rpcd 动态模块脚本必须补回 755。
  chmod 755 \
    ./files/usr/sbin/fanctl ./files/usr/sbin/ledctl \
    ./files/etc/init.d/fanctl ./files/etc/init.d/ledctl \
    ./files/usr/lib/sbe1v1k/fanctl ./files/usr/lib/sbe1v1k/ledctl \
    ./files/usr/lib/sbe1v1k/init.fanctl ./files/usr/lib/sbe1v1k/init.ledctl \
    ./files/etc/uci-defaults/99-hwctrl-enable \
    ./files/etc/uci-defaults/30_luci-theme-argon \
    ./files/etc/uci-defaults/990_set_argon_primary \
    ./files/etc/uci-defaults/91-ssid-model-prefix \
    ./files/usr/libexec/route-tool ./files/usr/libexec/route-tool.d/*.sh \
    ./files/usr/libexec/rpcd/luci.argon \
    ./files/usr/libexec/rpcd/luci.argon_appearance \
    ./files/usr/libexec/rpcd/luci.argon_branding \
    ./files/usr/libexec/rpcd/luci.argon_update \
    ./files/usr/libexec/rpcd/luci.argon_wallpaper 2>/dev/null || :
  chmod 755 ./files/usr/lib/lua/luci/controller/route_tool.lua 2>/dev/null || :

  # 双保险：远程 user-files 是全仓库共用的，切机型时上一版的残留会被整包卷进来。
  # 这里把万兆 BE10000 那一套全部清掉，确保这个固件里连文件都不带。
  rm -f ./files/etc/config/be10000 \
        ./files/etc/init.d/be10000-fan ./files/etc/init.d/be10000-led \
        ./files/usr/sbin/be10000-fanctl ./files/usr/sbin/be10000-ledctl \
        ./files/usr/share/luci/menu.d/luci-app-be10000.json \
        ./files/usr/share/rpcd/acl.d/luci-app-be10000.json \
        ./files/usr/share/luci/menu.d/luci-app-fan.json \
        ./files/usr/share/luci/menu.d/luci-app-led.json \
        ./files/usr/share/luci/menu.d/luci-app-sbehw.json \
        ./files/usr/share/rpcd/acl.d/luci-app-fan.json \
        ./files/usr/share/rpcd/acl.d/luci-app-led.json \
        ./files/usr/share/rpcd/acl.d/luci-app-sbehw.json \
        ./files/www/luci-static/resources/view/system/fan.js \
        ./files/www/luci-static/resources/view/system/led.js \
        ./files/etc/board.d/01_leds \
        ./files/etc/modules.d/60-hwmon-pwmfan \
        ./files/lib/functions/leds.sh \
        ./files/sbin/led.sh 2>/dev/null || :
  rm -rf ./files/www/luci-static/resources/view/be10000 \
         ./files/www/luci-static/resources/view/system/led-trigger \
         ./files/www/luci-static/resources/view/sbehw 2>/dev/null || :

  # 2026-11-23 用户指令：换 bootstrap 主题，不编译 luci-theme-argon / argon-config。
  # 本地 user-files 里那套从万兆提取的 woff2 字体与模板【原样保留、一个字节都不删】，
  # 仍会打进 rootfs（以后自行从源装 Argon 时可直接用）。但 Argon 主题自带的
  # 30_luci-theme-argon 开机脚本会 uci set luci.main.mediaurlbase=/luci-static/argon，
  # 把默认主题强行指回 Argon，导致 WRT_THEME=bootstrap 不生效。
  # 这里只从【编译产物 ./files】里剔除下面两个"主题注册/配置"文件，
  # 不触碰本地 user-files 任何文件：所有 woff2 字体、.ut 模板、静态资源全部保留。
  # 去掉 /etc/config/argon 后，Argon Config 菜单因 depends(uci argon) 不满足而不显示，
  # 等于把用户说的"argon-config 也移除"落地，而字体与模板一个字节都不删。
  rm -f ./files/etc/uci-defaults/30_luci-theme-argon \
        ./files/etc/config/argon 2>/dev/null || :

  echo "bootstrap theme (woff2 fonts kept in rootfs) + sbe1v1k ONLY: $(find ./files -type f | wc -l) files"
else
  echo "WARN: user-files not found, skip overlay"
fi

# ---------------- 品牌 / 无线 / SSID / 密码 / 后台地址：全部保持上游默认 ----------------
# 本脚本【不修改任何上游源码文件】，完全照抄 VIKINGYFY/immortalwrt 的默认：
#   * 主机名 / 左上角 / 登录页品牌：由官方 Settings.sh 按 WRT_NAME=SBE1V1K 设置，
#     新版 Argon 模板(header.ut / sysauth.ut)直接取 hostname 渲染，woff2 字体，页脚作者已删。
#   * 无线：wifi-scripts 生成器输出 wifi-iface disabled='0'（默认开启）。
#   * SSID / 密码：luci-app-router-tool 初始化为
#     OWRT-2.4G / OWRT-5.2G / OWRT-6G + 12345678（SBE 三频，第三频段是 6G 不是 5.8G）。
#   * 后台地址：官方 Settings.sh 按 WRT_IP 设为 192.168.99.1。
#
# 【OWRT 是字面量，严禁替换成 ImmortalWRT】
# 上游 luci-app-router-tool 靠 wireless.uc 里的 "iface.ssid != 'OWRT'" 判断
# 「未被修改过的默认 AP」；只有匹配才会执行初始化。上一版在这里对
# ./package/emortal/luci-app-router-tool/ 做了全局替换，把判断改成
# 'ImmortalWRT'，导致 router-tool 跳过初始化、无线默认失效 —— 已彻底撤销。
# 用户强调：是 OWRT，不是 OpenWrt。四个字母，一个都不能改。

echo "========== PRIVATE.sh done =========="
