const HELPER_BASE = 'http://127.0.0.1:17321';

export async function pairHelper() {
  const stored = await chrome.storage.local.get('helperToken');
  if (stored.helperToken) {
    return stored.helperToken;
  }

  let response;
  try {
    response = await fetch(`${HELPER_BASE}/v1/pair`, {
      method: 'POST',
      headers: { Origin: `chrome-extension://${chrome.runtime.id}` },
    });
  } catch {
    throw new Error('helper_unreachable');
  }

  if (response.status === 403) {
    throw new Error('helper_forbidden');
  }
  if (!response.ok) {
    throw new Error(`helper_error_${response.status}`);
  }

  const body = await response.json();
  await chrome.storage.local.set({ helperToken: body.token });
  return body.token;
}

export async function fetchSnapshot({ helperToken, nezhaBaseUrl, include = 'all' }) {
  const headers = {
    Origin: `chrome-extension://${chrome.runtime.id}`,
    'X-Helper-Token': helperToken,
  };
  if (nezhaBaseUrl) {
    headers['X-Nezha-Base-Url'] = nezhaBaseUrl;
  }

  let response;
  try {
    response = await fetch(`${HELPER_BASE}/v1/snapshot?include=${include}`, { headers });
  } catch {
    throw new Error('helper_unreachable');
  }

  if (response.status === 401) {
    throw new Error('helper_unauthorized');
  }
  if (response.status === 403) {
    throw new Error('helper_forbidden');
  }
  if (!response.ok) {
    throw new Error(`helper_error_${response.status}`);
  }

  return response.json();
}
