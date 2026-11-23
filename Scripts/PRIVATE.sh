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
  chmod 755 \
    ./files/etc/uci-defaults/* \
    ./files/etc/init.d/* \
    ./files/usr/libexec/route-tool \
    ./files/usr/libexec/route-tool.d/*.sh \
    ./files/usr/libexec/rpcd/luci.argon \
    ./files/usr/libexec/rpcd/luci.argon_appearance \
    ./files/usr/libexec/rpcd/luci.argon_branding \
    ./files/usr/libexec/rpcd/luci.argon_update \
    ./files/usr/libexec/rpcd/luci.argon_wallpaper 2>/dev/null || :
  chmod 644 ./files/usr/lib/lua/luci/controller/route_tool.lua 2>/dev/null || :
  echo "Mi-10G-Wrt user-files overlaid: $(find ./files -type f | wc -l) files"
else
  echo "WARN: user-files not found, skip overlay"
fi
