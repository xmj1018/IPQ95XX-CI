'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

/* 无损扩容/减容 —— 调用后端 /usr/sbin/nasresize。
   沿用本项目已验证的 file.exec 调用机制：nobatch + 串行队列 + 超时兜底，
   避免新版 LuCI 批处理导致 Promise 悬挂（“点了没反应”）。 */

const callFileExec = rpc.declare({
	object: 'file',
	method: 'exec',
	params: [ 'command', 'params', 'env' ],
	nobatch: true
});

var _chain = Promise.resolve();
function execCmd(args) {
	var p = _chain.then(function() {
		return callFileExec('/usr/sbin/nasresize', args, null);
	});
	_chain = p.then(function() {}, function() {});
	return Promise.race([
		p.then(function(res) { return res || { code: -1, stdout: '', stderr: 'no reply' }; }),
		new Promise(function(_, rej) {
			setTimeout(function() {
				rej(new Error((args && args[0] ? args[0] : '命令') + ' 执行超时'));
			}, 60000);
		})
	]);
}

var CSS = [
	'.rz-page{width:100%;max-width:100%;margin:0}',
	'.rz-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 18px}',
	'.rz-title{font-size:22px;font-weight:750;letter-spacing:.3px;margin:0;line-height:1.2}',
	'.rz-sub{opacity:.62;font-size:13px;margin-top:6px;line-height:1.6;max-width:760px}',
	'.rz-pill{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid rgba(127,127,127,.22);background:rgba(127,127,127,.07);white-space:nowrap}',
	'.rz-dot{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px rgba(127,127,127,.15)}',
	'.rz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}',
	'.rz-card{border:1px solid rgba(127,127,127,.2);border-radius:16px;background:rgba(127,127,127,.06);padding:16px 18px;min-width:0}',
	'.rz-card h3{margin:0 0 12px;font-size:14px;font-weight:700;letter-spacing:.4px;display:flex;align-items:center;gap:9px}',
	'.rz-card h3:before{content:"";width:3px;height:14px;border-radius:2px;background:var(--primary,#5e72e4)}',
	'.rz-metric{font-size:26px;font-weight:750;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.5px}',
	'.rz-label{font-size:12px;opacity:.6;margin-bottom:8px;letter-spacing:.3px}',
	'.rz-kv{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(127,127,127,.12);font-size:12.5px}',
	'.rz-kv:last-child{border-bottom:0}',
	'.rz-kv span:first-child{opacity:.65}',
	'.rz-kv span:last-child{font-weight:600;font-variant-numeric:tabular-nums;text-align:right;word-break:break-all}',
	'.rz-btn{padding:9px 16px;border-radius:10px;border:1px solid rgba(127,127,127,.25);background:rgba(127,127,127,.07);color:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:all .18s}',
	'.rz-btn:hover{border-color:var(--primary,#5e72e4);transform:translateY(-1px)}',
	'.rz-btn.primary{background:var(--primary,#5e72e4);border-color:var(--primary,#5e72e4);color:#fff}',
	'.rz-btn.warn{border-color:rgba(245,54,92,.45);color:#f5365c}',
	'.rz-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}',
	'.rz-row{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin-top:6px}',
	'.rz-select{padding:8px 10px;border-radius:9px;border:1px solid rgba(127,127,127,.25);background:rgba(127,127,127,.06);color:inherit;font-size:13px}',
	'.rz-note{padding:11px 14px;border-radius:11px;background:rgba(251,99,64,.1);border:1px solid rgba(251,99,64,.28);font-size:12.5px;line-height:1.65;margin-top:12px}',
	'.rz-ok{padding:11px 14px;border-radius:11px;background:rgba(45,206,137,.1);border:1px solid rgba(45,206,137,.28);font-size:12.5px;line-height:1.65;margin-top:12px}',
	'.rz-log{width:100%;min-height:150px;max-height:260px;overflow:auto;font-family:monospace;font-size:11.5px;line-height:1.5;padding:12px;border-radius:11px;background:rgba(0,0,0,.28);color:#b8e0c2;white-space:pre-wrap;word-break:break-all;border:1px solid rgba(127,127,127,.18)',
	'.rz-sec{margin-top:14px}',
	'@media(max-width:560px){.rz-metric{font-size:23px}}'
].join('');

