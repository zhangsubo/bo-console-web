import { normalizeSettings } from './settings-model.js';

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings);
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export async function loadCachedSnapshot() {
  const { snapshot } = await chrome.storage.local.get('snapshot');
  return snapshot ?? null;
}

export async function saveCachedSnapshot(snapshot) {
  await chrome.storage.local.set({ snapshot });
}
