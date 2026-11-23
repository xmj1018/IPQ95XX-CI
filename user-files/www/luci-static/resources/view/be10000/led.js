'use strict';
'require view';
'require uci';
'require fs';
'require rpc';
'require ui';
'require poll';

/*
 * BE10000 RGB 状态灯 —— SBE1V1K 同款精致风格（独立模块）
 * 后端：复用 OWRT 上游 luci-app-xiaomi-control 的 xiaomi-control.uc
 *       - 配置读写 uci xiaomi-control.settings（灯相关字段）
 *       - 运行状态读 /var/run/xiaomi-control.json 的 led 段
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

var MODES = [
	[ 'static', '常亮' ], [ 'breathe', '呼吸' ], [ 'duotone', '双色渐变' ], [ 'rainbow', '彩虹' ],
	[ 'temperature', '温度' ], [ 'cpu', 'CPU 负载' ], [ 'traffic', '网络流量' ]
];
var PRESETS = [
	[ '蓝', '0000ff' ], [ '红', 'ff2d2d' ], [ '绿', '2de02d' ], [ '青', '00e5ff' ],
	[ '黄', 'ffd500' ], [ '紫', 'b030ff' ], [ '橙', 'ff8800' ], [ '粉', 'ff5fa2' ],
	[ '白', 'ffffff' ], [ '靛', '5a5aff' ]
];

var CSS = [
	'.hw-page{width:100%;max-width:100%;margin:0}',
	'.hw-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 18px}',
	'.hw-title{font-size:22px;font-weight:750;letter-spacing:.3px;margin:0;line-height:1.2}',
	'.hw-sub{opacity:.62;font-size:13px;margin-top:6px;line-height:1.6;max-width:760px}',
	'.hw-pill{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid rgba(127,127,127,.22);background:rgba(127,127,127,.07);white-space:nowrap}',
	'.hw-card{border:1px solid rgba(127,127,127,.2);border-radius:16px;background:rgba(127,127,127,.06);padding:16px 18px;min-width:0;margin-bottom:14px}',
	'.hw-card.wide{grid-column:1/-1}',
	'.hw-card h3{margin:0 0 14px;font-size:14px;font-weight:700;letter-spacing:.4px;display:flex;align-items:center;gap:9px}',
	'.hw-card h3:before{content:"";width:3px;height:14px;border-radius:2px;background:var(--primary,#5e72e4)}',
	'.hw-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:9px 0}',
	'.hw-row>label{font-size:12.5px;opacity:.7;min-width:66px}',
	'.hw-slider{flex:1;min-width:110px;accent-color:var(--primary,#5e72e4)}',
	'.hw-num{width:70px;padding:7px 8px;border-radius:9px;border:1px solid rgba(127,127,127,.25);background:rgba(127,127,127,.06);color:inherit;text-align:center;font-variant-numeric:tabular-nums}',
	'.hw-btn{padding:9px 16px;border-radius:10px;border:1px solid rgba(127,127,127,.25);background:rgba(127,127,127,.07);color:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:all .18s}',
	'.hw-btn:hover{border-color:var(--primary,#5e72e4);transform:translateY(-1px)}',
	'.hw-btn.primary{background:var(--primary,#5e72e4);border-color:var(--primary,#5e72e4);color:#fff}',
	'.hw-select{padding:8px 10px;border-radius:9px;border:1px solid rgba(127,127,127,.25);background:rgba(127,127,127,.06);color:inherit;font-size:13px}',
	'.hw-kv{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(127,127,127,.12);font-size:12.5px}',
	'.hw-kv:last-child{border-bottom:0}',
	'.hw-kv span:first-child{opacity:.65}',
	'.hw-kv span:last-child{font-weight:600;font-variant-numeric:tabular-nums;text-align:right}',
	'.hw-2col{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}',
	'.hw-swatches{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}',
	'.hw-sw{width:30px;height:30px;border-radius:8px;cursor:pointer;border:2px solid transparent;transition:transform .15s}',
	'.hw-sw:hover{transform:scale(1.12)}',
	'.hw-sw.on{border-color:var(--primary,#5e72e4);box-shadow:0 0 0 2px rgba(94,114,228,.25)}',
	'.hw-toggle{position:relative;width:46px;height:26px;border-radius:999px;background:rgba(127,127,127,.3);cursor:pointer;transition:background .2s;flex:0 0 auto}',
	'.hw-toggle.on{background:var(--primary,#5e72e4)}',
	'.hw-toggle:after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.25)}',
	'.hw-toggle.on:after{left:23px}',
	'.hw-note{padding:11px 14px;border-radius:11px;background:rgba(94,114,228,.09);border:1px solid rgba(94,114,228,.25);font-size:12.5px;line-height:1.65;margin-top:12px}',
	'.hw-lampbox{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:190px}',
	'.hw-lamp{width:112px;height:112px;border-radius:50%;position:relative;transition:background .25s,box-shadow .25s;border:1px solid rgba(255,255,255,.25)}',
	'.hw-lamp:after{content:"";position:absolute;inset:-18px;border-radius:50%;background:inherit;filter:blur(24px);opacity:.5;z-index:-1}',
	'.hw-lamp.off{opacity:.25;box-shadow:none !important}',
	'.hw-hex{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;margin-top:16px;letter-spacing:.5px}'
].join('');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
	return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function modeLabel(m) { for (var i = 0; i < MODES.length; i++) if (MODES[i][0] === m) return MODES[i][1]; return m || '—'; }

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
			self.update(status.led || {});
		});
	},

	setText: function(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; },

	update: function(led) {
		this.setText('hw-run-pill', this._running ? '● 服务运行中' : '● 服务未运行');
		var pill = document.getElementById('hw-run-pill');
		if (pill) pill.style.color = this._running ? '#2dce89' : '#f5365c';
		this.setText('hw-led-live', led.error ? esc(led.error) : modeLabel(led.mode));
		var lv = document.getElementById('hw-led-live'); if (lv) lv.style.color = led.error ? '#f5365c' : 'inherit';
		this.setText('hw-led-br', (led.brightness != null) ? led.brightness : '—');
		this.updateLamp(led);
	},

	updateLamp: function(led) {
		var lamp = document.getElementById('hw-lamp');
		if (!lamp) return;
		var br = (typeof led.brightness === 'number') ? led.brightness : 0;
		var on = br > 0 && !led.error;
		var rgb = /^#[0-9a-fA-F]{6}$/.test(this._color || '') ? this._color : '#0000ff';
		var r = parseInt(rgb.substr(1, 2), 16), g = parseInt(rgb.substr(3, 2), 16), b = parseInt(rgb.substr(5, 2), 16);
		var k = Math.min(1, Math.max(0, br / 255));
		var sc = function(v) { return ('0' + Math.round(v * k).toString(16)).slice(-2); };
		var shown = '#' + sc(r) + sc(g) + sc(b);
		lamp.style.background = shown;
		lamp.style.boxShadow = on ? '0 0 34px 8px ' + rgb + ', inset 0 0 22px rgba(255,255,255,.35)' : 'none';
		if (on) lamp.classList.remove('off'); else lamp.classList.add('off');
		this.setText('hw-lamp-hex', shown);
	},

	applyCfg: function() {
		var self = this;
		var set = function(opt, val) { if (val != null) uci.set('xiaomi-control', 'settings', opt, String(val)); };
		set('enabled', this._getToggle('tg-led') ? '1' : '0');
		set('mode', document.getElementById('in-mode')?.value);
		set('color', this._color);
		set('second_color', this._color2);
		set('brightness', document.getElementById('in-bright')?.value);
		set('minimum_brightness', document.getElementById('in-minbright')?.value);
		set('speed', document.getElementById('in-speed')?.value);
		set('sensitivity', document.getElementById('in-sens')?.value);
		set('traffic_interface', document.getElementById('in-iface')?.value || 'wan');
		set('schedule_enabled', this._getToggle('tg-sched') ? '1' : '0');
		set('on_time', document.getElementById('in-on')?.value || '07:00');
		set('off_time', document.getElementById('in-off')?.value || '23:30');
		set('night_enabled', this._getToggle('tg-night') ? '1' : '0');
		set('night_start', document.getElementById('in-night-on')?.value || '22:00');
		set('night_end', document.getElementById('in-night-off')?.value || '07:00');
		set('night_brightness', document.getElementById('in-nightbright')?.value);
		uci.save('xiaomi-control');
		/* 不用 uci.apply：该 config 未在 ucitrack 注册，apply 会返回 ubus code 5 弹红条。
		   真正让新参数生效的是重启后端进程（它启动时会一次性读配置）。 */
		return L.resolveDefault(callServiceRestart('xiaomi-control'), null).then(function() {
			ui.addNotification('已应用', '灯效参数已保存并重载，稍后自动生效。');
			setTimeout(function() { self.refresh(); }, 1200);
		}).catch(function(e) {
			ui.addNotification('保存失败', String(e && e.message || e), 'danger');
		});
	},

	_getToggle: function(id) { var e = document.getElementById(id); return !!(e && e.classList.contains('on')); },
	_toggle: function(ev) { var t = ev.currentTarget; if (t) t.classList.toggle('on'); },
	_setColor: function(which, val) {
		var input = document.getElementById(which === 1 ? 'in-color' : 'in-color2');
		var prev = document.getElementById(which === 1 ? 'prev-color' : 'prev-color2');
		if (input) input.value = '#' + val;
		if (prev) prev.style.background = '#' + val;
		if (which === 1) this._color = '#' + val; else this._color2 = '#' + val;
		var target = document.querySelectorAll('.hw-sw');
		[].forEach.call(target, function(s) {
			if (s.getAttribute('data-which') == which) s.classList.toggle('on', s.getAttribute('data-v') === val);
		});
	},

	render: function() {
		var self = this;
		var _sec = uci.sections('xiaomi-control', 'control').filter(function(s) { return s['.name'] === 'settings'; })[0];
		var c = {};
		if (_sec) Object.keys(_sec).forEach(function(k) { if (k[0] !== '.') c[k] = uci.get('xiaomi-control', 'settings', k); });
		this._color = /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : '#0000ff';
		this._color2 = /^#[0-9a-fA-F]{6}$/.test(c.second_color || '') ? c.second_color : '#ff00aa';

		var bind = function(el) {
			for (var i = 1; i + 1 < arguments.length; i += 2) el.addEventListener(arguments[i], arguments[i + 1]);
			return el;
		};
		var kv = function(label, id, val) {
			return E('div', { 'class': 'hw-kv' }, [ E('span', {}, label), E('span', { 'id': id }, val || '—') ]);
		};
		var sliderRow = function(label, id, min, max, val) {
			return E('div', { 'class': 'hw-row' }, [
				E('label', {}, label),
				bind(E('input', { 'id': id + '-r', 'type': 'range', 'min': String(min), 'max': String(max), 'value': String(val), 'class': 'hw-slider' }),
					'input', function() { var n = document.getElementById(id); if (n) n.value = this.value; }),
				bind(E('input', { 'id': id, 'type': 'number', 'min': String(min), 'max': String(max), 'value': String(val), 'class': 'hw-num' }),
					'input', function() { var r = document.getElementById(id + '-r'); if (r) r.value = this.value; })
			]);
		};

		poll.add(function() { return self.refresh(); }, 5);

		return E('div', { 'class': 'cbi-map hw-page' }, [
			E('style', {}, CSS),
			E('div', { 'class': 'hw-head' }, [
				E('div', {}, [
					E('h2', { 'class': 'hw-title' }, 'RGB 状态灯'),
					E('div', { 'class': 'hw-sub' }, '小米 BE10000 RGB 环境灯效控制。实时状态每 5 秒刷新，修改后点「应用设置」即生效。')
				]),
				E('span', { 'class': 'hw-pill', 'id': 'hw-run-pill' }, '● 读取中')
			]),
			E('div', { 'class': 'hw-2col' }, [
				E('div', { 'class': 'hw-card hw-lampbox' }, [
					E('div', { 'class': 'hw-lamp off', 'id': 'hw-lamp', 'style': 'background:#0000ff' }),
					E('div', { 'class': 'hw-hex', 'id': 'hw-lamp-hex' }, '#000000'),
					E('div', { 'class': 'hw-foot' }, '实时预览（按当前亮度缩放）')
				]),
				E('div', { 'class': 'hw-card' }, [
					E('h3', {}, '灯效运行状态'),
					E('div', { 'style': 'margin-top:4px' }, [
						kv('当前灯效', 'hw-led-live', '—'),
						kv('当前亮度 (0–255)', 'hw-led-br', '—')
					])
				])
			]),
			E('div', { 'class': 'hw-2col' }, [
				E('div', { 'class': 'hw-card' }, [
					E('h3', {}, 'RGB 灯效'),
					E('div', { 'class': 'hw-row' }, [
						E('label', {}, '启用灯效'),
						E('div', { 'id': 'tg-led', 'class': 'hw-toggle' + ((c.enabled !== '0') ? ' on' : ''), 'click': self._toggle })
					]),
					E('div', { 'class': 'hw-row' }, [
						E('label', {}, '灯效模式'),
						E('select', { 'id': 'in-mode', 'class': 'hw-select' }, MODES.map(function(m) {
							return E('option', { 'value': m[0], 'selected': (c.mode || 'breathe') === m[0] }, m[1]);
						}))
					]),
					E('div', { 'class': 'hw-row' }, [
						E('label', {}, '主色'),
						E('div', { 'id': 'prev-color', 'style': 'width:26px;height:26px;border-radius:7px;background:' + this._color + ';border:1px solid rgba(127,127,127,.3)' }),
						bind(E('input', { 'id': 'in-color', 'type': 'text', 'value': this._color, 'class': 'hw-num', 'style': 'width:96px' }),
							'input', function() { if (/^#[0-9a-fA-F]{6}$/.test(this.value)) { self._color = this.value; document.getElementById('prev-color').style.background = this.value; } })
					]),
					E('div', { 'class': 'hw-swatches' }, PRESETS.map(function(p) {
						var s = E('div', {
							'class': 'hw-sw' + (self._color.slice(1).toLowerCase() === p[1] ? ' on' : ''),
							'style': 'background:#' + p[1], 'title': p[0]
						});
						s.setAttribute('data-v', p[1]); s.setAttribute('data-which', '1');
						s.addEventListener('click', function() { self._setColor(1, p[1]); });
						return s;
					})),
					sliderRow('最大亮度', 'in-bright', 0, 255, c.brightness || '96'),
					sliderRow('最小亮度', 'in-minbright', 0, 255, c.minimum_brightness || '8'),
					sliderRow('动画速度', 'in-speed', 1, 10, c.speed || '5'),
					sliderRow('灵敏度', 'in-sens', 1, 10, c.sensitivity || '5')
				])
			]),
			E('div', { 'class': 'hw-2col' }, [
				E('div', { 'class': 'hw-card' }, [
					E('h3', {}, '双色 / 流量设置'),
					E('div', { 'class': 'hw-row' }, [
						E('label', {}, '副色'),
						E('div', { 'id': 'prev-color2', 'style': 'width:26px;height:26px;border-radius:7px;background:' + this._color2 + ';border:1px solid rgba(127,127,127,.3)' }),
						bind(E('input', { 'id': 'in-color2', 'type': 'text', 'value': this._color2, 'class': 'hw-num', 'style': 'width:96px' }),
							'input', function() { if (/^#[0-9a-fA-F]{6}$/.test(this.value)) { self._color2 = this.value; document.getElementById('prev-color2').style.background = this.value; } })
					]),
					E('div', { 'class': 'hw-swatches' }, PRESETS.map(function(p) {
						var s = E('div', {
							'class': 'hw-sw' + (self._color2.slice(1).toLowerCase() === p[1] ? ' on' : ''),
							'style': 'background:#' + p[1], 'title': p[0]
						});
						s.setAttribute('data-v', p[1]); s.setAttribute('data-which', '2');
						s.addEventListener('click', function() { self._setColor(2, p[1]); });
						return s;
					})),
					E('div', { 'class': 'hw-row' }, [
						E('label', {}, '流量接口'),
						E('input', { 'id': 'in-iface', 'type': 'text', 'value': c.traffic_interface || 'wan', 'class': 'hw-num', 'style': 'width:110px' })
					]),
					E('div', { 'class': 'hw-foot' }, '「双色渐变」用副色；「网络流量」模式按此接口实时流量变色。')
				]),
				E('div', { 'class': 'hw-card' }, [
					E('h3', {}, '定时与夜间亮度'),
					E('div', { 'class': 'hw-row' }, [
						E('label', {}, '定时开关'),
						E('div', { 'id': 'tg-sched', 'class': 'hw-toggle' + (c.schedule_enabled === '1' ? ' on' : ''), 'click': self._toggle })
					]),
					E('div', { 'class': 'hw-row' }, [
						E('label', {}, '开启/关闭'),
						E('input', { 'id': 'in-on', 'type': 'time', 'value': c.on_time || '07:00', 'class': 'hw-num', 'style': 'width:100px' }),
						E('input', { 'id': 'in-off', 'type': 'time', 'value': c.off_time || '23:30', 'class': 'hw-num', 'style': 'width:100px' })
					]),
					E('div', { 'class': 'hw-row' }, [
						E('label', {}, '夜间降亮'),
						E('div', { 'id': 'tg-night', 'class': 'hw-toggle' + (c.night_enabled === '1' ? ' on' : ''), 'click': self._toggle })
					]),
					E('div', { 'class': 'hw-row' }, [
						E('label', {}, '夜间时段'),
						E('input', { 'id': 'in-night-on', 'type': 'time', 'value': c.night_start || '22:00', 'class': 'hw-num', 'style': 'width:100px' }),
						E('input', { 'id': 'in-night-off', 'type': 'time', 'value': c.night_end || '07:00', 'class': 'hw-num', 'style': 'width:100px' })
					]),
					sliderRow('夜间亮度', 'in-nightbright', 0, 255, c.night_brightness || '24')
				])
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
