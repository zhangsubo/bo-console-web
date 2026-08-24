import { buildDashboardModel, filterPortRows, isLikelyHttpPort } from './lib/dashboard-model.js';
import { loadSettings } from './lib/storage.js';
import { pairHelper, fetchSnapshot } from './lib/api.js';

let settings;
let helperToken;
let currentModel = null;
let portFilter = 'all';
let localTimer = null;
let remoteTimer = null;

async function init() {
  settings = await loadSettings();
  renderHeader();
  renderShortcuts();

  // Try cached snapshot first
  const cached = await loadCached();
  if (cached) {
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
  if (connected) {
    badge.textContent = '已连接';
    badge.className = 'helper-badge';
  } else {
    badge.textContent = '未连接';
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
  document.getElementById('clock').textContent = `${month} 月 ${day} 日 ${weekday}  ${hours}:${minutes}`;

  // Greeting
  const hour = now.getHours();
  let greeting = '你好';
  if (hour < 6) greeting = '夜深了';
  else if (hour < 12) greeting = '上午好';
  else if (hour < 14) greeting = '中午好';
  else if (hour < 18) greeting = '下午好';
  else greeting = '晚上好';

  const name = settings.greetingName ? `，${settings.greetingName}` : '';
  document.getElementById('greeting').textContent = `${greeting}${name}`;
}

function renderShortcuts() {
  const nav = document.getElementById('shortcut-nav');
  nav.innerHTML = '';
  for (const s of settings.shortcuts) {
    const a = document.createElement('a');
    a.className = 'shortcut-item';
    a.href = s.url;
    a.title = s.name;

    const icon = document.createElement('div');
    icon.className = 'shortcut-icon';
    if (s.iconUrl) {
      const img = document.createElement('img');
      img.src = s.iconUrl;
      img.alt = s.name;
      img.onerror = () => {
        img.remove();
        icon.textContent = getInitials(s.name);
      };
      icon.appendChild(img);
    } else {
      const img = document.createElement('img');
      try {
        img.src = new URL('/favicon.ico', s.url).href;
      } catch {
        img.src = '';
      }
      img.alt = s.name;
      img.onerror = () => {
        img.remove();
        icon.textContent = getInitials(s.name);
      };
      icon.appendChild(img);
    }

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

  const serverAttention = m.attention.filter(a => a.code !== 'watched_port_missing').length;
  const portAttention = m.attention.filter(a => a.code === 'watched_port_missing').length;
  const parts = [];
  if (serverAttention) parts.push(`服务器 ${serverAttention}`);
  if (portAttention) parts.push(`端口 ${portAttention}`);
  document.getElementById('attention-breakdown').textContent = parts.join(' · ') || '无';
}

function renderContainers() {
  const list = document.getElementById('container-list');
  list.innerHTML = '';

  const allContainers = currentModel.localStatus === 'error' ? [] : currentModel.containers;
  const visible = allContainers.slice(0, 5);

  if (allContainers.length === 0) {
    list.innerHTML = '<div class="empty-state">无容器</div>';
    return;
  }

  for (const c of visible) {
    const row = document.createElement('div');
    row.className = 'item-row';
    const dot = document.createElement('span');
    dot.className = `dot ${c.state === 'running' ? 'running' : 'stopped'}`;
    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = c.name;
    const meta = document.createElement('span');
    meta.className = 'item-meta';
    meta.textContent = c.state === 'running'
      ? `Up ${c.runningFor}  ${c.publishedPorts.length ? ':' + c.publishedPorts.join(',') : ''}  CPU ${c.cpuPercent}% MEM ${c.memoryPercent}%`
      : c.status;
    row.append(dot, name, meta);
    list.appendChild(row);
  }
}

function renderPorts() {
  const list = document.getElementById('port-list');
  list.innerHTML = '';

  const modeBadge = document.getElementById('port-mode-badge');
  const filters = document.getElementById('port-filters');

  if (settings.watchedPorts.length > 0) {
    modeBadge.textContent = '关注端口模式';
    modeBadge.className = 'badge';
    filters.style.display = 'none';
  } else {
    modeBadge.textContent = '';
    filters.style.display = '';
  }

  let rows = currentModel.portRows;
  if (settings.watchedPorts.length === 0) {
    rows = filterPortRows(rows, portFilter);
  }

  if (rows.length === 0) {
    list.innerHTML = '<div class="empty-state">无端口数据</div>';
    return;
  }

  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'item-row';

    const dot = document.createElement('span');
    dot.className = `dot ${row.listening ? 'listening' : 'missing'}`;

    const port = document.createElement('span');
    port.className = 'item-name';
    port.textContent = row.port;

    const detail = document.createElement('span');
    detail.className = 'item-detail';
    detail.textContent = row.listening
      ? `${row.process}  ${row.pid || ''}  ${row.source}`
      : '未监听';

    const action = document.createElement('span');
    if (row.listening && isLikelyHttpPort(row.port)) {
      const link = document.createElement('a');
      link.href = `http://localhost:${row.port}`;
      link.target = '_blank';
      link.textContent = '打开';
      link.style.cssText = 'font-size:0.75rem;color:var(--color-accent);text-decoration:none;';
      action.appendChild(link);
    }

    item.append(dot, port, detail, action);
    list.appendChild(item);
  }
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

    const header = document.createElement('div');
    header.className = 'server-header';
    const dot = document.createElement('span');
    dot.className = `dot ${server.online ? 'online' : 'offline'}`;
    const name = document.createElement('span');
    name.textContent = server.name;
    header.append(dot, name);

    if (!server.online) {
      const badge = document.createElement('span');
      badge.className = 'badge critical';
      badge.textContent = '离线';
      header.appendChild(badge);
    }

    const metrics = document.createElement('div');
    metrics.className = 'server-metrics';

    if (server.online) {
      const cpuVal = server.cpuPercent ?? 0;
      const memVal = server.memoryPercent ?? 0;
      const diskVal = server.diskPercent ?? 0;

      for (const [label, val, threshold] of [
        ['CPU', cpuVal, settings.thresholds],
        ['MEM', memVal, settings.thresholds],
        ['DISK', diskVal, settings.thresholds],
      ]) {
        const span = document.createElement('span');
        span.textContent = `${label} ${val}%`;
        if (val >= threshold.critical) span.style.color = 'var(--color-critical)';
        else if (val >= threshold.warning) span.style.color = 'var(--color-warning)';
        metrics.appendChild(span);
      }

      const netIn = document.createElement('span');
      netIn.textContent = `↑ ${formatBytes(server.netInSpeed)}/s`;
      metrics.appendChild(netIn);

      const netOut = document.createElement('span');
      netOut.textContent = `↓ ${formatBytes(server.netOutSpeed)}/s`;
      metrics.appendChild(netOut);
    }

    card.append(header, metrics);
    list.appendChild(card);
  }
}

function renderAttention() {
  const list = document.getElementById('attention-list');
  list.innerHTML = '';

  if (currentModel.attention.length === 0) {
    list.innerHTML = '<div class="empty-state">无异常</div>';
    return;
  }

  for (const item of currentModel.attention) {
    const row = document.createElement('div');
    row.className = 'attention-item';
    const icon = document.createElement('span');
    icon.className = `attention-icon ${item.severity}`;
    icon.textContent = '!';
    const text = document.createElement('span');
    text.textContent = item.message;
    row.append(icon, text);
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
  parts.push(`本机 ${settings.refresh.localSeconds}s · 服务器 ${settings.refresh.remoteSeconds}s`);
  document.getElementById('status-live').textContent = parts.join(' · ');
}

function formatAge(isoString) {
  const age = Math.round((Date.now() - new Date(isoString).getTime()) / 1000);
  if (age < 60) return `${age} 秒前更新`;
  if (age < 3600) return `${Math.floor(age / 60)} 分钟前更新`;
  return `${Math.floor(age / 3600)} 小时前更新`;
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
    summary.className = 'item-row';
    const dot = document.createElement('span');
    dot.className = `dot ${c.state === 'running' ? 'running' : 'stopped'}`;
    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = c.name;
    const meta = document.createElement('span');
    meta.className = 'item-meta';
    meta.textContent = c.state === 'running' ? `Up ${c.runningFor}` : c.status;
    summary.append(dot, name, meta);

    const body = document.createElement('div');
    body.style.cssText = 'padding:0.5rem 0 0.5rem 1rem;font-size:0.75rem;color:var(--color-text-secondary);';
    body.innerHTML = '';

    const fields = [
      ['镜像', c.image],
      ['容器 ID', c.id],
      ['端口映射', c.portMappings.length ? c.portMappings.join(', ') : '无'],
      ['创建时间', c.createdAt],
    ];
    for (const [label, val] of fields) {
      const p = document.createElement('div');
      p.style.marginBottom = '0.25rem';
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
