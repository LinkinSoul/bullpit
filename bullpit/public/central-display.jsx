const { useState, useEffect, useRef, useCallback } = React;


// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const TOTAL_ROUNDS   = 7;
const CD_PASSWORD    = "BULLPIT2025";
const INITIAL_CASH   = 100000;
const BUFFER_SECONDS = 90; // 90-second inter-round buffer
const POLL_MS        = 2500;
const DEFAULT_ROUND_DURATIONS = [720, 540, 540, 540, 360, 360, 360]; // per-round seconds
const ROUND_LABELS   = ["R1 · Orientation","R2 · Main","R3 · Main","R4 · Main","R5 · Finals","R6 · Finals","R7 · Finals"];

// ─── STOCK UNIVERSE (must match main sim) ────────────────────────────────────
const SECTORS_DATA = [
  { id:"healthcare", label:"Healthcare & Pharma", color:"#a78bfa", icon:"⚕️", stocks:[
    {ticker:"JNJ",name:"Johnson & Johnson"},{ticker:"PFE",name:"Pfizer"},
    {ticker:"NVO",name:"Novo Nordisk"},{ticker:"AZN",name:"AstraZeneca"},{ticker:"UNH",name:"UnitedHealth Group"},
  ]},
  { id:"logistics", label:"Logistics", color:"#fb923c", icon:"🚚", stocks:[
    {ticker:"UPS",name:"United Parcel Service"},{ticker:"FDX",name:"FedEx"},
    {ticker:"MAER",name:"A.P. Møller-Maersk"},{ticker:"DHER",name:"DHL Group"},{ticker:"XPO",name:"XPO Logistics"},
  ]},
  { id:"tech", label:"Tech & Manufacturing", color:"#38bdf8", icon:"💻", stocks:[
    {ticker:"AAPL",name:"Apple"},{ticker:"MSFT",name:"Microsoft"},
    {ticker:"TSLA",name:"Tesla"},{ticker:"SMSN",name:"Samsung Electronics"},{ticker:"SIEM",name:"Siemens"},
  ]},
  { id:"food", label:"Food & Agriculture", color:"#4ade80", icon:"🌾", stocks:[
    {ticker:"NESN",name:"Nestlé"},{ticker:"ADM",name:"Archer-Daniels-Midland"},
    {ticker:"MDLZ",name:"Mondelēz International"},{ticker:"BG",name:"Bunge Global"},{ticker:"DANO",name:"Danone"},
  ]},
  { id:"banking", label:"Banking & Finance", color:"#fbbf24", icon:"🏦", stocks:[
    {ticker:"JPM",name:"JPMorgan Chase"},{ticker:"GS",name:"Goldman Sachs"},
    {ticker:"HSBC",name:"HSBC Holdings"},{ticker:"BLK",name:"BlackRock"},{ticker:"AXP",name:"American Express"},
  ]},
  { id:"esg", label:"ESG", color:"#00f5c4", icon:"🌱", stocks:[
    {ticker:"ENPH",name:"Enphase Energy"},{ticker:"VWSYF",name:"Vestas Wind Systems"},
    {ticker:"BEP",name:"Brookfield Renewable"},{ticker:"ORSTED",name:"Ørsted"},{ticker:"FSLR",name:"First Solar"},
  ]},
  { id:"energy", label:"Energy", color:"#f472b6", icon:"⚡", stocks:[
    {ticker:"XOM",name:"ExxonMobil"},{ticker:"CVX",name:"Chevron"},
    {ticker:"SHEL",name:"Shell"},{ticker:"BP",name:"BP"},{ticker:"TTE",name:"TotalEnergies"},
  ]},
];
const STOCKS = SECTORS_DATA.flatMap(s => s.stocks.map(st => ({
  ...st, sector: s.label, color: s.color, sectorId: s.id
})));

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt    = (n, d=2) => Number(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtUSD = n => "$"+fmt(n);
const fmtK   = n => n>=1000 ? "$"+fmt(n/1000,1)+"K" : fmtUSD(n);
const clamp  = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
const nowStr = () => new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});


// Round identities (mirrors v5)
const ROUND_RULES_CD = [
  { round:1, name:"Orientation",     color:"#00f5c4", icon:"🎓", volMult:0.5, tax:false, liquidate:false },
  { round:2, name:"Bull Run",        color:"#fbbf24", icon:"🐂", volMult:1.0, tax:true,  liquidate:false },
  { round:3, name:"The Crash",       color:"#ef4444", icon:"💥", volMult:1.2, tax:false, liquidate:true  },
  { round:4, name:"Sector Wars",     color:"#f97316", icon:"⚔️",  volMult:1.3, tax:true,  liquidate:false },
  { round:5, name:"Dark Pool",       color:"#a78bfa", icon:"🌑", volMult:1.0, tax:false, liquidate:false },
  { round:6, name:"Volatility Storm",color:"#fb923c", icon:"⚡", volMult:3.0, tax:true,  liquidate:false },
  { round:7, name:"Grand Final",     color:"#e879f9", icon:"🏆", volMult:2.0, tax:false, liquidate:true  },
];

