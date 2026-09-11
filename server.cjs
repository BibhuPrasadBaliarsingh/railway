const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
// Use an internal port for tileserver-gl to prevent port collision with main wrapper server
const TILESERVER_PORT = process.env.TILESERVER_PORT || (parseInt(PORT, 10) + 1);

// Determine configuration for tileserver-gl process
const configPath = path.join(__dirname, 'config.json');
let cliArgs = [];

if (fs.existsSync(configPath)) {
  cliArgs = ['--config', 'config.json', '--port', String(TILESERVER_PORT)];
} else {
  let mbtilesPath = '/data/bbsr.mbtiles';
  if (!fs.existsSync(mbtilesPath)) {
    mbtilesPath = path.join(__dirname, 'data', 'bbsr.mbtiles');
  }
  cliArgs = ['--mbtiles', mbtilesPath, '--port', String(TILESERVER_PORT)];
}

console.log(`Starting internal tileserver-gl with args: ${cliArgs.join(' ')} on port ${TILESERVER_PORT}...`);

let tileserverProcess;
if (fs.existsSync('/usr/src/app/docker-entrypoint.sh')) {
  // Use official maptiler docker-entrypoint script with bash
  tileserverProcess = spawn('/bin/bash', ['/usr/src/app/docker-entrypoint.sh', ...cliArgs], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(TILESERVER_PORT) }
  });
} else if (fs.existsSync('/usr/src/app/src/main.js')) {
  tileserverProcess = spawn(process.execPath, ['/usr/src/app/src/main.js', ...cliArgs], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(TILESERVER_PORT) }
  });
} else {
  let tileserverScript = null;
  try {
    tileserverScript = require.resolve('tileserver-gl/src/main.js');
  } catch (e) {
    try {
      tileserverScript = require.resolve('tileserver-gl');
    } catch (e2) {
      const localPath = path.join(__dirname, 'node_modules', 'tileserver-gl', 'src', 'main.js');
      if (fs.existsSync(localPath)) {
        tileserverScript = localPath;
      }
    }
  }

  if (tileserverScript) {
    tileserverProcess = spawn(process.execPath, [tileserverScript, ...cliArgs], {
      stdio: 'inherit',
      env: { ...process.env, PORT: String(TILESERVER_PORT) }
    });
  } else if (process.platform === 'win32') {
    tileserverProcess = spawn('cmd.exe', ['/c', 'npx', 'tileserver-gl', ...cliArgs], {
      stdio: 'inherit',
      env: { ...process.env, PORT: String(TILESERVER_PORT) }
    });
  } else {
    tileserverProcess = spawn('tileserver-gl', cliArgs, {
      stdio: 'inherit',
      env: { ...process.env, PORT: String(TILESERVER_PORT) }
    });
  }
}

tileserverProcess.on('error', (err) => {
  console.error('Failed to start internal tileserver-gl process:', err);
});

tileserverProcess.on('exit', (code, signal) => {
  if (code !== 0) {
    console.error(`Internal tileserver-gl exited with code ${code} and signal ${signal}`);
  }
});

function proxyRequest(req, res, retriesLeft = 10) {
  const options = {
    hostname: '127.0.0.1',
    port: TILESERVER_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: req.headers.host || `127.0.0.1:${TILESERVER_PORT}`,
      'x-forwarded-host': req.headers.host || '',
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'https'
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    if (retriesLeft > 0) {
      setTimeout(() => proxyRequest(req, res, retriesLeft - 1), 500);
    } else if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Tile server unavailable' }));
    }
  });

  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
}

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // Health-check endpoint
  const urlPath = req.url.split('?')[0];
  if (urlPath === '/api/health') {
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (req.method === 'HEAD') {
        return res.end();
      }
      return res.end(JSON.stringify({ status: 'ok' }));
    }
  }

  // Handle literal placeholder requests if frontend library attempts to fetch unpopulated template URL
  if (req.url.includes('%7Bz%7D') || req.url.includes('{z}')) {
    const jsonUrl = req.url.replace(/\/\{z\}\/\{x\}\/\{y\}\.pbf|\/%7Bz%7D\/%7Bx%7D\/%7By%7D\.pbf/, '.json');
    res.writeHead(302, { Location: jsonUrl });
    return res.end();
  }

  // Reverse proxy all other routes to tileserver-gl
  proxyRequest(req, res);
});

server.listen(PORT, () => {
  console.log(`Map server proxy listening on port ${PORT}`);
  console.log(`Health endpoint ready at GET /api/health`);
});
