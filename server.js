const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
//  IN-MEMORY STORE
// ─────────────────────────────────────────────
const INDICES = [
  { id:"v5",    name:"Volatility 5 Index",         short:"V5",       vol:"low",    minLot:"0.001", minMargin:"$0.05", minSpread:"0.2"  },
  { id:"v10",   name:"Volatility 10 Index",        short:"V10",      vol:"low",    minLot:"0.001", minMargin:"$0.10", minSpread:"0.4"  },
  { id:"v15",   name:"Volatility 15 Index",        short:"V15",      vol:"low",    minLot:"0.001", minMargin:"$0.15", minSpread:"0.5"  },
  { id:"v25",   name:"Volatility 25 Index",        short:"V25",      vol:"medium", minLot:"0.001", minMargin:"$0.25", minSpread:"1.0"  },
  { id:"v30",   name:"Volatility 30 Index",        short:"V30",      vol:"medium", minLot:"0.001", minMargin:"$0.30", minSpread:"1.2"  },
  { id:"v50",   name:"Volatility 50 Index",        short:"V50",      vol:"medium", minLot:"0.001", minMargin:"$0.50", minSpread:"2.0"  },
  { id:"v75",   name:"Volatility 75 Index",        short:"V75",      vol:"high",   minLot:"0.001", minMargin:"$0.75", minSpread:"3.5"  },
  { id:"v90",   name:"Volatility 90 Index",        short:"V90",      vol:"high",   minLot:"0.001", minMargin:"$0.90", minSpread:"4.0"  },
  { id:"v100",  name:"Volatility 100 Index",       short:"V100",     vol:"high",   minLot:"0.001", minMargin:"$1.00", minSpread:"5.0"  },
  { id:"v5s",   name:"Volatility 5 (1s) Index",    short:"V5(1s)",   vol:"low",    minLot:"0.001", minMargin:"$0.05", minSpread:"0.1"  },
  { id:"v10s",  name:"Volatility 10 (1s) Index",   short:"V10(1s)",  vol:"low",    minLot:"0.001", minMargin:"$0.10", minSpread:"0.2"  },
  { id:"v15s",  name:"Volatility 15 (1s) Index",   short:"V15(1s)",  vol:"low",    minLot:"0.001", minMargin:"$0.15", minSpread:"0.3"  },
  { id:"v25s",  name:"Volatility 25 (1s) Index",   short:"V25(1s)",  vol:"medium", minLot:"0.001", minMargin:"$0.25", minSpread:"0.5"  },
  { id:"v30s",  name:"Volatility 30 (1s) Index",   short:"V30(1s)",  vol:"medium", minLot:"0.001", minMargin:"$0.30", minSpread:"0.7"  },
  { id:"v50s",  name:"Volatility 50 (1s) Index",   short:"V50(1s)",  vol:"medium", minLot:"0.001", minMargin:"$0.50", minSpread:"1.0"  },
  { id:"v75s",  name:"Volatility 75 (1s) Index",   short:"V75(1s)",  vol:"high",   minLot:"0.001", minMargin:"$0.75", minSpread:"2.0"  },
  { id:"v90s",  name:"Volatility 90 (1s) Index",   short:"V90(1s)",  vol:"high",   minLot:"0.001", minMargin:"$0.90", minSpread:"2.5"  },
  { id:"v100s", name:"Volatility 100 (1s) Index",  short:"V100(1s)", vol:"high",   minLot:"0.001", minMargin:"$1.00", minSpread:"3.0"  },
  { id:"v150s", name:"Volatility 150 (1s) Index",  short:"V150(1s)", vol:"high",   minLot:"0.001", minMargin:"$1.50", minSpread:"4.5"  },
  { id:"v250s", name:"Volatility 250 (1s) Index",  short:"V250(1s)", vol:"high",   minLot:"0.001", minMargin:"$2.50", minSpread:"6.0"  },
];

function defaultLiveState(idx) {
  return {
    bid:null, ask:null,
    spread:parseFloat(idx.minSpread),
    bias:{bull:50,bear:50},
    signal:"neutral",
    eaScannerActive:false, firstCrossAchieved:false, bbExpanding:false, isFlat:false,
    openTrades:0, openProfit:0,
    timeframes:[
      {tf:"M1", status:"watch",label:"Waiting for data",signal:"neutral"},
      {tf:"M5", status:"watch",label:"Waiting for data",signal:"neutral"},
      {tf:"M15",status:"watch",label:"Waiting for data",signal:"neutral"},
      {tf:"H1", status:"watch",label:"Waiting for data",signal:"neutral"},
      {tf:"H4", status:"watch",label:"Waiting for data",signal:"neutral"},
    ],
    lastUpdated:null,
  };
}

