#!/bin/sh
# 在 alpine:3.23 容器内运行（apk-tools 3.0.x，ADB/v3 包格式）
# 用 apk mkpkg 从 rootfs 目录生成真正的 apkv3 包，并本地验证可安装。
set -e

echo "===== apk 版本 ====="
apk --version

PLUGINS_DIR=/work/plugins
OUT=/work/out
mkdir -p "$OUT"

for P in "$PLUGINS_DIR"/*; do
  [ -d "$P" ] || continue
  NAME=$(basename "$P")
  eval "$(sed -n 's/^\([A-Z_]*\)=\(.*\)/\1="\2"/p' "$P/meta.txt")"
  echo
  echo "===== 打包 $NAME -> $PKG-$VER ====="

  # 构造 apk mkpkg 参数
  set -- mkpkg \
    --info "name:$PKG" \
    --info "version:$VER" \
    --info "arch:$ARCH" \
    --info "description:$DESC" \
    --info "url:$URL" \
    --info "license:$LIC" \
    --info "origin:$PKG" \
    --info "depends:$DEPENDS"

  # 安装/卸载脚本（用 TYPE:PATH）
  for s in pre-install post-install pre-deinstall post-deinstall; do
    if [ -f "$P/scripts/$s" ]; then
      chmod 755 "$P/scripts/$s"
      set -- "$@" --script "$s:$P/scripts/$s"
    fi
  done

  # rootfs 文件（设置可执行位）
  chmod 755 "$P/rootfs/usr/libexec/"* 2>/dev/null || true
  set -- "$@" --files "$P/rootfs"
  set -- "$@" --output "$OUT/${PKG}_${VER}.apk"

  apk "$@"
  ls -la "$OUT/${PKG}_${VER}.apk"
done

echo
echo "===== 验证：用 apk add --allow-untrusted 实测安装到临时 root ====="
TROOT=/work/testroot
rm -rf "$TROOT"; mkdir -p "$TROOT"
for A in "$OUT"/*.apk; do
  echo "--- 安装测试: $(basename "$A") ---"
  # --root 指向空 root，--no-scripts 避免真实执行，--allow-untrusted 绕过签名
  apk add --root "$TROOT" --allow-untrusted --no-scripts --initdb "$A" 2>&1 || {
    echo "  [WARN] 安装测试失败，尝试带 --force-depends"
    apk add --root "$TROOT" --allow-untrusted --no-scripts --initdb --force-depends "$A" 2>&1 || true
  }
done

echo
echo "===== 验证安装结果：列出已装包 ====="
apk info --root "$TROOT" 2>/dev/null || true
echo
echo "===== 验证文件是否落地 ====="
find "$TROOT" -type f | head -40
echo
echo "BUILD DONE"
