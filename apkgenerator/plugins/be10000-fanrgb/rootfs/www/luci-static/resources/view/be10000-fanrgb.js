'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require rpc';
'require ui';
'require poll';
'require dom';

/*
 * BE10000 风扇与灯效控制台 —— SBE1V1K 同款精致风格版
 *
 * 视觉：完全沿用 luci-app-sbe1v1k 的 hw-* 设计语言（半透明卡片 / currentColor
 *       自适应深浅主题 / 大号数字 / 仪表条 / 分段按钮 / 预设色块 / SVG）。
 * 后端：引用 OWRT 上游 luci-app-xiaomi-control 已生效的 xiaomi-control.uc：
 *       - 配置读写 uci xiaomi-control.settings（保存后 procd 自动重载，参数即生效）
 *       - 运行状态读 /var/run/xiaomi-control.json（温度/转速/PWM/传感器/故障）
 *       - 硬件操作（emc2305 PWM + ambient RGB）全由上游后端完成，一个字不改。
 */

/* ---------- 通知框修复（与 SBE 版一致：Argon 缺 fade-out 过渡） ---------- */
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
var MODES = [
	[ 'static', '常亮' ], [ 'breathe', '呼吸' ], [ 'duotone', '双色渐变' ], [ 'rainbow', '彩虹' ],
	[ 'temperature', '温度' ], [ 'cpu', 'CPU 负载' ], [ 'traffic', '网络流量' ]
];
var PRESETS = [
	[ '蓝', '0000ff' ], [ '红', 'ff2d2d' ], [ '绿', '2de02d' ], [ '青', '00e5ff' ],
	[ '黄', 'ffd500' ], [ '紫', 'b030ff' ], [ '橙', 'ff8800' ], [ '粉', 'ff5fa2' ],
	[ '白', 'ffffff' ], [ '靛', '5a5aff' ]
];

/* ---------- SBE 同款 CSS ---------- */
var CSS = [
	'.hw-page{width:100%;max-width:100%;margin:0}',
	'.hw-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 18px}',
	'.hw-title{font-size:22px;font-weight:750;letter-spacing:.3px;margin:0;line-height:1.2}',
	'.hw-sub{opacity:.62;font-size:13px;margin-top:6px;line-height:1.6;max-width:760px}',
	'.hw-pill{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid rgba(127,127,127,.22);background:rgba(127,127,127,.07);white-space:nowrap}',
	'.hw-dot{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px rgba(127,127,127,.15)}',
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
	'@media(max-width:560px){.hw-metric{font-size:25px}}'
].join('');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
	return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function tcolor(t) { return t >= 80 ? '#f5365c' : t >= 65 ? '#fb6340' : t >= 50 ? '#e6a100' : '#2dce89'; }
function modeLabel(m) { for (var i = 0; i < MODES.length; i++) if (MODES[i][0] === m) return MODES[i][1]; return m || '—'; }
function profileLabel(p) { for (var i = 0; i < PROFILES.length; i++) if (PROFILES[i][0] === p) return PROFILES[i][1]; return p || '—'; }