const liveData = {};
INDICES.forEach(idx => { liveData[idx.id] = defaultLiveState(idx); });

// ─────────────────────────────────────────────
//  SSE
// ─────────────────────────────────────────────
const sseClients = new Set();
function broadcastUpdate(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach(res => { try { res.write(data); } catch(e) { sseClients.delete(res); } });
}

// ─────────────────────────────────────────────
//  API ROUTES
// ─────────────────────────────────────────────
app.get('/api/indices', (req,res) => res.json(INDICES));

app.get('/api/live', (req,res) => {
  const snap = {}; INDICES.forEach(idx => { snap[idx.id] = liveData[idx.id]; }); res.json(snap);
});

app.get('/api/live/:id', (req,res) => {
  const s = liveData[req.params.id];
  if(!s) return res.status(404).json({error:'Symbol not found'});
  res.json(s);
});

app.post('/api/update', (req,res) => {
  const updates = Array.isArray(req.body) ? req.body : [req.body];
  const changed = [];
  updates.forEach(update => {
    const {id,...fields} = update;
    if(!id || !liveData[id]) return;
    liveData[id] = {...liveData[id],...fields, lastUpdated:new Date().toISOString()};
    changed.push({id, data:liveData[id]});
  });
  if(changed.length > 0) broadcastUpdate({type:'update', changed});
  res.json({ok:true, updated:changed.length});
});

