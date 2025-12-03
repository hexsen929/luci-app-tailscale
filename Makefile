# SPDX-License-Identifier: GPL-3.0-only
#
# Copyright (C) 2024 asvow

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI for Tailscale
LUCI_DEPENDS:=+tailscale
LUCI_PKGARCH:=all

PKG_VERSION:=1.2.6

include $(TOPDIR)/feeds/luci/luci.mk

define Package/luci-app-tailscale/postinst
#!/bin/sh
chmod +x /etc/init.d/tailscale 2>/dev/null
chmod +x /usr/sbin/tailscale_helper 2>/dev/null
exit 0
endef

# call BuildPackage - OpenWrt buildroot signature
