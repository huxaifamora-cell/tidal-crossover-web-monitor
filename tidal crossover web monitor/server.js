require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
//  IN-MEMORY STORE
//  This is where live data lives.
//  Your MT5 EA pushes updates to POST /api/update
//  The SSE stream pushes changes to all browsers instantly.
// ─────────────────────────────────────────────

const INDICES = [
  { id: "v5",      name: "Volatility 5 Index",          short: "V5",       vol: "low",    minLot: "0.001", minMargin: "$0.05", minSpread: "0.2"  },
  { id: "v10",     name: "Volatility 10 Index",         short: "V10",      vol: "low",    minLot: "0.001", minMargin: "$0.10", minSpread: "0.4"  },
  { id: "v15",     name: "Volatility 15 Index",         short: "V15",      vol: "low",    minLot: "0.001", minMargin: "$0.15", minSpread: "0.5"  },
  { id: "v25",     name: "Volatility 25 Index",         short: "V25",      vol: "medium", minLot: "0.001", minMargin: "$0.25", minSpread: "1.0"  },
  { id: "v30",     name: "Volatility 30 Index",         short: "V30",      vol: "medium", minLot: "0.001", minMargin: "$0.30", minSpread: "1.2"  },
  { id: "v50",     name: "Volatility 50 Index",         short: "V50",      vol: "medium", minLot: "0.001", minMargin: "$0.50", minSpread: "2.0"  },
  { id: "v75",     name: "Volatility 75 Index",         short: "V75",      vol: "high",   minLot: "0.001", minMargin: "$0.75", minSpread: "3.5"  },
  { id: "v90",     name: "Volatility 90 Index",         short: "V90",      vol: "high",   minLot: "0.001", minMargin: "$0.90", minSpread: "4.0"  },
  { id: "v100",    name: "Volatility 100 Index",        short: "V100",     vol: "high",   minLot: "0.001", minMargin: "$1.00", minSpread: "5.0"  },
  { id: "v5s",     name: "Volatility 5 (1s) Index",     short: "V5(1s)",   vol: "low",    minLot: "0.001", minMargin: "$0.05", minSpread: "0.1"  },
  { id: "v10s",    name: "Volatility 10 (1s) Index",    short: "V10(1s)",  vol: "low",    minLot: "0.001", minMargin: "$0.10", minSpread: "0.2"  },
  { id: "v15s",    name: "Volatility 15 (1s) Index",    short: "V15(1s)",  vol: "low",    minLot: "0.001", minMargin: "$0.15", minSpread: "0.3"  },
  { id: "v25s",    name: "Volatility 25 (1s) Index",    short: "V25(1s)",  vol: "medium", minLot: "0.001", minMargin: "$0.25", minSpread: "0.5"  },
  { id: "v30s",    name: "Volatility 30 (1s) Index",    short: "V30(1s)",  vol: "medium", minLot: "0.001", minMargin: "$0.30", minSpread: "0.7"  },
  { id: "v50s",    name: "Volatility 50 (1s) Index",    short: "V50(1s)",  vol: "medium", minLot: "0.001", minMargin: "$0.50", minSpread: "1.0"  },
  { id: "v75s",    name: "Volatility 75 (1s) Index",    short: "V75(1s)",  vol: "high",   minLot: "0.001", minMargin: "$0.75", minSpread: "2.0"  },
  { id: "v90s",    name: "Volatility 90 (1s) Index",    short: "V90(1s)",  vol: "high",   minLot: "0.001", minMargin: "$0.90", minSpread: "2.5"  },
  { id: "v100s",   name: "Volatility 100 (1s) Index",   short: "V100(1s)", vol: "high",   minLot: "0.001", minMargin: "$1.00", minSpread: "3.0"  },
  { id: "v150s",   name: "Volatility 150 (1s) Index",   short: "V150(1s)", vol: "high",   minLot: "0.001", minMargin: "$1.50", minSpread: "4.5"  },
  { id: "v250s",   name: "Volatility 250 (1s) Index",   short: "V250(1s)", vol: "high",   minLot: "0.001", minMargin: "$2.50", minSpread: "6.0"  },
];