app.get('/api/stream', (req,res) => {
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  res.setHeader('X-Accel-Buffering','no');
  res.write(`data: ${JSON.stringify({type:'snapshot',data:liveData})}\n\n`);
  sseClients.add(res);
  const hb = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch(e) {} }, 20000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

app.get('/health', (req,res) => res.json({status:'ok',clients:sseClients.size,uptime:process.uptime()}));

// ─────────────────────────────────────────────
//  INLINED HTML  (no public/ folder needed)
// ─────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TidalCross Ultimate &mdash; Volatility Intelligence</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=Rajdhani:wght@300;400;500;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
<style>
:root{--navy-deep:#050d1a;--navy-card:#0d1e38;--silver-dim:#5a7090;--silver-mid:#8aa0bc;--silver-hi:#c8d8eb;--silver-glow:#ddeeff;--accent-gold:#c8a96e;--accent-blue:#3d9bff;--accent-cyan:#00d4ff;--high-red:#ff4f6e;--med-amber:#ffb347;--low-green:#3dffb0;--border:rgba(136,170,210,0.12);--border-hi:rgba(200,217,235,0.25);--glow-blue:rgba(61,155,255,0.15)}
*{margin:0;padding:0;box-sizing:border-box}html{scroll-behavior:smooth}
body{background:var(--navy-deep);color:var(--silver-hi);font-family:'Rajdhani',sans-serif;min-height:100vh;overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(61,155,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(61,155,255,.03) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0}
.orb{position:fixed;border-radius:50%;filter:blur(120px);opacity:.12;pointer-events:none;z-index:0}
.orb-1{width:600px;height:600px;background:#1a4fff;top:-200px;left:-200px}
.orb-2{width:500px;height:500px;background:#004488;bottom:-150px;right:-100px}
.orb-3{width:300px;height:300px;background:#00aaff;top:40%;left:50%;transform:translateX(-50%);opacity:.06}
header{position:sticky;top:0;z-index:100;padding:0 40px;border-bottom:1px solid var(--border);background:rgba(5,13,26,.9);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:space-between;height:80px}
.logo-block{display:flex;align-items:center;gap:16px}
.logo-icon{width:42px;height:42px;border:1px solid var(--accent-gold);display:flex;align-items:center;justify-content:center;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:linear-gradient(135deg,rgba(200,169,110,.15),rgba(200,169,110,.05));color:var(--accent-gold);font-size:18px}
.logo-text{display:flex;flex-direction:column}
.logo-title{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:600;color:var(--silver-glow);letter-spacing:2px}
.logo-sub{font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--accent-gold);letter-spacing:4px;text-transform:uppercase}
.header-right{display:flex;align-items:center;gap:28px}
.conn-badge{display:flex;align-items:center;gap:8px;font-family:'Share Tech Mono',monospace;font-size:11px;letter-spacing:2px;padding:6px 14px;border:1px solid;transition:all .3s}
.conn-badge.connected{color:var(--low-green);border-color:rgba(61,255,176,.3);background:rgba(61,255,176,.06)}
.conn-badge.disconnected{color:var(--high-red);border-color:rgba(255,79,110,.3);background:rgba(255,79,110,.06)}
.conn-badge.connecting{color:var(--med-amber);border-color:rgba(255,179,71,.3);background:rgba(255,179,71,.06)}
.pulse-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.connected .pulse-dot{background:var(--low-green);box-shadow:0 0 0 0 rgba(61,255,176,.6);animation:pulse-ring 2s infinite}
.disconnected .pulse-dot{background:var(--high-red)}
.connecting .pulse-dot{background:var(--med-amber);animation:blink 1s infinite}
@keyframes pulse-ring{0%{box-shadow:0 0 0 0 rgba(61,255,176,.6)}70%{box-shadow:0 0 0 8px rgba(61,255,176,0)}100%{box-shadow:0 0 0 0 rgba(61,255,176,0)}}
@keyframes blink{50%{opacity:.3}}
.header-stat{display:flex;flex-direction:column;align-items:flex-end}
.stat-label{font-size:9px;color:var(--silver-dim);letter-spacing:2px;text-transform:uppercase}
.stat-value{font-family:'Share Tech Mono',monospace;font-size:13px;color:var(--accent-cyan)}
.hero{position:relative;z-index:1;text-align:center;padding:72px 40px 48px}
.hero-eyebrow{font-family:'Share Tech Mono',monospace;font-size:11px;letter-spacing:6px;color:var(--accent-gold);text-transform:uppercase;margin-bottom:16px;opacity:0;animation:fade-up .8s .2s forwards}
.hero-title{font-family:'Cormorant Garamond',serif;font-size:clamp(40px,6vw,72px);font-weight:300;color:var(--silver-glow);line-height:1.1;letter-spacing:1px;opacity:0;animation:fade-up .8s .4s forwards}
.hero-title span{color:var(--accent-gold);font-weight:600}
.hero-desc{margin-top:16px;font-size:15px;color:var(--silver-dim);letter-spacing:1px;opacity:0;animation:fade-up .8s .6s forwards}
@keyframes fade-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.controls{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:12px;padding:0 40px 48px;opacity:0;animation:fade-up .8s .8s forwards}
.ctrl-label{font-size:11px;letter-spacing:3px;color:var(--silver-dim);text-transform:uppercase;margin-right:4px}
.filter-btn{padding:8px 22px;border:1px solid var(--border);background:transparent;color:var(--silver-mid);font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;cursor:pointer;transition:all .25s;position:relative;overflow:hidden}
.filter-btn::before{content:'';position:absolute;inset:0;background:var(--glow-blue);opacity:0;transition:opacity .25s}
.filter-btn:hover{border-color:var(--accent-blue);color:var(--silver-glow)}
.filter-btn:hover::before{opacity:1}
.filter-btn.active{border-color:var(--accent-blue);color:var(--accent-cyan);background:rgba(61,155,255,.1);box-shadow:0 0 20px rgba(61,155,255,.2)}
.filter-btn.active.high{border-color:var(--high-red);color:var(--high-red);background:rgba(255,79,110,.08);box-shadow:0 0 20px rgba(255,79,110,.15)}
.filter-btn.active.medium{border-color:var(--med-amber);color:var(--med-amber);background:rgba(255,179,71,.08);box-shadow:0 0 20px rgba(255,179,71,.15)}
.filter-btn.active.low{border-color:var(--low-green);color:var(--low-green);background:rgba(61,255,176,.08);box-shadow:0 0 20px rgba(61,255,176,.15)}
.sort-divider{width:1px;height:24px;background:var(--border);margin:0 8px}
.grid-container{position:relative;z-index:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;padding:0 40px 80px}
.card{background:var(--navy-card);border:1px solid var(--border);position:relative;overflow:hidden;cursor:pointer;transition:border-color .3s,transform .3s,box-shadow .3s;opacity:0;animation:card-appear .5s forwards}
.card:hover{border-color:var(--border-hi);transform:translateY(-3px);box-shadow:0 20px 60px rgba(0,0,0,.5),0 0 40px rgba(61,155,255,.08)}
.card.hidden{display:none}
@keyframes card-appear{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.card::before,.card::after{content:'';position:absolute;width:16px;height:16px;transition:all .3s}
.card::before{top:-1px;left:-1px;border-top:2px solid var(--accent-gold);border-left:2px solid var(--accent-gold);opacity:0}
.card::after{bottom:-1px;right:-1px;border-bottom:2px solid var(--accent-gold);border-right:2px solid var(--accent-gold);opacity:0}
.card:hover::before,.card:hover::after{opacity:1;width:24px;height:24px}
@keyframes data-flash{0%,100%{background:var(--navy-card)}50%{background:rgba(61,155,255,.08)}}
.card.flash{animation:data-flash .6s ease}
.card-strip{position:absolute;top:0;left:0;right:0;height:2px}
.card-strip.high{background:linear-gradient(90deg,transparent,var(--high-red),transparent)}
.card-strip.medium{background:linear-gradient(90deg,transparent,var(--med-amber),transparent)}
.card-strip.low{background:linear-gradient(90deg,transparent,var(--low-green),transparent)}
.card-head{padding:24px 24px 16px;display:flex;align-items:flex-start;justify-content:space-between}
.card-index-num{font-family:'Share Tech Mono',monospace;font-size:10px;letter-spacing:3px;color:var(--silver-dim);margin-bottom:4px}
.card-name{font-family:'Cormorant Garamond',serif;font-size:19px;font-weight:600;color:var(--silver-glow);line-height:1.2}
.card-sub{font-size:11px;color:var(--silver-dim);letter-spacing:1px;margin-top:2px}
.card-price{margin-top:6px;font-family:'Share Tech Mono',monospace;font-size:14px;color:var(--accent-cyan);display:flex;align-items:center;gap:8px}
.price-stale{color:var(--silver-dim)!important}
.price-arrow{font-size:10px}
.price-arrow.up{color:var(--low-green)}
.price-arrow.down{color:var(--high-red)}
.vol-badge{padding:5px 12px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;border:1px solid;flex-shrink:0}
.vol-badge.high{color:var(--high-red);border-color:rgba(255,79,110,.4);background:rgba(255,79,110,.08)}
.vol-badge.medium{color:var(--med-amber);border-color:rgba(255,179,71,.4);background:rgba(255,179,71,.08)}
.vol-badge.low{color:var(--low-green);border-color:rgba(61,255,176,.4);background:rgba(61,255,176,.08)}
.card-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);margin:0 24px;border:1px solid var(--border)}
.stat-cell{background:var(--navy-card);padding:12px 10px;text-align:center}
.stat-cell-label{font-family:'Share Tech Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--silver-dim);text-transform:uppercase;margin-bottom:5px}
.stat-cell-val{font-family:'Share Tech Mono',monospace;font-size:13px;color:var(--accent-cyan);font-weight:500}
.card-crossover-peek{padding:14px 24px 8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.peek-label{font-size:10px;letter-spacing:2px;color:var(--silver-dim);text-transform:uppercase;white-space:nowrap}
.tf-chips{display:flex;flex-wrap:wrap;gap:6px}
.tf-chip{padding:3px 10px;font-family:'Share Tech Mono',monospace;font-size:10px;border:1px solid rgba(61,155,255,.3);color:var(--accent-blue);background:rgba(61,155,255,.06)}
.tf-chip.recent{border-color:rgba(61,255,176,.4);color:var(--low-green);background:rgba(61,255,176,.06)}
.tf-chip.soon{border-color:rgba(255,179,71,.4);color:var(--med-amber);background:rgba(255,179,71,.06)}
.card-ea-row{padding:6px 24px 10px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.ea-tag{font-family:'Share Tech Mono',monospace;font-size:9px;letter-spacing:2px;padding:3px 8px;border:1px solid;text-transform:uppercase}
.ea-tag.on{color:var(--low-green);border-color:rgba(61,255,176,.3);background:rgba(61,255,176,.05)}
.ea-tag.off{color:var(--silver-dim);border-color:var(--border)}
.card-toggle{padding:10px 24px 18px;display:flex;align-items:center;gap:8px;color:var(--silver-dim);font-size:11px;letter-spacing:2px;text-transform:uppercase;user-select:none;transition:color .2s}
.card:hover .card-toggle{color:var(--silver-mid)}
.toggle-arrow{width:16px;height:16px;border-right:1px solid var(--silver-dim);border-bottom:1px solid var(--silver-dim);transform:rotate(45deg);transition:transform .3s;flex-shrink:0;position:relative;top:-2px}
.card-expand{max-height:0;overflow:hidden;transition:max-height .5s cubic-bezier(.4,0,.2,1)}
.card.open .card-expand{max-height:700px;border-top:1px solid var(--border)}
.card.open .toggle-arrow{transform:rotate(225deg)}
.card.open{border-color:rgba(61,155,255,.3)}
.expand-inner{padding:24px}
.expand-section{margin-bottom:24px}
.expand-title{font-family:'Share Tech Mono',monospace;font-size:10px;letter-spacing:4px;color:var(--accent-gold);text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;gap:10px}
.expand-title::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,rgba(200,169,110,.3),transparent)}
.tf-table{width:100%;border-collapse:collapse}
.tf-table th{font-family:'Share Tech Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--silver-dim);text-transform:uppercase;padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)}
.tf-table td{font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:500;padding:9px 10px;border-bottom:1px solid rgba(136,170,210,.06);color:var(--silver-mid)}
.tf-table tr:last-child td{border-bottom:none}
.tf-table .tf-name{color:var(--silver-hi);font-weight:600}
.status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;position:relative;top:-1px}
.status-dot.recent{background:var(--low-green);box-shadow:0 0 6px var(--low-green)}
.status-dot.soon{background:var(--med-amber);box-shadow:0 0 6px var(--med-amber);animation:blink 1.5s infinite}
.status-dot.watch{background:var(--silver-dim)}
.signal-state{font-size:12px;font-weight:600;letter-spacing:1px}
.signal-state.long{color:var(--low-green)}
.signal-state.short{color:var(--high-red)}
.signal-state.neutral{color:var(--silver-dim)}
.bias-row{display:flex;align-items:center;gap:16px;margin-bottom:10px}
.bias-label{font-size:12px;color:var(--silver-dim);letter-spacing:1px;min-width:56px}
.bias-bar-wrap{flex:1;height:6px;background:rgba(136,170,210,.1);position:relative;overflow:hidden}
.bias-bar-fill{position:absolute;top:0;bottom:0;left:0;transition:width .8s .2s ease}
.bias-bar-fill.bull{background:linear-gradient(90deg,var(--low-green),rgba(61,255,176,.4))}
.bias-bar-fill.bear{background:linear-gradient(90deg,var(--high-red),rgba(255,79,110,.4))}
.bias-pct{font-family:'Share Tech Mono',monospace;font-size:12px;min-width:38px;text-align:right}
.bias-pct.bull{color:var(--low-green)}
.bias-pct.bear{color:var(--high-red)}
.trade-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border:1px solid;font-family:'Share Tech Mono',monospace;font-size:11px;margin-top:4px}
.trade-pill.profit{color:var(--low-green);border-color:rgba(61,255,176,.3);background:rgba(61,255,176,.05)}
.trade-pill.loss{color:var(--high-red);border-color:rgba(255,79,110,.3);background:rgba(255,79,110,.05)}
.trade-pill.none{color:var(--silver-dim);border-color:var(--border)}
.last-updated{font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--silver-dim);letter-spacing:1px;margin-top:16px;text-align:right}
footer{position:relative;z-index:1;text-align:center;padding:40px;border-top:1px solid var(--border);color:var(--silver-dim);font-size:12px;letter-spacing:2px}
footer span{color:var(--accent-gold)}
@media(max-width:768px){header{padding:0 20px}.grid-container{padding:0 20px 60px;grid-template-columns:1fr}.controls{padding:0 20px 36px}.hero{padding:48px 20px 32px}.header-stat:not(:first-of-type){display:none}}
</style>
</head>
<body>
<div class="orb orb-1"></div><div class="orb orb-2"></div><div class="orb orb-3"></div>
<header>
  <div class="logo-block">
    <div class="logo-icon">&#9672;</div>
    <div class="logo-text">
      <div class="logo-title">TidalCross</div>
      <div class="logo-sub">Ultimate v3 &middot; Uzumaki Trading</div>
    </div>
  </div>
  <div class="header-right">
    <div class="conn-badge connecting" id="conn-badge"><div class="pulse-dot"></div><span id="conn-text">CONNECTING</span></div>
    <div class="header-stat"><div class="stat-label">Active Signals</div><div class="stat-value" id="signal-count">&#8212;</div></div>
    <div class="header-stat"><div class="stat-label">Open Trades</div><div class="stat-value" id="trade-count">&#8212;</div></div>
    <div class="header-stat"><div class="stat-label">Time UTC</div><div class="stat-value" id="utc-time">&#8212;</div></div>
  </div>
</header>
<section class="hero">
  <div class="hero-eyebrow">Volatility Intelligence Dashboard</div>
  <h1 class="hero-title">Volatility Index<br><span>Live Scanner</span></h1>
  <p class="hero-desc">EMA &middot; Bollinger Band Crossover Engine &middot; 20 Synthetic Indices &middot; Real-Time MT5 Feed</p>
</section>
<div class="controls">
  <span class="ctrl-label">Filter</span>
  <button class="filter-btn active" data-filter="all" onclick="filterCards('all',this)">All</button>
  <button class="filter-btn high" data-filter="high" onclick="filterCards('high',this)">High</button>
  <button class="filter-btn medium" data-filter="medium" onclick="filterCards('medium',this)">Medium</button>
  <button class="filter-btn low" data-filter="low" onclick="filterCards('low',this)">Low</button>
  <div class="sort-divider"></div>
  <span class="ctrl-label">Sort</span>
  <button class="filter-btn" onclick="sortCards('vol-desc')">Vol &#8595;</button>
  <button class="filter-btn" onclick="sortCards('vol-asc')">Vol &#8593;</button>
  <button class="filter-btn" onclick="sortCards('signals')">Signals &#8595;</button>
  <button class="filter-btn" onclick="sortCards('name')">Name</button>
</div>
<div class="grid-container" id="card-grid"></div>
<footer>&copy; 2026 <span>Uzumaki Trading</span> &middot; TidalCross Ultimate v3 &middot; Live Data via MT5 WebRequest</footer>
<script>
let indices=[],liveData={},currentFilter='all',currentSort='vol-desc',eventSource=null,reconnectTimer=null;
const VOL_ORDER={high:0,medium:1,low:2};

async function boot(){
  try{const r=await fetch('/api/indices');indices=await r.json();renderAll();connectSSE();}
  catch(e){setConnStatus('disconnected','SERVER ERROR');}
}

function connectSSE(){
  if(eventSource)eventSource.close();
  setConnStatus('connecting','CONNECTING');
  eventSource=new EventSource('/api/stream');
  eventSource.onopen=()=>{setConnStatus('connected','LIVE');clearTimeout(reconnectTimer);};
  eventSource.onmessage=(e)=>{
    const msg=JSON.parse(e.data);
    if(msg.type==='snapshot'){liveData=msg.data;renderAll();updateHeaderStats();}
    if(msg.type==='update'){msg.changed.forEach(({id,data})=>{liveData[id]=data;patchCard(id,data);});updateHeaderStats();}
  };
  eventSource.onerror=()=>{setConnStatus('disconnected','RECONNECTING');eventSource.close();reconnectTimer=setTimeout(connectSSE,4000);};
}

function setConnStatus(s,l){document.getElementById('conn-badge').className='conn-badge '+s;document.getElementById('conn-text').textContent=l;}

function renderAll(){
  document.getElementById('card-grid').innerHTML=getSorted().map((idx,i)=>buildCard(idx,i)).join('');
  applyFilter();
}

function getSorted(){
  const list=[...indices];
  if(currentSort==='vol-desc')list.sort((a,b)=>VOL_ORDER[a.vol]-VOL_ORDER[b.vol]);
  else if(currentSort==='vol-asc')list.sort((a,b)=>VOL_ORDER[b.vol]-VOL_ORDER[a.vol]);
  else if(currentSort==='name')list.sort((a,b)=>a.name.localeCompare(b.name));
  else if(currentSort==='signals')list.sort((a,b)=>countActiveTFs(liveData[b.id])-countActiveTFs(liveData[a.id]));
  return list;
}

function countActiveTFs(live){if(!live||!live.timeframes)return 0;return live.timeframes.filter(t=>t.status!=='watch').length;}

function buildCard(idx,i){
  const live=liveData[idx.id]||{};
  const tfs=live.timeframes||[];
  const peek=tfs.filter(t=>t.status!=='watch').slice(0,3);
  const peekHTML=peek.length?peek.map(t=>'<span class="tf-chip '+t.status+'">'+t.tf+'</span>').join(''):'<span style="color:var(--silver-dim);font-size:11px;letter-spacing:1px">MONITORING...</span>';
  const priceStr=live.bid!=null?live.bid.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:5}):'&#8212;';
  const tfRows=tfs.map(t=>'<tr><td class="tf-name">'+t.tf+'</td><td><span class="status-dot '+t.status+'"></span>'+t.label+'</td><td><span class="signal-state '+t.signal+'">'+(t.signal==='long'?'&#9650; LONG':t.signal==='short'?'&#9660; SHORT':'&#8212; NEUTRAL')+'</span></td></tr>').join('')||'<tr><td colspan="3" style="color:var(--silver-dim);font-size:12px;padding:14px 10px">Waiting for MT5 data...</td></tr>';
  const bull=live.bias?.bull??50,bear=live.bias?.bear??50;
  const biasSignal=bull>bear?'long':bull<bear?'short':'neutral';
  const updStr=live.lastUpdated?'UPDATED '+new Date(live.lastUpdated).toUTCString().slice(17,25)+' UTC':'AWAITING FIRST UPDATE';
  return '<div class="card" id="card-'+idx.id+'" data-vol="'+idx.vol+'" data-id="'+idx.id+'" data-active="'+countActiveTFs(live)+'" style="animation-delay:'+i*.04+'s" onclick="toggleCard(this)">'+
    '<div class="card-strip '+idx.vol+'"></div>'+
    '<div class="card-head"><div><div class="card-index-num">IDX-'+String(i+1).padStart(2,'0')+' &middot; '+idx.short+'</div>'+
    '<div class="card-name">'+idx.name+'</div><div class="card-sub">Deriv Synthetic &middot; Continuous</div>'+
    '<div class="card-price'+(live.bid==null?' price-stale':'')+'" id="price-'+idx.id+'">'+priceStr+' <span class="price-arrow" id="arrow-'+idx.id+'"></span></div></div>'+
    '<div class="vol-badge '+idx.vol+'">'+idx.vol+'</div></div>'+
    '<div class="card-stats">'+
    '<div class="stat-cell"><div class="stat-cell-label">Min Lot</div><div class="stat-cell-val">'+idx.minLot+'</div></div>'+
    '<div class="stat-cell"><div class="stat-cell-label">Min Margin</div><div class="stat-cell-val">'+idx.minMargin+'</div></div>'+
    '<div class="stat-cell"><div class="stat-cell-label">Spread</div><div class="stat-cell-val" id="spread-'+idx.id+'">'+(live.spread??idx.minSpread)+'</div></div></div>'+
    '<div class="card-crossover-peek"><span class="peek-label">Crossovers:</span><div class="tf-chips" id="peek-'+idx.id+'">'+peekHTML+'</div></div>'+
    '<div class="card-ea-row" id="eatags-'+idx.id+'">'+(live.eaScannerActive?'<span class="ea-tag on">EA ACTIVE</span>':'<span class="ea-tag off">EA PAUSED</span>')+(live.firstCrossAchieved?'<span class="ea-tag on">CROSSED</span>':'<span class="ea-tag off">WAIT CROSS</span>')+(live.bbExpanding?'<span class="ea-tag on">BB EXPAND</span>':'<span class="ea-tag off">BB FLAT</span>')+'</div>'+
    '<div class="card-toggle"><div class="toggle-arrow"></div>Expand Details</div>'+
    '<div class="card-expand"><div class="expand-inner">'+
    '<div class="expand-section"><div class="expand-title">Open Trade</div><div id="tradepill-'+idx.id+'">'+(live.openTrades>0?'<div class="trade-pill '+(live.openProfit>=0?'profit':'loss')+'">&#9658; '+live.openTrades+' TRADE'+(live.openTrades>1?'S':'')+' &nbsp; $'+(live.openProfit>=0?'+':'')+(live.openProfit||0).toFixed(2)+'</div>':'<div class="trade-pill none">NO OPEN TRADES</div>')+'</div></div>'+
    '<div class="expand-section"><div class="expand-title">Timeframe Crossovers</div><table class="tf-table"><thead><tr><th>TF</th><th>Status</th><th>Signal</th></tr></thead><tbody id="tftable-'+idx.id+'">'+tfRows+'</tbody></table></div>'+
    '<div class="expand-section"><div class="expand-title">Market Bias</div>'+
    '<div class="bias-row"><span class="bias-label">Bullish</span><div class="bias-bar-wrap"><div class="bias-bar-fill bull" id="bull-'+idx.id+'" style="width:0%" data-target="'+bull+'%"></div></div><span class="bias-pct bull" id="bullpct-'+idx.id+'">'+bull+'%</span></div>'+
    '<div class="bias-row"><span class="bias-label">Bearish</span><div class="bias-bar-wrap"><div class="bias-bar-fill bear" id="bear-'+idx.id+'" style="width:0%" data-target="'+bear+'%"></div></div><span class="bias-pct bear" id="bearpct-'+idx.id+'">'+bear+'%</span></div>'+
    '<div style="margin-top:14px;padding:10px 14px;background:rgba(255,255,255,.02);border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;color:var(--silver-dim);letter-spacing:1px">Overall Bias</span><span class="signal-state '+biasSignal+'" id="bias-overall-'+idx.id+'">'+(bull>bear?'BULLISH':bull<bear?'BEARISH':'NEUTRAL')+'</span></div></div>'+
    '<div class="last-updated" id="updated-'+idx.id+'">'+updStr+'</div></div></div></div>';
}

function patchCard(id,live){
  const card=document.getElementById('card-'+id);if(!card)return;
  card.classList.remove('flash');void card.offsetWidth;card.classList.add('flash');
  const pe=document.getElementById('price-'+id),ae=document.getElementById('arrow-'+id);
  if(pe&&live.bid!=null){
    const prev=parseFloat(pe.dataset.prev||live.bid);
    pe.childNodes[0].textContent=live.bid.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:5})+' ';
    pe.classList.remove('price-stale');pe.dataset.prev=live.bid;
    if(ae){ae.textContent=live.bid>prev?'▲':live.bid<prev?'▼':'';ae.className='price-arrow '+(live.bid>prev?'up':'down');}
  }
  const se=document.getElementById('spread-'+id);if(se&&live.spread!=null)se.textContent=live.spread;
  const pkEl=document.getElementById('peek-'+id);
  if(pkEl&&live.timeframes){const p=live.timeframes.filter(t=>t.status!=='watch').slice(0,3);pkEl.innerHTML=p.length?p.map(t=>'<span class="tf-chip '+t.status+'">'+t.tf+'</span>').join(''):'<span style="color:var(--silver-dim);font-size:11px">MONITORING...</span>';}
  const eaEl=document.getElementById('eatags-'+id);
  if(eaEl)eaEl.innerHTML=(live.eaScannerActive?'<span class="ea-tag on">EA ACTIVE</span>':'<span class="ea-tag off">EA PAUSED</span>')+(live.firstCrossAchieved?'<span class="ea-tag on">CROSSED</span>':'<span class="ea-tag off">WAIT CROSS</span>')+(live.bbExpanding?'<span class="ea-tag on">BB EXPAND</span>':'<span class="ea-tag off">BB FLAT</span>');
  const tfEl=document.getElementById('tftable-'+id);
  if(tfEl&&live.timeframes)tfEl.innerHTML=live.timeframes.map(t=>'<tr><td class="tf-name">'+t.tf+'</td><td><span class="status-dot '+t.status+'"></span>'+t.label+'</td><td><span class="signal-state '+t.signal+'">'+(t.signal==='long'?'▲ LONG':t.signal==='short'?'▼ SHORT':'— NEUTRAL')+'</span></td></tr>').join('');
  const trEl=document.getElementById('tradepill-'+id);
  if(trEl)trEl.innerHTML=live.openTrades>0?'<div class="trade-pill '+(live.openProfit>=0?'profit':'loss')+'">&#9658; '+live.openTrades+' TRADE'+(live.openTrades>1?'S':'')+' &nbsp; $'+(live.openProfit>=0?'+':'')+(live.openProfit||0).toFixed(2)+'</div>':'<div class="trade-pill none">NO OPEN TRADES</div>';
  const bull=live.bias?.bull??50,bear=live.bias?.bear??50;
  const bEl=document.getElementById('bull-'+id);if(bEl){bEl.style.width=bull+'%';bEl.dataset.target=bull+'%';}
  const brEl=document.getElementById('bear-'+id);if(brEl){brEl.style.width=bear+'%';brEl.dataset.target=bear+'%';}
  const bpEl=document.getElementById('bullpct-'+id);if(bpEl)bpEl.textContent=bull+'%';
  const brpEl=document.getElementById('bearpct-'+id);if(brpEl)brpEl.textContent=bear+'%';
  const boEl=document.getElementById('bias-overall-'+id);
  if(boEl){boEl.textContent=bull>bear?'BULLISH':bull<bear?'BEARISH':'NEUTRAL';boEl.className='signal-state '+(bull>bear?'long':bull<bear?'short':'neutral');}
  const uEl=document.getElementById('updated-'+id);
  if(uEl&&live.lastUpdated)uEl.textContent='UPDATED '+new Date(live.lastUpdated).toUTCString().slice(17,25)+' UTC';
  card.dataset.active=countActiveTFs(live);
}

