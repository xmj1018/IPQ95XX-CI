'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require rpc';
'require poll';
'require dom';

/*
 * BE10000 风扇与灯效控制台 - 全新界面
 * 后端完全引用 OWRT 上游 luci-app-xiaomi-control（xiaomi-control.uc），
 * 硬件操作（emc2305 PWM 风扇 + red/green/blue:ambient RGB）一字不改，保证生效。
 * 本文件只重做视觉与交互，config 段与 /var/run 状态字段与原版保持一致。
 */

const callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

const callSystemBoard = rpc.declare({ object: 'system', method: 'board', expect: { '': {} } });

const CARD_STYLE = 'border:1px solid var(--border-color,#d0d0d0);border-radius:10px;padding:1.2rem;margin-bottom:1.2rem;background:var(--box-background-color,#fff);box-shadow:0 1px 3px rgba(0,0,0,.08)';
const TITLE_STYLE = 'font-size:1.15rem;font-weight:600;margin:0 0 .9rem;display:flex;align-items:center;gap:.5rem';
const STATS_STYLE = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem;margin-bottom:1rem';
const STAT_STYLE = 'background:var(--background-color,#f5f6f7);border-radius:8px;padding:.7rem .9rem;border-left:3px solid var(--primary-color,#4a90d9)';
const STAT_LABEL = 'font-size:.8rem;opacity:.7;display:block;margin-bottom:.25rem';
const STAT_VAL = 'font-size:1.05rem;font-weight:600';

function stat(label, value, color) {
	return E('div', { 'style': STAT_STYLE + (color ? ';border-left-color:' + color : '') }, [
		E('span', { 'style': STAT_LABEL }, label),
		E('span', { 'style': STAT_VAL }, value)
	]);
}

function nfcOptions(section) {
	section.tab('nfc', 'NFC');
	let o = section.taboption('nfc', form.DummyValue, '_nfc_status', _('运行状态'));
	o.renderWidget = function() { return section.map.nfcStatus; };
	o = section.taboption('nfc', form.Flag, 'nfc_enabled', _('启用 NFC'),
		_('关闭 NFC 会清除标签内容；开机或无线设置变化时会自动恢复已保存内容。不支持仅 WPA3 的网络。'));
	o.default = '0';
	o.rmempty = false;
	function option(type, name, title, mode) {
		const value = section.taboption('nfc', type, 'nfc_' + name, title);
		value.retain = true;
		value.depends(mode ? { nfc_enabled: '1', nfc_mode: mode } : { nfc_enabled: '1' });
		return value;
	}
	const size = function(value) { return new TextEncoder().encode(value || '').length; };
	o = option(form.ListValue, 'mode', _('标签内容'));
	[ [ 'wifi', _('当前路由器 Wi-Fi') ], [ 'text', _('自定义文本') ],
		[ 'uri', _('网址链接 (URI)') ], [ 'manual', _('手动填写 Wi-Fi') ] ].forEach(function(entry) { o.value(entry[0], entry[1]); });
	o.default = 'wifi';
	o.rmempty = false;
	o = option(form.ListValue, 'iface', _('接入点 (AP)'), 'wifi');
	uci.sections('wireless', 'wifi-iface').forEach(function(ap) {
		if (ap.mode === 'ap') o.value(ap['.name'], '%s · %s'.format(ap.ssid || ap['.name'], ap.device || ''));
	});
	o.validate = function(section_id, value) {
		const ap = uci.get('wireless', value);
		const radios = ap && (Array.isArray(ap.device) ? ap.device : (ap.device || '').split(/\s+/));
		return !!(ap && ap.mode === 'ap' && ap.disabled !== '1' && radios.length &&
			radios.every(function(id) { return uci.get('wireless', id) && uci.get('wireless', id, 'disabled') !== '1'; }) &&
			/^(none|psk(?:\+tkip)?|psk2(?:\+(?:ccmp|aes))?|(?:psk|sae)-mixed(?:\+ccmp)?)$/.test(ap.encryption || 'none')) ||
			_('所选接入点不可用或加密方式不受支持。');
	};
	o = option(form.TextValue, 'text', _('自定义文本'), 'text');
	o.rows = 6;
	o.description = _('最多 1900 个 UTF-8 字节。');
	o.validate = function(section_id, value) { return (size(value) > 0 && size(value) <= 1900) || _('文本长度须为 1–1900 个 UTF-8 字节。'); };
	o = option(form.Value, 'uri', _('网址'), 'uri');
	o.placeholder = 'https://example.com';
	o.validate = function(section_id, value) {
		return (size(value) <= 1900 && /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s\x00-\x1f\x7f]*$/.test(value || '')) || _('请输入有效 URI，最多 1900 个 UTF-8 字节。');
	};
	o = option(form.Value, 'manual_ssid', _('网络名称 (SSID)'), 'manual');
	o.validate = function(section_id, value) { return (size(value) > 0 && size(value) <= 32) || _('SSID 长度须为 1–32 个 UTF-8 字节。'); };
	const security = option(form.ListValue, 'security', _('加密方式'), 'manual');
	security.value('wpa2', 'WPA2-Personal');
	security.value('none', _('无密码'));
	security.default = 'wpa2';
	security.rmempty = false;
	o = section.taboption('nfc', form.Value, 'nfc_manual_key', _('密码'));
	o.password = true;
	o.retain = true;
	o.depends({ nfc_enabled: '1', nfc_mode: 'manual', nfc_security: 'wpa2' });
	o.validate = function(section_id, value) {
		return ((size(value) >= 8 && size(value) <= 63) || /^[a-fA-F0-9]{64}$/.test(value || '')) || _('密码须为 8–63 个字节或 64 位十六进制数。');
	};
}

