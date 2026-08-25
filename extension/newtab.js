import { buildDashboardModel, filterPortRows, isLikelyHttpPort } from './lib/dashboard-model.js';
import { loadSettings } from './lib/storage.js';
import { pairHelper, fetchSnapshot } from './lib/api.js';
import { initSettingsPanel } from './lib/settings-panel.js';

let settings;
let helperToken;
let currentModel = null;
let lastSnapshot = null;
let portFilter = 'all';
let portPage = 1;
let localTimer = null;
let remoteTimer = null;

async function init() {
  settings = await loadSettings();
  renderHeader();
  renderShortcuts();

  // Try cached snapshot first
  const cached = await loadCached();
  if (cached) {
    lastSnapshot = cached;
    currentModel = buildDashboardModel(cached, settings);
    renderDashboard();
  }

  // Pair and fetch fresh data
  try {
    helperToken = await pairHelper();
    setHelperStatus(true);
    await refreshAll();
    startTimers();
  } catch (err) {
    setHelperStatus(false);
  }

  setupVisibilityHandler();
  setupKeyboard();
  setupPortFilters();
  setupDialog();
  setupRefresh();
  setupSearch();
  initSettingsPanel({ getSettings: () => settings, onSave: applySettings });
}

// Apply saved settings without a reload
function applySettings(next) {
  settings = next;
  document.title = settings.title;
  document.getElementById('page-title').textContent = settings.title;
  updateClock();
  renderShortcuts();
  const select = document.getElementById('search-engine-select');
  const match = Object.entries(SEARCH_ENGINES).find(([, url]) => url === settings.searchEngine);
  if (match) select.value = match[0];
  portPage = 1;
  if (lastSnapshot) {
    currentModel = buildDashboardModel(lastSnapshot, settings);
    renderDashboard();
  }
  if (helperToken) startTimers();
}

async function loadCached() {
  try {
    const { snapshot } = await chrome.storage.local.get('snapshot');
    return snapshot ?? null;
  } catch {
    return null;
  }
}

async function saveCache(snapshot) {
  try {
    await chrome.storage.local.set({ snapshot });
  } catch {}
}

function setHelperStatus(connected) {
  const badge = document.getElementById('helper-status');
  const age = currentModel?.localUpdatedAt ? ` · 数据更新于 ${formatAge(currentModel.localUpdatedAt)}` : '';
  if (connected) {
    badge.textContent = `● 本地 Helper 已连接${age}`;
    badge.className = 'helper-badge';
  } else {
    badge.textContent = '● 本地 Helper 未连接';
    badge.className = 'helper-badge disconnected';
  }
}

function renderHeader() {
  document.getElementById('page-title').textContent = settings.title;
  updateClock();
  setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = weekdays[now.getDay()];
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const clock = document.getElementById('clock');
  clock.textContent = '';
  clock.append(`${month} 月 ${day} 日 ${weekday}`, document.createElement('br'), `${hours}:${minutes}`);

  const greeting = document.getElementById('greeting');
  const h = now.getHours();
  const part = h < 5 ? '夜深了' : h < 12 ? '上午好' : h < 18 ? '下午好' : '晚上好';
  greeting.textContent = settings.greetingName ? `${part}，${settings.greetingName}` : part;
}

function renderShortcuts() {
  const nav = document.getElementById('shortcut-nav');
  nav.innerHTML = '';
  for (const s of settings.shortcuts) {
    const a = document.createElement('a');
    a.className = 'shortcut';
    a.href = s.url;
    a.title = s.name;

    const icon = document.createElement('span');
    icon.className = 'shortcut-icon';
    const img = document.createElement('img');
    if (s.iconUrl) {
      img.src = s.iconUrl;
    } else {
      try {
        img.src = new URL('/favicon.ico', s.url).href;
      } catch {
        img.src = '';
      }
    }
    img.alt = s.name;
    img.onerror = () => {
      img.remove();
      icon.textContent = getInitials(s.name);
    };
    icon.appendChild(img);

    const name = document.createElement('span');
    name.className = 'shortcut-name';
    name.textContent = s.name;

    a.append(icon, name);
    nav.appendChild(a);
  }
}

