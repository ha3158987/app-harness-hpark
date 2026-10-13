// Maestro's Android inputText cannot type Unicode. Keep the Korean query and
// insert it into the focused WebView input using the lab's existing CDP path.
var result = http.post(LAB_WEB_URL + '/type', {
  headers: { Authorization: LAB_WEB_TOKEN },
  body: JSON.stringify({ text: SEARCH_QUERY })
});
if (!result.ok) throw new Error('WebView Unicode input failed: ' + result.body);