function calcScore(entry, initCash) {
  const roi = ((entry.total - initCash) / initCash) * 100;
  const unique = entry.uniqueStocks || 0;
  const score = roi * 0.6 + Math.max(0,roi) * 0.2 + unique * 2;
  return { roi, score };
}

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
function Spark({ data, color, w=80, h=28 }) {
  if (!data || data.length < 2) return <div style={{width:w,height:h}}/>;
  const mn=Math.min(...data), mx=Math.max(...data), range=mx-mn||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-mn)/range)*(h-3)+1}`).join(" ");
  const up=data[data.length-1]>=data[0];
  const c=up?color:"#ef4444";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",flexShrink:0}}>
      <defs>
        <linearGradient id={`sg${color.replace(/\W/g,"")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.25"/>
          <stop offset="100%" stopColor={c} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#sg${color.replace(/\W/g,"")})`}/>
      <polyline points={pts} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

// ─── RANK BADGE ───────────────────────────────────────────────────────────────
function RankBadge({ rank }) {
  const configs = {
    1: { bg:"linear-gradient(135deg,#f59e0b,#d97706)", color:"#020817", icon:"🥇" },
    2: { bg:"linear-gradient(135deg,#94a3b8,#64748b)", color:"#020817", icon:"🥈" },
    3: { bg:"linear-gradient(135deg,#b45309,#92400e)", color:"#f1f5f9", icon:"🥉" },
  };
  const cfg = configs[rank] || { bg:"#1e293b", color:"#475569", icon:null };
  return (
    <div style={{
      width:44, height:44, borderRadius:12, flexShrink:0,
      background:cfg.bg, display:"flex", alignItems:"center",
      justifyContent:"center", fontSize:rank<=3?22:18,
      fontWeight:900, color:cfg.color,
      boxShadow:rank===1?"0 0 20px rgba(245,158,11,0.5)":rank===2?"0 0 12px rgba(148,163,184,0.3)":"none"
    }}>
      {cfg.icon || rank}
    </div>
  );
}

// ─── ROUND PROGRESS PIPS ─────────────────────────────────────────────────────
function RoundPips({ current, total=TOTAL_ROUNDS }) {
  return (
    <div style={{ display:"flex", gap:6, alignItems:"center" }}>
      {Array.from({length:total},(_,i)=>{
        const roundN = i+1;
        const done   = roundN < current;
        const active = roundN === current;
        return (
          <div key={i} style={{
            width: active?28:16, height:16, borderRadius:8,
            background: done?"#00f5c4" : active?"#f1f5f9" : "#1e293b",
            border: active?"2px solid #00f5c4":"2px solid transparent",
            transition:"all 0.4s ease",
            boxShadow: active?"0 0 12px #00f5c4":"none",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:9, color:done?"#020817":active?"#020817":"#334155", fontWeight:800
          }}>
            {done && "✓"}
          </div>
        );
      })}
    </div>
  );
}

// ─── TRADE FLASH ITEM ────────────────────────────────────────────────────────
function TradeFlash({ trade }) {
  const stock = STOCKS.find(s=>s.ticker===trade.ticker);
  const isBuy = trade.action==="BUY";
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:10,
      background:isBuy?"rgba(0,245,196,0.05)":"rgba(239,68,68,0.05)",
      border:`1px solid ${isBuy?"#00f5c420":"#ef444420"}`,
      borderLeft:`3px solid ${isBuy?"#00f5c4":"#ef4444"}`,
      borderRadius:8, padding:"8px 12px", marginBottom:6,
      animation:"tradeSlide 0.4s ease"
    }}>
      <div style={{ width:8,height:8,borderRadius:"50%",background:isBuy?"#00f5c4":"#ef4444",
        boxShadow:`0 0 6px ${isBuy?"#00f5c4":"#ef4444"}`,flexShrink:0 }}/>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ fontWeight:800, fontSize:13,
            color:trade.teamColor||"#94a3b8" }}>{trade.team}</span>
          <span style={{ fontSize:11, color:"#475569" }}>·</span>
          <span style={{ fontSize:12, fontWeight:700,
            color:isBuy?"#00f5c4":"#ef4444" }}>{isBuy?"▲ BUY":"▼ SELL"}</span>
          <span style={{ fontSize:12, color:stock?.color, fontWeight:700 }}>{trade.ticker}</span>
          <span style={{ fontSize:11, color:"#64748b" }}>×{trade.qty}</span>
        </div>
        <div style={{ fontSize:10, color:"#475569", marginTop:2 }}>
          {fmtUSD(trade.price)} · {trade.time}
        </div>
      </div>
      <div style={{ textAlign:"right", flexShrink:0 }}>
        <div style={{ fontSize:13, fontWeight:800,
          color:isBuy?"#ef4444":"#00f5c4" }}>
          {isBuy?"-":"+"}{ fmtK(trade.qty*trade.price)}
        </div>
      </div>
    </div>
  );
}

