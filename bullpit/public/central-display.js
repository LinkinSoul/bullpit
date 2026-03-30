const {
  useState,
  useEffect,
  useRef,
  useCallback
} = React;

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const TOTAL_ROUNDS = 7;
const CD_PASSWORD = "BULLPIT2025";
const INITIAL_CASH = 100000;
const BUFFER_SECONDS = 90; // 90-second inter-round buffer
const POLITICAL_BUFFER_SECONDS = 30;
const NEWS_HISTORY_LIMIT = 40;
const POLL_MS = 2000;
const DEFAULT_ROUND_DURATIONS = [480, 600, 600, 600, 600, 480, 720];

// ─── STOCK UNIVERSE (must match main sim) ────────────────────────────────────
const SECTORS_DATA = [{
  id: "healthcare",
  label: "Healthcare & Pharma",
  color: "#a78bfa",
  icon: "⚕️",
  stocks: [{
    ticker: "JNJ",
    name: "Johnson & Johnson"
  }, {
    ticker: "PFE",
    name: "Pfizer"
  }, {
    ticker: "NVO",
    name: "Novo Nordisk"
  }, {
    ticker: "AZN",
    name: "AstraZeneca"
  }, {
    ticker: "UNH",
    name: "UnitedHealth Group"
  }]
}, {
  id: "logistics",
  label: "Logistics",
  color: "#fb923c",
  icon: "🚚",
  stocks: [{
    ticker: "UPS",
    name: "United Parcel Service"
  }, {
    ticker: "FDX",
    name: "FedEx"
  }, {
    ticker: "MAER",
    name: "A.P. Møller-Maersk"
  }, {
    ticker: "DHER",
    name: "DHL Group"
  }, {
    ticker: "XPO",
    name: "XPO Logistics"
  }]
}, {
  id: "tech",
  label: "Tech & Manufacturing",
  color: "#38bdf8",
  icon: "💻",
  stocks: [{
    ticker: "AAPL",
    name: "Apple"
  }, {
    ticker: "MSFT",
    name: "Microsoft"
  }, {
    ticker: "TSLA",
    name: "Tesla"
  }, {
    ticker: "SMSN",
    name: "Samsung Electronics"
  }, {
    ticker: "SIEM",
    name: "Siemens"
  }]
}, {
  id: "food",
  label: "Food & Agriculture",
  color: "#4ade80",
  icon: "🌾",
  stocks: [{
    ticker: "NESN",
    name: "Nestlé"
  }, {
    ticker: "ADM",
    name: "Archer-Daniels-Midland"
  }, {
    ticker: "MDLZ",
    name: "Mondelēz International"
  }, {
    ticker: "BG",
    name: "Bunge Global"
  }, {
    ticker: "DANO",
    name: "Danone"
  }]
}, {
  id: "banking",
  label: "Banking & Finance",
  color: "#fbbf24",
  icon: "🏦",
  stocks: [{
    ticker: "JPM",
    name: "JPMorgan Chase"
  }, {
    ticker: "GS",
    name: "Goldman Sachs"
  }, {
    ticker: "HSBC",
    name: "HSBC Holdings"
  }, {
    ticker: "BLK",
    name: "BlackRock"
  }, {
    ticker: "AXP",
    name: "American Express"
  }]
}, {
  id: "esg",
  label: "ESG",
  color: "#00f5c4",
  icon: "🌱",
  stocks: [{
    ticker: "ENPH",
    name: "Enphase Energy"
  }, {
    ticker: "VWSYF",
    name: "Vestas Wind Systems"
  }, {
    ticker: "BEP",
    name: "Brookfield Renewable"
  }, {
    ticker: "ORSTED",
    name: "Ørsted"
  }, {
    ticker: "FSLR",
    name: "First Solar"
  }]
}, {
  id: "energy",
  label: "Energy",
  color: "#f472b6",
  icon: "⚡",
  stocks: [{
    ticker: "XOM",
    name: "ExxonMobil"
  }, {
    ticker: "CVX",
    name: "Chevron"
  }, {
    ticker: "SHEL",
    name: "Shell"
  }, {
    ticker: "BP",
    name: "BP"
  }, {
    ticker: "TTE",
    name: "TotalEnergies"
  }]
}];
const STOCKS = SECTORS_DATA.flatMap(s => s.stocks.map(st => ({
  ...st,
  sector: s.label,
  color: s.color,
  sectorId: s.id
})));

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt = (n, d = 2) => Number(n).toLocaleString("en-US", {
  minimumFractionDigits: d,
  maximumFractionDigits: d
});
const fmtUSD = n => "$" + fmt(n);
const fmtK = n => n >= 1000 ? "$" + fmt(n / 1000, 1) + "K" : fmtUSD(n);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const nowStr = () => new Date().toLocaleTimeString([], {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

// Round identities (mirrors current sim)
const ROUND_RULES_CD = [{
  round: 1,
  name: "The Hawk Returns",
  color: "#00f5c4",
  icon: "🏛️",
  volMult: 0.8,
  leaderHidden: false,
  briefing: "Fed hawkishness reprices risk."
}, {
  round: 2,
  name: "Silicon Iron Curtain",
  color: "#fbbf24",
  icon: "🛰️",
  volMult: 1.1,
  leaderHidden: false,
  briefing: "Industrial policy and export controls hit the tape."
}, {
  round: 3,
  name: "Oil Strait Crisis",
  color: "#ef4444",
  icon: "🛢️",
  volMult: 1.35,
  leaderHidden: false,
  briefing: "A shipping shock drives oil higher and liquidity lower."
}, {
  round: 4,
  name: "Debt Ceiling Roulette",
  color: "#f97316",
  icon: "🏦",
  volMult: 1.25,
  leaderHidden: false,
  briefing: "Funding stress and Treasury brinkmanship rattle markets."
}, {
  round: 5,
  name: "Election-Year America",
  color: "#a78bfa",
  icon: "🗳️",
  volMult: 1.15,
  leaderHidden: true,
  briefing: "The leaderboard goes dark under policy uncertainty."
}, {
  round: 6,
  name: "Credit Crack",
  color: "#fb923c",
  icon: "⚡",
  volMult: 1.7,
  leaderHidden: false,
  briefing: "Credit spreads blow out and recession fear deepens."
}, {
  round: 7,
  name: "America Reprices",
  color: "#e879f9",
  icon: "🦅",
  volMult: 2.0,
  leaderHidden: false,
  briefing: "Everything reprices in the final stress round."
}];
function calcScore(entry, initCash) {
  const total = entry?.netEquity != null ? entry.netEquity : entry?.total || 0;
  const roi = initCash > 0 ? (total - initCash) / initCash * 100 : 0;
  const score = Number.isFinite(entry?.score) ? entry.score : roi;
  return {
    roi,
    score
  };
}
function sortLiveEntries(entries = []) {
  return [...entries].sort((a, b) => {
    const eqA = a?.netEquity != null ? a.netEquity : a?.total || 0;
    const eqB = b?.netEquity != null ? b.netEquity : b?.total || 0;
    if (Math.abs(eqB - eqA) > 0.01) return eqB - eqA;
    if (Math.abs((b?.crisisAlpha || 0) - (a?.crisisAlpha || 0)) > 0.001) return (b?.crisisAlpha || 0) - (a?.crisisAlpha || 0);
    if ((a?.marginBreaches || 0) !== (b?.marginBreaches || 0)) return (a?.marginBreaches || 0) - (b?.marginBreaches || 0);
    if (Math.abs((a?.maxDrawdown || 0) - (b?.maxDrawdown || 0)) > 0.001) return (a?.maxDrawdown || 0) - (b?.maxDrawdown || 0);
    return (a?.lastTradeTs || Date.now()) - (b?.lastTradeTs || Date.now());
  });
}
function sortFinalEntries(entries = []) {
  return [...entries].sort((a, b) => {
    const scoreA = Number.isFinite(a?.score) ? a.score : 0;
    const scoreB = Number.isFinite(b?.score) ? b.score : 0;
    if (Math.abs(scoreB - scoreA) > 0.001) return scoreB - scoreA;
    if (Math.abs((b?.tb1 || 0) - (a?.tb1 || 0)) > 0.01) return (b?.tb1 || 0) - (a?.tb1 || 0);
    if (Math.abs((b?.tb2 || 0) - (a?.tb2 || 0)) > 0.0001) return (b?.tb2 || 0) - (a?.tb2 || 0);
    if ((a?.tb3 || 0) !== (b?.tb3 || 0)) return (a?.tb3 || 0) - (b?.tb3 || 0);
    if (Math.abs((a?.tb4 || 0) - (b?.tb4 || 0)) > 0.0001) return (a?.tb4 || 0) - (b?.tb4 || 0);
    return (a?.tb5 || 0) - (b?.tb5 || 0);
  });
}
function findStockMeta(ticker) {
  return STOCKS.find(s => s.ticker === ticker) || {
    ticker,
    name: ticker,
    color: "#94a3b8",
    sectorId: null,
    sector: "Market"
  };
}
function normalizeNewsItem(item = {}) {
  const stock = findStockMeta(item.ticker || item.underlyingTicker || "MARKET");
  return {
    ...item,
    ticker: item.ticker || item.underlyingTicker || "MARKET",
    sectorId: item.sectorId || stock.sectorId || null,
    sentiment: item.sentiment || ((item.impact || 0) >= 0 ? "bull" : "bear"),
    round: Number.isFinite(item.round) ? item.round : Number.isFinite(item.storylineRound) ? item.storylineRound : null
  };
}
function isMacroInferencePack(events = []) {
  return events.length > 0 && events.every(evt => evt?.political || evt?.storyline);
}
function getDisplayInferenceClues(events = []) {
  const lead = events[0] || {};
  if (Array.isArray(lead.playerClues) && lead.playerClues.length) return lead.playerClues;
  return ["Translate the macro bulletin into financing pressure, demand shifts, and pricing power.", "Let the tape confirm your thesis instead of expecting the bulletin to name names.", "Second-order winners and losers often matter more than the obvious first move."];
}
function buildCentralMacroFallback(events = []) {
  const lead = events[0];
  if (!lead) return null;
  return {
    ticker: "MARKET",
    hideTicker: true,
    headline: lead.eventName ? `${lead.eventIcon ? `${lead.eventIcon} ` : ""}${lead.eventName}` : lead.headline || "Macro bulletin",
    detail: lead.storylineBlurb || lead.eventSubheadline || lead.detail || "Markets are repricing a macro bulletin. Teams must infer the exposed names from first principles.",
    sentiment: "neutral",
    tag: lead.eventTag || (lead.political ? "MACRO EVENT" : "MARKET UPDATE"),
    time: lead.time || "LIVE",
    playerClues: getDisplayInferenceClues(events),
    macroQuestion: lead.macroQuestion || null
  };
}

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
function Spark({
  data,
  color,
  w = 80,
  h = 28
}) {
  if (!data || data.length < 2) return /*#__PURE__*/React.createElement("div", {
    style: {
      width: w,
      height: h
    }
  });
  const mn = Math.min(...data),
    mx = Math.max(...data),
    range = mx - mn || 1;
  const pts = data.map((v, i) => `${i / (data.length - 1) * w},${h - (v - mn) / range * (h - 3) + 1}`).join(" ");
  const up = data[data.length - 1] >= data[0];
  const c = up ? color : "#ef4444";
  return /*#__PURE__*/React.createElement("svg", {
    width: w,
    height: h,
    viewBox: `0 0 ${w} ${h}`,
    style: {
      display: "block",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: `sg${color.replace(/\W/g, "")}`,
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: c,
    stopOpacity: "0.25"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: c,
    stopOpacity: "0"
  }))), /*#__PURE__*/React.createElement("polygon", {
    points: `0,${h} ${pts} ${w},${h}`,
    fill: `url(#sg${color.replace(/\W/g, "")})`
  }), /*#__PURE__*/React.createElement("polyline", {
    points: pts,
    fill: "none",
    stroke: c,
    strokeWidth: "2",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }));
}

