// Android WebView can omit the rendered results subtree from accessibility.
// Check the visible DOM title AND expected detail href, then use browser input
// to click that same visible link. The lab rejects absent/hidden/covered links.
var options = { headers: { Authorization: LAB_WEB_TOKEN } };
var result = typeof OPEN_RESULT !== 'undefined' && OPEN_RESULT === 'true'
  ? http.post(LAB_WEB_URL + '/search-result', { headers: options.headers, body: '{}' })
  : http.get(LAB_WEB_URL + '/search-result', options);
if (!result.ok || !json(result.body).visible) throw new Error('Search result validation failed: ' + result.body);
