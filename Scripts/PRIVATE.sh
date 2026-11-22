#!/bin/bash
# SBE1V1K 新固件构建脚本（2026-11-23 从零编写，不继承任何旧脚本）
# 只做两件事：把 user-files 覆盖进 ./files，再补回被 REST API 上传丢掉的可执行位。
# 不修改任何上游源码文件；本目录是全新 user-files，无需清理机型残留。

if [ -d "$GITHUB_WORKSPACE/user-files" ]; then
  mkdir -p ./files
  cp -af "$GITHUB_WORKSPACE/user-files/." ./files/

  # GitHub REST API 上传的文件统一 100644，脚本类必须补回 755
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