const ColorValue = form.Value.extend({
	renderWidget: function(section_id, option_index, cfgvalue) {
		const value = /^#[0-9a-fA-F]{6}$/.test(cfgvalue || '') ? cfgvalue : this.default;
		const widget = this.super('renderWidget', [ section_id, option_index, value ]);
		const input = widget.querySelector('input') || widget;
		const picker = E('input', {
			type: 'color', value: value, title: _('选择颜色'),
			style: 'width:3.5em;height:2.2em;margin-left:.5em;border:none;background:none;cursor:pointer',
			change: function(ev) {
				input.value = ev.target.value;
				input.dispatchEvent(new Event('change', { bubbles: true }));
			}
		});
		input.addEventListener('input', function() {
			if (/^#[0-9a-fA-F]{6}$/.test(input.value))
				picker.value = input.value;
		});
		return E('div', { style: 'display:flex;align-items:center;gap:.5em' }, [ widget, picker ]);
	}
});

function validateColor(section_id, value) {
	return /^#[0-9a-fA-F]{6}$/.test(value || '') || _('请输入 #RRGGBB 格式的颜色值。');
}

function validateTime(section_id, value) {
	return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value || '') || _('请输入 HH:MM 格式的时间。');
}

function fault(error) {
	const messages = {
		'fan-unavailable': _('风扇控制器不可用'),
		'temperature-unavailable': _('无法读取温度，正在请求风扇全速'),
		'pwm-read-failed': _('无法读取风扇输出，正在请求全速'),
		'pwm-write-failed': _('无法确认风扇输出，正在请求全速'),
		'fan-stalled': _('风扇堵转，正在请求全速'),
		'fan-control-failed': _('风扇控制异常，正在请求全速'),
		'led-write-failed': _('无法写入 RGB 灯光输出'),
		'led-control-failed': _('RGB 灯光控制异常')
	};
	return error ? (messages[error] || _('未知错误')) : _('无');
}