function getInitials(name) {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

function renderDashboard() {
  if (!currentModel) return;
  renderSummaryCards();
  renderContainers();
  renderPorts();
  renderServers();
  renderAttention();
  renderStatusFooter();
  if (helperToken) setHelperStatus(true);
}

function renderSummaryCards() {
  const m = currentModel;
  document.getElementById('docker-running').textContent = m.dockerSummary.running;
  document.getElementById('docker-stopped').textContent = m.dockerSummary.stopped;
  document.getElementById('port-total').textContent = m.portSummary.total;
  document.getElementById('port-listening').textContent = m.portSummary.listening;
  document.getElementById('port-missing').textContent = m.portSummary.missing;
  document.getElementById('server-online').textContent = m.serverSummary.online;
  document.getElementById('server-offline').textContent = m.serverSummary.offline;
  document.getElementById('server-avg-cpu').textContent = m.serverSummary.avgCpu != null ? `${m.serverSummary.avgCpu}%` : '-';
  document.getElementById('attention-count').textContent = m.attention.length;

  // Set severity on cards for color coding
  const portCard = document.getElementById('card-ports');
  const serverCard = document.getElementById('card-servers');
  const attentionCard = document.getElementById('card-attention');

  portCard.removeAttribute('data-severity');
  serverCard.removeAttribute('data-severity');
  attentionCard.removeAttribute('data-severity');

  if (m.portSummary.missing > 0) {
    portCard.dataset.severity = 'critical';
  }
  if (m.serverSummary.offline > 0) {
    serverCard.dataset.severity = 'critical';
  }
  if (m.attention.some(a => a.severity === 'critical')) {
    attentionCard.dataset.severity = 'critical';
  } else if (m.attention.some(a => a.severity === 'warning')) {
    attentionCard.dataset.severity = 'warning';
  }

  const serverAttention = m.attention.filter(a => a.code !== 'watched_port_missing').length;
  const portAttention = m.attention.filter(a => a.code === 'watched_port_missing').length;
  const parts = [];
  if (serverAttention) parts.push(`服务器 ${serverAttention}`);
  if (portAttention) parts.push(`端口 ${portAttention}`);
  document.getElementById('attention-breakdown').textContent = parts.join(' · ') || '无';
}

function metricClass(value, thresholds) {
  if (value >= thresholds.critical) return 'danger';
  if (value >= thresholds.warning) return 'warn';
  return '';
}

function renderContainers() {
  const list = document.getElementById('container-list');
  list.innerHTML = '';

  const allContainers = currentModel.localStatus === 'error' ? [] : currentModel.containers;
  document.getElementById('docker-view-all').textContent = `查看全部 ${allContainers.length}`;
  const visible = allContainers.slice(0, 5);

  if (allContainers.length === 0) {
    list.innerHTML = '<div class="empty-state">无容器</div>';
    return;
  }

  for (const c of visible) {
    const row = document.createElement('div');
    row.className = 'data-row';

    const main = document.createElement('div');
    main.className = 'row-main';
    const dot = document.createElement('span');
    dot.className = `status-dot ${c.state === 'running' ? 'good' : 'danger'}`;
    dot.setAttribute('aria-label', c.state === 'running' ? '运行中' : '已停止');
    const name = document.createElement('span');
    name.className = 'row-name';
    name.textContent = c.name;
    main.append(dot, name);

    const uptime = document.createElement('span');
    uptime.className = `row-muted${c.state === 'running' ? '' : ' danger'}`;
    uptime.textContent = c.state === 'running' ? `Up ${c.runningFor}` : c.status;

    const port = document.createElement('span');
    port.className = 'row-mono';
    port.textContent = c.state === 'running' && c.publishedPorts.length ? `:${c.publishedPorts.join(',')}` : '—';

    const usage = document.createElement('span');
    usage.className = 'row-mono';
    usage.textContent = c.state === 'running' ? `${c.cpuPercent}% / ${c.memoryPercent}%` : '—';

    row.append(main, uptime, port, usage);
    list.appendChild(row);
  }
}

function renderPorts() {
  const list = document.getElementById('port-list');
  list.innerHTML = '';

  const modeBadge = document.getElementById('port-mode-badge');
  const filters = document.getElementById('port-filters');
  const pagination = document.getElementById('port-pagination');

  if (settings.watchedPorts.length > 0) {
    modeBadge.textContent = '关注端口模式';
    modeBadge.className = 'badge';
    filters.style.display = 'none';
  } else {
    modeBadge.textContent = '';
    modeBadge.className = '';
    filters.style.display = '';
  }

  let rows = currentModel.portRows;
  if (settings.watchedPorts.length === 0) {
    rows = filterPortRows(rows, portFilter);
  }

  if (rows.length === 0) {
    list.innerHTML = '<div class="empty-state">无端口数据</div>';
    pagination.innerHTML = '';
    return;
  }

  // Pagination
  const perPage = settings.portsPerPage;
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  if (portPage > totalPages) portPage = totalPages;
  const start = (portPage - 1) * perPage;
  const pageRows = rows.slice(start, start + perPage);

  for (const row of pageRows) {
    const item = document.createElement('div');
    item.className = 'data-row';

    const main = document.createElement('div');
    main.className = 'row-main';
    const dot = document.createElement('span');
    dot.className = `status-dot ${row.listening ? 'good' : 'danger'}`;
    dot.setAttribute('aria-label', row.listening ? '监听中' : '未监听');
    const port = document.createElement('span');
    port.className = 'row-name';
    port.textContent = row.port;
    main.append(dot, port);

    const status = document.createElement('span');
    status.className = `row-muted ${row.listening ? 'good' : 'danger'}`;
    status.textContent = row.listening ? '监听' : '未监听';

    const source = document.createElement('span');
    source.className = 'row-mono';
    source.textContent = row.listening ? row.source || '系统进程' : '—';

    const process = document.createElement('span');
    process.className = 'row-mono';
    if (row.listening) {
      process.textContent = row.process || '—';
      if (isLikelyHttpPort(row.port)) {
        const link = document.createElement('a');
        link.className = 'row-link';
        link.href = `http://localhost:${row.port}`;
        link.target = '_blank';
        link.textContent = ' 打开 ↗';
        process.appendChild(link);
      }
    } else {
      process.textContent = '—';
    }

    item.append(main, status, source, process);
    list.appendChild(item);
  }

  renderPagination(pagination, totalPages, rows.length);
}

function renderPagination(container, totalPages, totalItems) {
  container.innerHTML = '';
  if (totalPages <= 1) return;

  const prev = document.createElement('button');
  prev.textContent = '‹';
  prev.disabled = portPage <= 1;
  prev.addEventListener('click', () => { portPage--; renderPorts(); });

  const info = document.createElement('span');
  info.className = 'page-info';
  info.textContent = `${portPage} / ${totalPages}`;

  const next = document.createElement('button');
  next.textContent = '›';
  next.disabled = portPage >= totalPages;
  next.addEventListener('click', () => { portPage++; renderPorts(); });

  const count = document.createElement('span');
  count.textContent = `共 ${totalItems} 个`;

  container.append(prev, info, next, count);
}

function renderServers() {
  const list = document.getElementById('server-list');
  list.innerHTML = '';

  if (currentModel.remoteStatus === 'unconfigured') {
    list.innerHTML = '<div class="empty-state">未配置哪吒监控</div>';
    return;
  }

  if (currentModel.servers.length === 0) {
    list.innerHTML = '<div class="empty-state">无服务器数据</div>';
    return;
  }

  // Sort: offline first, then by name
  const sorted = [...currentModel.servers].sort((a, b) => {
    if (a.online !== b.online) return a.online ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  for (const server of sorted) {
    const card = document.createElement('a');
    card.className = 'server-card';
    card.href = buildServerUrl(server.id);
    card.target = '_blank';

    const top = document.createElement('div');
    top.className = 'server-top';
    const nameWrap = document.createElement('div');
    nameWrap.className = 'server-name';
    const dot = document.createElement('span');
    dot.className = `status-dot ${server.online ? 'good' : 'danger'}`;
    dot.setAttribute('aria-label', server.online ? '在线' : '离线');
    const name = document.createElement('span');
    name.className = 'server-name-text';
    name.textContent = server.name;
    nameWrap.append(dot, name);
    const state = document.createElement('span');
    state.className = `row-mono${server.online ? '' : ' danger'}`;
    state.textContent = server.online ? '在线' : '离线';
    top.append(nameWrap, state);

    const metrics = document.createElement('div');
    metrics.className = 'server-metrics';

    if (server.online) {
      for (const [label, val] of [
        ['CPU', server.cpuPercent ?? 0],
        ['MEM', server.memoryPercent ?? 0],
        ['DISK', server.diskPercent ?? 0],
      ]) {
        const cls = metricClass(val, settings.thresholds);
        const item = document.createElement('div');
        item.className = 'metric-inline';

        const lbl = document.createElement('span');
        lbl.className = 'metric-label';
        lbl.textContent = label;

        const value = document.createElement('span');
        value.className = `metric-value${cls ? ` ${cls}` : ''}`;
        value.textContent = `${val}%`;

        const bar = document.createElement('span');
        bar.className = 'metric-bar';
        const fill = document.createElement('span');
        if (cls) fill.className = cls;
        fill.style.width = `${Math.min(100, val)}%`;
        bar.appendChild(fill);

        item.append(lbl, value, bar);
        metrics.appendChild(item);
      }

      const net = document.createElement('div');
      net.className = 'server-net';
      const up = document.createElement('span');
      up.textContent = `↑ ${formatBytes(server.netInSpeed)}/s`;
      const down = document.createElement('span');
      down.textContent = `↓ ${formatBytes(server.netOutSpeed)}/s`;
      net.append(up, down);
      metrics.appendChild(net);
    }

    card.append(top, metrics);
    list.appendChild(card);
  }
}

const ATTENTION_SOURCES = {
  watched_port_missing: '关注端口',
  server_offline: '哪吒监控',
  resource_critical: '资源阈值',
  resource_warning: '资源阈值',
};

function renderAttention() {
  const list = document.getElementById('attention-list');
  list.innerHTML = '';

  if (currentModel.attention.length === 0) {
    list.innerHTML = '<div class="empty-state">无异常</div>';
    return;
  }

  for (const item of currentModel.attention) {
    const row = document.createElement('div');
    row.className = `attention-item ${item.severity}`;

    const icon = document.createElement('span');
    icon.className = `attention-icon ${item.severity}`;
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '!';

    const copy = document.createElement('div');
    copy.className = 'attention-copy';
    const message = document.createElement('div');
    message.textContent = item.message;
    const time = document.createElement('div');
    time.className = 'attention-time';
    time.textContent = `当前 · ${ATTENTION_SOURCES[item.code] ?? '监控'}`;
    copy.append(message, time);

    row.append(icon, copy);
    list.appendChild(row);
  }
}

function renderStatusFooter() {
  const parts = [];
  if (currentModel.localUpdatedAt) {
    parts.push(`本机 ${formatAge(currentModel.localUpdatedAt)}`);
  }
  if (currentModel.remoteUpdatedAt) {
    parts.push(`服务器 ${formatAge(currentModel.remoteUpdatedAt)}`);
  }
  parts.push(`本机 ${settings.refresh.localSeconds}s · 服务器 ${settings.refresh.remoteSeconds}s 刷新`);
  document.getElementById('status-live').textContent = parts.join(' · ');
}

function formatAge(isoString) {
  const age = Math.round((Date.now() - new Date(isoString).getTime()) / 1000);
  if (age < 60) return `${age} 秒前`;
  if (age < 3600) return `${Math.floor(age / 60)} 分钟前`;
  return `${Math.floor(age / 3600)} 小时前`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildServerUrl(id) {
  if (!settings.nezhaBaseUrl) return '#';
  try {
    const url = new URL(settings.nezhaBaseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '#';
    return `${url.href.replace(/\/$/, '')}/dashboard/server/${id}`;
  } catch {
    return '#';
  }
}

async function refreshAll() {
  if (!helperToken) return;
  try {
    const snapshot = await fetchSnapshot({
      helperToken,
      nezhaBaseUrl: settings.nezhaBaseUrl,
      include: 'all',
    });
    await saveCache(snapshot);
    lastSnapshot = snapshot;
    currentModel = buildDashboardModel(snapshot, settings);
    renderDashboard();
  } catch (err) {
    if (err.message === 'helper_unreachable') {
      setHelperStatus(false);
    }
  }
}

async function refreshLocal() {
  if (!helperToken) return;
  try {
    const snapshot = await fetchSnapshot({
      helperToken,
      nezhaBaseUrl: settings.nezhaBaseUrl,
      include: 'local',
    });
    if (currentModel) {
      // Merge local data into existing model
      const merged = {
        local: snapshot.local,
        remote: { status: currentModel.remoteStatus, servers: currentModel.servers, updatedAt: currentModel.remoteUpdatedAt },
      };
      currentModel = buildDashboardModel(merged, settings);
      lastSnapshot = merged;
      await saveCache(merged);
      renderDashboard();
    }
  } catch {}
}

async function refreshRemote() {
  if (!helperToken) return;
  try {
    const snapshot = await fetchSnapshot({
      helperToken,
      nezhaBaseUrl: settings.nezhaBaseUrl,
      include: 'remote',
    });
    if (currentModel) {
      const merged = {
        local: { status: currentModel.localStatus, containers: currentModel.containers, ports: currentModel.portRows.filter(r => r.listening), updatedAt: currentModel.localUpdatedAt },
        remote: snapshot.remote,
      };
      currentModel = buildDashboardModel(merged, settings);
      lastSnapshot = merged;
      await saveCache(merged);
      renderDashboard();
    }
  } catch {}
}

function startTimers() {
  stopTimers();
  localTimer = setInterval(refreshLocal, settings.refresh.localSeconds * 1000);
  remoteTimer = setInterval(refreshRemote, settings.refresh.remoteSeconds * 1000);
}

function stopTimers() {
  if (localTimer) { clearInterval(localTimer); localTimer = null; }
  if (remoteTimer) { clearInterval(remoteTimer); remoteTimer = null; }
}

function setupVisibilityHandler() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshAll();
      startTimers();
    } else {
      stopTimers();
    }
  });
}

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      document.getElementById('search-input').focus();
    }
  });
}

