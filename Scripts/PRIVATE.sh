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

  # Argon 3.2.0 选中项白字修复（用户实测有效）：
  # 官方 base.css 用对比度算法给主色 #6A89CC 算出 --light-on-primary=#000000，
  # 导致一级菜单选中项是「蓝底黑字」。在官方主题包 base.css 末尾追加覆盖，
  # 强制 --light-on-primary/--accent-text 为白字（含 hover 与图标），保留原主色。
  # 主题本体仍是 jerrykuku 官方源，仅多这段 CSS；编译后落在
  # /www/luci-static/argon/css/base.css，开机即生效，无需手动 SSH。
  ARGON_CSS="$ARGON_PKG/htdocs/luci-static/argon/css/base.css"
  if [ -f "$ARGON_CSS" ] && ! grep -q "Argon selected white text" "$ARGON_CSS"; then
    cat >> "$ARGON_CSS" <<'ARGON_WHITE_TEXT_EOF'

/* Argon selected white text (keep primary #6A89CC) */
:root {
  --light-on-primary: #ffffff !important;
  --accent-text: #ffffff !important;
}
.main-left .nav > li > :is(a, button):first-child.active,
.main-left .nav > li > :is(a, button):first-child.active::after,
.main-left .nav > li > :is(a, button):first-child.active .menu-icon,
.main-left .nav > li > :is(a, button):first-child:hover,
.main-left .nav > li > :is(a, button):first-child:hover::after,
.main-left .nav > li > :is(a, button):first-child:hover .menu-icon {
  color: #ffffff !important;
}
ARGON_WHITE_TEXT_EOF
    echo "Argon base.css: appended selected white-text override"
  else
    echo "Argon base.css: override already present or file missing, skip"
  fi

  # Argon 3.2.0 主色固化为 #6A89CC（用户指定，编好的固件默认就是这个色）：
  # 官方默认 primary=#5e72e4，存在两处——
  #   1) root/etc/config/argon 的 option primary（首次开机写进 /etc/config/argon）
  #   2) root/etc/uci-defaults/30_luci-theme-argon 的 DEFAULTS 段 primary（缺失时兜底）
  # 两处都改，避免升级/重建配置时回退到官方默认蓝。
  ARGON_PRIMARY='#6A89CC'
  ARGON_CONFIG="$ARGON_PKG/root/etc/config/argon"
  ARGON_DEFAULT="$ARGON_PKG/root/etc/uci-defaults/30_luci-theme-argon"
  if [ -f "$ARGON_CONFIG" ]; then
    sed -i "s/option primary '[^']*'/option primary '$ARGON_PRIMARY'/" "$ARGON_CONFIG"
    echo "Argon config primary: $(grep -m1 'option primary' "$ARGON_CONFIG" | tr -d '\t')"
  else
    echo "WARN: Argon config/argon not found"
  fi
  if [ -f "$ARGON_DEFAULT" ]; then
    sed -i "s/^primary #[0-9A-Fa-f]\{6\}$/primary $ARGON_PRIMARY/" "$ARGON_DEFAULT"
    echo "Argon uci-defaults primary: $(grep -m1 '^primary ' "$ARGON_DEFAULT")"
  else
    echo "WARN: Argon 30_luci-theme-argon not found"
  fi

  # Argon 3.2.0 登录面板透明度固化为 0.3（用户指定，官方默认 0.5）。
  # 同样改 config + uci-defaults 两处；dark_glass_mode 默认 inherit，
  # 深色模式自动继承浅色的 transparency，故只改主 transparency 即可全覆盖。
  ARGON_TRANSPARENCY='0.3'
  if [ -f "$ARGON_CONFIG" ]; then
    sed -i "s/option transparency '[^']*'/option transparency '$ARGON_TRANSPARENCY'/" "$ARGON_CONFIG"
    echo "Argon config transparency: $(grep -m1 "option transparency '" "$ARGON_CONFIG" | tr -d '\t')"
  fi
  if [ -f "$ARGON_DEFAULT" ]; then
    sed -i "s/^transparency [0-9.]*$/transparency $ARGON_TRANSPARENCY/" "$ARGON_DEFAULT"
    echo "Argon uci-defaults transparency: $(grep -m1 '^transparency ' "$ARGON_DEFAULT")"
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
