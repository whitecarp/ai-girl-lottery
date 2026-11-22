window.postMessage({ source: 'ai-girl-lottery-bridge', type: 'BRIDGE_READY' }, '*');

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'FETCH_PROGRESS') {
    window.postMessage({ source: 'ai-girl-lottery-bridge', type: 'FETCH_PROGRESS', message: msg.message }, '*');
  }
});

window.addEventListener('message', (ev) => {
  if (!ev.data || ev.data.source !== 'ai-girl-lottery-page') return;
  if (ev.data.type === 'PING_BRIDGE') {
    window.postMessage({ source: 'ai-girl-lottery-bridge', type: 'BRIDGE_READY' }, '*');
    return;
  }
  if (ev.data.type === 'FETCH_COMMENTS' && (ev.data.input || ev.data.bvid)) {
    chrome.runtime.sendMessage(
      { type: 'FETCH_COMMENTS', input: ev.data.input || ev.data.bvid, bvid: ev.data.bvid },
      (res) => {
        if (chrome.runtime.lastError) {
          window.postMessage(
            {
              source: 'ai-girl-lottery-bridge',
              type: 'FETCH_ERROR',
              error: chrome.runtime.lastError.message,
            },
            '*'
          );
          return;
        }
        if (res?.ok) {
          window.postMessage({ source: 'ai-girl-lottery-bridge', type: 'FETCH_RESULT', payload: res.payload }, '*');
        } else {
          window.postMessage(
            { source: 'ai-girl-lottery-bridge', type: 'FETCH_ERROR', error: res?.error || '抓取失败' },
            '*'
          );
        }
      }
    );
  }
});
