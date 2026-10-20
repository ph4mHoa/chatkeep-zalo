// Offscreen document: service workers cannot create blob: URLs, so export text becomes a blob here.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return;
  if (msg.type === 'blob') sendResponse({ url: URL.createObjectURL(new Blob([msg.text], { type: msg.mime })) });
  else if (msg.type === 'revoke') { URL.revokeObjectURL(msg.url); sendResponse({}); }
});
