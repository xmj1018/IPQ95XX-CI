'use strict';
'require view';
'require uci';
'require fs';
'require rpc';
'require ui';
'require poll';

const callServiceList = rpc.declare({ object: 'service', method: 'list', params: [ 'name' ], expect: { '': {} } });
const callServiceRestart = rpc.declare({ object: 'service', method: 'restart', params: [ 'name' ] });

var PROFILES = [
	[ 'auto', '自动', '45–85 °C' ],
	[ 'quiet', '静音', '52–80 °C' ],
	[ 'balanced', '均衡', '45–75 °C' ],
	[ 'performance', '性能', '38–65 °C' ],
	[ 'custom', '自定义曲线', '按下方的温度/转速曲线' ]
];

var DEFAULT_CURVE = [ [ 40, 20 ], [ 50, 35 ], [ 65, 60 ], [ 80, 100 ] ];

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
	'.hw-seg button{flex:1;min-width:80px;padding:11px 10px;border-radius:11px;border:1px solid rgba(127,127,127,.22);background:rgba(127,127,127,.05);color:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:all .18s}',
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
	'.hw-chart{width:100%;height:auto;display:block;border-radius:12px;background:rgba(127,127,127,.05);border:1px solid rgba(127,127,127,.14)}',
	'.hw-pt{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 0;border-bottom:1px solid rgba(127,127,127,.1);font-size:12.5px}',
	'.hw-pt:last-child{border-bottom:0}',
	'.hw-pt>span{opacity:.65}',
	'.hw-pt input{width:66px;padding:6px 7px;border-radius:8px;border:1px solid rgba(127,127,127,.25);background:rgba(127,127,127,.06);color:inherit;text-align:center;font-variant-numeric:tabular-nums}',
	'@media(max-width:560px){.hw-metric{font-size:25px}}'
].join('');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
	return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function tcolor(t) { return t >= 80 ? '#f5365c' : t >= 65 ? '#fb6340' : t >= 50 ? '#e6a100' : '#2dce89'; }
function profileLabel(p) { for (var i = 0; i < PROFILES.length; i++) if (PROFILES[i][0] === p) return PROFILES[i][1]; return p || '—'; }

var _hwToast = null;
function notify(title, children, danger) {
	if (_hwToast) { try { _hwToast._close(true); } catch (e) {} _hwToast = null; }
	var color = danger ? '#e64545' : '#3a9d5d';
	var content = [];
	if (title != null) content.push(E('h4', { 'style': 'margin:0 0 4px;font-size:14px' }, title));
	if (children != null) content.push(children);
	var box = E('div', {
		'class': 'alert-message hw-toast',
		'style': 'display:flex;align-items:center;gap:12px;padding:10px 14px;margin-bottom:10px;' +
			'background:' + color + ';color:#fff;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.2);' +
			'opacity:0;transform:translateY(-6px);transition:opacity .18s ease,transform .18s ease'
	}, [
		E('div', { 'style': 'flex:1 1 auto' }, content),
		E('button', {
			'class': 'btn',
			'style': 'margin-left:auto;background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5)',
			'click': function() { close(); }
		}, [ '关闭' ])
	]);
	var mc = document.querySelector('#maincontent') || document.body;
	mc.insertBefore(box, mc.firstElementChild);
	if (window.requestAnimationFrame)
		requestAnimationFrame(function() { box.style.opacity = '1'; box.style.transform = 'translateY(0)'; });
	else { box.style.opacity = '1'; box.style.transform = 'translateY(0)'; }
	var closed = false, timer = null;
	function close(immediate) {
		if (closed) return;
		closed = true;
		if (timer != null) clearTimeout(timer);
		document.removeEventListener('click', once, true);
		if (_hwToast === box) _hwToast = null;
		function done() { if (box.parentNode) box.parentNode.removeChild(box); }
		if (immediate || !box.parentNode || !window.requestAnimationFrame) { done(); return; }
		box.style.opacity = '0';
		box.style.transform = 'translateY(-6px)';
		setTimeout(done, 200);
	}
	function once(ev) {
		if (closed || !box.parentNode) { close(true); return; }
		if (ev.target === box || box.contains(ev.target)) return;
		close();
	}
	timer = setTimeout(function() { close(); }, 3000);
	document.addEventListener('click', once, true);
	box._close = close;
	_hwToast = box;
	return box;
}

function parseCurve(str) {
	var pts = [];
	String(str || '').split(',').forEach(function(seg) {
		var kv = seg.split(':');
		if (kv.length !== 2) return;
		var t = parseInt(kv[0], 10), p = parseInt(kv[1], 10);
		if (isNaN(t) || isNaN(p)) return;
		pts.push([ Math.min(95, Math.max(30, t)), Math.min(100, Math.max(0, p)) ]);
	});
	pts.sort(function(a, b) { return a[0] - b[0]; });
	return pts.length ? pts : DEFAULT_CURVE.map(function(p) { return p.slice(); });
}

