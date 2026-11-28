#!/bin/bash
rm -rf ./package/honk ./package/luci-app-honk ./package/doona ./package/luci-app-doona 2>/dev/null
find ./feeds -maxdepth 4 -type d \( -iname "honk" -o -iname "luci-app-honk" -o -iname "doona" -o -iname "luci-app-doona" \) -exec rm -rf {} + 2>/dev/null
UPDATE_PACKAGE "honk" "kenzok8/openwrt-honk" "main" "pkg" "luci-app-honk honk doona luci-app-doona"
UPDATE_PACKAGE "luci-app-honk" "kenzok8/openwrt-honk" "main" "pkg"
UPDATE_PACKAGE "v2ray-geodata" "kenzok8/small" "master" "" "v2ray-geoip v2ray-geosite"
UPDATE_PACKAGE "open-app-filter" "destan19/OpenAppFilter" "master" "" "luci-app-appfilter oaf open-app-filter"

# ── iStoreOS 系列包：从项目作者官方源拉取（2026-11-26 按用户要求改） ──
# 源头是 istoreos（iStoreOS 团队），不再用 kenzok8/openwrt-packages 这个中间打包仓。
#   - istoreos/istoreos-app-hub : apps/quickstart/  → quickstart, luci-app-quickstart
#                                 apps/istorex/     → luci-app-istorex
#   - istoreos/istore           : luci/             → luci-app-store, taskd, luci-lib-taskd, luci-lib-xterm
# 官方仓是多层目录(apps/<应用>/<包名> 或 luci/<包名>)，UPDATE_PACKAGE 的 pkg 模式
# 用模糊 -iname 会误抓相邻包(如 quickstart 会连带 quickstart-netpolicy)，这里按精确路径拷贝。
ISTORE_HUB="./package/_istoreos-app-hub"
ISTORE_LUCI="./package/_istoreos-luci"
rm -rf "$ISTORE_HUB" "$ISTORE_LUCI"
git clone --depth=1 --single-branch --branch main "https://github.com/istoreos/istoreos-app-hub.git" "$ISTORE_HUB"
git clone --depth=1 --single-branch --branch main "https://github.com/istoreos/istore.git" "$ISTORE_LUCI"

# 删除 feeds 里可能存在的同名包，避免与官方源冲突
for PKG in quickstart luci-app-quickstart luci-app-istorex luci-app-store taskd luci-lib-taskd luci-lib-xterm; do
  find ./feeds/luci/ ./feeds/packages/ -maxdepth 4 -type d -iname "*$PKG*" -exec rm -rf {} + 2>/dev/null || :
done

# 精确拷贝官方包到 ./package/ (先删目标再拷，避免 cp 嵌套成 pkg/pkg/)
copy_istore_pkg() {
  local src="$1" name="$2"
  [ -d "$src" ] || { echo "WARN: 官方包源不存在: $src"; return 1; }
  rm -rf "./package/$name"
  cp -af "$src" "./package/$name"
}
copy_istore_pkg "$ISTORE_HUB/apps/istorex/luci-app-istorex"       luci-app-istorex
copy_istore_pkg "$ISTORE_LUCI/luci/luci-app-store"                luci-app-store
copy_istore_pkg "$ISTORE_LUCI/luci/taskd"                         taskd
copy_istore_pkg "$ISTORE_LUCI/luci/luci-lib-taskd"                luci-lib-taskd
copy_istore_pkg "$ISTORE_LUCI/luci/luci-lib-xterm"                luci-lib-xterm