function esc(s) {
	return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
		return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
	});
}

function notify(title, msg, danger) {
	if (ui.addNotification) ui.addNotification(null, E('p', {}, (title ? title + '：' : '') + msg), danger ? 'danger' : 'info');
	else alert((title ? title + '：' : '') + msg);
}

return view.extend({
	st: null,
	devs: [],

	refresh: function() {
		var self = this;
		return execCmd([ 'status' ]).then(function(res) {
			var d = null;
			try { d = JSON.parse((res.stdout || '').trim()); } catch (e) { d = null; }
			if (!d || !d.ok) { self.renderStatus(null); return; }
			self.st = d;
			self.renderStatus(d);
		}).catch(function(e) { self.renderStatus(null); });
	},

	loadDevices: function() {
		var self = this;
		return execCmd([ 'devices' ]).then(function(res) {
			try { self.devs = JSON.parse((res.stdout || '').trim()) || []; } catch (e) { self.devs = []; }
			self.renderDevSelect();
		}).catch(function() { self.devs = []; self.renderDevSelect(); });
	},

	modeLabel: function(d) {
		if (!d) return '读取中';
		return d.mode === 'extroot' ? 'U 盘扩容中' : '内部 flash';
	},

	renderStatus: function(d) {
		var modeEl = document.getElementById('rz-mode');
		var pill = document.getElementById('rz-pill');
		if (!d) {
			if (modeEl) modeEl.textContent = '—';
			if (pill) pill.textContent = '状态读取失败';
			return;
		}
		if (pill) pill.innerHTML = '<span class="rz-dot"></span>' + esc(this.modeLabel(d));
		var set = function(id, v) { var e = document.getElementById(id); if (e) e.textContent = (v === undefined || v === null || v === '') ? '—' : v; };
		set('rz-mode', this.modeLabel(d));
		set('rz-src', d.src);
		set('rz-dev', d.dev);
		set('rz-size', d.size);
		set('rz-used', d.used);
		set('rz-fs', d.fstype);
		set('rz-inner', d.inner_dev || d.inner_fs);
		// 三机型固件工具集不同: 按后端上报的 fs_avail 只显示本机可用的文件系统,
		// 避免 IPQ95XX (无 f2fs-tools) 选了 f2fs 后 mkfs 失败。
		var fssel = document.getElementById('rz-fs-sel');
		if (fssel) {
			var avail = String(d.fs_avail || 'ext4').split(',');
			var opts = [
				{ v: 'ext4', t: 'ext4（推荐，兼容性好）' },
				{ v: 'f2fs', t: 'f2fs（U 盘更耐用）' }
			];
			var html = '';
			opts.forEach(function(o) {
				if (avail.indexOf(o.v) >= 0) html += '<option value="' + o.v + '">' + o.t + '</option>';
			});
			if (!html) html = '<option value="">(本机无可用 mkfs 工具)</option>';
			fssel.innerHTML = html;
		}
		var ext = (d.mode === 'extroot');
		var a = document.getElementById('rz-expand-box'); if (a) a.style.display = ext ? 'none' : '';
		var r = document.getElementById('rz-reduce-box'); if (r) r.style.display = ext ? '' : 'none';
		// UBI/伪设备布局无法在扩容运行时安全写回内部 flash: 隐藏“减容并保留配置”, 只留 detach
		var wb = (d.inner_wb === '0');
		var rb = document.getElementById('rz-btn-reduce'); if (rb) rb.style.display = wb ? 'none' : '';
		var hint = document.getElementById('rz-wb-hint'); if (hint) hint.style.display = wb ? '' : 'none';
	},

	renderDevSelect: function() {
		var sel = document.getElementById('rz-dev'); if (!sel) return;
		var html = '';
		if (!this.devs.length) html = '<option value="">(未检测到可用设备)</option>';
		else {
			html = '<option value="">请选择 U 盘分区</option>';
			this.devs.forEach(function(d) {
				html += '<option value="' + esc(d.dev) + '">' + esc(d.dev) + ' · ' + esc(d.size || '?') +
					(d.fstype ? ' · ' + esc(d.fstype) : '') + (d.mounted ? ' · 已挂载:' + esc(d.mounted) : '') + '</option>';
			});
		}
		sel.innerHTML = html;
	},

	runCmd: function(args, okMsg) {
		var self = this;
		return execCmd(args).then(function(res) {
			var txt = (res.stdout || '') + (res.stderr || '');
			if (res.code !== 0 && /^ERROR|error/i.test(txt)) {
				notify('操作失败', txt.trim(), true);
			} else {
				notify('完成', okMsg || txt.trim() || '已执行');
			}
			self.loadLog();
			return self.refresh();
		}).catch(function(e) { notify('调用失败', e.message, true); });
	},

	loadLog: function() {
		var self = this;
		return execCmd([ 'log' ]).then(function(res) {
			var box = document.getElementById('rz-log');
			if (box) box.textContent = (res.stdout || '').trim() || '(暂无日志)';
		}).catch(function() {});
	},

	doExpand: function() {
		var sel = document.getElementById('rz-dev');
		var fs = document.getElementById('rz-fs-sel');
		var dev = sel ? sel.value : '';
		var fstype = fs ? fs.value : 'ext4';
		if (!dev) { notify('', '请先选择 U 盘分区', true); return; }
		if (!confirm('确认无损扩容到 ' + dev + '？\n\n' +
			'· 该分区将被格式化，原有数据全部清空\n' +
			'· 当前配置/已装软件会完整复制到 U 盘\n' +
			'· 完成后需重启，重启后 O 盘空间变为 U 盘容量\n\n继续？')) return;
		this.runCmd([ 'expand', dev, fstype ], '扩容指令已执行，请按提示重启');
	},

	doReduce: function() {
		if (!confirm('确认减容并回写配置？\n\n' +
			'· 会把 U 盘当前的配置/软件写回内部 flash\n' +
			'· 成功后重启即可拔掉 U 盘，配置不丢\n' +
			'· 内部 flash 空间必须够放当前数据，否则自动中止（不改系统）\n\n' +
			'建议先备份配置。继续？')) return;
		this.runCmd([ 'reduce' ], '减容指令已执行，请按提示重启后拔盘');
	},

	doDetach: function() {
		if (!confirm('确认仅撤销扩容、拔掉 U 盘？\n\n' +
			'· 不回写数据，重启后使用扩容前的内部配置\n' +
			'· 扩容后在 U 盘上新增的软件/设置将不再生效\n' +
			'· 这是最安全的方式，U 盘数据仍保留在盘上\n\n继续？')) return;
		this.runCmd([ 'detach' ], '已撤销扩容，请重启后拔盘');
	},

	render: function() {
		var self = this;
		poll.add(function() { return self.refresh(); }, 8);
		this.refresh();
		this.loadDevices();
		this.loadLog();

		var kv = function(label, id) {
			return E('div', { 'class': 'rz-kv' }, [ E('span', {}, label), E('span', { 'id': id }, '—') ]);
		};

		return E('div', { 'class': 'cbi-map rz-page' }, [
			E('style', {}, CSS),
			E('div', { 'class': 'rz-head' }, [
				E('div', {}, [
					E('h2', { 'class': 'rz-title' }, '无损扩容 / 减容'),
					E('div', { 'class': 'rz-sub' },
						'把 U 盘无损挂载为 /overlay 扩大可写空间（配置完整保留）；也可反向把 U 盘数据写回内部 flash 后安全拔盘。' +
						'所有操作在任何一步失败都不会破坏当前系统，fstab 改动前自动备份。')
				]),
				E('span', { 'class': 'rz-pill', 'id': 'rz-pill' }, [ E('span', { 'class': 'rz-dot' }), '读取中' ])
			]),

			E('div', { 'class': 'rz-grid' }, [
				E('div', { 'class': 'rz-card' }, [
					E('h3', {}, '当前状态'),
					kv('运行模式', 'rz-mode'),
					kv('overlay 源', 'rz-src'),
					kv('承载设备', 'rz-dev'),
					kv('总容量', 'rz-size'),
					kv('已用', 'rz-used'),
					kv('文件系统', 'rz-fs'),
					kv('内部 flash', 'rz-inner')
				]),

				E('div', { 'class': 'rz-card', 'id': 'rz-expand-box' }, [
					E('h3', {}, '① 无损扩容'),
					E('div', { 'class': 'rz-label' }, '选择 U 盘分区（会被格式化）'),
					E('select', { 'id': 'rz-dev', 'class': 'rz-select' }),
					E('div', { 'class': 'rz-row' }, [
						E('select', { 'id': 'rz-fs-sel', 'class': 'rz-select' }, [
							E('option', { 'value': 'ext4' }, 'ext4（推荐，兼容性好）'),
							E('option', { 'value': 'f2fs' }, 'f2fs（U 盘更耐用）')
						]),
						E('button', { 'class': 'rz-btn primary', 'click': ui.createHandlerFn(self, 'doExpand') }, '开始扩容')
					]),
					E('div', { 'class': 'rz-note' },
						'扩容前请确认 U 盘容量大于当前已用空间。现有配置、密码、已装插件会完整复制到 U 盘；完成后需重启生效。')
				]),

				E('div', { 'class': 'rz-card', 'id': 'rz-reduce-box', 'style': 'display:none' }, [
					E('h3', {}, '② 减容 / 拔盘'),
					E('div', { 'class': 'rz-label' }, '把 U 盘数据写回内部 flash，之后可拔盘'),
					E('div', { 'class': 'rz-row' }, [
						E('button', { 'id': 'rz-btn-reduce', 'class': 'rz-btn primary', 'click': ui.createHandlerFn(self, 'doReduce') }, '减容并保留配置'),
						E('button', { 'class': 'rz-btn warn', 'click': ui.createHandlerFn(self, 'doDetach') }, '仅撤销/拔盘')
					]),
					E('div', { 'class': 'rz-note', 'id': 'rz-wb-hint', 'style': 'display:none' },
						'本机内部 overlay 采用 UBI/伪设备布局，无法在扩容运行时安全把数据写回内部 flash。' +
						'请使用「仅撤销/拔盘」：重启后回到扩容前的内部配置（U 盘上的数据仍完整保留在盘上，随时可再挂回）。'),
					E('div', { 'class': 'rz-ok' },
						'“减容并保留配置”：把 U 盘当前数据写回内部 flash，重启后拔盘、配置不丢（需内部空间足够、且内部 overlay 是普通块设备）。' +
						'“仅撤销/拔盘”：不回写，回到扩容前的内部配置，最安全。操作前建议先备份配置。')
				])
			]),

			E('div', { 'class': 'rz-card rz-sec' }, [
				E('h3', {}, '操作日志'),
				E('pre', { 'class': 'rz-log', 'id': 'rz-log' }, '读取中…'),
				E('div', { 'class': 'rz-row' }, [
					E('button', { 'class': 'rz-btn', 'click': ui.createHandlerFn(self, 'loadLog') }, '刷新日志'),
					E('button', { 'class': 'rz-btn', 'click': ui.createHandlerFn(self, 'refresh') }, '刷新状态')
				])
			])
		]);
	}
});
