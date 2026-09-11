const express = require('express');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
// Use an internal port for tileserver-gl to prevent port collision with main wrapper server
const TILESERVER_PORT = process.env.TILESERVER_PORT || (parseInt(PORT, 10) + 1);

// Enable CORS headers so external monitoring services can call the endpoint seamlessly
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Fast, lightweight health-check endpoint for Render keep-alive & monitoring
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Determine configuration and executable for internal tileserver-gl process
const configPath = path.join(__dirname, 'config.json');
const cliArgs = fs.existsSync(configPath)
  ? ['--config', 'config.json', '--port', String(TILESERVER_PORT)]
  : ['--mbtiles', 'data/bbsr.mbtiles', '--port', String(TILESERVER_PORT)];

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

console.log(`Starting internal tileserver-gl on port ${TILESERVER_PORT}...`);

let tileserverProcess;
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

tileserverProcess.on('error', (err) => {
  console.error('Failed to start internal tileserver-gl process:', err);
});

tileserverProcess.on('exit', (code, signal) => {
  if (code !== 0) {
    console.error(`Internal tileserver-gl exited with code ${code} and signal ${signal}`);
  }
});

// Reverse proxy all other routes to tileserver-gl
app.use((req, res) => {
  const options = {
    hostname: '127.0.0.1',
    port: TILESERVER_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: req.headers.host || `127.0.0.1:${TILESERVER_PORT}`
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Tile server unavailable' });
    }
  });

  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
});

app.listen(PORT, () => {
  console.log(`Map server proxy listening on port ${PORT}`);
  console.log(`Health endpoint ready at GET /api/health`);
});