# ── iStoreOS 首页：整套锁定到「官网固件同款」的官方前端 + 官方后端（2026-11-28） ──
# 背景（用户要求「官网固件里是啥咱就是啥」，并强调全部用官方源、权威、后期好更新）：
#   解压官网 iStoreOS 25.12.6-2026110611 x86_64 官方固件逐项核对 + 读官方源码得出：
#   - 官网固件首页 = luci-app-quickstart 0.12.10-r1 的 index.js（498KB，5 张卡片全部
#     写死在前端：网络向导/局域网设备管理/网络测速/家长控制/应用商店），不依赖元数据，
#     所以「该有的都有」。该 index.js MD5 feae5221c2b633088b8a5a7fcfc2b756，
#     与官方 app-hub commit 45f666b60327afb742e1b460b174138c9f853930 逐字节一致。
#   - 官方 app-hub main 现为 0.18.0，index.js 只剩 1438B 加载器，真正界面是 app.js；
#     app.js 里 app 类卡片（网络测速/家长控制等）靠后端 /cgi-bin/luci/istore/home/v1/cards/
#     返回的元数据才显示，元数据缺就没卡片——这正是我们之前首页卡片不齐的根因。
#   - 官网固件后端 = quickstart 0.13.1，来自作者官方 linkease/istore-packages prebuilt，
#     覆盖 aarch64/arm/x86_64；配套老前端走 istore_backend.lua 反代 127.0.0.1:3038，
#     init 为 `serve --unix /var/run/quickstart/local.sock`（见官网固件 /etc/init.d/quickstart）。
# 做法：前端 luci-app-quickstart 从官方 app-hub 的 45f666b checkout（0.12.10-r1）；
#       后端 quickstart 用官方 istore-packages 0.13.1 tarball（官方 hash）覆盖 Makefile。
# 全部作者官方源，版本锁定，后期官方升级只改这两个版本/哈希即可。
ISTORE_QS_COMMIT="45f666b60327afb742e1b460b174138c9f853930"
QS_BACKEND_VER="0.13.1"
QS_BACKEND_HASH="f84ce3bfe1f6ee38338226cfdbb05283c6176cd75e5bb411c9411624f98ba0b1"

# 前端：把官方 app-hub 切到 45f666b（浅克隆需补拉该 commit），再精确取 0.12.10-r1 包
git -C "$ISTORE_HUB" fetch --depth=1 origin "$ISTORE_QS_COMMIT" 2>/dev/null || \
  git -C "$ISTORE_HUB" fetch --unshallow 2>/dev/null || :
if ! git -C "$ISTORE_HUB" cat-file -e "$ISTORE_QS_COMMIT^{commit}" 2>/dev/null; then
  echo "ERROR: 官方 app-hub 缺少 45f666b 首页版本，无法照官网固件，终止构建"; exit 1
fi
# 关掉 Windows Git 的换行符自动转换，确保 index.js 与官方源码逐字节一致
git -C "$ISTORE_HUB" config core.autocrlf false
git -C "$ISTORE_HUB" config core.eol lf
git -C "$ISTORE_HUB" checkout -q "$ISTORE_QS_COMMIT" -- apps/quickstart/quickstart apps/quickstart/luci-app-quickstart
FRONT_MK="$ISTORE_HUB/apps/quickstart/luci-app-quickstart/Makefile"
if ! grep -q '^PKG_VERSION:=0.12.10-r1' "$FRONT_MK" 2>/dev/null; then
  echo "ERROR: 官方前端不是 0.12.10-r1（官网固件同款），终止构建"; grep -E '^PKG_VERSION' "$FRONT_MK" 2>/dev/null || true; exit 1
fi
# 前端 index.js 逐字节校验（必须等于官网固件里那份完整 5 卡片前端）
FRONT_JS="$ISTORE_HUB/apps/quickstart/luci-app-quickstart/htdocs/luci-static/quickstart/index.js"
FRONT_MD5=$(md5sum "$FRONT_JS" 2>/dev/null | cut -d' ' -f1)
if [ "$FRONT_MD5" != "feae5221c2b633088b8a5a7fcfc2b756" ]; then
  echo "ERROR: 官方前端 index.js 与官网固件不一致（$FRONT_MD5），终止构建"; exit 1
fi

# 后端：官方 app-hub 45f666b 的 Makefile 指向 0.13.0；官网固件实际是 0.13.1，
# 这里把版本/源/hash 精确改成官方 istore-packages 0.13.1（哈希来自官方 release tarball）。
QS_MK="$ISTORE_HUB/apps/quickstart/quickstart/Makefile"
if ! grep -q 'PKG_SOURCE_URL:=https://github.com/linkease/istore-packages/releases/download/prebuilt/' "$QS_MK" 2>/dev/null; then
  echo "ERROR: 官方 quickstart Makefile 未指向作者官方 prebuilt 源，终止构建"; exit 1
