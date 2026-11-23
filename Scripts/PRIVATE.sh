#!/bin/bash
# SBE1V1K 全新精简固件 | 2026-11-23 从零编写
# 由 CI 官方 Scripts/Packages.sh 末尾自动 source，故可直接用 UPDATE_PACKAGE 函数。
#
# 本脚本只做两件事：
#   1) 准备本固件所需、而 owrt 源与官方 Packages.sh 都不自带的第三方包源；
#   2) 把 user-files 覆盖进 ./files 并补回被 REST API 上传丢掉的可执行位。
#
# 【包源归属】官方 Packages.sh 已提供：OpenClash(vernesong)、Argon(sbwml 新版)。
#            本固件【不】加 HomeProxy，GENERAL 基线里写死的 homeproxy 由 PRIVATE.txt =n 关掉。
#            其余三个（honk / OAF / iStoreOS 风格）必须在此克隆，否则 defconfig 会
#            因找不到包符号直接丢弃 PRIVATE.txt 里的 =y，插件静默消失。

echo " "
echo "========== Load PRIVATE.sh (SBE1V1K fresh minimal) =========="

# ---------------- Honk + luci-app-honk（kenzok8/openwrt-honk）----------------
# 先清掉可能存在的同名旧目录，避免两个来源同时提供同名包导致 trying to overwrite。
rm -rf ./package/honk ./package/luci-app-honk ./package/doona ./package/luci-app-doona 2>/dev/null
find ./feeds -maxdepth 4 -type d \( -iname "honk" -o -iname "luci-app-honk" -o -iname "doona" -o -iname "luci-app-doona" \) -exec rm -rf {} + 2>/dev/null
UPDATE_PACKAGE "honk" "kenzok8/openwrt-honk" "main" "pkg" "luci-app-honk honk doona luci-app-doona"
UPDATE_PACKAGE "luci-app-honk" "kenzok8/openwrt-honk" "main" "pkg"

# ---------------- OAF 应用过滤（destan19/OpenAppFilter 同源一整套）----------------
# 只克隆这一套，appfilter/oaf/kmod-oaf/luci-app-oaf 版本配套。
# 切勿再克隆 kenzok8/jell 的 luci-app-oaf（版本 0），它与 appfilter 7.x 都提供
# usr/share/rpcd/acl.d/luci-app-oaf.json，会 trying to overwrite 导致打包失败。
UPDATE_PACKAGE "open-app-filter" "destan19/OpenAppFilter" "master" "" "luci-app-appfilter oaf open-app-filter"

# ---------------- iStoreOS 风格（kenzok8/openwrt-packages 同源保版本一致）----------------
# 依赖链：luci-app-quickstart→quickstart/luci-app-store；
#         istorex/store→luci-lib-taskd；luci-lib-taskd→luci-lib-xterm+taskd。
for PKG in quickstart luci-app-quickstart luci-app-istorex luci-app-store taskd luci-lib-taskd luci-lib-xterm; do
  UPDATE_PACKAGE "$PKG" "kenzok8/openwrt-packages" "master" "pkg"
done

# ---------------- 自定义文件覆盖（最新版 Argon 模板 + 315 字体 + 自研功能成品）----------------
if [ -d "$GITHUB_WORKSPACE/user-files" ]; then
  mkdir -p ./files
  cp -af "$GITHUB_WORKSPACE/user-files/." ./files/

  # GitHub REST API 上传的文件统一 100644，脚本类必须补回 755（通配覆盖全部 uci-defaults/init.d）
  chmod 755 \
    ./files/etc/uci-defaults/* \
    ./files/etc/init.d/* \
    ./files/usr/sbin/fanctl ./files/usr/sbin/ledctl \
    ./files/usr/lib/sbe1v1k/* \
    ./files/usr/libexec/route-tool ./files/usr/libexec/route-tool.d/*.sh \
    ./files/usr/libexec/rpcd/luci.argon \
    ./files/usr/libexec/rpcd/luci.argon_appearance \
    ./files/usr/libexec/rpcd/luci.argon_branding \
    ./files/usr/libexec/rpcd/luci.argon_update \
    ./files/usr/libexec/rpcd/luci.argon_wallpaper 2>/dev/null || :
  chmod 644 ./files/usr/lib/lua/luci/controller/route_tool.lua 2>/dev/null || :

  echo "fresh user-files overlaid: $(find ./files -type f | wc -l) files"
else
  echo "WARN: user-files not found, skip overlay"
fi
