# TidalCross Ultimate v3 — Live Dashboard

Midnight navy/silver elite-tech dashboard for monitoring 20 Deriv Volatility Indices in real time.

## Stack
- **Server**: Node.js + Express
- **Live data**: Server-Sent Events (SSE) — no WebSocket needed
- **MT5 → Server**: HTTP POST via MT5 `WebRequest()`
- **Frontend**: Vanilla JS, no framework

---

## Deploy to Render

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "TidalCross dashboard"
git remote add origin https://github.com/YOUR_USERNAME/tidalcross.git
git push -u origin main
```

### 2. Create Web Service on Render
1. Go to https://render.com → New → **Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free (or paid for always-on)

### 3. Set Environment Variables on Render
In Render dashboard → Your Service → Environment:
```
API_KEY = your_secret_key_here
```
Use the same key in your MT5 EA (`TidalCross_WebPush.mqh` → `#define API_KEY`).

---

## MT5 EA Integration

### 1. Allow WebRequest in MT5
`Tools → Options → Expert Advisors → Allow WebRequest for listed URLs`
Add: `https://YOUR-APP.onrender.com`

### 2. Include the push helper
Copy `TidalCross_WebPush.mqh` into your MT5 `MQL5/Include/` folder.

In `TidalCross_Ultimate_v3.mq5`:
```mql5
#include <TidalCross_WebPush.mqh>
```

Update the URL in the .mqh file:
```mql5
#define DASHBOARD_URL "https://YOUR-APP.onrender.com/api/update"
#define API_KEY       "your_secret_key_here"
```

### 3. Call PushSymbolUpdate inside OnTick
After your signal logic per symbol, call:
```mql5
PushSymbolUpdate(sym, !IsTradingPaused, FirstCrossAchieved[i],
                 bbExpanding, isFlat, openTrades, openProfit, bullBiasCalc);
```

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/stream` | GET (SSE) | Live event stream for browsers |
| `/api/live` | GET | Full snapshot of all 20 indices |
| `/api/live/:id` | GET | Single index live state |
| `/api/update` | POST | MT5 pushes data here |
| `/api/indices` | GET | Static index definitions |
| `/health` | GET | Server health + SSE client count |

### POST /api/update body
```json
{
  "id": "v75",
  "bid": 12345.67,
  "ask": 12348.50,
  "spread": 3.5,
  "signal": "long",
  "eaScannerActive": true,
  "firstCrossAchieved": true,
  "bbExpanding": true,
  "isFlat": false,
  "openTrades": 1,
  "openProfit": 4.23,
  "bias": { "bull": 65, "bear": 35 },
  "timeframes": [
    { "tf": "M1",  "status": "recent", "label": "Crossed 2m ago",   "signal": "long" },
    { "tf": "M5",  "status": "soon",   "label": "Approaching ~5m",  "signal": "long" },
    { "tf": "M15", "status": "watch",  "label": "Monitoring",       "signal": "neutral" },
    { "tf": "H1",  "status": "watch",  "label": "Monitoring",       "signal": "neutral" },
    { "tf": "H4",  "status": "watch",  "label": "No signal",        "signal": "neutral" }
  ]
}
```
Send an array `[{...}, {...}]` to batch-update multiple indices at once.

### Symbol IDs
| Symbol | ID |
|---|---|
| Volatility 5 Index | `v5` |
| Volatility 10 Index | `v10` |
| Volatility 15 Index | `v15` |
| Volatility 25 Index | `v25` |
| Volatility 30 Index | `v30` |
| Volatility 50 Index | `v50` |
| Volatility 75 Index | `v75` |
| Volatility 90 Index | `v90` |
| Volatility 100 Index | `v100` |
| Volatility 5 (1s) Index | `v5s` |
| Volatility 10 (1s) Index | `v10s` |
| Volatility 15 (1s) Index | `v15s` |
| Volatility 25 (1s) Index | `v25s` |
| Volatility 30 (1s) Index | `v30s` |
| Volatility 50 (1s) Index | `v50s` |
| Volatility 75 (1s) Index | `v75s` |
| Volatility 90 (1s) Index | `v90s` |
| Volatility 100 (1s) Index | `v100s` |
| Volatility 150 (1s) Index | `v150s` |
| Volatility 250 (1s) Index | `v250s` |

---

## Note on Render Free Tier
Free services on Render **spin down after 15 minutes of inactivity**. The SSE stream will reconnect automatically on the frontend when the server wakes up. For always-on, upgrade to a paid plan ($7/mo).