return view.extend({
	data: null,
	cfg: null,
	_running: false,

	load: function() {
		/* uci.load 用 resolveDefault 兜底：配置缺失/损坏时不让整页渲染中断。
		   render() 里 uci.get_all 已有 || {} 保护，仍可显示完整面板。 */
		return Promise.all([
			L.resolveDefault(uci.load('xiaomi-control'), null),
			L.resolveDefault(fs.read('/var/run/xiaomi-control.json'), ''),
			L.resolveDefault(callServiceList('xiaomi-control'), {})
		]);
	},

	/* 运行状态：每 5 秒读 /var/run 状态 + 服务运行状态 */
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
			self.update(status);
		});
	},

	setText: function(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; },
	setHTML: function(id, v) { var e = document.getElementById(id); if (e) e.innerHTML = v; },

	update: function(status) {
		var fan = status.fan || {}, led = status.led || {};
		this.setText('hw-run-pill', this._running ? '● 服务运行中' : '● 服务未运行');
		var pill = document.getElementById('hw-run-pill');
		if (pill) { pill.style.color = this._running ? '#2dce89' : '#f5365c'; }

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
		this.setText('hw-led-live', led.error ? esc(led.error) : modeLabel(led.mode));
		this.setText('hw-led-br', (led.brightness != null) ? led.brightness : '—');
	},

	/* ---- 配置读写：走 uci xiaomi-control.settings，保存先 reload 服务让参数生效 ---- */
	applyCfg: function() {
		var self = this;
		/* 把界面控件的值写回 uci */
		var set = function(opt, val) { if (val != null) uci.set('xiaomi-control', 'settings', opt, String(val)); };
		set('profile', document.getElementById('in-profile')?.value);
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
		return uci.apply('xiaomi-control').then(function() {
			/* 显式重启后端：ucode 后端启动时一次性读 cfg，重启确保新参数立即生效 */
			return L.resolveDefault(callServiceRestart('xiaomi-control'), null);
		}).then(function() {
			ui.addNotification('已应用', '风扇与灯效参数已保存并重载，稍后自动生效。');
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

	render: function(data) {
		var self = this;
		var c = uci.get_all('xiaomi-control', 'settings') || {};
		this._color = /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : '#0000ff';
		this._color2 = /^#[0-9a-fA-F]{6}$/.test(c.second_color || '') ? c.second_color : '#ff00aa';

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
		var segBtn = function(group, value, label, cur, fn, arg) {
			var b = E('button', { 'class': (cur === value ? 'on' : ''), 'click': fn }, label);
			b.setAttribute('data-group', group); b.setAttribute('data-v', value);
			return b;
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
					E('h2', { 'class': 'hw-title' }, '风扇与灯效控制'),
					E('div', { 'class': 'hw-sub' },
						'小米 BE10000 · 引用 OWRT 上游硬件控制器：emc2305 PWM 风扇 + RGB 环境灯。' +
						'下方实时数据每 5 秒刷新；修改参数后点「应用」即重载生效。')
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
					kv('RGB 状态', 'hw-led-live', '—'),
					kv('RGB 亮度', 'hw-led-br', '—'),
					kv('故障', 'hw-fault', '—')
				]),
				E('div', { 'class': 'hw-note' }, '故障为「无」即硬件正常；若出现 pwm/temperature 相关提示，后端会自动请求风扇满速保护。')
			]),

			E('div', { 'class': 'hw-2col' }, [
				/* ---------- 风扇卡片 ---------- */
				E('div', { 'class': 'hw-card' }, [
					E('h3', {}, '风扇调速曲线'),
					E('div', { 'class': 'hw-seg' }, PROFILES.map(function(p) {
						return segBtn('profile', p[0], p[1] + ' · ' + p[2], c.profile || 'auto', function() {
							var group = this.getAttribute('data-group'), v = this.getAttribute('data-v');
							[].forEach.call(this.parentNode.children, function(b) { b.classList.toggle('on', b === this); }, this);
							var sel = document.getElementById('in-profile'); if (sel) sel.value = v;
						});
					})),
					E('select', { 'id': 'in-profile', 'style': 'display:none' }, PROFILES.map(function(p) {
						return E('option', { 'value': p[0], 'selected': (c.profile || 'auto') === p[0] }, p[1]);
					})),
					E('div', { 'class': 'hw-foot' },
						'取所有温控区最高温，带迟滞与启动增压；任何模式超温或故障时自动满速。')
				]),

				/* ---------- RGB 卡片 ---------- */
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
				]),
				E('div', { 'class': 'hw-foot' },
					'应用后保存配置并重启上游控制器，新参数立即生效。夜间时段值沿用上游 night_start/night_end 字段。')
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
