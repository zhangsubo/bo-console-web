export const DEFAULT_SETTINGS = Object.freeze({
  title: 'BO Console',
  greetingName: '',
  searchEngine: 'https://www.google.com/search?q=%s',
  watchedPorts: [],
  portsPerPage: 15,
  nezhaBaseUrl: '',
  thresholds: { warning: 80, critical: 90 },
  refresh: { localSeconds: 10, remoteSeconds: 30 },
  shortcuts: [],
});

export function normalizeSettings(value) {
  const raw = value ?? {};
  const watchedPorts = Array.isArray(raw.watchedPorts)
    ? [...new Set(
        raw.watchedPorts
          .map(Number)
          .filter(p => Number.isInteger(p) && p >= 1 && p <= 65535),
      )]
    : [];

  const thresholds = raw.thresholds ?? {};
  const refresh = raw.refresh ?? {};

  return {
    title: typeof raw.title === 'string' && raw.title ? raw.title : DEFAULT_SETTINGS.title,
    greetingName: typeof raw.greetingName === 'string' ? raw.greetingName : DEFAULT_SETTINGS.greetingName,
    searchEngine: typeof raw.searchEngine === 'string' && raw.searchEngine ? raw.searchEngine : DEFAULT_SETTINGS.searchEngine,
    watchedPorts,
    portsPerPage: Number.isFinite(raw.portsPerPage) && raw.portsPerPage >= 5 ? raw.portsPerPage : DEFAULT_SETTINGS.portsPerPage,
    nezhaBaseUrl: typeof raw.nezhaBaseUrl === 'string' ? raw.nezhaBaseUrl : DEFAULT_SETTINGS.nezhaBaseUrl,
    thresholds: {
      warning: Number.isFinite(thresholds.warning) ? thresholds.warning : DEFAULT_SETTINGS.thresholds.warning,
      critical: Number.isFinite(thresholds.critical) ? thresholds.critical : DEFAULT_SETTINGS.thresholds.critical,
    },
    refresh: {
      localSeconds: Number.isFinite(refresh.localSeconds) ? refresh.localSeconds : DEFAULT_SETTINGS.refresh.localSeconds,
      remoteSeconds: Number.isFinite(refresh.remoteSeconds) ? refresh.remoteSeconds : DEFAULT_SETTINGS.refresh.remoteSeconds,
    },
    shortcuts: Array.isArray(raw.shortcuts) ? raw.shortcuts : DEFAULT_SETTINGS.shortcuts,
  };
}
