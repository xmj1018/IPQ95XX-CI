# SPDX-License-Identifier: Apache-2.0
# Thin packaging for the PON optical status view.
# The two payload files are fetched at build time from the plugin author's
# repository (lunatickochiya/Pon-Action, pinned commit) and SHA256-verified
# in the workflow. Nothing in the payload is modified.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-pon-status
PKG_VERSION:=1.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=lunatickochiya

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-pon-status
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=PON optical module status (Status - Overview)
  DEPENDS:=+luci-base +luci-app-pon
  PKGARCH:=all
endef

define Package/luci-app-pon-status/description
  Shows PON Rx/Tx optical power, module temperature, bias current and voltage
  on the LuCI Status - Overview page. Data comes from ponctl (airoha-ponctl),
  which PONWRT already selects on Airoha targets.
endef

define Build/Compile
endef

define Package/luci-app-pon-status/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/status/include
	$(INSTALL_DATA) ./files/70_pon.js $(1)/www/luci-static/resources/view/status/include/70_pon.js
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/luci-app-pon-status.json $(1)/usr/share/rpcd/acl.d/luci-app-pon-status.json
endef

$(eval $(call BuildPackage,luci-app-pon-status))
