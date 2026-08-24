import { normalizeSettings } from './lib/settings-model.js';
import { loadSettings, saveSettings } from './lib/storage.js';
import { pairHelper, fetchSnapshot } from './lib/api.js';

let currentSettings;

async function init() {
  currentSettings = await loadSettings();
  renderSettings(currentSettings);
}

function renderSettings(s) {
  document.getElementById('title').value = s.title;
  document.getElementById('greeting-name').value = s.greetingName;
  document.getElementById('search-engine').value = s.searchEngine;
  document.getElementById('nezha-base-url').value = s.nezhaBaseUrl;
  document.getElementById('warning-threshold').value = s.thresholds.warning;
  document.getElementById('critical-threshold').value = s.thresholds.critical;
  document.getElementById('local-refresh').value = s.refresh.localSeconds;
  document.getElementById('remote-refresh').value = s.refresh.remoteSeconds;
  renderWatchedPorts(s.watchedPorts);
  renderShortcuts(s.shortcuts);
}

function renderWatchedPorts(ports) {
  const list = document.getElementById('watched-port-list');
  list.innerHTML = '';
  for (const port of ports) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = port;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      currentSettings.watchedPorts = currentSettings.watchedPorts.filter(p => p !== port);
      renderWatchedPorts(currentSettings.watchedPorts);
    });
    tag.appendChild(remove);
    list.appendChild(tag);
  }
}

function renderShortcuts(shortcuts) {
  const list = document.getElementById('shortcut-list');
  list.innerHTML = '';
  for (let i = 0; i < shortcuts.length; i++) {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    row.draggable = true;
    row.dataset.index = i;

    const nameInput = document.createElement('input');
    nameInput.placeholder = '名称';
    nameInput.value = shortcuts[i].name || '';
    nameInput.addEventListener('change', () => { shortcuts[i].name = nameInput.value; });

    const urlInput = document.createElement('input');
    urlInput.placeholder = 'URL';
    urlInput.value = shortcuts[i].url || '';
    urlInput.addEventListener('change', () => { shortcuts[i].url = urlInput.value; });

    const iconInput = document.createElement('input');
    iconInput.placeholder = '图标 URL（可选）';
    iconInput.value = shortcuts[i].iconUrl || '';
    iconInput.addEventListener('change', () => { shortcuts[i].iconUrl = iconInput.value; });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      shortcuts.splice(i, 1);
      renderShortcuts(shortcuts);
    });

    row.append(nameInput, urlInput, iconInput, removeBtn);

    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(i));
    });
    row.addEventListener('dragover', (e) => { e.preventDefault(); });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData('text/plain'));
      const to = i;
      if (from !== to) {
        const [item] = shortcuts.splice(from, 1);
        shortcuts.splice(to, 0, item);
        renderShortcuts(shortcuts);
      }
    });

    list.appendChild(row);
  }
}

// Add watched port
document.getElementById('add-watched-port').addEventListener('click', () => {
  const input = document.getElementById('watched-port');
  const port = Number(input.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return;
  if (currentSettings.watchedPorts.includes(port)) return;
  currentSettings.watchedPorts.push(port);
  input.value = '';
  renderWatchedPorts(currentSettings.watchedPorts);
});

// Add shortcut
document.getElementById('add-shortcut').addEventListener('click', () => {
  currentSettings.shortcuts.push({ name: '', url: '', iconUrl: '' });
  renderShortcuts(currentSettings.shortcuts);
});

// Save
document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = {
    title: document.getElementById('title').value,
    greetingName: document.getElementById('greeting-name').value,
    searchEngine: document.getElementById('search-engine').value,
    nezhaBaseUrl: document.getElementById('nezha-base-url').value,
    watchedPorts: currentSettings.watchedPorts,
    thresholds: {
      warning: Number(document.getElementById('warning-threshold').value),
      critical: Number(document.getElementById('critical-threshold').value),
    },
    refresh: {
      localSeconds: Number(document.getElementById('local-refresh').value),
      remoteSeconds: Number(document.getElementById('remote-refresh').value),
    },
    shortcuts: currentSettings.shortcuts,
  };
  const normalized = normalizeSettings(s);
  await saveSettings(normalized);
  currentSettings = normalized;
  showStatus('设置已保存', 'success');
});

// Test helper
document.getElementById('test-helper').addEventListener('click', async () => {
  try {
    const token = await pairHelper();
    await fetchSnapshot({ helperToken: token, nezhaBaseUrl: currentSettings.nezhaBaseUrl, include: 'all' });
    showStatus('已连接', 'success');
  } catch (err) {
    if (err.message === 'helper_unreachable') {
      showStatus('Helper 未运行', 'error');
    } else if (err.message === 'helper_forbidden') {
      showStatus('扩展 ID 未授权', 'error');
    } else {
      showStatus(`连接失败: ${err.message}`, 'error');
    }
  }
});

function showStatus(text, type) {
  const el = document.getElementById('status-message');
  el.textContent = text;
  el.className = type;
}

init();
