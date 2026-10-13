if (PLATFORM === 'android') {
  var snapshot = http.get(LAB_WEB_URL + '/snapshot', { headers: { Authorization: LAB_WEB_TOKEN } });
  console.log('LAB_NAVIGATION ' + snapshot.body);
}