function updateHeaderStats(){
  let s=0,t=0;Object.values(liveData).forEach(l=>{s+=countActiveTFs(l);t+=l.openTrades||0;});
  document.getElementById('signal-count').textContent=s||'0';
  document.getElementById('trade-count').textContent=t||'0';
}

function toggleCard(card){
  const was=card.classList.contains('open');
  document.querySelectorAll('.card.open').forEach(c=>c.classList.remove('open'));
  if(!was){card.classList.add('open');setTimeout(()=>{card.querySelectorAll('.bias-bar-fill').forEach(b=>{b.style.width=b.dataset.target;});},80);}
}

function filterCards(f,btn){
  currentFilter=f;
  document.querySelectorAll('.filter-btn[data-filter]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');applyFilter();
}
function applyFilter(){document.querySelectorAll('.card').forEach(c=>{c.classList.toggle('hidden',currentFilter!=='all'&&c.dataset.vol!==currentFilter);});}
function sortCards(m){currentSort=m;renderAll();}

function updateClock(){const n=new Date(),p=v=>String(v).padStart(2,'0');document.getElementById('utc-time').textContent=p(n.getUTCHours())+':'+p(n.getUTCMinutes())+':'+p(n.getUTCSeconds());}
setInterval(updateClock,1000);updateClock();
boot();
</script>
</body>
</html>`;

app.get('*', (req, res) => res.send(HTML));

app.listen(PORT, () => console.log('TidalCross running on port ' + PORT));