// ─── RANK BADGE ───────────────────────────────────────────────────────────────
function RankBadge({
  rank
}) {
  const configs = {
    1: {
      bg: "linear-gradient(135deg,#f59e0b,#d97706)",
      color: "#020817",
      icon: "🥇"
    },
    2: {
      bg: "linear-gradient(135deg,#94a3b8,#64748b)",
      color: "#020817",
      icon: "🥈"
    },
    3: {
      bg: "linear-gradient(135deg,#b45309,#92400e)",
      color: "#f1f5f9",
      icon: "🥉"
    }
  };
  const cfg = configs[rank] || {
    bg: "#1e293b",
    color: "#475569",
    icon: null
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 44,
      height: 44,
      borderRadius: 12,
      flexShrink: 0,
      background: cfg.bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: rank <= 3 ? 22 : 18,
      fontWeight: 900,
      color: cfg.color,
      boxShadow: rank === 1 ? "0 0 20px rgba(245,158,11,0.5)" : rank === 2 ? "0 0 12px rgba(148,163,184,0.3)" : "none"
    }
  }, cfg.icon || rank);
}

// ─── ROUND PROGRESS PIPS ─────────────────────────────────────────────────────
function RoundPips({
  current,
  total = TOTAL_ROUNDS
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      alignItems: "center"
    }
  }, Array.from({
    length: total
  }, (_, i) => {
    const roundN = i + 1;
    const done = roundN < current;
    const active = roundN === current;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        width: active ? 28 : 16,
        height: 16,
        borderRadius: 8,
        background: done ? "#00f5c4" : active ? "#f1f5f9" : "#1e293b",
        border: active ? "2px solid #00f5c4" : "2px solid transparent",
        transition: "all 0.4s ease",
        boxShadow: active ? "0 0 12px #00f5c4" : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 9,
        color: done ? "#020817" : active ? "#020817" : "#334155",
        fontWeight: 800
      }
    }, done && "✓");
  }));
}

// ─── TRADE FLASH ITEM ────────────────────────────────────────────────────────
function TradeFlash({
  trade
}) {
  const stock = findStockMeta(trade.ticker);
  const action = trade.action || "";
  const isBuy = ["BUY", "COVER", "FUT CLOSE", "PUT BUY", "CALL BUY", "FUT LONG"].some(flag => action.includes(flag));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      background: isBuy ? "rgba(0,245,196,0.05)" : "rgba(239,68,68,0.05)",
      border: `1px solid ${isBuy ? "#00f5c420" : "#ef444420"}`,
      borderLeft: `3px solid ${isBuy ? "#00f5c4" : "#ef4444"}`,
      borderRadius: 8,
      padding: "8px 12px",
      marginBottom: 6,
      animation: "tradeSlide 0.4s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: isBuy ? "#00f5c4" : "#ef4444",
      boxShadow: `0 0 6px ${isBuy ? "#00f5c4" : "#ef4444"}`,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 800,
      fontSize: 13,
      color: trade.teamColor || "#94a3b8"
    }
  }, trade.team), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "#475569"
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: isBuy ? "#00f5c4" : "#ef4444"
    }
  }, isBuy ? "▲ BUY" : "▼ SELL"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: stock?.color,
      fontWeight: 700
    }
  }, trade.ticker), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "#64748b"
    }
  }, "\xD7", trade.qty)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      marginTop: 2
    }
  }, fmtUSD(trade.price), " \xB7 ", trade.time)), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 800,
      color: isBuy ? "#ef4444" : "#00f5c4"
    }
  }, isBuy ? "-" : "+", fmtK(trade.qty * trade.price))));
}

