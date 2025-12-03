/* SPDX-License-Identifier: GPL-3.0-only
 *
 * Copyright (C) 2022 ImmortalWrt.org
 * Copyright (C) 2024 asvow
 */

'use strict';
'require dom';
'require fs';
'require poll';
'require ui';
'require view';

function formatBytes(bytes) {
	const n = parseInt(bytes, 10);
	if (isNaN(n) || n === 0) return '-';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(n) / Math.log(k));
	return parseFloat((n / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatLastSeen(d) {
	if (!d) return _('N/A');
	if (d === '0001-01-01T00:00:00Z') return _('Online');
	const t = new Date(d);
	if (isNaN(t)) return _('N/A');
	const diff = (Date.now() - t) / 1000;
	if (diff < 0) return t.toLocaleString();
	if (diff < 60) return _('Just now');
	const mins = diff / 60, hrs = mins / 60, days = hrs / 24;
	if (mins < 60) return Math.floor(mins) + ' ' + _('minutes ago');
	if (hrs < 24) return Math.floor(hrs) + ' ' + _('hours ago');
	if (days < 30) return Math.floor(days) + ' ' + _('days ago');
	return t.toISOString().slice(0, 10);
}

return view.extend({
	async load() {
		const [ipRes, tsRes] = await Promise.all([
			fs.exec('/sbin/ip', ['-s', '-j', 'ad']),
			fs.exec('/usr/sbin/tailscale', ['status', '--json'])
		]);

		let interfaces = [];
		if (ipRes.code === 0 && ipRes.stdout) {
			try {
				const allIfaces = JSON.parse(ipRes.stdout);
				interfaces = allIfaces.filter(iface => iface.ifname.match(/tailscale[0-9]+/)).map(iface => ({
					name: iface.ifname,
					ipv4: (iface.addr_info || []).find(a => a.family === 'inet')?.local,
					ipv6: (iface.addr_info || []).find(a => a.family === 'inet6')?.local,
					mtu: iface.mtu,
					rxBytes: iface.stats64?.rx?.bytes || 0,
					txBytes: iface.stats64?.tx?.bytes || 0
				}));
			} catch (e) {}
		}

		let tsStatus = null;
		if (tsRes.code === 0 && tsRes.stdout) {
			try {
				tsStatus = JSON.parse(tsRes.stdout.replace(/("\w+"):\s*(\d{10,})/g, '$1:"$2"'));
			} catch (e) {}
		}

		return { interfaces, tsStatus };
	},

	pollData(container) {
		poll.add(async () => {
			const data = await this.load();
			dom.content(container, this.renderContent(data));
		});
	},

	renderContent(data) {
		const { interfaces, tsStatus } = data;
		const elements = [];

		// Service status
		const isRunning = tsStatus && tsStatus.BackendState === 'Running';
		const statusColor = isRunning ? 'green' : 'red';
		const statusText = isRunning ? _('RUNNING') : _('NOT RUNNING');

		elements.push(E('h3', {}, _('Service Status')));
		elements.push(E('p', {}, [
			E('span', { style: 'color:' + statusColor + ';font-weight:bold;' }, statusText),
			tsStatus?.Version ? E('span', {}, ' (v' + tsStatus.Version + ')') : ''
		]));

		// Basic info when running
		if (isRunning && tsStatus.Self) {
			const self = tsStatus.Self;
			const domain = tsStatus.MagicDNSSuffix || '';
			const infoRows = [];

			if (self.TailscaleIPs) {
				const ipv4 = self.TailscaleIPs.find(ip => ip.includes('.'));
				const ipv6 = self.TailscaleIPs.find(ip => ip.includes(':'));
				if (ipv4) infoRows.push(E('tr', {}, [E('td', {}, 'Tailscale IPv4'), E('td', {}, ipv4)]));
				if (ipv6) infoRows.push(E('tr', {}, [E('td', {}, 'Tailscale IPv6'), E('td', {}, ipv6)]));
			}
			if (domain) infoRows.push(E('tr', {}, [E('td', {}, _('Tailnet')), E('td', {}, domain)]));

			if (infoRows.length > 0) {
				elements.push(E('table', { class: 'table' }, infoRows));
			}
		}

		// Interface info
		if (interfaces.length > 0) {
			elements.push(E('h3', { style: 'margin-top:20px;' }, _('Network Interface Information')));
			interfaces.forEach(iface => {
				elements.push(E('table', { class: 'table' }, [
					E('tr', {}, [E('td', { width: '30%' }, _('Interface Name')), E('td', {}, iface.name)]),
					E('tr', {}, [E('td', {}, _('IPv4 Address')), E('td', {}, iface.ipv4 || '-')]),
					E('tr', {}, [E('td', {}, _('IPv6 Address')), E('td', {}, iface.ipv6 || '-')]),
					E('tr', {}, [E('td', {}, _('MTU')), E('td', {}, iface.mtu)]),
					E('tr', {}, [E('td', {}, _('Total Download')), E('td', {}, formatBytes(iface.rxBytes))]),
					E('tr', {}, [E('td', {}, _('Total Upload')), E('td', {}, formatBytes(iface.txBytes))])
				]));
			});
		}

		// Peers list
		if (isRunning && tsStatus.Peer) {
			const peers = Object.values(tsStatus.Peer);
			if (peers.length > 0) {
				elements.push(E('h3', { style: 'margin-top:20px;' }, _('Network Devices')));

				const headerRow = E('tr', { class: 'tr cbi-section-table-titles' }, [
					E('th', { class: 'th' }, _('Status')),
					E('th', { class: 'th' }, _('Hostname')),
					E('th', { class: 'th' }, _('Tailscale IP')),
					E('th', { class: 'th' }, _('OS')),
					E('th', { class: 'th' }, _('RX')),
					E('th', { class: 'th' }, _('TX')),
					E('th', { class: 'th' }, _('Last Seen'))
				]);

				const rows = [headerRow];
				peers.forEach(peer => {
					const online = peer.Online;
					const ip = peer.TailscaleIPs ? peer.TailscaleIPs.find(i => i.includes('.')) : '-';
					rows.push(E('tr', { class: 'tr' }, [
						E('td', { class: 'td' }, E('span', { style: 'color:' + (online ? 'green' : 'gray') + ';' }, online ? '●' : '○')),
						E('td', { class: 'td' }, peer.HostName || '-'),
						E('td', { class: 'td' }, ip || '-'),
						E('td', { class: 'td' }, peer.OS || '-'),
						E('td', { class: 'td' }, formatBytes(peer.RxBytes)),
						E('td', { class: 'td' }, formatBytes(peer.TxBytes)),
						E('td', { class: 'td' }, online ? _('Online') : formatLastSeen(peer.LastSeen))
					]));
				});

				elements.push(E('table', { class: 'table cbi-section-table' }, rows));
			}
		}

		if (elements.length === 0) {
			return E('div', {}, _('No interface online.'));
		}

		return E('div', {}, elements);
	},

	render(data) {
		const content = E([], [
			E('h2', { class: 'content' }, _('Tailscale')),
			E('div', { class: 'cbi-map-descr' }, _('Tailscale is a cross-platform and easy to use virtual LAN.')),
			E('div')
		]);
		const container = content.lastElementChild;

		dom.content(container, this.renderContent(data));
		this.pollData(container);

		return content;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
