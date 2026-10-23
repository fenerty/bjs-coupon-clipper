// Local DOM regression tests: node tests/serve-fixture.cjs, then open the printed URL.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8765');
  if (url.pathname === '/bjs-coupons.user.js') {
    let source = fs.readFileSync(path.join(root, 'bjs-coupons.user.js'), 'utf8');
    if (!req.headers.referer?.includes('case=paced')) {
      // Test delays are accelerated; the production file is never modified.
      source = source.replace('minClickIntervalMs: 450', 'minClickIntervalMs: 20');
    }
    source = source.replace('confirmationTimeoutMs: 8000', 'confirmationTimeoutMs: 500')
      .replace('scanSettleMs: 250', 'scanSettleMs: 30');
    res.setHeader('Content-Type', 'text/javascript');
    res.end(source);
  } else if (url.pathname === '/myCoupons') {
    res.setHeader('Content-Type', 'text/html');
    res.end(fs.readFileSync(path.join(__dirname, 'browser-fixture.html')));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(0, '127.0.0.1', () => {
  console.log('Fixture: http://127.0.0.1:' + server.address().port + '/myCoupons?case=205');
  console.log('Cases: 205, duplicate, legacy, removed, tab, disabled, background, timeout, rate-limit, stop, zero, paced');
});
