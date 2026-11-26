/*
 * luci-app-partexp-plus - 分区扩容增强
 * 基于官方 sirpdboy/luci-app-partexp 之上，补充：安全拔盘(撤销扩容) / 减容
 * 扩容本身仍调用官方 /usr/bin/partexp，本页只做增强操作。
 */

'use strict';

'require rpc';
'require ui';
'require view';

var callList = rpc.declare({ object: 'partexp-plus', method: 'list_disks' });
var callExpand = rpc.declare({ object: 'partexp-plus', method: 'expand', params: ['disk'] });
var callUndo = rpc.declare({ object: 'partexp-plus', method: 'undo', params: ['disk'] });
var callShrink = rpc.declare({ object: 'partexp-plus', method: 'shrink', params: ['disk', 'size_mb'] });
var callLog = rpc.declare({ object: 'partexp-plus', method: 'get_log' });

return view.extend({
    load: function() {
        return Promise.all([callList(), callLog()]);
    },

    render: function(data) {
        var disks = (data && data[0] && data[0].disks) || [];
        var log = (data && data[1] && data[1].log) || '';

        var root = E('div', { 'class': 'cbi-map' });
        var html = [];

        html.push('<h2 name="content">分区扩容增强</h2>');
        html.push('<div class="cbi-section-descr">扩容调用官方 partexp；此处额外提供<strong>撤销扩容(安全拔盘)</strong>与<strong>减容</strong>。减容有数据风险，操作前务必备份。</div>');

        html.push('<fieldset class="cbi-section"><legend>目标硬盘</legend>');
        html.push('<div class="cbi-value"><label class="cbi-value-title">选择磁盘</label><div class="cbi-value-field">');
        html.push('<select class="cbi-input-select" id="pp-disk">');
        if (disks.length === 0) {
            html.push('<option value="">未发现可用磁盘（请确认 U 盘已插入并被识别）</option>');
        } else {
            disks.forEach(function(d) {
                var tag = d.overlay == 1 ? ' [当前用于 overlay]' : '';
                html.push('<option value="' + d.name + '">' + d.name + ' (' + d.dev + ', ' + d.size + ' MB, ' + (d.model || 'unknown') + ')' + tag + '</option>');
            });
        }
        html.push('</select></div></div>');
        html.push('<div class="cbi-value"><label class="cbi-value-title">当前挂载</label><div class="cbi-value-field"><span id="pp-mounted">' +
            (disks.length ? (disks[0].mounted || '(none)') : '(none)') + '</span></div></div>');
        html.push('</fieldset>');

        html.push('<fieldset class="cbi-section"><legend>一键扩容（官方）</legend>');
        html.push('<div class="cbi-section-descr">把所选磁盘扩容并挂载到 /overlay /opt 等，保留配置勾选沿用官方页面。</div>');
        html.push('<button class="cbi-button cbi-button-apply" id="pp-expand">调用官方扩容</button>');
        html.push('</fieldset>');

        html.push('<fieldset class="cbi-section"><legend>撤销扩容 / 安全拔盘</legend>');
        html.push('<div class="cbi-section-descr">删除 fstab 中指向该盘的挂载项并卸载分区，<strong>不删除 U 盘数据</strong>。完成后建议重启，让 /overlay 回到内置闪存，然后即可拔盘。</div>');
        html.push('<button class="cbi-button cbi-button-negative" id="pp-undo">撤销并卸载</button>');
        html.push('</fieldset>');

        html.push('<fieldset class="cbi-section"><legend>减容（高级 / 危险）</legend>');
        html.push('<div class="cbi-value"><label class="cbi-value-title">目标大小(MB)</label><div class="cbi-value-field">');
        html.push('<input type="text" class="cbi-input-text" id="pp-size" value="" placeholder="例如 8192" /></div></div>');
        html.push('<div class="cbi-section-descr">把所选磁盘最后一个分区缩小到指定大小。执行前会卸载并检查文件系统；<strong>请先备份数据</strong>。</div>');
        html.push('<button class="cbi-button cbi-button-negative" id="pp-shrink">执行减容</button>');
        html.push('</fieldset>');

        html.push('<fieldset class="cbi-section"><legend>操作日志</legend>');
        html.push('<textarea class="cbi-input-textarea" id="pp-log" readonly="readonly" rows="14" style="width:100%;font-family:monospace;">' + log.replace(/</g, '&lt;') + '</textarea>');
        html.push('<button class="cbi-button" id="pp-refresh">刷新日志</button>');
        html.push('</fieldset>');

        root.innerHTML = html.join('');

        var sel = root.querySelector('#pp-disk');
        var logBox = root.querySelector('#pp-log');
        var mounted = root.querySelector('#pp-mounted');

        function selected() {
            return sel ? sel.value : '';
        }
        function refreshLog() {
            return callLog().then(function(r) {
                if (logBox) logBox.value = (r && r.log) || '';
            });
        }
        function notify(title, text, type) {
            ui.addNotification({ title: title, text: text, type: type || 'info', delay: 6000 });
        }
        function needDisk() {
            var d = selected();
            if (!d) { notify('未选择磁盘', '请先插入并选择目标磁盘', 'warning'); return null; }
            return d;
        }

        sel && sel.addEventListener('change', function() {
            var d = null;
            disks.forEach(function(x) { if (x.name === selected()) d = x; });
            if (mounted && d) mounted.textContent = d.mounted || '(none)';
        });

        root.querySelector('#pp-expand') && root.querySelector('#pp-expand').addEventListener('click', function() {
            var d = needDisk(); if (!d) return;
            if (!confirm('确定调用官方 partexp 把 ' + d + ' 扩容并挂载？\n可能改变分区与 /overlay，请先备份。')) return;
            callExpand(d).then(function(r) {
                notify('扩容', (r && r.message) || (r && r.error) || '已提交', (r && r.error) ? 'error' : 'success');
                return refreshLog();
            }).catch(function(e) { notify('扩容失败', String(e), 'error'); });
        });

        root.querySelector('#pp-undo') && root.querySelector('#pp-undo').addEventListener('click', function() {
            var d = needDisk(); if (!d) return;
            if (!confirm('确定撤销 ' + d + ' 的挂载配置并卸载？\n不会删除 U 盘数据，但建议随后重启路由器。')) return;
            callUndo(d).then(function(r) {
                notify('撤销扩容', (r && r.message) || (r && r.error) || '已完成', (r && r.error) ? 'error' : 'success');
                return refreshLog();
            }).catch(function(e) { notify('撤销失败', String(e), 'error'); });
        });

        root.querySelector('#pp-shrink') && root.querySelector('#pp-shrink').addEventListener('click', function() {
            var d = needDisk(); if (!d) return;
            var sz = root.querySelector('#pp-size').value.trim();
            if (!/^[0-9]+$/.test(sz) || parseInt(sz, 10) < 64) {
                notify('参数错误', '目标大小须为不小于 64 的整数 MB', 'warning'); return;
            }
            if (!confirm('危险操作：把 ' + d + ' 最后一个分区缩小到 ' + sz + 'MB。\n此操作可能丢失数据，确认已备份？')) return;
            callShrink(d, sz).then(function(r) {
                notify('减容', (r && r.message) || (r && r.error) || '已提交', (r && r.error) ? 'error' : 'success');
                return refreshLog();
            }).catch(function(e) { notify('减容失败', String(e), 'error'); });
        });

        root.querySelector('#pp-refresh') && root.querySelector('#pp-refresh').addEventListener('click', function() {
            refreshLog();
        });

        return root;
    }
});
