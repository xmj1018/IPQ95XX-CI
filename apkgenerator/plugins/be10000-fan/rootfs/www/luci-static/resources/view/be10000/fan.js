'use strict';
'require view';
'require uci';
'require fs';
'require rpc';
'require ui';
'require poll';

/*
 * BE10000 风扇控制 —— SBE1V1K 同款精致风格（独立模块）
 * 后端：复用 OWRT 上游 luci-app-xiaomi-control 的 xiaomi-control.uc
 *       - 配置读写 uci xiaomi-control.settings.profile
 *       - 运行状态读 /var/run/xiaomi-control.json 的 fan 段
 */

ui.addNotification = function(title, children, ...classes) {
	var danger = classes.indexOf('danger') >= 0;
	var color = danger ? '#e64545' : '#3a9d5d';
	var content = [];
	if (title != null) content.push(E('h4', { 'style': 'margin:0 0 4px;font-size:14px' }, title));
	if (children != null) content.push(children);
	var box = E('div', {
		'class': 'alert-message',
		'style': 'display:flex;align-items:center;gap:12px;padding:10px 14px;margin-bottom:10px;' +
			'background:' + color + ';color:#fff;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.2)'
	}, [
		E('div', { 'style': 'flex:1 1 auto' }, content),
		E('button', {
			'class': 'btn',
			'style': 'margin-left:auto;background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5)',
			'click': function(ev) {
				var n = ev.target;
				while (n && !(n.classList && n.classList.contains('alert-message'))) n = n.parentNode;
				if (n && n.parentNode) n.parentNode.removeChild(n);
			}
		}, [ '关闭' ])
	]);
	var mc = document.querySelector('#maincontent') || document.body;
	mc.insertBefore(box, mc.firstElementChild);
	setTimeout(function() { if (box.parentNode) box.parentNode.removeChild(box); }, 2600);
	return box;
};

const callServiceList = rpc.declare({ object: 'service', method: 'list', params: [ 'name' ], expect: { '': {} } });
const callServiceRestart = rpc.declare({ object: 'service', method: 'restart', params: [ 'name' ] });

var PROFILES = [
	[ 'auto', '自动', '45–85 °C' ],
	[ 'quiet', '静音', '52–80 °C' ],
	[ 'balanced', '均衡', '45–75 °C' ],
	[ 'performance', '性能', '38–65 °C' ]
];

var CSS = [
	'.hw-page{width:100%;max-width:100%;margin:0}',
	'.hw-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 18px}',
	'.hw-title{font-size:22px;font-weight:750;letter-spacing:.3px;margin:0;line-height:1.2}',
	'.hw-sub{opacity:.62;font-size:13px;margin-top:6px;line-height:1.6;max-width:760px}',
	'.hw-pill{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid rgba(127,127,127,.22);background:rgba(127,127,127,.07);white-space:nowrap}',
	'.hw-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}',
	'.hw-card{border:1px solid rgba(127,127,127,.2);border-radius:16px;background:rgba(127,127,127,.06);padding:16px 18px;min-width:0;margin-bottom:14px}',
	'.hw-card.wide{grid-column:1/-1}',
	'.hw-card h3{margin:0 0 14px;font-size:14px;font-weight:700;letter-spacing:.4px;display:flex;align-items:center;gap:9px}',
	'.hw-card h3:before{content:"";width:3px;height:14px;border-radius:2px;background:var(--primary,#5e72e4)}',
	'.hw-metric{font-size:30px;font-weight:750;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.5px}',
	'.hw-unit{font-size:14px;font-weight:600;opacity:.55;margin-left:3px}',
	'.hw-label{font-size:12px;opacity:.6;margin-bottom:8px;letter-spacing:.3px}',
	'.hw-foot{font-size:12px;opacity:.6;margin-top:9px;line-height:1.5}',
	'.hw-bar{height:8px;border-radius:999px;background:rgba(127,127,127,.16);overflow:hidden;margin-top:12px}',
	'.hw-bar>i{display:block;height:100%;border-radius:999px;transition:width .4s ease,background .3s}',
	'.hw-seg{display:flex;gap:7px;flex-wrap:wrap}',
	'.hw-seg button{flex:1;min-width:74px;padding:11px 10px;border-radius:11px;border:1px solid rgba(127,127,127,.22);background:rgba(127,127,127,.05);color:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:all .18s}',
	'.hw-seg button:hover{border-color:var(--primary,#5e72e4);transform:translateY(-1px)}',
	'.hw-seg button.on{background:var(--primary,#5e72e4);border-color:var(--primary,#5e72e4);color:#fff;box-shadow:0 4px 12px rgba(94,114,228,.3)}',
	'.hw-btn{padding:9px 16px;border-radius:10px;border:1px solid rgba(127,127,127,.25);background:rgba(127,127,127,.07);color:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:all .18s}',
	'.hw-btn:hover{border-color:var(--primary,#5e72e4);transform:translateY(-1px)}',
	'.hw-btn.primary{background:var(--primary,#5e72e4);border-color:var(--primary,#5e72e4);color:#fff}',
	'.hw-kv{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(127,127,127,.12);font-size:12.5px}',
	'.hw-kv:last-child{border-bottom:0}',
	'.hw-kv span:first-child{opacity:.65}',
	'.hw-kv span:last-child{font-weight:600;font-variant-numeric:tabular-nums;text-align:right}',
	'.hw-note{padding:11px 14px;border-radius:11px;background:rgba(94,114,228,.09);border:1px solid rgba(94,114,228,.25);font-size:12.5px;line-height:1.65;margin-top:12px}',
	'@media(max-width:560px){.hw-metric{font-size:25px}}'
].join('');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
	return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function tcolor(t) { return t >= 80 ? '#f5365c' : t >= 65 ? '#fb6340' : t >= 50 ? '#e6a100' : '#2dce89'; }
