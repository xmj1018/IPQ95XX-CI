#!/bin/bash
# SPDX-License-Identifier: MIT
# Copyright (C) 2026 VIKINGYFY

#移除luci-app-attendedsysupgrade
find ./feeds/luci/collections/ -type f -name "Makefile" -exec sed -i "/attendedsysupgrade/d" {} +
#修改默认主题
find ./feeds/luci/collections/ -type f -name "Makefile" -exec sed -i "s/luci-theme-bootstrap/luci-theme-$WRT_THEME/g" {} +
#修改immortalwrt.lan关联IP
find ./feeds/luci/modules/luci-mod-system/ -type f -name "flash.js" -exec sed -i "s/192\.168\.[0-9]*\.[0-9]*/$WRT_IP/g" {} +
#添加编译日期标识
find ./feeds/luci/modules/luci-mod-status/ -type f -name "10_system.js" -exec sed -i "s/(\(luciversion || ''\))/(\1) + (' \/ $WRT_MARK-$WRT_DATE')/g" {} +

#修改默认 WIFI 名称/密码：唯一写入点是 router-tool 的 defaults 段。
#上游 /etc/config/router-tool 默认 option ssid ''（空），WRT_SSID 由编译入口传入；
#mac80211.uc 的 default_ssid() 读它作前缀，自动追加 -2.4G / -5.2G / -5.8G / -6G。
#mac80211.uc 本身没有 ssid '...' 写法，旧脚本对它做 sed 实际命中不到，已移除。
ROUTER_TOOL="./package/emortal/luci-app-router-tool/root/etc/config/router-tool"
[ -f "$ROUTER_TOOL" ] && sed -i "s/ssid '.*'/ssid '$WRT_SSID'/g; s/key '.*'/key '$WRT_WORD'/g" "$ROUTER_TOOL"

CFG_FILE="./package/base-files/files/bin/config_generate"
#修改默认IP地址
sed -i "s/192\.168\.[0-9]*\.[0-9]*/$WRT_IP/g" $CFG_FILE
#修改默认主机名
sed -i "s/hostname='.*'/hostname='$WRT_NAME'/g" $CFG_FILE

#配置文件修改
echo "CONFIG_PACKAGE_luci=y" >> ./.config
echo "CONFIG_LUCI_LANG_zh_Hans=y" >> ./.config
echo "CONFIG_PACKAGE_luci-theme-$WRT_THEME=y" >> ./.config
# argon 3.2.0(作者官方源)已把 argon-config 集成进主题本体：
# 只勾主题，不勾 luci-app-argon / luci-app-argon-config，
# 否则旧独立插件会和主题抢同一批文件，APK 报 trying to overwrite 冲突。
# 其它主题(vantage 等)保持原样，避免影响别的平台。
if [ "$WRT_THEME" != "argon" ]; then
	echo "CONFIG_PACKAGE_luci-app-$WRT_THEME=y" >> ./.config
	echo "CONFIG_PACKAGE_luci-app-$WRT_THEME-config=y" >> ./.config
fi

#引入私有扩展配置
if [ -f "$GITHUB_WORKSPACE/Config/PRIVATE.txt" ]; then
	echo "Applying private configurations from PRIVATE.txt..."
	cat $GITHUB_WORKSPACE/Config/PRIVATE.txt >> ./.config
fi

#手动调整的插件
if [ -n "$WRT_PACKAGE" ]; then
	echo -e "$WRT_PACKAGE" >> ./.config
fi

#高通平台调整
DTS_PATH="./target/linux/qualcommax/dts/"
if [[ "${WRT_TARGET^^}" == *"QUALCOMMAX"* ]]; then
	#无WIFI配置调整Q6大小
	if [[ "$WRT_WIFI" == "WIFI-NO" ]]; then
		find $DTS_PATH -type f ! -iname '*nowifi*' -exec sed -i 's/ipq\(6018\|8074\).dtsi/ipq\1-nowifi.dtsi/g' {} +
		echo "qualcommax set up nowifi successfully!"
	fi
fi