const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=%s',
  baidu: 'https://www.baidu.com/s?wd=%s',
};

function setupSearch() {
  const form = document.getElementById('search-form');
  const select = document.getElementById('search-engine-select');

  // Initialize selector from settings
  const currentEngine = Object.entries(SEARCH_ENGINES).find(([, url]) => url === settings.searchEngine);
  select.value = currentEngine ? currentEngine[0] : 'google';

  select.addEventListener('change', () => {
    settings.searchEngine = SEARCH_ENGINES[select.value];
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;

    try {
      const url = new URL(query);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        window.open(query, '_blank');
        return;
      }
    } catch {}

    const searchUrl = settings.searchEngine.replace('%s', encodeURIComponent(query));
    window.open(searchUrl, '_blank');
  });
}

function setupPortFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      portFilter = btn.dataset.filter;
      portPage = 1;
      renderPorts();
    });
  });
}

function setupDialog() {
  const dialog = document.getElementById('container-dialog');
  document.getElementById('docker-view-all').addEventListener('click', () => {
    renderDialogContainers();
    dialog.showModal();
  });
  document.getElementById('close-dialog').addEventListener('click', () => {
    dialog.close();
  });
}

function renderDialogContainers() {
  const list = document.getElementById('container-dialog-list');
  list.innerHTML = '';
  const containers = currentModel.containers;
  for (const c of containers) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.className = 'data-row';

    const main = document.createElement('div');
    main.className = 'row-main';
    const dot = document.createElement('span');
    dot.className = `status-dot ${c.state === 'running' ? 'good' : 'danger'}`;
    const name = document.createElement('span');
    name.className = 'row-name';
    name.textContent = c.name;
    main.append(dot, name);

    const meta = document.createElement('span');
    meta.className = 'row-muted';
    meta.textContent = c.state === 'running' ? `Up ${c.runningFor}` : c.status;
    summary.append(main, meta);

    const body = document.createElement('div');
    body.className = 'detail-body';

    const fields = [
      ['镜像', c.image],
      ['容器 ID', c.id],
      ['端口映射', c.portMappings.length ? c.portMappings.join(', ') : '无'],
      ['创建时间', c.createdAt],
    ];
    for (const [label, val] of fields) {
      const p = document.createElement('div');
      const lbl = document.createElement('strong');
      lbl.textContent = `${label}: `;
      const span = document.createElement('span');
      span.textContent = val;
      p.append(lbl, span);
      body.appendChild(p);
    }

    details.append(summary, body);
    list.appendChild(details);
  }
}

function setupRefresh() {
  document.getElementById('refresh-button').addEventListener('click', () => {
    refreshAll();
  });
}

init();
