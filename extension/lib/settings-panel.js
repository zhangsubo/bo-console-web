import { normalizeSettings } from './settings-model.js';
import { saveSettings } from './storage.js';
import { pairHelper, fetchSnapshot } from './api.js';

// Slide-in settings drawer on the new tab page.
// getSettings() returns current settings; onSave(normalized) applies saved settings live.
export function initSettingsPanel({ getSettings, onSave }) {
  const overlay = document.getElementById('settings-overlay');
  const panel = document.getElementById('settings-panel');
  const statusEl = document.getElementById('status-message');
  let draft = null;

  function cloneSettings(s) {
    return {
      ...s,
      watchedPorts: [...s.watchedPorts],
      shortcuts: s.shortcuts.map(x => ({ ...x })),
    };
  }

  function open() {
    draft = cloneSettings(getSettings());
    renderSettings(draft);
    hideStatus();
    overlay.classList.add('open');
    panel.classList.add('open');
    document.getElementById('close-settings').focus();
  }

  function close() {
    overlay.classList.remove('open');
    panel.classList.remove('open');
    hideStatus();
  }

  function showStatus(text, type = 'info') {
    statusEl.textContent = text;
    statusEl.className = `settings-status show ${type}`;
  }

  function hideStatus() {
    statusEl.className = 'settings-status';
    statusEl.textContent = '';
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
    document.getElementById('ports-per-page').value = s.portsPerPage;
    renderWatchedPorts();
    renderShortcuts();
  }

  function renderWatchedPorts() {
    const list = document.getElementById('watched-port-list');
    list.innerHTML = '';
    for (const port of draft.watchedPorts) {
      const tag = document.createElement('span');
      tag.className = 'port-tag';
      tag.append(port, ' ');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'port-tag-remove';
      remove.setAttribute('aria-label', `删除端口 ${port}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        draft.watchedPorts = draft.watchedPorts.filter(p => p !== port);
        renderWatchedPorts();
      });
      tag.appendChild(remove);
      list.appendChild(tag);
    }
  }

  function renderShortcuts() {
    const list = document.getElementById('shortcut-list');
    list.innerHTML = '';
    for (let i = 0; i < draft.shortcuts.length; i++) {
      const item = document.createElement('div');
      item.className = 'shortcut-editor-item';

      const fields = document.createElement('div');
      fields.className = 'shortcut-editor-fields';

      const nameInput = document.createElement('input');
      nameInput.className = 'form-input';
      nameInput.type = 'text';
      nameInput.placeholder = '名称';
      nameInput.value = draft.shortcuts[i].name || '';
      nameInput.addEventListener('change', () => { draft.shortcuts[i].name = nameInput.value; });

      const urlInput = document.createElement('input');
      urlInput.className = 'form-input';
      urlInput.type = 'url';
      urlInput.placeholder = 'URL';
      urlInput.value = draft.shortcuts[i].url || '';
      urlInput.addEventListener('change', () => { draft.shortcuts[i].url = urlInput.value; });

      fields.append(nameInput, urlInput);

      const actions = document.createElement('div');
      actions.className = 'shortcut-editor-actions';

      const up = document.createElement('button');
      up.type = 'button';
      up.title = '上移';
      up.setAttribute('aria-label', '上移');
      up.textContent = '↑';
      up.addEventListener('click', () => {
        if (i === 0) return;
        [draft.shortcuts[i - 1], draft.shortcuts[i]] = [draft.shortcuts[i], draft.shortcuts[i - 1]];
        renderShortcuts();
      });

      const down = document.createElement('button');
      down.type = 'button';
      down.title = '下移';
      down.setAttribute('aria-label', '下移');
      down.textContent = '↓';
      down.addEventListener('click', () => {
        if (i >= draft.shortcuts.length - 1) return;
        [draft.shortcuts[i], draft.shortcuts[i + 1]] = [draft.shortcuts[i + 1], draft.shortcuts[i]];
        renderShortcuts();
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'delete-btn';
      del.title = '删除';
      del.setAttribute('aria-label', '删除快捷入口');
      del.textContent = '×';
      del.addEventListener('click', () => {
        draft.shortcuts.splice(i, 1);
        renderShortcuts();
      });

      actions.append(up, down, del);
      item.append(fields, actions);
      list.appendChild(item);
    }
  }

  // Open / close
  document.getElementById('settings-link').addEventListener('click', open);
  document.getElementById('add-shortcut-entry').addEventListener('click', open);
  document.getElementById('close-settings').addEventListener('click', close);
  document.getElementById('cancel-settings').addEventListener('click', close);
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('open')) close();
  });

  // Add watched port
  const portInput = document.getElementById('watched-port');
  function addPort() {
    const port = Number(portInput.value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      portInput.focus();
      return;
    }
    if (!draft.watchedPorts.includes(port)) {
      draft.watchedPorts.push(port);
      renderWatchedPorts();
    }
    portInput.value = '';
  }
  document.getElementById('add-watched-port').addEventListener('click', addPort);
  portInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addPort();
    }
  });

  // Add shortcut
  document.getElementById('add-shortcut').addEventListener('click', () => {
    draft.shortcuts.push({ name: '', url: '', iconUrl: '' });
    renderShortcuts();
  });

  // Save
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const normalized = normalizeSettings({
      title: document.getElementById('title').value,
      greetingName: document.getElementById('greeting-name').value,
      searchEngine: document.getElementById('search-engine').value,
      nezhaBaseUrl: document.getElementById('nezha-base-url').value,
      watchedPorts: draft.watchedPorts,
      thresholds: {
        warning: Number(document.getElementById('warning-threshold').value),
        critical: Number(document.getElementById('critical-threshold').value),
      },
      refresh: {
        localSeconds: Number(document.getElementById('local-refresh').value),
        remoteSeconds: Number(document.getElementById('remote-refresh').value),
      },
      portsPerPage: Number(document.getElementById('ports-per-page').value),
      shortcuts: draft.shortcuts,
    });
    await saveSettings(normalized);
    draft = cloneSettings(normalized);
    onSave(normalized);
    showStatus('设置已保存', 'success');
  });

  // Test helper
  document.getElementById('test-helper').addEventListener('click', async () => {
    try {
      const token = await pairHelper();
      await fetchSnapshot({
        helperToken: token,
        nezhaBaseUrl: document.getElementById('nezha-base-url').value,
        include: 'all',
      });
      showStatus('Helper 已连接', 'success');
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
}