// ─── DISRUPTION CARD ─────────────────────────────────────────────────────────
function DisruptionCard({
  events,
  bufferLeft,
  phase = "buffer"
}) {
  const [revealed, setRevealed] = useState(0);
  const eventCount = events?.length || 0;
  const eventsKey = (events || []).map(evt => [evt.storylineId || evt.eventName || evt.headline || evt.ticker || "event", evt.ticker || "MARKET", evt.impact || 0].join(":")).join("|");
  useEffect(() => {
    if (revealed < eventCount) {
      const t = setTimeout(() => setRevealed(r => r + 1), 700);
      return () => clearTimeout(t);
    }
  }, [eventCount, eventsKey, revealed]);
  useEffect(() => {
    setRevealed(0);
  }, [eventsKey]);
  const isPoliticalBuffer = (events || []).some(evt => evt.political && !evt.storyline);
  const totalBuffer = isPoliticalBuffer ? POLITICAL_BUFFER_SECONDS : BUFFER_SECONDS;
  const pct = bufferLeft != null ? clamp(bufferLeft / Math.max(1, totalBuffer) * 100, 0, 100) : 0;
  const bMins = bufferLeft != null ? Math.floor(bufferLeft / 60) : 0;
  const bSecs = bufferLeft != null ? bufferLeft % 60 : 0;
  const liveDisruption = phase === "disruption";
  const macroInferencePack = isMacroInferencePack(events || []);
  const leadEvent = events?.[0] || null;
  const inferenceClues = getDisplayInferenceClues(events || []);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0a0f1e",
      border: "2px solid #ef4444",
      borderRadius: 16,
      boxShadow: "0 0 60px rgba(239,68,68,0.25), inset 0 0 40px rgba(239,68,68,0.04)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "linear-gradient(135deg,#450a0a,#7f1d1d)",
      padding: "16px 22px",
      borderBottom: "1px solid #ef444440",
      display: "flex",
      alignItems: "center",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      animation: "blink 0.8s step-end infinite"
    }
  }, "\uD83D\uDEA8"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 900,
      fontSize: 20,
      color: "#fef2f2",
      letterSpacing: "-0.01em"
    }
  }, liveDisruption ? "MARKET DISRUPTION LIVE" : "MARKET DISRUPTION ALERT"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#fca5a5",
      letterSpacing: "0.2em",
      marginTop: 2
    }
  }, liveDisruption ? "REPRICING NOW ACROSS THE MARKET" : "TAKING EFFECT NEXT ROUND")), !liveDisruption && bufferLeft != null && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#fca5a5",
      marginBottom: 4
    }
  }, "NEXT ROUND IN"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontSize: 28,
      fontWeight: 900,
      color: bMins < 1 ? "#ef4444" : "#f1f5f9",
      animation: bMins < 1 ? "pulse 0.5s infinite" : "none"
    }
  }, String(bMins).padStart(2, "0"), ":", String(bSecs).padStart(2, "0")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      height: 3,
      background: "#7f1d1d",
      borderRadius: 2,
      width: 80
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      background: "#ef4444",
      borderRadius: 2,
      width: `${pct}%`,
      transition: "width 1s linear"
    }
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, macroInferencePack && leadEvent ? /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0f172a",
      border: "1px solid #1e293b",
      borderRadius: 12,
      padding: "16px 18px",
      display: "grid",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 24
    }
  }, leadEvent.eventIcon || "🧭"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#38bdf8",
      fontWeight: 800,
      letterSpacing: "0.14em",
      marginBottom: 4
    }
  }, "CENTRAL INFERENCE BRIEF"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      color: "#f8fafc",
      fontWeight: 800,
      lineHeight: 1.35
    }
  }, leadEvent.eventName || leadEvent.headline || "Macro bulletin")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      letterSpacing: "0.12em"
    }
  }, "NO DIRECT TICKER HINTS")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#020817",
      border: "1px solid #1e293b",
      borderRadius: 10,
      padding: "12px 14px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "#fbbf24",
      fontWeight: 800,
      letterSpacing: "0.14em",
      marginBottom: 6
    }
  }, "INFERENCE BRIEF"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "#e2e8f0",
      lineHeight: 1.7
    }
  }, leadEvent.storylineBlurb || leadEvent.eventSubheadline || leadEvent.detail || "Teams must infer the affected names from the macro bulletin and market reaction.")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#020817",
      border: "1px solid #1e293b",
      borderRadius: 10,
      padding: "12px 14px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "#38bdf8",
      fontWeight: 800,
      letterSpacing: "0.14em",
      marginBottom: 8
    }
  }, "WHAT TEAMS SHOULD INFER"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 7
    }
  }, inferenceClues.slice(0, 3).map((clue, index) => /*#__PURE__*/React.createElement("div", {
    key: `${index}:${clue}`,
    style: {
      display: "flex",
      gap: 8,
      fontSize: 12,
      color: "#94a3b8",
      lineHeight: 1.6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#38bdf8",
      fontWeight: 800,
      flexShrink: 0
    }
  }, index + 1, "."), /*#__PURE__*/React.createElement("span", null, clue))))), leadEvent.macroQuestion && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#020817",
      border: "1px solid #1e293b",
      borderRadius: 10,
      padding: "12px 14px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "#fbbf24",
      fontWeight: 800,
      letterSpacing: "0.14em",
      marginBottom: 6
    }
  }, "TEAM CHALLENGE"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "#e5e7eb",
      lineHeight: 1.65
    }
  }, leadEvent.macroQuestion))) : events?.slice(0, 3).map((evt, i) => {
    const stock = findStockMeta(evt.ticker);
    const up = evt.impact > 0;
    return i < revealed ? /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        background: "#0f172a",
        border: `1px solid ${up ? "#16653440" : "#7f1d1d40"}`,
        borderLeft: `4px solid ${up ? "#00f5c4" : "#ef4444"}`,
        borderRadius: 10,
        padding: "14px 16px",
        animation: "tradeSlide 0.5s ease"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 10,
        height: 10,
        borderRadius: "50%",
        flexShrink: 0,
        background: up ? "#00f5c4" : "#ef4444",
        boxShadow: `0 0 10px ${up ? "#00f5c4" : "#ef4444"}`
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        color: stock?.color,
        fontWeight: 800,
        fontSize: 15
      }
    }, evt.ticker), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#64748b",
        fontSize: 12
      }
    }, stock?.name), /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: "auto",
        display: "flex",
        alignItems: "center",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14,
        fontWeight: 900,
        color: up ? "#00f5c4" : "#ef4444"
      }
    }, up ? "▲" : "▼", " ", Math.abs(evt.impact), "%"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 4,
        background: up ? "rgba(0,245,196,0.12)" : "rgba(239,68,68,0.12)",
        color: up ? "#00f5c4" : "#ef4444",
        fontWeight: 700
      }
    }, up ? "BULLISH" : "BEARISH"))), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        color: "#f1f5f9",
        fontWeight: 600,
        lineHeight: 1.5,
        marginBottom: 6
      }
    }, evt.headline), evt.detail && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "#64748b",
        fontStyle: "italic",
        lineHeight: 1.5
      }
    }, evt.detail)) : /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        height: 80,
        background: "#0f172a",
        borderRadius: 10,
        border: "1px solid #1e293b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#1e293b",
        fontSize: 11,
        letterSpacing: "0.2em"
      }
    }, "DECRYPTING...");
  })));
}
function CentralDisruptionTakeover({
  events,
  bufferLeft,
  newsGroups,
  roundNum,
  phase,
  currentTime
}) {
  const roundKey = String(roundNum);
  const roundNews = newsGroups.find(([key]) => key === roundKey)?.[1] || [];
  const generalNews = newsGroups.find(([key]) => key === "general")?.[1] || [];
  const macroFallback = isMacroInferencePack(events || []) ? buildCentralMacroFallback(events || []) : null;
  const fallbackFeed = macroFallback ? [macroFallback] : (events || []).slice(0, 6).map((evt, index) => ({
    ticker: evt.ticker || "MARKET",
    headline: evt.eventName ? `${evt.eventIcon ? `${evt.eventIcon} ` : ""}${evt.eventName} — ${evt.headline}` : evt.headline,
    detail: evt.detail,
    sentiment: evt.impact > 0 ? "bull" : "bear",
    tag: evt.eventTag || (evt.political ? "POLITICAL EVENT" : "BUFFER EVENT"),
    time: evt.time || `LIVE ${index + 1}`
  }));
  const feed = [...roundNews, ...generalNews].slice(0, 6);
  const visibleFeed = feed.length > 0 ? feed : fallbackFeed;
  const liveDisruption = phase === "disruption";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: "grid",
      gridTemplateRows: "auto 1fr auto",
      background: "radial-gradient(circle at top left, rgba(239,68,68,0.18), transparent 35%), radial-gradient(circle at bottom right, rgba(56,189,248,0.1), transparent 30%), #020817"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "18px 24px 16px",
      borderBottom: "1px solid #3f1d1d",
      background: "linear-gradient(90deg,rgba(69,10,10,0.98),rgba(15,23,42,0.96))",
      display: "flex",
      alignItems: "center",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 34,
      animation: "blink 0.8s step-end infinite"
    }
  }, "\uD83D\uDEA8"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontSize: 26,
      fontWeight: 900,
      color: "#fee2e2",
      letterSpacing: "-0.02em"
    }
  }, liveDisruption ? "LIVE DISRUPTION ON THE TAPE" : `ROUND ${roundNum} DISRUPTION BULLETIN`), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#fca5a5",
      letterSpacing: "0.16em",
      marginTop: 4
    }
  }, liveDisruption ? "MARKET PRICES ARE REPRICING NOW" : "FULL-SCREEN BUFFER BRIEFING ON CENTRAL DISPLAY")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#94a3b8",
      letterSpacing: "0.14em"
    }
  }, "CENTRAL CLOCK"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: 30,
      lineHeight: 1,
      color: "#f8fafc"
    }
  }, currentTime))), /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: 0,
      display: "grid",
      gridTemplateColumns: "minmax(0,1.35fr) minmax(320px,0.85fr)",
      gap: 18,
      padding: "18px 20px 16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(DisruptionCard, {
    events: events,
    bufferLeft: liveDisruption ? null : bufferLeft,
    phase: phase
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      background: "#08101d",
      border: "1px solid #1f2937",
      borderRadius: 18,
      overflow: "hidden",
      boxShadow: "0 0 40px rgba(15,23,42,0.45)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "14px 16px 12px",
      borderBottom: "1px solid #111827"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 900,
      fontSize: 18,
      color: "#f8fafc"
    }
  }, "ROUND ", roundNum, " NEWS DESK"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      letterSpacing: "0.14em",
      marginTop: 4
    }
  }, "TEAM-FACING NEWS, STORY BEATS, AND DISRUPTION CONTEXT")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: "12px 14px"
    }
  }, visibleFeed.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 32,
      opacity: 0.14
    }
  }, "\uD83D\uDCF0"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#334155",
      letterSpacing: "0.16em"
    }
  }, "AWAITING NEWS FEED")) : visibleFeed.map((item, index) => {
    const stock = findStockMeta(item.ticker);
    const tone = item.sentiment === "bull" ? "#00f5c4" : item.sentiment === "bear" ? "#ef4444" : "#38bdf8";
    return /*#__PURE__*/React.createElement("div", {
      key: `${item.ticker}-${item.time || index}-${index}`,
      style: {
        background: "#0a0f1e",
        border: `1px solid ${tone}20`,
        borderLeft: `3px solid ${tone}`,
        borderRadius: 10,
        padding: "11px 12px",
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 7,
        marginBottom: 5,
        flexWrap: "wrap"
      }
    }, !item.hideTicker && /*#__PURE__*/React.createElement("span", {
      style: {
        color: stock.color,
        fontWeight: 800,
        fontSize: 12
      }
    }, item.ticker), item.tag && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 8,
        padding: "2px 6px",
        borderRadius: 999,
        background: "#0f172a",
        border: "1px solid #1e293b",
        color: "#94a3b8",
        letterSpacing: "0.08em"
      }
    }, item.tag), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 8,
        color: "#475569"
      }
    }, item.time)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "#e2e8f0",
        lineHeight: 1.5,
        fontWeight: 700
      }
    }, item.headline), item.detail && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: "#64748b",
        marginTop: 5,
        lineHeight: 1.45
      }
    }, item.detail), Array.isArray(item.playerClues) && item.playerClues.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 8,
        display: "grid",
        gap: 5
      }
    }, item.playerClues.slice(0, 3).map((clue, clueIndex) => /*#__PURE__*/React.createElement("div", {
      key: `${clueIndex}:${clue}`,
      style: {
        display: "flex",
        gap: 7,
        fontSize: 10,
        color: "#94a3b8",
        lineHeight: 1.5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#38bdf8",
        fontWeight: 800,
        flexShrink: 0
      }
    }, clueIndex + 1, "."), /*#__PURE__*/React.createElement("span", null, clue)))), item.macroQuestion && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 8,
        padding: "8px 10px",
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 8
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 8,
        color: "#fbbf24",
        fontWeight: 800,
        letterSpacing: "0.12em",
        marginBottom: 4
      }
    }, "TEAM CHALLENGE"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: "#e5e7eb",
        lineHeight: 1.55
      }
    }, item.macroQuestion)));
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 34,
      borderTop: "1px solid #111827",
      background: "#030712",
      display: "flex",
      alignItems: "center",
      padding: "0 20px",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      letterSpacing: "0.14em"
    }
  }, liveDisruption ? "DISRUPTION MODE" : "BUFFER MODE"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#1e293b"
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569"
    }
  }, "ROUND ", roundNum, "/", TOTAL_ROUNDS), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#1e293b"
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569"
    }
  }, events.length, " MARKET EVENT", events.length === 1 ? "" : "S"), !liveDisruption && bufferLeft != null && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#1e293b"
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#38bdf8"
    }
  }, "NEXT ROUND IN ", String(Math.floor(bufferLeft / 60)).padStart(2, "0"), ":", String(bufferLeft % 60).padStart(2, "0")))));
}