fi
sed -i "s/^PKG_VERSION:=.*/PKG_VERSION:=$QS_BACKEND_VER/" "$QS_MK"
sed -i "s/^PKG_HASH:=.*/PKG_HASH:=$QS_BACKEND_HASH/" "$QS_MK"
grep -q "^PKG_VERSION:=$QS_BACKEND_VER" "$QS_MK" && grep -q "^PKG_HASH:=$QS_BACKEND_HASH" "$QS_MK" || {
  echo "ERROR: 官方 quickstart 0.13.1 版本/哈希写入失败，终止构建"; exit 1; }
echo "OK: 首页官网固件同款 — 前端 luci-app-quickstart 0.12.10-r1 (MD5 $FRONT_MD5) + 后端 quickstart $QS_BACKEND_VER (hash $QS_BACKEND_HASH)"

# 首页两包在锁定版本后再拷贝（此时官方仓库已切到 45f666b、后端 Makefile 已改 0.13.1）
copy_istore_pkg "$ISTORE_HUB/apps/quickstart/quickstart"          quickstart
copy_istore_pkg "$ISTORE_HUB/apps/quickstart/luci-app-quickstart" luci-app-quickstart
rm -rf "$ISTORE_HUB" "$ISTORE_LUCI"

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

  # ── 风扇/RGB 机型隔离：这套 sbe1v1k 大界面只属于 SBE1V1K ──
  # user-files 两个机型共用，但风扇控制/RGB 状态灯是 SBE1V1K 专属
  # （pwm-fan + 三色 PWM LED）。万兆 BE10000 是 emc2305/xiaomi-control，
  # 绝不能带这套菜单/守护/脚本，否则万兆会出现无用的「风扇控制/RGB 状态灯」。
  # 在 overlay 之后按 WRT_NAME 删除万兆里的这一整套（构建期删，不依赖开机脚本）。
  if [ "${WRT_NAME:-}" = "BE10000" ]; then
    rm -f \
      ./files/usr/share/luci/menu.d/luci-app-sbe1v1k.json \
      ./files/usr/share/rpcd/acl.d/luci-app-sbe1v1k.json \
      ./files/www/luci-static/resources/view/sbe1v1k/fan.js \
      ./files/www/luci-static/resources/view/sbe1v1k/led.js \
      ./files/etc/init.d/fanctl ./files/etc/init.d/ledctl \
      ./files/etc/config/fan ./files/etc/config/led \
      ./files/usr/sbin/fanctl ./files/usr/sbin/ledctl \
      ./files/usr/lib/sbe1v1k/fanctl ./files/usr/lib/sbe1v1k/ledctl \
      ./files/usr/lib/sbe1v1k/init.fanctl ./files/usr/lib/sbe1v1k/init.ledctl \
      ./files/usr/lib/sbe1v1k/config.fan ./files/usr/lib/sbe1v1k/config.led \
      ./files/etc/uci-defaults/99-hwctrl-enable 2>/dev/null || :
    echo "BE10000: removed SBE1V1K fan/RGB files from ./files (not for this board)"
  fi

  chmod 755 \
    ./files/etc/uci-defaults/* \
    ./files/etc/init.d/* \
    ./files/usr/sbin/fanctl \
    ./files/usr/sbin/ledctl \
    ./files/usr/libexec/route-tool \
    ./files/usr/libexec/route-tool.d/*.sh 2>/dev/null || :
  chmod 644 ./files/usr/lib/lua/luci/controller/route_tool.lua 2>/dev/null || :
  # SBE1V1K 风扇/RGB 守护：git core.filemode=false，checkout 后是 644，
  # init.d 用 `command /usr/sbin/fanctl|ledctl` 直接执行，必须在这里补 +x，
  # 否则固件里守护起不来（表现为「没驱动/不能用」）。
  ls -l ./files/usr/sbin/fanctl ./files/usr/sbin/ledctl 2>/dev/null || :
  echo "${WRT_NAME:-?} user-files overlaid: $(find ./files -type f | wc -l) files"
else
  echo "WARN: user-files not found, skip overlay"
fi