// ─── DISRUPTION CARD ─────────────────────────────────────────────────────────
function DisruptionCard({ events, bufferLeft }) {
  const [revealed, setRevealed] = useState(0);
  useEffect(()=>{
    if(revealed<(events?.length||0)){
      const t=setTimeout(()=>setRevealed(r=>r+1),700);
      return()=>clearTimeout(t);
    }
  },[revealed,events]);
  useEffect(()=>{ setRevealed(0); },[events]);

  const pct = bufferLeft!=null ? clamp((bufferLeft/BUFFER_SECONDS)*100,0,100) : 0;
  const bMins = bufferLeft!=null?Math.floor(bufferLeft/60):0;
  const bSecs = bufferLeft!=null?bufferLeft%60:0;

  return (
    <div style={{
      background:"#0a0f1e",
      border:"2px solid #ef4444",
      borderRadius:16,
      boxShadow:"0 0 60px rgba(239,68,68,0.25), inset 0 0 40px rgba(239,68,68,0.04)",
      overflow:"hidden"
    }}>
      {/* header */}
      <div style={{
        background:"linear-gradient(135deg,#450a0a,#7f1d1d)",
        padding:"16px 22px", borderBottom:"1px solid #ef444440",
        display:"flex", alignItems:"center", gap:14
      }}>
        <div style={{ fontSize:28, animation:"blink 0.8s step-end infinite" }}>🚨</div>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:20,
            color:"#fef2f2", letterSpacing:"-0.01em" }}>MARKET DISRUPTION ALERT</div>
          <div style={{ fontSize:10, color:"#fca5a5", letterSpacing:"0.2em", marginTop:2 }}>
            TAKING EFFECT NEXT ROUND
          </div>
        </div>
        {bufferLeft!=null && (
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:11, color:"#fca5a5", marginBottom:4 }}>NEXT ROUND IN</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:28, fontWeight:900,
              color:bMins<1?"#ef4444":"#f1f5f9",
              animation:bMins<1?"pulse 0.5s infinite":"none" }}>
              {String(bMins).padStart(2,"0")}:{String(bSecs).padStart(2,"0")}
            </div>
            <div style={{ marginTop:6, height:3, background:"#7f1d1d", borderRadius:2, width:80 }}>
              <div style={{ height:"100%", background:"#ef4444", borderRadius:2,
                width:`${pct}%`, transition:"width 1s linear" }}/>
            </div>
          </div>
        )}
      </div>

      {/* events */}
      <div style={{ padding:"16px 22px", display:"flex", flexDirection:"column", gap:10 }}>
        {events?.slice(0,3).map((evt,i)=>{
          const stock=STOCKS.find(s=>s.ticker===evt.ticker);
          const up=evt.impact>0;
          return i<revealed ? (
            <div key={i} style={{
              background:"#0f172a",
              border:`1px solid ${up?"#16653440":"#7f1d1d40"}`,
              borderLeft:`4px solid ${up?"#00f5c4":"#ef4444"}`,
              borderRadius:10, padding:"14px 16px",
              animation:"tradeSlide 0.5s ease"
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                <div style={{ width:10,height:10,borderRadius:"50%",flexShrink:0,
                  background:up?"#00f5c4":"#ef4444",
                  boxShadow:`0 0 10px ${up?"#00f5c4":"#ef4444"}` }}/>
                <span style={{ color:stock?.color, fontWeight:800, fontSize:15 }}>{evt.ticker}</span>
                <span style={{ color:"#64748b", fontSize:12 }}>{stock?.name}</span>
                <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:14, fontWeight:900,
                    color:up?"#00f5c4":"#ef4444" }}>
                    {up?"▲":"▼"} {Math.abs(evt.impact)}%
                  </span>
                  <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4,
                    background:up?"rgba(0,245,196,0.12)":"rgba(239,68,68,0.12)",
                    color:up?"#00f5c4":"#ef4444", fontWeight:700 }}>
                    {up?"BULLISH":"BEARISH"}
                  </span>
                </div>
              </div>
              <div style={{ fontSize:14, color:"#f1f5f9", fontWeight:600, lineHeight:1.5, marginBottom:6 }}>
                {evt.headline}
              </div>
              {evt.detail && (
                <div style={{ fontSize:12, color:"#64748b", fontStyle:"italic", lineHeight:1.5 }}>
                  {evt.detail}
                </div>
              )}
            </div>
          ) : (
            <div key={i} style={{ height:80, background:"#0f172a", borderRadius:10,
              border:"1px solid #1e293b", display:"flex", alignItems:"center",
              justifyContent:"center", color:"#1e293b", fontSize:11, letterSpacing:"0.2em" }}>
              DECRYPTING...
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MAIN CENTRAL DISPLAY ─────────────────────────────────────────────────────
function CentralDisplay() {
  const [screen, setScreen] = useState("login");
  const [cdPass, setCdPass] = useState("");
  const [passErr, setPassErr] = useState("");

  // ── shared state from storage ──────────────────────────────────────────
  const [leaderboard,   setLeaderboard]   = useState([]);
  const [tradeStream,   setTradeStream]   = useState([]);
  const [disruptions,   setDisruptions]   = useState([]);
  const [gamePhase,     setGamePhase]     = useState("idle"); // idle|running|buffer|disruption|ended
  const [roundNum,      setRoundNum]      = useState(1);
  const [roundTimeLeft, setRoundTimeLeft] = useState(null);
  const [bufferLeft,    setBufferLeft]    = useState(null);
  const [prices,        setPrices]        = useState({});
  const [priceHistory,  setPriceHistory]  = useState({});
  const [sentiment,     setSentiment]     = useState("neutral");
  const [broadcast,     setBroadcast]     = useState(null);
  const [currentTime,   setCurrentTime]   = useState(nowStr());
  const [teams,         setTeams]         = useState([]);
  const [initCash,      setInitCash]      = useState(INITIAL_CASH);
  const [allRoundEnded, setAllRoundEnded] = useState(false);
  const [leaderHidden,  setLeaderHidden]  = useState(false);
  const [volMultiplier, setVolMultiplier] = useState(1.0);

  const phaseRef      = useRef(gamePhase);
  const lastTradeRef  = useRef(null);
  const lastBcastRef  = useRef(null);
  phaseRef.current = gamePhase;

  // ── clock ──────────────────────────────────────────────────────────────
  useEffect(()=>{
    const id=setInterval(()=>setCurrentTime(nowStr()),1000);
    return()=>clearInterval(id);
  },[]);

  // ── poll shared storage ────────────────────────────────────────────────
  const poll = useCallback(async()=>{
    try {
      // leaderboard
      const lbRes = await window.storage.list("lb:",true);
      const lbKeys = lbRes?.keys||[];
      const lbRows = (await Promise.all(lbKeys.map(async k=>{
        try{const r=await window.storage.get(k,true); return r?JSON.parse(r.value):null;}catch{return null;}
      }))).filter(Boolean);
      setLeaderboard(lbRows.sort((a,b)=>b.total-a.total));

      // game state
      const gsR = await window.storage.get("gm:state",true);
      if(gsR){
        const gs=JSON.parse(gsR.value);
        if(gs.phase)    setGamePhase(gs.phase);
        if(gs.round)    setRoundNum(gs.round);
        if(gs.roundLeft!==undefined) setRoundTimeLeft(gs.roundLeft);
        if(gs.leaderHidden!==undefined) setLeaderHidden(gs.leaderHidden||false);
        if(gs.volMultiplier!==undefined) setVolMultiplier(gs.volMultiplier||1);
        if(gs.bufferLeft!==undefined) setBufferLeft(gs.bufferLeft);
        if(gs.initCash) setInitCash(gs.initCash);
        if(gs.allEnded) setAllRoundEnded(true);
        if(gs.sentiment) setSentiment(gs.sentiment);
      }

      // prices + history
      const prR = await window.storage.get("gm:prices",true);
      if(prR){
        const pr=JSON.parse(prR.value);
        if(pr.prices)  setPrices(pr.prices);
        if(pr.history) setPriceHistory(pr.history);
      }

      // teams
      const tmR = await window.storage.get("gm:teams",true);
      if(tmR) setTeams(JSON.parse(tmR.value));

      // trade stream
      const trR = await window.storage.get("cd:trades",true);
      if(trR){
        const tr=JSON.parse(trR.value);
        if(tr.id!==lastTradeRef.current){
          lastTradeRef.current = tr.id;
          setTradeStream(prev=>[tr,...prev].slice(0,40));
        }
      }

      // disruption events
      const diR = await window.storage.get("gm:disruptions",true);
      if(diR){
        const di=JSON.parse(diR.value);
        setDisruptions(di.events||[]);
      }

      // broadcast
      const bcR = await window.storage.get("gm:broadcast",true);
      if(bcR){
        const bc=JSON.parse(bcR.value);
        if(bc.id!==lastBcastRef.current){
          lastBcastRef.current = bc.id;
          setBroadcast(bc);
          setTimeout(()=>setBroadcast(null),8000);
        }
      }
    }catch(e){ /* silent */ }
  },[]);

  useEffect(()=>{
    poll();
    const id=setInterval(poll, POLL_MS);
    return()=>clearInterval(id);
  },[poll]);

  // ── derived ────────────────────────────────────────────────────────────
  const ranked = leaderboard.map(e=>{
    const {roi,score}=calcScore(e,initCash);
    const holdVal=e.total-(e.cash||0);
    return {...e, roi, score, holdVal};
  }).sort((a,b)=>b.score-a.score);

  const timerMins = roundTimeLeft!=null?Math.floor(roundTimeLeft/60):null;
  const timerSecs = roundTimeLeft!=null?roundTimeLeft%60:null;
  const timerUrgent = timerMins!=null&&timerMins<3;
  const timerCritical = timerMins!=null&&timerMins<1;

  const bufMins = bufferLeft!=null?Math.floor(bufferLeft/60):null;
  const bufSecs = bufferLeft!=null?bufferLeft%60:null;

  const isBuffer = gamePhase==="buffer";
  const isDisruption = gamePhase==="disruption";
  const isRunning = gamePhase==="running";
  const isPaused  = gamePhase==="paused";
  const isIdle    = gamePhase==="idle";

  const sentimentConfig = {
    bull:     { label:"BULL MARKET",     color:"#00f5c4", icon:"📈" },
    bear:     { label:"BEAR MARKET",     color:"#ef4444", icon:"📉" },
    volatile: { label:"HIGH VOLATILITY", color:"#fbbf24", icon:"⚡" },
    neutral:  { label:"NEUTRAL",         color:"#64748b", icon:"〰" },
  };
  const sentCfg = sentimentConfig[sentiment]||sentimentConfig.neutral;

  // winner for final screen
  const champion = allRoundEnded && ranked[0];

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&family=Syne:wght@700;800;900&family=Bebas+Neue&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:#020817;overflow:hidden;}
    ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-track{background:#0f172a;}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px;}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
    @keyframes tradeSlide{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}
    @keyframes fadeup{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
    @keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
    @keyframes scanIn{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0% 0 0)}}
    @keyframes tickerMove{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
    @keyframes rankFlash{0%,100%{background:transparent}50%{background:rgba(0,245,196,0.08)}}
    @keyframes glowPulse{0%,100%{box-shadow:0 0 20px rgba(0,245,196,0.15)}50%{box-shadow:0 0 50px rgba(0,245,196,0.4)}}
    @keyframes countdownBoom{0%{transform:scale(1)}50%{transform:scale(1.08)}100%{transform:scale(1)}}
    @keyframes championReveal{from{opacity:0;transform:scale(0.85)}to{opacity:1;transform:scale(1)}}
  `;

  // ─── LOGIN SCREEN ────────────────────────────────────────────────────
  if (screen === "login") {
    const CSS_LOGIN = `
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&family=Syne:wght@700;800;900&family=Bebas+Neue&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      body{background:#020817;}
      @keyframes fadeup{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
      @keyframes scanline{0%{transform:translateY(-100%)}100%{transform:translateY(100vh)}}
    `;
    return (
      <div style={{
        minHeight:"100vh", background:"#020817",
        display:"flex", alignItems:"center", justifyContent:"center",
        fontFamily:"'JetBrains Mono','Courier New',monospace",
        backgroundImage:"radial-gradient(ellipse at 50% 40%, rgba(0,245,196,0.06) 0%, transparent 65%)"
      }}>
        <style>{CSS_LOGIN}</style>
        {/* Scanline effect */}
        <div style={{
          position:"fixed", inset:0, pointerEvents:"none", zIndex:0,
          background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px)"
        }}/>
        <div style={{ width:420, padding:48, animation:"fadeup 0.5s ease", position:"relative", zIndex:1 }}>

          {/* Logo */}
          <div style={{ textAlign:"center", marginBottom:44 }}>
            <div style={{ fontSize:9, letterSpacing:"0.45em", color:"#334155", marginBottom:14 }}>
              CENTRAL DISPLAY TERMINAL
            </div>
            <div style={{
              fontFamily:"'Bebas Neue',sans-serif", fontSize:72, lineHeight:1,
              background:"linear-gradient(135deg,#00f5c4,#38bdf8)",
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", marginBottom:8
            }}>
              BULL PIT
            </div>
            <div style={{ fontSize:11, color:"#475569", letterSpacing:"0.05em" }}>
              Where fortunes are forged in seconds
            </div>
            {/* Decorative line */}
            <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:20 }}>
              <div style={{ flex:1, height:1, background:"linear-gradient(90deg,transparent,#1e293b)" }}/>
              <span style={{ fontSize:9, color:"#334155", letterSpacing:"0.2em" }}>SECURE ACCESS</span>
              <div style={{ flex:1, height:1, background:"linear-gradient(90deg,#1e293b,transparent)" }}/>
            </div>
          </div>

          {/* Login card */}
          <div style={{
            background:"#0a0f1e", border:"1px solid #1e293b",
            borderRadius:14, padding:"28px 28px 24px",
            boxShadow:"0 0 60px rgba(0,245,196,0.05)"
          }}>
            <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.15em", marginBottom:10 }}>
              DISPLAY PASSWORD
            </div>
            <div style={{ position:"relative", marginBottom: passErr ? 8 : 16 }}>
              <input
                type="password"
                value={cdPass}
                onChange={e => { setCdPass(e.target.value); setPassErr(""); }}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    if (cdPass === CD_PASSWORD) setScreen("display");
                    else setPassErr("Incorrect password.");
                  }
                }}
                placeholder="Enter display password…"
                autoFocus
                style={{
                  width:"100%", padding:"13px 16px",
                  background:"#020817",
                  border:`1px solid ${passErr ? "#ef4444" : "#1e293b"}`,
                  color:"#f1f5f9", borderRadius:8, fontSize:14,
                  fontFamily:"inherit", outline:"none",
                  transition:"border-color 0.2s"
                }}
              />
            </div>
            {passErr && (
              <div style={{ color:"#ef4444", fontSize:11, marginBottom:12 }}>
                {passErr}
              </div>
            )}
            <button
              onClick={() => {
                if (cdPass === CD_PASSWORD) setScreen("display");
                else setPassErr("Incorrect password.");
              }}
              style={{
                width:"100%", padding:"13px",
                background:"linear-gradient(135deg,#00f5c4,#38bdf8)",
                border:"none", borderRadius:9,
                color:"#020817", fontSize:13, fontWeight:800,
                cursor:"pointer", fontFamily:"inherit", letterSpacing:"0.08em",
                transition:"opacity 0.2s"
              }}>
              LAUNCH DISPLAY &#8594;
            </button>

            {/* Hint */}
            <div style={{ marginTop:16, textAlign:"center", fontSize:9,
              color:"#1e293b", letterSpacing:"0.1em" }}>
              FOR OPERATOR USE ONLY &middot; PROJECTOR / MAIN SCREEN
            </div>
          </div>

          {/* Footer */}
          <div style={{ textAlign:"center", marginTop:20, fontSize:9, color:"#1e293b" }}>
            BULL PIT &copy; 2025 &middot; CENTRAL DISPLAY v2
          </div>
        </div>
      </div>
    );
  }

  // ─── CHAMPION SCREEN ────────────────────────────────────────────────────
  if (allRoundEnded && champion) {
    return (
      <div style={{ width:"100vw", height:"100vh", background:"#020817", overflow:"hidden",
        fontFamily:"'JetBrains Mono','Courier New',monospace",
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        backgroundImage:"radial-gradient(ellipse at center, rgba(251,191,36,0.1) 0%, transparent 65%)" }}>
        <style>{CSS}</style>
        <div style={{ textAlign:"center", animation:"championReveal 1s ease" }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:"8vw", color:"#334155",
            letterSpacing:"0.2em", marginBottom:8 }}>FINAL RESULTS</div>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:"3.5vw", fontWeight:900,
            color:"#fbbf24", textShadow:"0 0 80px rgba(251,191,36,0.6)", marginBottom:4 }}>
            🏆 CHAMPION
          </div>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:"6vw", fontWeight:900,
            color:champion.color||"#fbbf24", marginBottom:8,
            textShadow:`0 0 60px ${champion.color||"#fbbf24"}80` }}>
            {champion.name}
          </div>
          <div style={{ display:"flex", gap:24, justifyContent:"center", marginBottom:40 }}>
            {[
              {l:"FINAL VALUE", v:fmtUSD(champion.total), c:"#f1f5f9"},
              {l:"ROI",         v:`+${fmt(champion.roi)}%`, c:"#00f5c4"},
              {l:"SCORE",       v:fmt(champion.score,1),   c:"#fbbf24"},
            ].map(c=>(
              <div key={c.l} style={{ background:"#0f172a", border:"1px solid #1e293b",
                borderRadius:12, padding:"16px 28px", textAlign:"center" }}>
                <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.15em", marginBottom:6 }}>{c.l}</div>
                <div style={{ fontSize:"2vw", fontWeight:900, color:c.c }}>{c.v}</div>
              </div>
            ))}
          </div>
          {/* podium */}
          <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
            {ranked.slice(0,7).map((e,i)=>(
              <div key={e.name} style={{
                background:"#0f172a", border:`1px solid ${i===0?"#fbbf24":"#1e293b"}`,
                borderRadius:10, padding:"12px 16px", minWidth:120,
                boxShadow:i===0?"0 0 30px rgba(251,191,36,0.3)":"none"
              }}>
                <div style={{ fontSize:18, marginBottom:4 }}>
                  {i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}
                </div>
                <div style={{ fontWeight:800, fontSize:12, color:e.color||"#94a3b8",
                  marginBottom:2 }}>{e.name}</div>
                <div style={{ fontSize:11, color:"#f1f5f9" }}>{fmtUSD(e.total)}</div>
                <div style={{ fontSize:10, color:"#64748b" }}>ROI {fmt(e.roi)}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── MAIN DISPLAY ───────────────────────────────────────────────────────
  return (
    <div style={{
      width:"100vw", height:"100vh", background:"#020817", overflow:"hidden",
      fontFamily:"'JetBrains Mono','Courier New',monospace", color:"#f1f5f9",
      display:"flex", flexDirection:"column",
      backgroundImage:"radial-gradient(ellipse at 20% 50%, rgba(0,245,196,0.03) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(56,189,248,0.03) 0%, transparent 50%)"
    }}>
      <style>{CSS}</style>

      {/* ── BROADCAST BANNER ── */}
      {broadcast && (
        <div style={{
          position:"absolute", top:0, left:0, right:0, zIndex:9999,
          background:"linear-gradient(135deg,#0c4a6e,#0f172a)",
          borderBottom:"3px solid #38bdf8", padding:"14px 32px",
          display:"flex", alignItems:"center", gap:16,
          animation:"fadeup 0.4s ease",
          boxShadow:"0 4px 40px rgba(56,189,248,0.3)"
        }}>
          <span style={{ fontSize:24 }}>📢</span>
          <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:20,
            color:"#e0f2fe", letterSpacing:"0.02em" }}>{broadcast.text}</span>
        </div>
      )}

      {/* ── TOP HEADER BAR ── */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"0 28px", height:64, flexShrink:0,
        borderBottom:"1px solid #0f172a",
        background:"linear-gradient(90deg,#020817,#04111f,#020817)"
      }}>
        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:42, letterSpacing:"0.08em",
            background:"linear-gradient(135deg,#00f5c4,#38bdf8)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            lineHeight:1 }}>BULL PIT</div>
          <div style={{ height:28, width:1, background:"#1e293b" }}/>
          <div>
            <div style={{ fontSize:9, color:"#334155", letterSpacing:"0.25em" }}>COMPETITION</div>
            <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.15em" }}>WHERE FORTUNES ARE FORGED IN SECONDS</div>
          </div>
        </div>

        {/* Round progress + identity */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
          <RoundPips current={roundNum} total={TOTAL_ROUNDS}/>
          {(() => {
            const rules = ROUND_RULES_CD[roundNum-1] || ROUND_RULES_CD[0];
            return (
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:14 }}>{rules.icon}</span>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:11, color:rules.color, fontWeight:800,
                    letterSpacing:"0.1em" }}>{rules.name.toUpperCase()}</div>
                  <div style={{ fontSize:9, color:"#334155" }}>
                    ROUND {roundNum}/{TOTAL_ROUNDS}
                    {rules.tax && " · TAX"}
                    {rules.liquidate && " · LIQUIDATION"}
                    {volMultiplier > 1 && ` · ${volMultiplier}× VOL`}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Phase + Timer */}
        <div style={{ display:"flex", alignItems:"center", gap:20 }}>
          {/* Sentiment */}
          <div style={{ display:"flex", alignItems:"center", gap:6,
            padding:"5px 12px", borderRadius:6,
            background:`${sentCfg.color}15`, border:`1px solid ${sentCfg.color}30` }}>
            <span>{sentCfg.icon}</span>
            <span style={{ fontSize:10, color:sentCfg.color, fontWeight:700,
              letterSpacing:"0.1em" }}>{sentCfg.label}</span>
          </div>

          {/* Phase badge */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:8, height:8, borderRadius:"50%",
              background: isRunning?"#00f5c4":isPaused?"#fbbf24":isBuffer?"#38bdf8":"#64748b",
              animation: isRunning?"pulse 1.5s infinite":"none",
              boxShadow: isRunning?"0 0 10px #00f5c4":"none" }}/>
            <span style={{ fontSize:11, letterSpacing:"0.15em",
              color:isRunning?"#00f5c4":isPaused?"#fbbf24":isBuffer?"#38bdf8":"#64748b",
              fontWeight:700 }}>
              {isRunning?"LIVE":isPaused?"PAUSED":isBuffer?"BUFFER":isDisruption?"DISRUPTION":"STANDBY"}
            </span>
          </div>

          {/* Main countdown */}
          {isRunning && timerMins!==null && (
            <div style={{
              fontFamily:"'Bebas Neue',sans-serif",
              fontSize: timerCritical?52:44,
              lineHeight:1,
              color: timerCritical?"#ef4444":timerUrgent?"#fbbf24":"#f1f5f9",
              animation: timerCritical?"pulse 0.5s infinite":timerUrgent?"countdownBoom 1s infinite":"none",
              textShadow: timerCritical?"0 0 30px #ef4444":"none",
              minWidth:120, textAlign:"right"
            }}>
              {String(timerMins).padStart(2,"0")}:{String(timerSecs).padStart(2,"0")}
            </div>
          )}
          {isBuffer && bufMins!==null && (
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:9, color:"#38bdf8", letterSpacing:"0.15em", marginBottom:2 }}>
                NEXT ROUND IN
              </div>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:44, lineHeight:1,
                color:"#38bdf8" }}>
                {String(bufMins).padStart(2,"0")}:{String(bufSecs).padStart(2,"0")}
              </div>
            </div>
          )}

          {/* Clock */}
          <div style={{ textAlign:"right", borderLeft:"1px solid #1e293b", paddingLeft:16 }}>
            <div style={{ fontSize:9, color:"#334155", letterSpacing:"0.1em" }}>LOCAL TIME</div>
            <div style={{ fontSize:14, color:"#475569", fontWeight:700 }}>{currentTime}</div>
          </div>
        </div>
      </div>

      {/* ── PRICE TICKER STRIP ── */}
      <div style={{ height:34, background:"#040d1a", borderBottom:"1px solid #0f172a",
        overflow:"hidden", display:"flex", alignItems:"center" }}>
        <div style={{ display:"flex", gap:0, whiteSpace:"nowrap",
          animation:"tickerMove 40s linear infinite" }}>
          {[...STOCKS,...STOCKS,...STOCKS,...STOCKS].map((s,i)=>{
            const p=prices[s.ticker]||0;
            const h=priceHistory[s.ticker];
            const prev=h&&h.length>1?h[h.length-2]:p;
            const chg=prev?((p-prev)/prev)*100:0;
            return(
              <span key={i} style={{ fontSize:12, padding:"0 20px",
                borderRight:"1px solid #0f172a", display:"inline-flex",
                alignItems:"center", gap:8 }}>
                <span style={{ color:s.color, fontWeight:800 }}>{s.ticker}</span>
                <span style={{ color:"#94a3b8", fontVariantNumeric:"tabular-nums" }}>
                  {p>0?fmtUSD(p):"—"}
                </span>
                {p>0&&(
                  <span style={{ color:chg>=0?"#00f5c4":"#ef4444", fontSize:11 }}>
                    {chg>=0?"▲":"▼"}{fmt(Math.abs(chg))}%
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* ── MAIN BODY ── */}
      <div style={{ flex:1, display:"grid",
        gridTemplateColumns:"1fr 360px",
        gap:0, overflow:"hidden" }}>

        {/* ══ LEFT: LEADERBOARD ══ */}
        <div style={{ borderRight:"1px solid #0f172a", display:"flex",
          flexDirection:"column", overflow:"hidden" }}>
          {/* header */}
          <div style={{ padding:"14px 22px 12px", borderBottom:"1px solid #0f172a",
            display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:18,
              color:"#f1f5f9", letterSpacing:"-0.01em" }}>LEADERBOARD</div>
            <div style={{ marginLeft:"auto", fontSize:9, color:"#334155",
              letterSpacing:"0.1em" }}>
              SCORE = 60% ROI + 20% RETURN + 20% DIVERSITY
            </div>
          </div>

          {/* leaderboard rows */}
          <div style={{ flex:1, overflowY:"auto", padding:"12px 16px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, alignContent:"start" }}>
            {ranked.length===0 ? (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                justifyContent:"center", height:"100%", gap:12 }}>
                <div style={{ fontSize:36, opacity:0.2 }}>📊</div>
                <div style={{ color:"#334155", fontSize:13, letterSpacing:"0.1em" }}>
                  WAITING FOR PLAYERS
                </div>
              </div>
            ) : ranked.map((entry,i)=>{
              const team=teams.find(t=>t.name===entry.name);
              const color=team?.color||entry.color||"#64748b";
              const scoreComponents=calcScore(entry,initCash);
              const maxScore=ranked[0]?.score||1;
              const scorePct=clamp((scoreComponents.score/maxScore)*100,0,100);
              const isTop=i===0;
              const cashPct=entry.total>0?clamp((entry.cash||0)/entry.total*100,0,100):100;
              const holdPct=100-cashPct;

              return (
                <div key={entry.name} style={{
                  background: isTop
                    ? "linear-gradient(135deg,rgba(251,191,36,0.08),rgba(245,158,11,0.04))"
                    : "#0a0f1e",
                  border:`1px solid ${isTop?"#fbbf2440":"#111827"}`,
                  borderRadius:12, padding:"14px 16px", marginBottom:8,
                  animation: isTop?"glowPulse 3s infinite":"none",
                  transition:"all 0.4s"
                }}>
                  {/* top row */}
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
                    <RankBadge rank={i+1}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                        <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:800,
                          fontSize:16, color, letterSpacing:"-0.01em",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {entry.name}
                        </span>
                        {entry.isBot&&<span style={{ fontSize:10, color:"#334155",
                          padding:"1px 6px", borderRadius:3, border:"1px solid #1e293b" }}>BOT</span>}
                        {isTop&&<span style={{ fontSize:10, color:"#fbbf24",
                          padding:"1px 6px", borderRadius:3, border:"1px solid #fbbf2440",
                          background:"rgba(251,191,36,0.1)" }}>LEADING</span>}
                      </div>
                      {/* score bar */}
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <div style={{ flex:1, height:4, background:"#1e293b", borderRadius:2 }}>
                          <div style={{ width:`${scorePct}%`, height:"100%",
                            background:isTop?"linear-gradient(90deg,#fbbf24,#f59e0b)":
                              `linear-gradient(90deg,${color},${color}88)`,
                            borderRadius:2, transition:"width 0.8s ease" }}/>
                        </div>
                        <span style={{ fontSize:11, color:"#475569", fontWeight:700,
                          minWidth:60, textAlign:"right" }}>
                          {fmt(scoreComponents.score,1)} pts
                        </span>
                      </div>
                    </div>

                    {/* total value */}
                    <div style={{ textAlign:"right", flexShrink:0 }}>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:26,
                        lineHeight:1, color:"#f1f5f9", letterSpacing:"0.02em" }}>
                        {fmtK(entry.total)}
                      </div>
                      <div style={{ fontSize:11, fontWeight:800,
                        color:entry.pnl>=0?"#00f5c4":"#ef4444", marginTop:2 }}>
                        {entry.pnl>=0?"▲ +":"▼ "}{fmtUSD(Math.abs(entry.pnl))}
                      </div>
                    </div>
                  </div>

                  {/* indicators row */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)",
                    gap:8, marginBottom:10 }}>
                    {[
                      { label:"ROI",      value:`${entry.roi>=0?"+":""}${fmt(entry.roi)}%`,
                        color:entry.roi>=0?"#00f5c4":"#ef4444" },
                      { label:"CASH",     value:fmtK(entry.cash||0), color:"#38bdf8" },
                      { label:"HOLDINGS", value:fmtK(entry.holdVal||0), color:"#a78bfa" },
                      { label:"STOCKS",   value:`${entry.uniqueStocks||0} held`,
                        color:"#fbbf24" },
                    ].map(ind=>(
                      <div key={ind.label} style={{ background:"#060c18",
                        borderRadius:7, padding:"6px 8px", textAlign:"center" }}>
                        <div style={{ fontSize:8, color:"#334155",
                          letterSpacing:"0.15em", marginBottom:3 }}>{ind.label}</div>
                        <div style={{ fontSize:12, fontWeight:800, color:ind.color }}>
                          {ind.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* portfolio composition bar */}
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between",
                      fontSize:9, color:"#334155", marginBottom:3 }}>
                      <span>CASH {fmt(cashPct,0)}%</span>
                      <span>HOLDINGS {fmt(holdPct,0)}%</span>
                    </div>
                    <div style={{ height:5, background:"#0f172a", borderRadius:3,
                      overflow:"hidden", display:"flex" }}>
                      <div style={{ width:`${cashPct}%`, background:"#38bdf8",
                        height:"100%", transition:"width 0.6s ease" }}/>
                      <div style={{ flex:1, background:color+"66",
                        height:"100%", transition:"width 0.6s ease" }}/>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ══ RIGHT: TRADE STREAM ══ */}
        <div style={{ display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ padding:"14px 16px 12px", borderBottom:"1px solid #0f172a" }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900,
              fontSize:16, color:"#f1f5f9" }}>LIVE TRADES</div>
            <div style={{ fontSize:9, color:"#334155", letterSpacing:"0.1em",
              marginTop:3 }}>REAL-TIME ACTIVITY FEED</div>
          </div>
          {/* Show disruption card in trade column during buffer/disruption */}
          {(isBuffer||isDisruption) && (
            <div style={{ padding:"12px", borderBottom:"1px solid #0f172a", overflowY:"auto", maxHeight:"55%" }}>
              {disruptions.length>0 ? (
                <DisruptionCard events={disruptions} bufferLeft={bufferLeft}/>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                  justifyContent:"center", padding:"24px 0", gap:10 }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:48, color:"#38bdf8" }}>
                    {bufMins!=null?`${String(bufMins).padStart(2,"0")}:${String(bufSecs).padStart(2,"0")}`:"--:--"}
                  </div>
                  <div style={{ fontSize:10, color:"#334155", letterSpacing:"0.15em" }}>BUFFER PERIOD · NEXT ROUND SOON</div>
                </div>
              )}
            </div>
          )}
          <div style={{ flex:1, overflowY:"auto", padding:"10px 12px" }}>
            {tradeStream.length===0 ? (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                justifyContent:"center", height:"100%", gap:10 }}>
                <div style={{ fontSize:28, opacity:0.15 }}>📡</div>
                <div style={{ color:"#1e293b", fontSize:11,
                  letterSpacing:"0.15em" }}>AWAITING TRADES</div>
              </div>
            ) : tradeStream.map((t,i)=>(
              <TradeFlash key={t.id||i} trade={t}/>
            ))}
          </div>


        </div>
      </div>

      {/* ── BOTTOM STATUS BAR ── */}
      <div style={{ height:30, background:"#020817", borderTop:"1px solid #080f1e",
        display:"flex", alignItems:"center", padding:"0 20px", gap:20 }}>
        <div style={{ fontSize:9, color:"#1e293b", letterSpacing:"0.1em" }}>
          BULL PIT CENTRAL DISPLAY
        </div>
        <div style={{ fontSize:9, color:"#1e293b" }}>·</div>
        <div style={{ fontSize:9, color:"#1e293b" }}>
          {ranked.length} ACTIVE PLAYERS
        </div>
        <div style={{ fontSize:9, color:"#1e293b" }}>·</div>
        <div style={{ fontSize:9, color:"#1e293b" }}>
          ROUND {roundNum}/{TOTAL_ROUNDS}
        </div>
        <div style={{ marginLeft:"auto", fontSize:9, color:"#1e293b" }}>
          SCORE FORMULA: 60% ROI + 20% RETURN + 20% DIVERSIFICATION
        </div>
      </div>
    </div>
  );
}
