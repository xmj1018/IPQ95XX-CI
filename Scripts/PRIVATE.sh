#!/bin/bash
rm -rf ./package/honk ./package/luci-app-honk ./package/doona ./package/luci-app-doona 2>/dev/null
find ./feeds -maxdepth 4 -type d \( -iname "honk" -o -iname "luci-app-honk" -o -iname "doona" -o -iname "luci-app-doona" \) -exec rm -rf {} + 2>/dev/null
UPDATE_PACKAGE "honk" "kenzok8/openwrt-honk" "main" "pkg" "luci-app-honk honk doona luci-app-doona"
UPDATE_PACKAGE "luci-app-honk" "kenzok8/openwrt-honk" "main" "pkg"
UPDATE_PACKAGE "v2ray-geodata" "kenzok8/small" "master" "" "v2ray-geoip v2ray-geosite"
UPDATE_PACKAGE "open-app-filter" "destan19/OpenAppFilter" "master" "" "luci-app-appfilter oaf open-app-filter"

for PKG in quickstart luci-app-quickstart luci-app-istorex luci-app-store taskd luci-lib-taskd luci-lib-xterm; do
  UPDATE_PACKAGE "$PKG" "kenzok8/openwrt-packages" "master" "pkg"
done

UPDATE_PACKAGE "luci-app-re-homeproxy" "1andrevich/homeproxy-hiddify" "master" "" "luci-app-homeproxy"

if [ -d "$GITHUB_WORKSPACE/user-files" ]; then
  mkdir -p ./files
  cp -af "$GITHUB_WORKSPACE/user-files/." ./files/
  # Argon 统一为作者官方源(jerrykuku master 3.2.0)+ 官方自带字体，与 PONWRT-HG5585F 完全一致：
  #   - 旧的 argon rpcd / uci-defaults 覆盖文件已移除；
  #   - user-files/www/luci-static/argon/fonts/ 字体覆盖目录已整体删除，
  #     不再用小米原版字体(以及旧版残留的 argon.woff 图标字体)覆盖主题；
  #   - 官方主题 fonts/ 只含 GoogleSans-Regular.woff2 + TypoGraphica.woff2，
  #     base.css 的 @font-face 直接引用这两个文件，编译后即为官方字体。
  ARGON_PKG="./package/luci-theme-argon"
  ARGON_FONTS="$ARGON_PKG/htdocs/luci-static/argon/fonts"
  if [ -f "$ARGON_PKG/Makefile" ]; then
    echo "Argon official source: jerrykuku/luci-theme-argon master, $(grep -m1 '^PKG_VERSION' "$ARGON_PKG/Makefile")"
  else
    echo "WARN: Argon official package not found (check Packages.sh clone)"
  fi
  if [ -d "$ARGON_FONTS" ]; then
    echo "Argon official fonts: $(ls -1 "$ARGON_FONTS" | tr '\n' ' ')"
  else
    echo "WARN: Argon official fonts dir not found"
  fi
  chmod 755 \
    ./files/etc/uci-defaults/* \
    ./files/etc/init.d/* \
    ./files/usr/libexec/route-tool \
    ./files/usr/libexec/route-tool.d/*.sh 2>/dev/null || :
  chmod 644 ./files/usr/lib/lua/luci/controller/route_tool.lua 2>/dev/null || :
  echo "SBE1V1K user-files overlaid: $(find ./files -type f | wc -l) files"
else
  echo "WARN: user-files not found, skip overlay"
fi