// Default live state — overwritten when MT5 pushes real data
function defaultLiveState(idx) {
  return {
    bid: null,
    ask: null,
    spread: parseFloat(idx.minSpread),
    bias: { bull: 50, bear: 50 },
    signal: "neutral",           // "long" | "short" | "neutral"
    eaScannerActive: false,
    firstCrossAchieved: false,
    bbExpanding: false,
    isFlat: false,
    openTrades: 0,
    openProfit: 0,
    timeframes: [
      { tf: "M1",  status: "watch", label: "Waiting for data", signal: "neutral" },
      { tf: "M5",  status: "watch", label: "Waiting for data", signal: "neutral" },
      { tf: "M15", status: "watch", label: "Waiting for data", signal: "neutral" },
      { tf: "H1",  status: "watch", label: "Waiting for data", signal: "neutral" },
      { tf: "H4",  status: "watch", label: "Waiting for data", signal: "neutral" },
    ],
    lastUpdated: null,
  };
}

// Live data store: keyed by symbol id
const liveData = {};
INDICES.forEach(idx => { liveData[idx.id] = defaultLiveState(idx); });

// ─────────────────────────────────────────────
//  SSE CLIENTS
// ─────────────────────────────────────────────
const sseClients = new Set();

function broadcastUpdate(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach(res => {
    try { res.write(data); } catch(e) { sseClients.delete(res); }
  });
}

// ─────────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────────

// GET /api/indices — static index info
app.get('/api/indices', (req, res) => {
  res.json(INDICES);
});

// GET /api/live — full snapshot of all live states
app.get('/api/live', (req, res) => {
  const snapshot = {};
  INDICES.forEach(idx => { snapshot[idx.id] = liveData[idx.id]; });
  res.json(snapshot);
});

// GET /api/live/:id — single symbol live state
app.get('/api/live/:id', (req, res) => {
  const state = liveData[req.params.id];
  if (!state) return res.status(404).json({ error: 'Symbol not found' });
  res.json(state);
});

// POST /api/update — MT5 EA pushes data here
// Accepts single object OR array of objects
// Expected body (per symbol):
// {
//   "id": "v75",
//   "bid": 12345.67,
//   "ask": 12348.50,
//   "spread": 3.5,
//   "signal": "long",
//   "eaScannerActive": true,
//   "firstCrossAchieved": true,
//   "bbExpanding": true,
//   "isFlat": false,
//   "openTrades": 1,
//   "openProfit": 4.23,
//   "bias": { "bull": 65, "bear": 35 },
//   "timeframes": [
//     { "tf": "M1",  "status": "recent", "label": "Crossed 2m ago", "signal": "long" },
//     { "tf": "M5",  "status": "soon",   "label": "Approaching ~5m","signal": "long" },
//     { "tf": "M15", "status": "watch",  "label": "Monitoring",     "signal": "neutral" },
//     { "tf": "H1",  "status": "watch",  "label": "Monitoring",     "signal": "neutral" },
//     { "tf": "H4",  "status": "watch",  "label": "No signal",      "signal": "neutral" }
//   ]
// }

app.post('/api/update', (req, res) => {
  const updates = Array.isArray(req.body) ? req.body : [req.body];
  const changed = [];

  updates.forEach(update => {
    const { id, ...fields } = update;
    if (!id || !liveData[id]) return;
    liveData[id] = { ...liveData[id], ...fields, lastUpdated: new Date().toISOString() };
    changed.push({ id, data: liveData[id] });
  });

  if (changed.length > 0) {
    broadcastUpdate({ type: 'update', changed });
  }

  res.json({ ok: true, updated: changed.length });
});

// GET /api/stream — SSE endpoint for live browser updates
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering on Render

  // Send full snapshot immediately on connect
  res.write(`data: ${JSON.stringify({ type: 'snapshot', data: liveData })}\n\n`);

  sseClients.add(res);

  // Heartbeat every 20s to keep the connection alive through Render's proxy
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch(e) { /* ignore */ }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Health check for Render
app.get('/health', (req, res) => res.json({ status: 'ok', clients: sseClients.size, uptime: process.uptime() }));

// Serve index.html for all other routes (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ TidalCross server running on port ${PORT}`);
  console.log(`   SSE stream : /api/stream`);
  console.log(`   EA push    : POST /api/update`);
  console.log(`   Snapshot   : GET  /api/live`);
});