return view.extend({
	_running: false,
	curve: DEFAULT_CURVE.map(function(p) { return p.slice(); }),
	curveTouched: false,
	_ptSig: '',
	currentTemp: null,
	currentPct: null,
	lastMode: 'auto',

	load: function() {
		return Promise.all([
			L.resolveDefault(uci.load('xiaomi-control'), null),
			L.resolveDefault(fs.read('/var/run/xiaomi-control.json'), ''),
			L.resolveDefault(callServiceList('xiaomi-control'), {})
		]);
	},

	refresh: function() {
		if (!document.getElementById('hw-temp')) return Promise.resolve();
		var self = this;
		return Promise.all([
			L.resolveDefault(fs.read('/var/run/xiaomi-control.json'), ''),
			L.resolveDefault(callServiceList('xiaomi-control'), {})
		]).then(function(r) {
			var status = {};
			try { status = JSON.parse(r[0]) || {}; } catch (e) {}
			var inst = r[1]['xiaomi-control']?.instances || {};
			self._running = Object.keys(inst).some(function(k) { return inst[k].running; });
			var fan = status.fan || {};
			if (!self.curveTouched && fan.curve) {
				var pts = parseCurve(fan.curve);
				var sig = JSON.stringify(pts);
				if (sig !== self._ptSig) { self.curve = pts; self.renderPoints(); }
			}
			self.currentTemp = (typeof fan.temperature === 'number' && fan.temperature >= 0) ? fan.temperature / 1000 : null;
			self.currentPct = (typeof fan.pct === 'number') ? fan.pct : (typeof fan.pwm === 'number' ? Math.round(fan.pwm * 100 / 255) : null);
			self.update(fan);
		});
	},

	setText: function(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; },

	update: function(fan) {
		this.setText('hw-run-pill', this._running ? '● 服务运行中' : '● 服务未运行');
		var pill = document.getElementById('hw-run-pill');
		if (pill) pill.style.color = this._running ? '#2dce89' : '#f5365c';
		var temp = this.currentTemp != null ? this.currentTemp.toFixed(1) : '—';
		this.setText('hw-temp', temp);
		var te = document.getElementById('hw-temp'); if (te) te.style.color = (this.currentTemp != null) ? tcolor(this.currentTemp) : 'inherit';
		this.setText('hw-temp-src', fan.sensor || '—');
		this.setText('hw-sensors', (fan.sensors != null) ? fan.sensors : '—');
		this.setText('hw-rpm', (fan.rpm != null && fan.rpm >= 0) ? fan.rpm : '—');
		this.setText('hw-pct', this.currentPct != null ? Math.round(this.currentPct) : '—');
		var pct = this.currentPct != null ? Math.round(this.currentPct) : 0;
		var bar = document.getElementById('hw-bar-i');
		if (bar) { bar.style.width = pct + '%'; bar.style.background = this.currentPct != null ? tcolor(this.currentTemp || 0) : 'rgba(127,127,127,.3)'; }
		this.setText('hw-profile-live', profileLabel(fan.profile));
		this.setText('hw-pwm-raw', (fan.pwm != null) ? fan.pwm + ' / 255' : '—');
		this.setText('hw-fault', fan.error ? esc(fan.error) : '无');
		this.setText('hw-avail', fan.available === true ? '可用' : fan.available === false ? '不可用' : '—');
		var cc = document.getElementById('hw-curve-card');
		if (cc) cc.style.display = (fan.profile === 'custom') ? '' : 'none';
		this.drawChart();
	},

	curveSig: function() { return JSON.stringify(this.curve || []); },

	renderPoints: function() {
		var box = document.getElementById('hw-points'); if (!box) return;
		var self = this; box.innerHTML = '';
		this._ptSig = this.curveSig();
		this.curve.forEach(function(p, i) {
			var ti = E('input', { 'type': 'number', 'min': '30', 'max': '95', 'value': p[0] });
			var pi = E('input', { 'type': 'number', 'min': '0', 'max': '100', 'value': p[1] });
			ti.addEventListener('change', function() {
				self.curve[i][0] = Math.min(95, Math.max(30, parseInt(ti.value, 10) || 40));
				self.curveTouched = true;
				self.curve.sort(function(a, b) { return a[0] - b[0]; });
				self.renderPoints(); self.drawChart();
			});
			pi.addEventListener('change', function() {
				self.curve[i][1] = Math.min(100, Math.max(0, parseInt(pi.value, 10) || 0));
				self.curveTouched = true;
				self.drawChart();
			});
			box.appendChild(E('div', { 'class': 'hw-pt' }, [
				E('span', {}, '温度'), ti, E('span', {}, '°C'),
				E('span', {}, '转速'), pi, E('span', {}, '%'),
				E('button', { 'class': 'hw-btn', 'style': 'padding:5px 10px;margin-left:auto',
					'click': function() {
						if (self.curve.length <= 1) return;
						self.curve.splice(i, 1);
						self.curveTouched = true;
						self.renderPoints(); self.drawChart();
					} }, '删除')
			]));
		});
	},

	drawChart: function() {
		var box = document.getElementById('hw-chart-box'); if (!box) return;
		var sig = this.curveSig() + '|' + this.currentTemp + '|' + this.currentPct;
		if (sig === this._chartSig) return;
		this._chartSig = sig;
		var W = 600, H = 230, padL = 40, padR = 14, padT = 14, padB = 28;
		var x0 = 30, x1 = 90;
		function X(t) { return padL + (t - x0) / (x1 - x0) * (W - padL - padR); }
		function Y(p) { return H - padB - p / 100 * (H - padT - padB); }
		var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="hw-chart" preserveAspectRatio="xMidYMid meet">';
		[ 0, 25, 50, 75, 100 ].forEach(function(p) {
			s += '<line x1="' + padL + '" y1="' + Y(p) + '" x2="' + (W - padR) + '" y2="' + Y(p) +
				'" stroke="rgba(127,127,127,.18)" stroke-width="1"/>';
			s += '<text x="4" y="' + (Y(p) + 3) + '" font-size="10" fill="currentColor" opacity=".55">' + p + '%</text>';
		});
		[ 30, 45, 60, 75, 90 ].forEach(function(t) {
			s += '<line x1="' + X(t) + '" y1="' + padT + '" x2="' + X(t) + '" y2="' + (H - padB) +
				'" stroke="rgba(127,127,127,.09)" stroke-width="1"/>';
			s += '<text x="' + (X(t) - 8) + '" y="' + (H - 9) + '" font-size="10" fill="currentColor" opacity=".55">' + t + '°</text>';
		});
		var pts = this.curve || [];
		if (pts.length) {
			var line = 'M ' + X(30) + ' ' + Y(pts[0][1]);
			pts.forEach(function(p) { line += ' L ' + X(p[0]) + ' ' + Y(p[1]); });
			line += ' L ' + X(90) + ' ' + Y(pts[pts.length - 1][1]);
			s += '<path d="' + line + ' L ' + X(90) + ' ' + Y(0) + ' L ' + X(30) + ' ' + Y(0) +
				' Z" fill="rgba(94,114,228,.12)"/>';
			s += '<path d="' + line + '" fill="none" stroke="var(--primary,#5e72e4)" stroke-width="2.5" stroke-linejoin="round"/>';
			pts.forEach(function(p) {
				s += '<circle cx="' + X(p[0]) + '" cy="' + Y(p[1]) + '" r="4" fill="#fff" stroke="var(--primary,#5e72e4)" stroke-width="2"/>';
			});
		}
		if (this.currentTemp != null && this.currentPct != null) {
			var t = Math.min(x1, Math.max(x0, this.currentTemp));
			s += '<circle cx="' + X(t) + '" cy="' + Y(this.currentPct) +
				'" r="6" fill="#f5365c" stroke="#fff" stroke-width="2"/>';
		}
		s += '<text x="' + (W - padR - 2) + '" y="' + (padT + 8) + '" text-anchor="end" font-size="10" fill="currentColor" opacity=".5">蓝线 = 自定义转速曲线 / 红点 = 当前工作点</text>';
		s += '</svg>';
		box.innerHTML = s;
	},

	curveStr: function() { return this.curve.map(function(p) { return p[0] + ':' + p[1]; }).join(','); },

	handleAddPoint: function() {
		if (this.curve.length >= 8) return;
		var last = this.curve[this.curve.length - 1] || [ 50, 50 ];
		this.curve.push([ Math.min(95, last[0] + 10), Math.min(100, last[1] + 15) ]);
		this.curveTouched = true;
		this.curve.sort(function(a, b) { return a[0] - b[0]; });
		this.renderPoints(); this.drawChart();
	},

	handleRestoreCurve: function() {
		this.curve = DEFAULT_CURVE.map(function(p) { return p.slice(); });
		this.curveTouched = true;
		this.renderPoints(); this.drawChart();
	},

	applyCfg: function() {
		var self = this;
		var profile = document.getElementById('in-profile')?.value;
		if (profile != null) {
			uci.set('xiaomi-control', 'settings', 'profile', String(profile));
			if (profile === 'custom')
				uci.set('xiaomi-control', 'settings', 'curve', this.curveStr());
		}
		return uci.save().then(function() {
			return L.resolveDefault(callServiceRestart('xiaomi-control'), null);
		}).then(function() {
			self.curveTouched = false;
			notify('已应用', '风扇设置已保存并重载，稍后自动生效。');
			setTimeout(function() { self.refresh(); }, 1200);
		}).catch(function(e) {
			notify('保存失败', String(e && e.message || e), true);
		});
	},

	render: function() {
		var self = this;
		var _sec = uci.sections('xiaomi-control', 'control').filter(function(s) { return s['.name'] === 'settings'; })[0];
		var c = {};
		if (_sec) Object.keys(_sec).forEach(function(k) { if (k[0] !== '.') c[k] = uci.get('xiaomi-control', 'settings', k); });
		this.curve = parseCurve(c.curve);
		this.lastMode = c.profile || 'auto';

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

		var segBtn = function(p) {
			var b = E('button', { 'class': (self.lastMode === p[0] ? 'on' : ''), 'click': function() {
				[].forEach.call(this.parentNode.children, function(x) { x.classList.remove('on'); });
				this.classList.add('on');
				var sel = document.getElementById('in-profile'); if (sel) sel.value = p[0];
				var cc = document.getElementById('hw-curve-card');
				if (cc) cc.style.display = (p[0] === 'custom') ? '' : 'none';
			} }, p[1]);
			return b;
		};

		var curveCard = E('div', { 'class': 'hw-card wide', 'id': 'hw-curve-card', 'style': 'display:none' }, [
			E('h3', {}, '自定义风扇曲线'),
			E('div', { 'id': 'hw-chart-box' }),
			E('div', { 'class': 'hw-note' }, '横轴为温度（°C），纵轴为风扇转速（%）。调速时按下面的点线性插值：低于第一点用第一点转速，高于最后一点用最后一点转速。改完数值后点「应用设置」生效。'),
			E('div', { 'id': 'hw-points', 'style': 'margin-top:10px' }),
			E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, [
				E('button', { 'class': 'hw-btn', 'click': ui.createHandlerFn(this, 'handleAddPoint') }, '+ 增加曲线点'),
				E('button', { 'class': 'hw-btn', 'click': ui.createHandlerFn(this, 'handleRestoreCurve') }, '恢复默认曲线')
			])
		]);

		return E('div', { 'class': 'cbi-map hw-page' }, [
			E('style', {}, CSS),
			E('div', { 'class': 'hw-head' }, [
				E('div', {}, [
					E('h2', { 'class': 'hw-title' }, '风扇控制'),
					E('div', { 'class': 'hw-sub' }, '小米 BE10000 风扇调速。实时数据每 5 秒刷新；选「自定义曲线」可按下方的温度/转速表调速，点「应用设置」后生效。')
				]),
				E('span', { 'class': 'hw-pill', 'id': 'hw-run-pill' }, '● 读取中')
			]),
			E('div', { 'class': 'hw-grid' }, [
				metric('hw-temp', '最热温度', '—', '°C', '来源：hw-temp-src'),
				metric('hw-pct', '当前转速', '—', '%', 'hw-pwm-raw'),
				metric('hw-rpm', '实测转速', '—', 'RPM', '上游后端读取'),
				metric('hw-sensors', '有效传感器', '—', '个', '温控区数量')
			]),
			E('div', { 'style': 'font-size:11px;opacity:.5;margin:-6px 0 14px' }, [
				'传感器：', E('span', { 'id': 'hw-temp-src' }, '—'), ' · PWM：', E('span', { 'id': 'hw-pwm-raw' }, '—')
			]),
			E('div', { 'class': 'hw-card wide' }, [
				E('h3', {}, '实时状态'),
				E('div', { 'class': 'hw-bar' }, E('i', { 'id': 'hw-bar-i', 'style': 'width:0%' })),
				E('div', { 'style': 'margin-top:12px' }, [
					kv('当前模式', 'hw-profile-live', profileLabel(this.lastMode)),
					kv('控制器', 'hw-avail', '—'),
					kv('故障', 'hw-fault', '—')
				]),
				E('div', { 'class': 'hw-note' }, '故障为「无」即硬件正常；失速或超温时后端会自动满速保护。')
			]),
			E('div', { 'class': 'hw-card wide' }, [
				E('h3', {}, '调速模式'),
				E('div', { 'class': 'hw-seg' }, PROFILES.map(function(p) { return segBtn(p); })),
				E('select', { 'id': 'in-profile', 'style': 'display:none' }, PROFILES.map(function(p) {
					return E('option', { 'value': p[0], 'selected': (self.lastMode) === p[0] }, p[1]);
				})),
				E('div', { 'class': 'hw-foot' }, '自动/静音/均衡/性能 = 上游内置四档温控曲线；自定义曲线 = 使用下方你自己的温度/转速表。')
			]),
			curveCard,
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
