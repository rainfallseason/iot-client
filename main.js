const http = require('http');
const url = require('url');
const querystring = require('querystring');

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 共通レスポンス設定
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });

  // /move への POST
  if (pathname === '/move' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const data = querystring.parse(body);
      if (data.order === 'open' || data.order === 'close') {
        res.end(JSON.stringify({ result: 'ok', order: data.order }));
        // ドライバーに指示出し
      } else {
        res.end(JSON.stringify({ result: 'error', message: 'invalid order' }));
      }
    });
  }

  // /weather への GET
  else if (pathname === '/weather' && req.method === 'GET') {
    const { temp, humi, lat, lon } = // センサーから読み出したデータを構成
    res.end(JSON.stringify({
      temp: temp,
      humi: humi,
      lat: lat,
      lon: lon
    }));
  }

  // その他
  else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

// ポート3000で待機
server.listen(3000, () => {
  console.log('Server running');
});