// ─── MAIN CENTRAL DISPLAY ─────────────────────────────────────────────────────
function CentralDisplay() {
  const [screen, setScreen] = useState("login");
  const [cdPass, setCdPass] = useState("");
  const [passErr, setPassErr] = useState("");

  // ── shared state from storage ──────────────────────────────────────────
  const [leaderboard, setLeaderboard] = useState([]);
  const [tradeStream, setTradeStream] = useState([]);
  const [news, setNews] = useState([]);
  const [disruptions, setDisruptions] = useState([]);
  const [gamePhase, setGamePhase] = useState("idle"); // idle|running|buffer|disruption|ended
  const [roundNum, setRoundNum] = useState(1);
  const [roundTimeLeft, setRoundTimeLeft] = useState(null);
  const [roundEndsAt, setRoundEndsAt] = useState(null);
  const [bufferLeft, setBufferLeft] = useState(null);
  const [bufferEndsAt, setBufferEndsAt] = useState(null);
  const [prices, setPrices] = useState({});
  const [priceHistory, setPriceHistory] = useState({});
  const [sentiment, setSentiment] = useState("neutral");
  const [broadcast, setBroadcast] = useState(null);
  const [currentTime, setCurrentTime] = useState(nowStr());
  const [teams, setTeams] = useState([]);
  const [initCash, setInitCash] = useState(INITIAL_CASH);
  const [allRoundEnded, setAllRoundEnded] = useState(false);
  const [leaderHidden, setLeaderHidden] = useState(false);
  const [volMultiplier, setVolMultiplier] = useState(1.0);
  const phaseRef = useRef(gamePhase);
  const lastTradeRef = useRef(null);
  const lastBcastRef = useRef(null);
  phaseRef.current = gamePhase;

  // ── clock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(nowStr()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── poll shared storage ────────────────────────────────────────────────
  const poll = useCallback(async () => {
    try {
      // leaderboard
      const lbRes = await window.storage.list("lb:", true);
      const lbKeys = lbRes?.keys || [];
      const lbRows = (await Promise.all(lbKeys.map(async k => {
        try {
          const r = await window.storage.get(k, true);
          return r ? JSON.parse(r.value) : null;
        } catch {
          return null;
        }
      }))).filter(Boolean);
      setLeaderboard(lbRows.sort((a, b) => b.total - a.total));

      // game state
      const gsR = await window.storage.get("gm:state", true);
      if (gsR) {
        const gs = JSON.parse(gsR.value);
        if (gs.phase) setGamePhase(gs.phase);
        if (gs.round) setRoundNum(gs.round);
        if (gs.roundLeft !== undefined) setRoundTimeLeft(gs.roundLeft);
        if (gs.roundEndsAt !== undefined) setRoundEndsAt(gs.roundEndsAt);
        if (gs.leaderHidden !== undefined) setLeaderHidden(gs.leaderHidden || false);
        if (gs.volMultiplier !== undefined) setVolMultiplier(gs.volMultiplier || 1);
        if (gs.bufferLeft !== undefined) setBufferLeft(gs.bufferLeft);
        if (gs.bufferEndsAt !== undefined) setBufferEndsAt(gs.bufferEndsAt);
        if (gs.initCash) setInitCash(gs.initCash);
        setAllRoundEnded(!!gs.allEnded || gs.phase === "ended");
        if (gs.sentiment) setSentiment(gs.sentiment);
      }

      // prices + history
      const prR = await window.storage.get("gm:prices", true);
      if (prR) {
        const pr = JSON.parse(prR.value);
        if (pr.prices) setPrices(pr.prices);
        if (pr.history) setPriceHistory(pr.history);
      }

      // teams
      const tmR = await window.storage.get("gm:teams", true);
      if (tmR) setTeams(JSON.parse(tmR.value));

      // trade stream
      const trR = await window.storage.get("cd:trades", true);
      if (trR) {
        const tr = JSON.parse(trR.value);
        if (tr.id !== lastTradeRef.current) {
          lastTradeRef.current = tr.id;
          setTradeStream(prev => [tr, ...prev].slice(0, 40));
        }
      }

      // disruption events
      const diR = await window.storage.get("gm:disruptions", true);
      if (diR) {
        const di = JSON.parse(diR.value);
        setDisruptions(di.events || []);
      }

      // round-wise newswire
      const newsR = await window.storage.get("gm:news", true);
      if (newsR) {
        const payload = JSON.parse(newsR.value);
        const items = Array.isArray(payload?.items) ? payload.items.map(item => normalizeNewsItem(item)).slice(0, NEWS_HISTORY_LIMIT) : [];
        setNews(items);
      }

      // broadcast
      const bcR = await window.storage.get("gm:broadcast", true);
      if (bcR) {
        const bc = JSON.parse(bcR.value);
        if (bc.id !== lastBcastRef.current) {
          lastBcastRef.current = bc.id;
          setBroadcast(bc);
          setTimeout(() => setBroadcast(null), 8000);
        }
      }
    } catch (e) {/* silent */}
  }, []);
  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);
  useEffect(() => {
    if (gamePhase !== "running" || !roundEndsAt) return undefined;
    const syncCountdown = () => {
      setRoundTimeLeft(Math.max(0, Math.ceil((roundEndsAt - Date.now()) / 1000)));
    };
    syncCountdown();
    const id = setInterval(syncCountdown, 200);
    return () => clearInterval(id);
  }, [gamePhase, roundEndsAt]);
  useEffect(() => {
    if (gamePhase !== "buffer" || !bufferEndsAt) return undefined;
    const syncCountdown = () => {
      setBufferLeft(Math.max(0, Math.ceil((bufferEndsAt - Date.now()) / 1000)));
    };
    syncCountdown();
    const id = setInterval(syncCountdown, 200);
    return () => clearInterval(id);
  }, [bufferEndsAt, gamePhase]);

  // ── derived ────────────────────────────────────────────────────────────
  const finalMode = allRoundEnded || gamePhase === "ended";
  const ranked = (finalMode ? sortFinalEntries : sortLiveEntries)(leaderboard.map(e => {
    const {
      roi,
      score
    } = calcScore(e, initCash);
    const total = e?.netEquity != null ? e.netEquity : e.total || 0;
    const holdVal = total - (e.cash || 0);
    const pnl = total - initCash;
    const uniquePositions = e.uniqueSectors || e.uniqueStocks || e.sectors?.length || 0;
    return {
      ...e,
      total,
      roi,
      score,
      holdVal,
      pnl,
      uniquePositions
    };
  }));
  const tickerTapeStocks = Object.keys(prices || {}).length ? Object.keys(prices).map(ticker => findStockMeta(ticker)) : STOCKS;
  const timerMins = roundTimeLeft != null ? Math.floor(roundTimeLeft / 60) : null;
  const timerSecs = roundTimeLeft != null ? roundTimeLeft % 60 : null;
  const timerUrgent = timerMins != null && timerMins < 3;
  const timerCritical = timerMins != null && timerMins < 1;
  const bufMins = bufferLeft != null ? Math.floor(bufferLeft / 60) : null;
  const bufSecs = bufferLeft != null ? bufferLeft % 60 : null;
  const isBuffer = gamePhase === "buffer";
  const isDisruption = gamePhase === "disruption";
  const isRunning = gamePhase === "running";
  const isPaused = gamePhase === "paused";
  const isIdle = gamePhase === "idle";
  const showDisruptionTakeover = (isBuffer || isDisruption) && disruptions.length > 0;
  const takeoverRoundNum = showDisruptionTakeover ? Number.isFinite(disruptions?.[0]?.storylineRound) ? disruptions[0].storylineRound : Math.min(roundNum + 1, TOTAL_ROUNDS) : roundNum;
  const sentimentConfig = {
    bull: {
      label: "BULL MARKET",
      color: "#00f5c4",
      icon: "📈"
    },
    bear: {
      label: "BEAR MARKET",
      color: "#ef4444",
      icon: "📉"
    },
    volatile: {
      label: "HIGH VOLATILITY",
      color: "#fbbf24",
      icon: "⚡"
    },
    neutral: {
      label: "NEUTRAL",
      color: "#64748b",
      icon: "〰"
    }
  };
  const sentCfg = sentimentConfig[sentiment] || sentimentConfig.neutral;
  const newsRoundGroups = Object.entries(news.reduce((groups, item) => {
    const roundKey = Number.isFinite(item?.round) && item.round > 0 ? String(item.round) : "general";
    if (!groups[roundKey]) groups[roundKey] = [];
    groups[roundKey].push(item);
    return groups;
  }, {})).sort((a, b) => {
    if (a[0] === "general") return 1;
    if (b[0] === "general") return -1;
    return Number(b[0]) - Number(a[0]);
  });

  // winner for final screen
  const champion = finalMode && ranked[0];
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
    return /*#__PURE__*/React.createElement("div", {
      style: {
        minHeight: "100vh",
        background: "#020817",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'JetBrains Mono','Courier New',monospace",
        backgroundImage: "radial-gradient(ellipse at 50% 40%, rgba(0,245,196,0.06) 0%, transparent 65%)"
      }
    }, /*#__PURE__*/React.createElement("style", null, CSS_LOGIN), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
        background: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px)"
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        width: 420,
        padding: 48,
        animation: "fadeup 0.5s ease",
        position: "relative",
        zIndex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        marginBottom: 44
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        letterSpacing: "0.45em",
        color: "#334155",
        marginBottom: 14
      }
    }, "CENTRAL DISPLAY TERMINAL"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Bebas Neue',sans-serif",
        fontSize: 72,
        lineHeight: 1,
        background: "linear-gradient(135deg,#00f5c4,#38bdf8)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        marginBottom: 8
      }
    }, "BULL PIT"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "#475569",
        letterSpacing: "0.05em"
      }
    }, "Where fortunes are forged in seconds"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: 20
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        height: 1,
        background: "linear-gradient(90deg,transparent,#1e293b)"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        color: "#334155",
        letterSpacing: "0.2em"
      }
    }, "SECURE ACCESS"), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        height: 1,
        background: "linear-gradient(90deg,#1e293b,transparent)"
      }
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        background: "#0a0f1e",
        border: "1px solid #1e293b",
        borderRadius: 14,
        padding: "28px 28px 24px",
        boxShadow: "0 0 60px rgba(0,245,196,0.05)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: "#475569",
        letterSpacing: "0.15em",
        marginBottom: 10
      }
    }, "DISPLAY PASSWORD"), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative",
        marginBottom: passErr ? 8 : 16
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "password",
      value: cdPass,
      onChange: e => {
        setCdPass(e.target.value);
        setPassErr("");
      },
      onKeyDown: e => {
        if (e.key === "Enter") {
          if (cdPass === CD_PASSWORD) setScreen("display");else setPassErr("Incorrect password.");
        }
      },
      placeholder: "Enter display password\u2026",
      autoFocus: true,
      style: {
        width: "100%",
        padding: "13px 16px",
        background: "#020817",
        border: `1px solid ${passErr ? "#ef4444" : "#1e293b"}`,
        color: "#f1f5f9",
        borderRadius: 8,
        fontSize: 14,
        fontFamily: "inherit",
        outline: "none",
        transition: "border-color 0.2s"
      }
    })), passErr && /*#__PURE__*/React.createElement("div", {
      style: {
        color: "#ef4444",
        fontSize: 11,
        marginBottom: 12
      }
    }, passErr), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (cdPass === CD_PASSWORD) setScreen("display");else setPassErr("Incorrect password.");
      },
      style: {
        width: "100%",
        padding: "13px",
        background: "linear-gradient(135deg,#00f5c4,#38bdf8)",
        border: "none",
        borderRadius: 9,
        color: "#020817",
        fontSize: 13,
        fontWeight: 800,
        cursor: "pointer",
        fontFamily: "inherit",
        letterSpacing: "0.08em",
        transition: "opacity 0.2s"
      }
    }, "LAUNCH DISPLAY \u2192"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 16,
        textAlign: "center",
        fontSize: 9,
        color: "#1e293b",
        letterSpacing: "0.1em"
      }
    }, "FOR OPERATOR USE ONLY \xB7 PROJECTOR / MAIN SCREEN")), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        marginTop: 20,
        fontSize: 9,
        color: "#1e293b"
      }
    }, "BULL PIT \xA9 2025 \xB7 CENTRAL DISPLAY v4")));
  }

  // ─── CHAMPION SCREEN ────────────────────────────────────────────────────
  if (allRoundEnded && champion) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        width: "100vw",
        height: "100vh",
        background: "#020817",
        overflow: "hidden",
        fontFamily: "'JetBrains Mono','Courier New',monospace",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundImage: "radial-gradient(ellipse at center, rgba(251,191,36,0.1) 0%, transparent 65%)"
      }
    }, /*#__PURE__*/React.createElement("style", null, CSS), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        animation: "championReveal 1s ease"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Bebas Neue',sans-serif",
        fontSize: "8vw",
        color: "#334155",
        letterSpacing: "0.2em",
        marginBottom: 8
      }
    }, "FINAL RESULTS"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Syne',sans-serif",
        fontSize: "3.5vw",
        fontWeight: 900,
        color: "#fbbf24",
        textShadow: "0 0 80px rgba(251,191,36,0.6)",
        marginBottom: 4
      }
    }, "\uD83C\uDFC6 CHAMPION"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Syne',sans-serif",
        fontSize: "6vw",
        fontWeight: 900,
        color: champion.color || "#fbbf24",
        marginBottom: 8,
        textShadow: `0 0 60px ${champion.color || "#fbbf24"}80`
      }
    }, champion.name), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 24,
        justifyContent: "center",
        marginBottom: 40
      }
    }, [{
      l: "FINAL VALUE",
      v: fmtUSD(champion.total),
      c: "#f1f5f9"
    }, {
      l: "ROI",
      v: `+${fmt(champion.roi)}%`,
      c: "#00f5c4"
    }, {
      l: "SCORE",
      v: fmt(champion.score, 1),
      c: "#fbbf24"
    }].map(c => /*#__PURE__*/React.createElement("div", {
      key: c.l,
      style: {
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 12,
        padding: "16px 28px",
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: "#475569",
        letterSpacing: "0.15em",
        marginBottom: 6
      }
    }, c.l), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: "2vw",
        fontWeight: 900,
        color: c.c
      }
    }, c.v)))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 12,
        justifyContent: "center"
      }
    }, ranked.slice(0, 7).map((e, i) => /*#__PURE__*/React.createElement("div", {
      key: e.name,
      style: {
        background: "#0f172a",
        border: `1px solid ${i === 0 ? "#fbbf24" : "#1e293b"}`,
        borderRadius: 10,
        padding: "12px 16px",
        minWidth: 120,
        boxShadow: i === 0 ? "0 0 30px rgba(251,191,36,0.3)" : "none"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 18,
        marginBottom: 4
      }
    }, i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`), /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 800,
        fontSize: 12,
        color: e.color || "#94a3b8",
        marginBottom: 2
      }
    }, e.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "#f1f5f9"
      }
    }, fmtUSD(e.total)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: "#64748b"
      }
    }, "ROI ", fmt(e.roi), "%"))))));
  }

  // ─── MAIN DISPLAY ───────────────────────────────────────────────────────
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100vw",
      height: "100vh",
      background: "#020817",
      overflow: "hidden",
      fontFamily: "'JetBrains Mono','Courier New',monospace",
      color: "#f1f5f9",
      display: "flex",
      flexDirection: "column",
      backgroundImage: "radial-gradient(ellipse at 20% 50%, rgba(0,245,196,0.03) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(56,189,248,0.03) 0%, transparent 50%)"
    }
  }, /*#__PURE__*/React.createElement("style", null, CSS), broadcast && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: "linear-gradient(135deg,#0c4a6e,#0f172a)",
      borderBottom: "3px solid #38bdf8",
      padding: "14px 32px",
      display: "flex",
      alignItems: "center",
      gap: 16,
      animation: "fadeup 0.4s ease",
      boxShadow: "0 4px 40px rgba(56,189,248,0.3)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 24
    }
  }, "\uD83D\uDCE2"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 800,
      fontSize: 20,
      color: "#e0f2fe",
      letterSpacing: "0.02em"
    }
  }, broadcast.text)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 28px",
      height: 64,
      flexShrink: 0,
      borderBottom: "1px solid #0f172a",
      background: "linear-gradient(90deg,#020817,#04111f,#020817)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: 42,
      letterSpacing: "0.08em",
      background: "linear-gradient(135deg,#00f5c4,#38bdf8)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      lineHeight: 1
    }
  }, "BULL PIT"), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 28,
      width: 1,
      background: "#1e293b"
    }
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155",
      letterSpacing: "0.25em"
    }
  }, "COMPETITION"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      letterSpacing: "0.15em"
    }
  }, "WHERE FORTUNES ARE FORGED IN SECONDS"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(RoundPips, {
    current: roundNum,
    total: TOTAL_ROUNDS
  }), (() => {
    const rules = ROUND_RULES_CD[roundNum - 1] || ROUND_RULES_CD[0];
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14
      }
    }, rules.icon), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: rules.color,
        fontWeight: 800,
        letterSpacing: "0.1em"
      }
    }, rules.name.toUpperCase()), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: "#334155"
      }
    }, "ROUND ", roundNum, "/", TOTAL_ROUNDS, rules.leaderHidden && " · BOARD HIDDEN", volMultiplier > 1 && ` · ${volMultiplier}× VOL`)));
  })()), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "5px 12px",
      borderRadius: 6,
      background: `${sentCfg.color}15`,
      border: `1px solid ${sentCfg.color}30`
    }
  }, /*#__PURE__*/React.createElement("span", null, sentCfg.icon), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: sentCfg.color,
      fontWeight: 700,
      letterSpacing: "0.1em"
    }
  }, sentCfg.label)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: isRunning ? "#00f5c4" : isPaused ? "#fbbf24" : isDisruption ? "#ef4444" : isBuffer ? "#38bdf8" : "#64748b",
      animation: isRunning ? "pulse 1.5s infinite" : "none",
      boxShadow: isRunning ? "0 0 10px #00f5c4" : "none"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      letterSpacing: "0.15em",
      color: isRunning ? "#00f5c4" : isPaused ? "#fbbf24" : isDisruption ? "#ef4444" : isBuffer ? "#38bdf8" : "#64748b",
      fontWeight: 700
    }
  }, isRunning ? "LIVE" : isPaused ? "PAUSED" : isBuffer ? "BUFFER" : isDisruption ? "DISRUPTION" : "STANDBY")), isRunning && timerMins !== null && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: timerCritical ? 52 : 44,
      lineHeight: 1,
      color: timerCritical ? "#ef4444" : timerUrgent ? "#fbbf24" : "#f1f5f9",
      animation: timerCritical ? "pulse 0.5s infinite" : timerUrgent ? "countdownBoom 1s infinite" : "none",
      textShadow: timerCritical ? "0 0 30px #ef4444" : "none",
      minWidth: 120,
      textAlign: "right"
    }
  }, String(timerMins).padStart(2, "0"), ":", String(timerSecs).padStart(2, "0")), isBuffer && bufMins !== null && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#38bdf8",
      letterSpacing: "0.15em",
      marginBottom: 2
    }
  }, "NEXT ROUND IN"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: 44,
      lineHeight: 1,
      color: "#38bdf8"
    }
  }, String(bufMins).padStart(2, "0"), ":", String(bufSecs).padStart(2, "0"))), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right",
      borderLeft: "1px solid #1e293b",
      paddingLeft: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155",
      letterSpacing: "0.1em"
    }
  }, "LOCAL TIME"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: "#475569",
      fontWeight: 700
    }
  }, currentTime)))), showDisruptionTakeover ? /*#__PURE__*/React.createElement(CentralDisruptionTakeover, {
    events: disruptions,
    bufferLeft: bufferLeft,
    newsGroups: newsRoundGroups,
    roundNum: takeoverRoundNum,
    phase: gamePhase,
    currentTime: currentTime
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 34,
      background: "#040d1a",
      borderBottom: "1px solid #0f172a",
      overflow: "hidden",
      display: "flex",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 0,
      whiteSpace: "nowrap",
      animation: "tickerMove 40s linear infinite"
    }
  }, [...tickerTapeStocks, ...tickerTapeStocks, ...tickerTapeStocks, ...tickerTapeStocks].map((s, i) => {
    const p = prices[s.ticker] || 0;
    const h = priceHistory[s.ticker];
    const prev = h && h.length > 1 ? h[h.length - 2] : p;
    const chg = prev ? (p - prev) / prev * 100 : 0;
    return /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        fontSize: 12,
        padding: "0 20px",
        borderRight: "1px solid #0f172a",
        display: "inline-flex",
        alignItems: "center",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: s.color,
        fontWeight: 800
      }
    }, s.ticker), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#94a3b8",
        fontVariantNumeric: "tabular-nums"
      }
    }, p > 0 ? fmtUSD(p) : "—"), p > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        color: chg >= 0 ? "#00f5c4" : "#ef4444",
        fontSize: 11
      }
    }, chg >= 0 ? "▲" : "▼", fmt(Math.abs(chg)), "%"));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "grid",
      gridTemplateColumns: "1fr 360px",
      gap: 0,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      borderRight: "1px solid #0f172a",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "14px 22px 12px",
      borderBottom: "1px solid #0f172a",
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 900,
      fontSize: 18,
      color: "#f1f5f9",
      letterSpacing: "-0.01em"
    }
  }, "LEADERBOARD"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      fontSize: 9,
      color: "#334155",
      letterSpacing: "0.1em"
    }
  }, finalMode ? "FINAL 105-POINT COMPOSITE SCORE" : "LIVE RANK BY NET EQUITY")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: "12px 16px",
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 10,
      alignContent: "start"
    }
  }, leaderHidden && !finalMode ? /*#__PURE__*/React.createElement("div", {
    style: {
      gridColumn: "1 / -1",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      gap: 14,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 40,
      opacity: 0.25
    }
  }, "\uD83D\uDD76\uFE0F"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 800,
      fontSize: 20,
      color: "#a78bfa"
    }
  }, "LEADERBOARD HIDDEN"), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 420,
      color: "#64748b",
      fontSize: 13,
      lineHeight: 1.7
    }
  }, "This round is running under incomplete-information rules. Teams must trade the policy narrative, not each other.")) : ranked.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 36,
      opacity: 0.2
    }
  }, "\uD83D\uDCCA"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#334155",
      fontSize: 13,
      letterSpacing: "0.1em"
    }
  }, "WAITING FOR PLAYERS")) : ranked.map((entry, i) => {
    const team = teams.find(t => t.name === entry.name);
    const color = team?.color || entry.color || "#64748b";
    const scoreComponents = calcScore(entry, initCash);
    const maxScore = ranked[0]?.score || 1;
    const scorePct = clamp(scoreComponents.score / maxScore * 100, 0, 100);
    const isTop = i === 0;
    const cashPct = entry.total > 0 ? clamp((entry.cash || 0) / entry.total * 100, 0, 100) : 100;
    const holdPct = 100 - cashPct;
    return /*#__PURE__*/React.createElement("div", {
      key: entry.name,
      style: {
        background: isTop ? "linear-gradient(135deg,rgba(251,191,36,0.08),rgba(245,158,11,0.04))" : "#0a0f1e",
        border: `1px solid ${isTop ? "#fbbf2440" : "#111827"}`,
        borderRadius: 12,
        padding: "14px 16px",
        marginBottom: 8,
        animation: isTop ? "glowPulse 3s infinite" : "none",
        transition: "all 0.4s"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 10
      }
    }, /*#__PURE__*/React.createElement(RankBadge, {
      rank: i + 1
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 3
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "'Syne',sans-serif",
        fontWeight: 800,
        fontSize: 16,
        color,
        letterSpacing: "-0.01em",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, entry.name), entry.isBot && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        color: "#334155",
        padding: "1px 6px",
        borderRadius: 3,
        border: "1px solid #1e293b"
      }
    }, "BOT"), isTop && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        color: "#fbbf24",
        padding: "1px 6px",
        borderRadius: 3,
        border: "1px solid #fbbf2440",
        background: "rgba(251,191,36,0.1)"
      }
    }, "LEADING")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        height: 4,
        background: "#1e293b",
        borderRadius: 2
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: `${scorePct}%`,
        height: "100%",
        background: isTop ? "linear-gradient(90deg,#fbbf24,#f59e0b)" : `linear-gradient(90deg,${color},${color}88)`,
        borderRadius: 2,
        transition: "width 0.8s ease"
      }
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: "#475569",
        fontWeight: 700,
        minWidth: 60,
        textAlign: "right"
      }
    }, fmt(scoreComponents.score, 1), " pts"))), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "right",
        flexShrink: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Bebas Neue',sans-serif",
        fontSize: 26,
        lineHeight: 1,
        color: "#f1f5f9",
        letterSpacing: "0.02em"
      }
    }, fmtK(entry.total)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 800,
        color: entry.pnl >= 0 ? "#00f5c4" : "#ef4444",
        marginTop: 2
      }
    }, entry.pnl >= 0 ? "▲ +" : "▼ ", fmtUSD(Math.abs(entry.pnl))))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(4,1fr)",
        gap: 8,
        marginBottom: 10
      }
    }, [{
      label: "ROI",
      value: `${entry.roi >= 0 ? "+" : ""}${fmt(entry.roi)}%`,
      color: entry.roi >= 0 ? "#00f5c4" : "#ef4444"
    }, {
      label: "CASH",
      value: fmtK(entry.cash || 0),
      color: "#38bdf8"
    }, {
      label: "HOLDINGS",
      value: fmtK(entry.holdVal || 0),
      color: "#a78bfa"
    }, {
      label: "SECTORS",
      value: `${entry.uniquePositions || 0} active`,
      color: "#fbbf24"
    }].map(ind => /*#__PURE__*/React.createElement("div", {
      key: ind.label,
      style: {
        background: "#060c18",
        borderRadius: 7,
        padding: "6px 8px",
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 8,
        color: "#334155",
        letterSpacing: "0.15em",
        marginBottom: 3
      }
    }, ind.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 800,
        color: ind.color
      }
    }, ind.value)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        fontSize: 9,
        color: "#334155",
        marginBottom: 3
      }
    }, /*#__PURE__*/React.createElement("span", null, "CASH ", fmt(cashPct, 0), "%"), /*#__PURE__*/React.createElement("span", null, "HOLDINGS ", fmt(holdPct, 0), "%")), /*#__PURE__*/React.createElement("div", {
      style: {
        height: 5,
        background: "#0f172a",
        borderRadius: 3,
        overflow: "hidden",
        display: "flex"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: `${cashPct}%`,
        background: "#38bdf8",
        height: "100%",
        transition: "width 0.6s ease"
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        background: color + "66",
        height: "100%",
        transition: "width 0.6s ease"
      }
    }))));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "14px 16px 12px",
      borderBottom: "1px solid #0f172a"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 900,
      fontSize: 16,
      color: "#f1f5f9"
    }
  }, "NEWSWIRE & LIVE TRADES"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155",
      letterSpacing: "0.1em",
      marginTop: 3
    }
  }, "DISRUPTIONS, SILENT STORY BEATS, AND EXECUTION FLOW")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "grid",
      gridTemplateRows: "minmax(0,1.1fr) minmax(0,0.9fr)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      borderBottom: "1px solid #0f172a"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 12px 8px",
      borderBottom: "1px solid #0f172a"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 800,
      color: "#38bdf8",
      letterSpacing: "0.12em"
    }
  }, "TEAM NEWSWIRE"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155",
      marginTop: 3
    }
  }, "ROUND-WISE DISRUPTIONS AND SILENT STORY BEATS")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: "10px 12px"
    }
  }, newsRoundGroups.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      opacity: 0.15
    }
  }, "\uD83D\uDCF0"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#1e293b",
      fontSize: 11,
      letterSpacing: "0.15em"
    }
  }, "AWAITING NEWS")) : newsRoundGroups.slice(0, 3).map(([roundKey, items]) => /*#__PURE__*/React.createElement("div", {
    key: roundKey,
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#94a3b8",
      letterSpacing: "0.12em",
      fontWeight: 800
    }
  }, roundKey === "general" ? "GENERAL FEED" : `ROUND ${roundKey}`), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "#334155"
    }
  }, items.length, " item", items.length === 1 ? "" : "s")), items.slice(0, 4).map((item, index) => {
    const stock = findStockMeta(item.ticker);
    const tone = item.sentiment === "bull" ? "#00f5c4" : item.sentiment === "bear" ? "#ef4444" : "#38bdf8";
    return /*#__PURE__*/React.createElement("div", {
      key: `${roundKey}-${item.ticker}-${item.time || index}-${index}`,
      style: {
        background: "#0a0f1e",
        border: `1px solid ${tone}20`,
        borderLeft: `3px solid ${tone}`,
        borderRadius: 8,
        padding: "9px 10px",
        marginBottom: 6
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 4,
        flexWrap: "wrap"
      }
    }, !item.hideTicker && /*#__PURE__*/React.createElement("span", {
      style: {
        color: stock.color,
        fontWeight: 800,
        fontSize: 11
      }
    }, item.ticker), item.tag && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 8,
        padding: "1px 6px",
        borderRadius: 4,
        background: "#0f172a",
        border: "1px solid #1e293b",
        color: "#94a3b8",
        letterSpacing: "0.08em"
      }
    }, item.tag), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 8,
        color: "#475569"
      }
    }, item.time)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "#e2e8f0",
        lineHeight: 1.45,
        fontWeight: 600
      }
    }, item.headline), item.detail && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: "#64748b",
        marginTop: 4,
        lineHeight: 1.45
      }
    }, item.detail), Array.isArray(item.playerClues) && item.playerClues.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 7,
        display: "grid",
        gap: 4
      }
    }, item.playerClues.slice(0, 3).map((clue, clueIndex) => /*#__PURE__*/React.createElement("div", {
      key: `${clueIndex}:${clue}`,
      style: {
        display: "flex",
        gap: 6,
        fontSize: 9,
        color: "#94a3b8",
        lineHeight: 1.45
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#38bdf8",
        fontWeight: 800,
        flexShrink: 0
      }
    }, clueIndex + 1, "."), /*#__PURE__*/React.createElement("span", null, clue)))), item.macroQuestion && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 7,
        padding: "7px 8px",
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 7
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 7,
        color: "#fbbf24",
        fontWeight: 800,
        letterSpacing: "0.12em",
        marginBottom: 4
      }
    }, "TEAM CHALLENGE"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: "#e5e7eb",
        lineHeight: 1.5
      }
    }, item.macroQuestion)));
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: 0,
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 12px 8px",
      borderBottom: "1px solid #0f172a"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 800,
      color: "#f1f5f9",
      letterSpacing: "0.12em"
    }
  }, "LIVE TRADES"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155",
      marginTop: 3
    }
  }, "REAL-TIME EXECUTION FLOW")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: "10px 12px"
    }
  }, tradeStream.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      opacity: 0.15
    }
  }, "\uD83D\uDCE1"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#1e293b",
      fontSize: 11,
      letterSpacing: "0.15em"
    }
  }, "AWAITING TRADES")) : tradeStream.map((t, i) => /*#__PURE__*/React.createElement(TradeFlash, {
    key: t.id || i,
    trade: t
  }))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 30,
      background: "#020817",
      borderTop: "1px solid #080f1e",
      display: "flex",
      alignItems: "center",
      padding: "0 20px",
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#1e293b",
      letterSpacing: "0.1em"
    }
  }, "BULL PIT CENTRAL DISPLAY"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#1e293b"
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#1e293b"
    }
  }, ranked.length, " ACTIVE PLAYERS"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#1e293b"
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#1e293b"
    }
  }, "ROUND ", roundNum, "/", TOTAL_ROUNDS), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      fontSize: 9,
      color: "#1e293b"
    }
  }, finalMode ? "FINAL MODE: 105-POINT COMPOSITE SCORE" : "LIVE MODE: RANKED BY NET EQUITY"))));
}
window.CentralDisplay = CentralDisplay;