function profileLabel(p) { for (var i = 0; i < PROFILES.length; i++) if (PROFILES[i][0] === p) return PROFILES[i][1]; return p || '—'; }

return view.extend({
	_running: false,

	load: function() {
		return Promise.all([
			L.resolveDefault(uci.load('xiaomi-control'), null),
			L.resolveDefault(fs.read('/var/run/xiaomi-control.json'), ''),
			L.resolveDefault(callServiceList('xiaomi-control'), {})
		]);
	},

	refresh: function() {
		var self = this;
		return Promise.all([
			L.resolveDefault(fs.read('/var/run/xiaomi-control.json'), ''),
			L.resolveDefault(callServiceList('xiaomi-control'), {})
		]).then(function(r) {
			var status = {};
			try { status = JSON.parse(r[0]) || {}; } catch (e) {}
			var inst = r[1]['xiaomi-control']?.instances || {};
			self._running = Object.keys(inst).some(function(k) { return inst[k].running; });
			self.update(status.fan || {});
		});
	},

	setText: function(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; },

	update: function(fan) {
		this.setText('hw-run-pill', this._running ? '● 服务运行中' : '● 服务未运行');
		var pill = document.getElementById('hw-run-pill');
		if (pill) pill.style.color = this._running ? '#2dce89' : '#f5365c';
		var temp = (typeof fan.temperature === 'number' && fan.temperature >= 0) ? (fan.temperature / 1000).toFixed(1) : '—';
		this.setText('hw-temp', temp);
		var te = document.getElementById('hw-temp'); if (te) te.style.color = (fan.temperature >= 0) ? tcolor(fan.temperature / 1000) : 'inherit';
		this.setText('hw-temp-src', fan.sensor || '—');
		this.setText('hw-sensors', (fan.sensors != null) ? fan.sensors : '—');
		this.setText('hw-rpm', (fan.rpm != null && fan.rpm >= 0) ? fan.rpm : '—');
		var pwm = (fan.pwm != null && fan.pwm >= 0) ? fan.pwm : null;
		this.setText('hw-pct', pwm != null ? Math.round(pwm * 100 / 255) : '—');
		var pct = (pwm != null && fan.error) ? 100 : (pwm != null ? Math.round(pwm * 100 / 255) : 0);
		var bar = document.getElementById('hw-bar-i');
		if (bar) { bar.style.width = pct + '%'; bar.style.background = pwm != null ? tcolor(fan.temperature / 1000) : 'rgba(127,127,127,.3)'; }
		this.setText('hw-profile-live', profileLabel(fan.profile));
		this.setText('hw-pwm-raw', pwm != null ? pwm + ' / 255' : '—');
		this.setText('hw-fault', fan.error ? esc(fan.error) : '无');
		this.setText('hw-avail', fan.available === true ? '可用' : fan.available === false ? '不可用' : '—');
	},

	applyCfg: function() {
		var self = this;
		var profile = document.getElementById('in-profile')?.value;
		if (profile != null) uci.set('xiaomi-control', 'settings', 'profile', String(profile));
		uci.save('xiaomi-control');
		return uci.apply('xiaomi-control').then(function() {
			return L.resolveDefault(callServiceRestart('xiaomi-control'), null);
		}).then(function() {
			ui.addNotification('已应用', '风扇参数已保存并重载，稍后自动生效。');
			setTimeout(function() { self.refresh(); }, 1200);
		}).catch(function(e) {
			ui.addNotification('保存失败', String(e && e.message || e), 'danger');
		});
	},

	render: function() {
		var self = this;
		var _sec = uci.sections('xiaomi-control', 'control').filter(function(s) { return s['.name'] === 'settings'; })[0];
		var c = {};
		if (_sec) Object.keys(_sec).forEach(function(k) { if (k[0] !== '.') c[k] = uci.get('xiaomi-control', 'settings', k); });

		var bind = function(el) {
			for (var i = 1; i + 1 < arguments.length; i += 2) el.addEventListener(arguments[i], arguments[i + 1]);
			return el;
		};
		var metric = function(id, label, val, unit, foot) {
			return E('div', { 'class': 'hw-card' }, [
				E('div', { 'class': 'hw-label' }, label),
				E('div', { 'class': 'hw-metric', 'id': id }, val),
				E('span', { 'class': 'hw-unit' }, unit),
				E('div', { 'class': 'hw-foot' }, foot || '')
			]);
		};
		var kv = function(label, id, val) {
			return E('div', { 'class': 'hw-kv' }, [ E('span', {}, label), E('span', { 'id': id }, val || '—') ]);
		};

		poll.add(function() { return self.refresh(); }, 5);

		var segBtn = function(p, cur) {
			var b = E('button', { 'class': (cur === p[0] ? 'on' : ''), 'click': function() {
				[].forEach.call(this.parentNode.children, function(x) { x.classList.remove('on'); });
				this.classList.add('on');
				var sel = document.getElementById('in-profile'); if (sel) sel.value = p[0];
			} }, p[1] + ' · ' + p[2]);
			return b;
		};

		return E('div', { 'class': 'cbi-map hw-page' }, [
			E('style', {}, CSS),
			E('div', { 'class': 'hw-head' }, [
				E('div', {}, [
					E('h2', { 'class': 'hw-title' }, '风扇控制'),
					E('div', { 'class': 'hw-sub' }, '小米 BE10000 风扇调速控制。实时数据每 5 秒刷新，切换曲线后点「应用设置」即生效。')
				]),
				E('span', { 'class': 'hw-pill', 'id': 'hw-run-pill' }, '● 读取中')
			]),
			E('div', { 'class': 'hw-grid' }, [
				metric('hw-temp', '最热点温度', '—', '°C', '来源：hw-temp-src'),
				metric('hw-pct', '风扇占空比', '—', '%', 'hw-pwm-raw'),
				metric('hw-rpm', '实测转速', '—', 'RPM', '上游后端读取'),
				metric('hw-sensors', '有效传感器', '—', '个', '温控区数量')
			]),
			E('div', { 'style': 'font-size:11px;opacity:.5;margin:-6px 0 14px' }, [
				'传感器：', E('span', { 'id': 'hw-temp-src' }, '—'), ' · PWM：', E('span', { 'id': 'hw-pwm-raw' }, '—')
			]),
			E('div', { 'class': 'hw-card wide' }, [
				E('h3', {}, '实时占空比与状态'),
				E('div', { 'class': 'hw-bar' }, E('i', { 'id': 'hw-bar-i', 'style': 'width:0%' })),
				E('div', { 'style': 'margin-top:12px' }, [
					kv('当前曲线', 'hw-profile-live', profileLabel(c.profile)),
					kv('控制器', 'hw-avail', '—'),
					kv('故障', 'hw-fault', '—')
				]),
				E('div', { 'class': 'hw-note' }, '故障为「无」即硬件正常；超温或故障时后端会自动请求风扇满速保护。')
			]),
			E('div', { 'class': 'hw-card wide' }, [
				E('h3', {}, '风扇调速曲线'),
				E('div', { 'class': 'hw-seg' }, PROFILES.map(function(p) { return segBtn(p, c.profile || 'auto'); })),
				E('select', { 'id': 'in-profile', 'style': 'display:none' }, PROFILES.map(function(p) {
					return E('option', { 'value': p[0], 'selected': (c.profile || 'auto') === p[0] }, p[1]);
				})),
				E('div', { 'class': 'hw-foot' }, '取所有温控区最高温，带迟滞与启动增压；任何模式超温或故障时自动满速。温度未到启动阈值时风扇待机、转速为 0 属正常。')
			]),
			E('div', { 'class': 'hw-card wide' }, [
				E('div', { 'style': 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
					E('button', { 'class': 'hw-btn primary', 'click': ui.createHandlerFn(this, 'applyCfg') }, '应用设置'),
					E('button', { 'class': 'hw-btn', 'click': function() { self.refresh(); } }, '立即刷新状态')
				])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