function nfcFault(error) {
	const rollback = ' NFC rollback failed.';
	const invalid = 'Invalid NFC option: ';
	if (error.endsWith(rollback))
		return '%s %s'.format(nfcFault(error.slice(0, -rollback.length)), _('NFC 回滚失败。'));
	if (error.startsWith(invalid))
		return _('NFC 选项无效：%s').format(error.slice(invalid.length));
	return _(error);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(uci.load('xiaomi-control'), null),
			L.resolveDefault(uci.load('wireless'), null),
			L.resolveDefault(callSystemBoard(), {})
		]);
	},

	updateStatus: function() {
		return Promise.all([
			L.resolveDefault(fs.read('/var/run/xiaomi-control.json'), ''),
			L.resolveDefault(callServiceList('xiaomi-control'), {}),
			L.resolveDefault(fs.read('/var/run/xiaomi-nfc.json'), '')
		]).then(L.bind(function(result) {
			const instances = result[1]['xiaomi-control']?.instances || {};
			const running = Object.keys(instances).some(function(key) { return instances[key].running; });
			let status = {};
			try {
				const parsed = JSON.parse(result[0]);
				if (parsed && typeof parsed == 'object') status = parsed;
			} catch (e) { /* Status not ready. */ }
			const fan = running ? (status.fan || {}) : {};
			const led = running ? (status.led || {}) : {};
			let nfc = {};
			try { nfc = JSON.parse(result[2]); } catch (e) { /* Not ready. */ }
			dom.content(this.nfcStatus, nfc.error ? nfcFault(nfc.error) : !nfc.available ? _('NFC 硬件不可用。') :
				nfc.enabled ? _('已写入 NFC 标签。') : _('NFC 已关闭。'));

			const reading = function(value, format) {
				return typeof value == 'number' && Number.isFinite(value) && value >= 0 ? format(value) : '-';
			};
			const badge = running ? '🟢 ' + _('运行中') : '🔴 ' + _('已停止');
			dom.content(this.fanBadge, badge);

			dom.content(this.fanStats, E('div', { 'style': STATS_STYLE }, [
				stat(_('温度'), reading(fan.temperature, function(v) { return '%.1f °C'.format(v / 1000); }), '#e0741a'),
				stat(_('风扇转速'), reading(fan.rpm, function(v) { return '%d RPM'.format(v); }), '#2e9e5b'),
				stat(_('PWM 输出'), reading(fan.pwm, function(v) { return '%d / 255 (%d%%)'.format(v, Math.round(v * 100 / 255)); }), '#4a90d9'),
				stat(_('最热传感器'), fan.sensor || '-', '#8e6fd0'),
				stat(_('有效传感器'), reading(fan.sensors, String), '#c05a9e'),
				stat(_('故障'), running && !status.fan ? _('正在收集数据…') : fault(fan.error),
					fan.error ? '#d04040' : '#2e9e5b')
			]));
			dom.content(this.ledStatus, running ? (!status.led ? _('正在收集数据…') :
				(led.error ? fault(led.error) : '🟢 ' + _('运行中'))) : '🔴 ' + _('已停止'));
		}, this));
	},

	render: function(data) {
		const m = new form.Map('xiaomi-control', _('风扇灯光控制'),
			_('小米 BE10000 风扇与灯光控制面板，实时数据自动刷新，修改后点应用即生效。'));
		const s = m.section(form.NamedSection, 'settings', 'control');
		s.addremove = false;
		this.fanStatus = E('div', {}, _('正在收集数据…'));
		this.fanStats = E('div', {}, _('正在收集数据…'));
		this.fanBadge = E('span', {}, '...');
		this.ledStatus = E('span', {}, _('正在收集数据…'));
		this.nfcStatus = m.nfcStatus = E('span', {}, _('正在收集数据…'));
		/* 不再硬编码板名：原先 xiaomi,be10000 的正则在板名变体/取值失败时
		   会让整个风扇+灯效控件区不渲染，表现为"菜单有、页面空"。
		   前端一律渲染，硬件是否可用由上游后端 xiaomi-control.uc 自行判断。 */
		if (true) {

			/* ---------- 风扇卡片 ---------- */
			s.tab('fan', _('🌀 风扇'));
			let o = s.taboption('fan', form.DummyValue, '_fan_badge', _('控制器状态'));
			o.renderWidget = L.bind(function() { return this.fanBadge; }, this);
			o = s.taboption('fan', form.DummyValue, '_fan_live', _('实时数据'));
			o.renderWidget = L.bind(function() { return this.fanStats; }, this);
			o = s.taboption('fan', form.ListValue, 'profile', _('风扇模式'),
				_('取所有有效温控区的最高温度，带迟滞、启动增压；异常时自动恢复全速。'));
			o.value('auto', _('自动（45–85 °C）'));
			o.value('quiet', _('静音（52–80 °C）'));
			o.value('balanced', _('均衡（45–75 °C）'));
			o.value('performance', _('性能（38–65 °C）'));
			o.default = 'auto';
			o.rmempty = false;

			/* ---------- 灯效卡片 ---------- */
			s.tab('led', _('💡 RGB 灯效'));
			o = s.taboption('led', form.DummyValue, '_led_status', _('控制器状态'));
			o.renderWidget = L.bind(function() { return E('span', { 'style': 'font-weight:600' }, this.ledStatus); }, this);
			o = s.taboption('led', form.Flag, 'enabled', _('启用 RGB 灯效'));
			o.default = o.enabled;
			o.rmempty = false;
			o = s.taboption('led', form.ListValue, 'mode', _('灯效模式'));
			[
				[ 'static', _('静态') ], [ 'breathe', _('呼吸') ],
				[ 'duotone', _('双色渐变') ], [ 'rainbow', _('彩虹') ],
				[ 'temperature', _('温度') ], [ 'cpu', _('CPU 负载') ], [ 'traffic', _('网络流量') ]
			].forEach(function(entry) { o.value(entry[0], entry[1]); });
			o.default = 'breathe';
			o.rmempty = false;
			o.depends('enabled', '1');

			function modes(option, values) {
				values.forEach(function(mode) { option.depends({ enabled: '1', mode: mode }); });
			}
			function slider(name, title, value, low, high, values) {
				const option = s.taboption('led', form.RangeSliderValue, name, title);
				option.min = low;
				option.max = high;
				option.step = 1;
				option.default = value;
				option.rmempty = false;
				option.formvalue = function(section_id) {
					const element = this.getUIElement(section_id);
					return element ? element.getValue() : null;
				};
				option.datatype = 'range(%d,%d)'.format(low, high);
				if (values) modes(option, values);
				else option.depends('enabled', '1');
				return option;
			}
			function timeOption(name, title, value, flag) {
				const option = s.taboption('led', form.Value, name, title);
				option.default = value;
				option.rmempty = false;
				option.validate = validateTime;
				const dependency = { enabled: '1' };
				dependency[flag] = '1';
				option.depends(dependency);
			}

			o = s.taboption('led', ColorValue, 'color', _('主色'));
			o.default = '#0000ff';
			o.rmempty = false;
			o.validate = validateColor;
			modes(o, [ 'static', 'breathe', 'duotone' ]);
			o = s.taboption('led', ColorValue, 'second_color', _('副色'));
			o.default = '#ff00aa';
			o.rmempty = false;
			o.validate = validateColor;
			modes(o, [ 'duotone' ]);
			slider('brightness', _('最高亮度'), '96', 0, 255);
			slider('minimum_brightness', _('最低亮度'), '8', 0, 255, [ 'breathe' ]);
			slider('speed', _('动画速度'), '5', 1, 10, [ 'breathe', 'duotone', 'rainbow' ]);
			slider('sensitivity', _('状态灵敏度'), '5', 1, 10, [ 'temperature', 'cpu', 'traffic' ]);
			o = s.taboption('led', form.Value, 'traffic_interface', _('流量接口'),
				_('网络逻辑接口或设备名，例如 wan 或 pppoe-wan。'));
			o.default = 'wan';
			o.rmempty = false;
			o.validate = function(section_id, value) {
				return /^[A-Za-z0-9_+.:@-]{1,15}$/.test(value || '') || _('请输入有效的接口或设备名，最多 15 个字符。');
			};
			modes(o, [ 'traffic' ]);

			o = s.taboption('led', form.Flag, 'schedule_enabled', _('定时灯效'),
				_('起止时间相同表示全天开启；时段可跨零点。'));
			o.rmempty = false;
			o.depends('enabled', '1');
			timeOption('on_time', _('开启时间'), '07:00', 'schedule_enabled');
			timeOption('off_time', _('关闭时间'), '23:30', 'schedule_enabled');
			o = s.taboption('led', form.Flag, 'night_enabled', _('夜间亮度'));
			o.rmempty = false;
			o.depends('enabled', '1');
			timeOption('night_start', _('夜间开始'), '22:00', 'night_enabled');
			timeOption('night_end', _('夜间结束'), '07:00', 'night_enabled');
			o = slider('night_brightness', _('夜间最高亮度'), '24', 0, 255, []);
			o.depends({ enabled: '1', night_enabled: '1' });
		}
		nfcOptions(s);

		return m.render().then(L.bind(function(node) {
			poll.add(L.bind(this.updateStatus, this), 5);
			return this.updateStatus().then(function() { return node; });
		}, this));
	}
});
