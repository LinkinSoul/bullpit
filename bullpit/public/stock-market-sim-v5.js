const {
  useState,
  useEffect,
  useRef,
  useCallback
} = React;

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const INITIAL_CASH = 100000;
const TICK_MS = 2000; // faster ticks for 30 teams
const HISTORY_LEN = 60;
const GM_PASSWORD = "GMMASTER99";
const TOTAL_ROUNDS = 7;
const BUFFER_SECS = 90;
const TAX_RATE = 0.20; // 20% profit tax
const SCORE_WRITE_INTERVAL = 8000; // write scores every 8s (30-team optimisation)
const MAX_TEAMS = 30;

// Per-round durations: R1=8min, R2=10, R3=10, R4=10, R5=10, R6=8, R7=12
const DEFAULT_ROUND_DURATIONS = [480, 600, 600, 600, 600, 480, 720];

// Round identity: name, special rules, volatility multiplier, sentiment lock,
// disruption schedule, tax/liquidation events
const ROUND_RULES = [{
  round: 1,
  name: "Orientation",
  color: "#00f5c4",
  icon: "🎓",
  volMult: 0.5,
  sentLock: null,
  leaderHidden: false,
  tax: false,
  liquidate: false,
  disruptionPlan: {
    midRound: [{
      type: "ai",
      count: 1
    }]
  },
  briefing: "Volatility at 50%. Learn the market. No tax this round. One AI disruption mid-round.",
  gmNote: "Keep sentiment NEUTRAL. Fire 1 AI disruption at ~4 minute mark. Announce no tax."
}, {
  round: 2,
  name: "Bull Run",
  color: "#fbbf24",
  icon: "🐂",
  volMult: 1.0,
  sentLock: "bull",
  leaderHidden: false,
  tax: true,
  liquidate: false,
  disruptionPlan: {
    at5min: [{
      type: "political",
      eventHint: "green_subsidy"
    }]
  },
  briefing: "Sentiment locked BULL. Market only goes up — but 20% profit tax hits at round end.",
  gmNote: "Lock sentiment to BULL at start. Fire Green Subsidy political shock at 5-min mark. Announce tax warning at 2-min mark."
}, {
  round: 3,
  name: "The Crash",
  color: "#ef4444",
  icon: "💥",
  volMult: 1.2,
  sentLock: null,
  leaderHidden: false,
  tax: false,
  liquidate: true,
  disruptionPlan: {
    atStart: [{
      type: "political",
      eventHint: "pandemic_scare"
    }],
    midRound: [{
      type: "ai",
      count: 1
    }]
  },
  briefing: "FORCED LIQUIDATION. Market opens BEAR for 3 minutes. All positions cleared at round end.",
  gmNote: "Set BEAR at start. Fire Pandemic Scare political shock immediately. Switch to NEUTRAL at 3-min mark. Fire 1 AI disruption at 6-min mark. Liquidation happens automatically."
}, {
  round: 4,
  name: "Sector Wars",
  color: "#f97316",
  icon: "⚔️",
  volMult: 1.3,
  sentLock: null,
  leaderHidden: false,
  tax: true,
  liquidate: false,
  disruptionPlan: {
    atStart: [{
      type: "ai",
      count: 1
    }],
    midRound: [{
      type: "political",
      eventHint: "trade_war"
    }]
  },
  briefing: "GM buffs 2 sectors and crashes 2 others at start. 20% profit tax at end.",
  gmNote: "At start: set 2 sectors BULL, 2 sectors BEAR. Fire AI disruption immediately. Fire Trade War at 5-min mark. Announce sectors being boosted/crashed to players."
}, {
  round: 5,
  name: "Dark Pool",
  color: "#a78bfa",
  icon: "🌑",
  volMult: 1.0,
  sentLock: null,
  leaderHidden: true,
  tax: false,
  liquidate: false,
  disruptionPlan: {
    midRound: [{
      type: "ai",
      count: 2
    }]
  },
  briefing: "LEADERBOARD HIDDEN for entire round. Trade on conviction alone. Two AI disruptions.",
  gmNote: "Hide leaderboard. Fire 2 AI disruptions at 3-min and 7-min marks. Reveal leaderboard only at round end ceremony."
}, {
  round: 6,
  name: "Volatility Storm",
  color: "#fb923c",
  icon: "⚡",
  volMult: 3.0,
  sentLock: null,
  leaderHidden: false,
  tax: true,
  liquidate: false,
  disruptionPlan: {
    atStart: [{
      type: "political",
      eventHint: "fed_rate_shock"
    }],
    midRound: [{
      type: "ai",
      count: 1
    }]
  },
  briefing: "3× VOLATILITY on all stocks. Massive swings every tick. 20% profit tax at end.",
  gmNote: "Set volatility multiplier to 3. Fire Fed Rate Shock immediately. Fire 1 AI disruption at 4-min mark. Use FREEZE power-up card for drama."
}, {
  round: 7,
  name: "Grand Final",
  color: "#e879f9",
  icon: "🏆",
  volMult: 2.0,
  sentLock: null,
  leaderHidden: false,
  tax: false,
  liquidate: true,
  disruptionPlan: {
    atStart: [{
      type: "political",
      eventHint: "oil_embargo"
    }],
    midRound: [{
      type: "ai",
      count: 2
    }],
    late: [{
      type: "political",
      eventHint: "cyberwar"
    }]
  },
  briefing: "EQUAL CAPITAL RESTART. 2× volatility. GM fires all remaining power-up cards. No tax — winner takes all.",
  gmNote: "Liquidate and reset all teams to equal capital. Fire Oil Embargo at start. Two AI disruptions at 4-min and 8-min. Fire Cyberwar at 10-min. Use all remaining power-up cards freely."
}];

// Power-up cards (GM one-time use)
const POWERUP_CARDS = [{
  id: "tsunami",
  icon: "🌊",
  name: "Tsunami",
  color: "#ef4444",
  desc: "Entire market crashes 15% instantly",
  effect: {
    type: "market",
    pct: -15
  }
}, {
  id: "moonshot",
  icon: "🚀",
  name: "Moon Shot",
  color: "#fbbf24",
  desc: "One random stock surges 40% for 60 seconds",
  effect: {
    type: "spike",
    pct: 40,
    duration: 60
  }
}, {
  id: "freeze",
  icon: "🧊",
  name: "Freeze",
  color: "#38bdf8",
  desc: "Trading locked for 90 seconds — prices keep moving",
  effect: {
    type: "freeze",
    duration: 90
  }
}, {
  id: "wildcard",
  icon: "🎲",
  name: "Wild Card",
  color: "#e879f9",
  desc: "Redistributes 10% of cash randomly between teams",
  effect: {
    type: "shuffle",
    pct: 10
  }
}];

// ─── PREDICTION MARKET QUESTIONS ──────────────────────────────────────────────
// One per round. Tests specific economic concept. No sector hints in question.
// GM sees correct answer + explanation. Players must reason from first principles.
const PREDICTION_QUESTIONS = [{
  round: 1,
  concept: "Supply and Demand",
  question: "The central bank signals it may raise interest rates next quarter. What happens to the overall market in the SHORT TERM?",
  options: [{
    id: "a",
    text: "Markets rise — investors celebrate economic strength"
  }, {
    id: "b",
    text: "Markets fall — higher rates mean higher discount rates on future earnings"
  }, {
    id: "c",
    text: "No effect — rates are only relevant to banks"
  }, {
    id: "d",
    text: "Markets are unpredictable — fundamentals don't matter"
  }],
  correct: "b",
  explanation: "Higher interest rates increase the discount rate in DCF valuation, reducing the present value of future cash flows. Growth stocks with far-future earnings are hit hardest. This is the core inverse relationship between rates and equity valuations.",
  bonus: 0.08
}, {
  round: 2,
  concept: "Monetary Policy & Asset Bubbles",
  question: "Central bank has flooded markets with cheap money for 2 years (QE). Sentiment is BULL. Which risk should prudent investors watch for?",
  options: [{
    id: "a",
    text: "Deflation — too much money causes prices to fall"
  }, {
    id: "b",
    text: "Asset bubble — cheap money inflates valuations beyond fundamentals"
  }, {
    id: "c",
    text: "Currency appreciation — more money means stronger currency"
  }, {
    id: "d",
    text: "No risk — bull markets always continue"
  }],
  correct: "b",
  explanation: "Quantitative easing lowers the risk-free rate and pushes investors into riskier assets (search for yield). This inflates asset prices beyond what fundamentals justify — creating an asset bubble. When rates eventually rise, valuations correct sharply.",
  bonus: 0.08
}, {
  round: 3,
  concept: "Negative Demand Shock & Defensive vs Cyclical",
  question: "The economy enters recession. GDP contracts 3%. Which portfolio strategy is most likely to PRESERVE capital?",
  options: [{
    id: "a",
    text: "All-in on manufacturing and logistics — infrastructure is always needed"
  }, {
    id: "b",
    text: "Concentrate in healthcare and food — inelastic demand sectors"
  }, {
    id: "c",
    text: "Buy more technology — innovation continues regardless of economy"
  }, {
    id: "d",
    text: "All-in on ESG — green transition is unstoppable"
  }],
  correct: "b",
  explanation: "Defensive sectors with price-inelastic demand (healthcare, food staples) are recession-resistant because consumers cannot defer these purchases. Cyclical sectors (manufacturing, logistics, tech) suffer as demand falls and capex is cut.",
  bonus: 0.08
}, {
  round: 4,
  concept: "Sector Rotation & Comparative Advantage",
  question: "Capital is visibly rotating between sectors. Two sectors are surging, two are crashing. What economic principle drives sector rotation?",
  options: [{
    id: "a",
    text: "Random walk — markets have no memory or pattern"
  }, {
    id: "b",
    text: "Relative valuation and risk-adjusted return — capital flows to better risk/reward"
  }, {
    id: "c",
    text: "Insider trading — institutions always know more"
  }, {
    id: "d",
    text: "Calendar effects — certain months are always better"
  }],
  correct: "b",
  explanation: "Sector rotation is driven by rational capital allocation — investors continuously compare risk-adjusted returns across sectors. When macro conditions change (e.g., rate hike), sectors with better relative value attract flows from those with worse outlooks.",
  bonus: 0.08
}, {
  round: 5,
  concept: "Information Asymmetry & Market Efficiency",
  question: "DARK POOL ROUND: You cannot see the leaderboard. How does hidden information affect rational decision-making?",
  options: [{
    id: "a",
    text: "No effect — prices already reflect all information (strong-form efficiency)"
  }, {
    id: "b",
    text: "Forces you to trade on fundamentals alone — removes behavioural bias"
  }, {
    id: "c",
    text: "Makes trading impossible — you need to know others' positions"
  }, {
    id: "d",
    text: "Hidden information benefits everyone equally"
  }],
  correct: "b",
  explanation: "Information asymmetry is a core market failure. When leaderboard data is removed, traders must rely on fundamental analysis rather than anchoring to others' positions. This tests pure economic reasoning — the same condition as trading illiquid assets with no comparable transactions.",
  bonus: 0.08
}, {
  round: 6,
  concept: "Stagflation — The Policy Dilemma",
  question: "STAGFLATION: High inflation AND slow growth simultaneously. Why is this the hardest macro regime for policymakers?",
  options: [{
    id: "a",
    text: "Rate hikes cure inflation but worsen growth — no good policy option exists"
  }, {
    id: "b",
    text: "Fiscal stimulus solves both problems simultaneously"
  }, {
    id: "c",
    text: "Central banks should ignore inflation and focus on growth"
  }, {
    id: "d",
    text: "Stagflation is impossible — inflation and slow growth cannot coexist"
  }],
  correct: "a",
  explanation: "Stagflation creates a policy dilemma: contractionary policy (rate hikes) fights inflation but further suppresses growth and increases unemployment. Expansionary policy boosts growth but worsens inflation. This is why 1970s stagflation was so damaging — no policy tool addresses both simultaneously.",
  bonus: 0.08
}, {
  round: 7,
  concept: "Full Market Cycle — Capital Allocation",
  question: "GRAND FINAL: All teams start equal at $100,000. You have 12 minutes. What does modern portfolio theory say about optimal allocation?",
  options: [{
    id: "a",
    text: "Concentrate in one sector — highest conviction gives highest return"
  }, {
    id: "b",
    text: "Diversify across uncorrelated assets — maximise Sharpe ratio"
  }, {
    id: "c",
    text: "All-in on the market index — passive beats active always"
  }, {
    id: "d",
    text: "Hold 100% cash — preserve capital when uncertain"
  }],
  correct: "b",
  explanation: "Modern Portfolio Theory (Markowitz) shows that diversification across uncorrelated assets improves the risk-adjusted return (Sharpe ratio) without sacrificing expected return. In a competitive simulation, the winner is often the team that balances return AND risk — not just the highest absolute gainer.",
  bonus: 0.08
}];
const ROUND_LABELS = ["R1 · Orientation", "R2 · Bull Run", "R3 · The Crash", "R4 · Sector Wars", "R5 · Dark Pool", "R6 · Volatility Storm", "R7 · Grand Final"];

// ─── 7 SECTORS × 5 MNC STOCKS EACH = 35 STOCKS ───────────────────────────────
const SECTORS = [{
  id: "healthcare",
  label: "Healthcare & Pharma",
  color: "#a78bfa",
  icon: "⚕️",
  stocks: [{
    ticker: "JNJ",
    name: "Johnson & Johnson",
    basePrice: 165,
    volatility: 0.9,
    mktCap: "$398B",
    employees: "152K",
    founded: 1886,
    description: "World's largest healthcare company spanning pharmaceuticals, medical devices, and consumer health products."
  }, {
    ticker: "PFE",
    name: "Pfizer",
    basePrice: 28,
    volatility: 1.3,
    mktCap: "$157B",
    employees: "83K",
    founded: 1849,
    description: "Global biopharmaceutical company known for COVID-19 vaccines, oncology, and rare disease treatments."
  }, {
    ticker: "NVO",
    name: "Novo Nordisk",
    basePrice: 108,
    volatility: 1.1,
    mktCap: "$432B",
    employees: "64K",
    founded: 1923,
    description: "Danish pharma leader dominating the global diabetes and obesity drug markets with GLP-1 therapies."
  }, {
    ticker: "AZN",
    name: "AstraZeneca",
    basePrice: 72,
    volatility: 1.0,
    mktCap: "$227B",
    employees: "83K",
    founded: 1999,
    description: "Anglo-Swedish multinational specializing in oncology, cardiovascular, and respiratory medicines."
  }, {
    ticker: "UNH",
    name: "UnitedHealth Group",
    basePrice: 520,
    volatility: 0.8,
    mktCap: "$487B",
    employees: "400K",
    founded: 1977,
    description: "America's largest health insurer and healthcare services company operating Optum and UnitedHealthcare."
  }, {
    ticker: "ABBV",
    name: "AbbVie",
    basePrice: 172,
    volatility: 1.0,
    mktCap: "$304B",
    employees: "50K",
    founded: 2013,
    description: "US biopharmaceutical leader known for Humira and Skyrizi, with a strong oncology and immunology pipeline."
  }]
}, {
  id: "logistics",
  label: "Logistics",
  color: "#fb923c",
  icon: "🚚",
  stocks: [{
    ticker: "UPS",
    name: "United Parcel Service",
    basePrice: 138,
    volatility: 1.0,
    mktCap: "$117B",
    employees: "500K",
    founded: 1907,
    description: "Global leader in package delivery and supply chain management operating in 220+ countries."
  }, {
    ticker: "FDX",
    name: "FedEx",
    basePrice: 245,
    volatility: 1.2,
    mktCap: "$62B",
    employees: "547K",
    founded: 1971,
    description: "International courier and logistics services with $90B+ revenue serving 220+ countries."
  }, {
    ticker: "MAER",
    name: "A.P. Møller-Maersk",
    basePrice: 112,
    volatility: 1.3,
    mktCap: "$24B",
    employees: "110K",
    founded: 1904,
    description: "World's largest container shipping company controlling ~17% of global container capacity."
  }, {
    ticker: "DHER",
    name: "DHL Group",
    basePrice: 38,
    volatility: 1.0,
    mktCap: "$31B",
    employees: "600K",
    founded: 1969,
    description: "World's leading logistics company with Express, Freight, Supply Chain, and eCommerce divisions."
  }, {
    ticker: "XPO",
    name: "XPO Logistics",
    basePrice: 92,
    volatility: 1.4,
    mktCap: "$11B",
    employees: "42K",
    founded: 2000,
    description: "Tech-enabled freight transportation company operating the third-largest LTL network in North America."
  }, {
    ticker: "EXPD",
    name: "Expeditors International",
    basePrice: 118,
    volatility: 1.1,
    mktCap: "$18B",
    employees: "19K",
    founded: 1979,
    description: "Global logistics company specializing in air and ocean freight forwarding and customs brokerage."
  }]
}, {
  id: "tech",
  label: "Tech & Manufacturing",
  color: "#38bdf8",
  icon: "💻",
  stocks: [{
    ticker: "AAPL",
    name: "Apple",
    basePrice: 185,
    volatility: 1.1,
    mktCap: "$2.9T",
    employees: "164K",
    founded: 1976,
    description: "The world's most valuable company, maker of iPhone, Mac, iPad, and Apple Silicon. Leader in premium consumer tech."
  }, {
    ticker: "MSFT",
    name: "Microsoft",
    basePrice: 415,
    volatility: 0.9,
    mktCap: "$3.1T",
    employees: "221K",
    founded: 1975,
    description: "Enterprise software giant powering Azure cloud, Microsoft 365, GitHub, and the Copilot AI ecosystem."
  }, {
    ticker: "TSLA",
    name: "Tesla",
    basePrice: 195,
    volatility: 2.0,
    mktCap: "$620B",
    employees: "140K",
    founded: 2003,
    description: "Electric vehicle and clean energy pioneer with global manufacturing and Full Self-Driving ambitions."
  }, {
    ticker: "SMSN",
    name: "Samsung Electronics",
    basePrice: 68,
    volatility: 1.2,
    mktCap: "$318B",
    employees: "270K",
    founded: 1969,
    description: "South Korea's tech titan dominating memory chips, displays, and flagship Android smartphones globally."
  }, {
    ticker: "SIEM",
    name: "Siemens",
    basePrice: 182,
    volatility: 0.9,
    mktCap: "$112B",
    employees: "320K",
    founded: 1847,
    description: "German industrial conglomerate leading in automation, digitalization, smart infrastructure, and rail systems."
  }, {
    ticker: "NVDA",
    name: "NVIDIA",
    basePrice: 875,
    volatility: 2.2,
    mktCap: "$2.1T",
    employees: "29K",
    founded: 1993,
    description: "Dominant AI chip and GPU maker whose H100 accelerators power the global artificial intelligence revolution."
  }]
}, {
  id: "food",
  label: "Food & Agriculture",
  color: "#4ade80",
  icon: "🌾",
  stocks: [{
    ticker: "NESN",
    name: "Nestlé",
    basePrice: 105,
    volatility: 0.7,
    mktCap: "$283B",
    employees: "275K",
    founded: 1866,
    description: "World's largest food and beverage company with 2000+ brands across 186 countries including Nescafé and KitKat."
  }, {
    ticker: "ADM",
    name: "Archer-Daniels-Midland",
    basePrice: 58,
    volatility: 1.1,
    mktCap: "$27B",
    employees: "41K",
    founded: 1902,
    description: "Global agricultural commodities trader processing oilseeds, corn, wheat and producing food ingredients."
  }, {
    ticker: "MDLZ",
    name: "Mondelēz International",
    basePrice: 68,
    volatility: 0.8,
    mktCap: "$91B",
    employees: "91K",
    founded: 2012,
    description: "Snacking powerhouse behind Oreo, Cadbury, Milka, and Toblerone sold in 150+ countries worldwide."
  }, {
    ticker: "BG",
    name: "Bunge Global",
    basePrice: 92,
    volatility: 1.2,
    mktCap: "$11B",
    employees: "23K",
    founded: 1818,
    description: "Leading agribusiness and food company linking farmers to consumers through grain and oilseed operations."
  }, {
    ticker: "DANO",
    name: "Danone",
    basePrice: 62,
    volatility: 0.8,
    mktCap: "$42B",
    employees: "96K",
    founded: 1919,
    description: "French multinational in dairy, plant-based foods, waters, and specialized nutrition including Activia and Evian."
  }, {
    ticker: "KO",
    name: "Coca-Cola",
    basePrice: 62,
    volatility: 0.6,
    mktCap: "$267B",
    employees: "79K",
    founded: 1892,
    description: "World's most recognised beverage brand selling 2 billion servings daily across 200+ countries."
  }]
}, {
  id: "banking",
  label: "Banking & Finance",
  color: "#fbbf24",
  icon: "🏦",
  stocks: [{
    ticker: "JPM",
    name: "JPMorgan Chase",
    basePrice: 198,
    volatility: 1.0,
    mktCap: "$573B",
    employees: "309K",
    founded: 1799,
    description: "America's largest bank with $3.9T in assets, spanning investment banking, retail, and asset management."
  }, {
    ticker: "GS",
    name: "Goldman Sachs",
    basePrice: 468,
    volatility: 1.3,
    mktCap: "$162B",
    employees: "45K",
    founded: 1869,
    description: "Wall Street's premier investment bank known for M&A advisory, trading, and capital markets."
  }, {
    ticker: "HSBC",
    name: "HSBC Holdings",
    basePrice: 42,
    volatility: 1.0,
    mktCap: "$163B",
    employees: "220K",
    founded: 1865,
    description: "Asia's largest bank with $3T assets operating across 62 countries in retail and investment banking."
  }, {
    ticker: "BLK",
    name: "BlackRock",
    basePrice: 808,
    volatility: 0.9,
    mktCap: "$130B",
    employees: "21K",
    founded: 1988,
    description: "World's largest asset manager with $10T+ AUM, known for iShares ETFs and the Aladdin risk platform."
  }, {
    ticker: "AXP",
    name: "American Express",
    basePrice: 225,
    volatility: 1.1,
    mktCap: "$168B",
    employees: "74K",
    founded: 1850,
    description: "Premium credit card and financial services company known for Centurion, Platinum, and corporate travel cards."
  }, {
    ticker: "MS",
    name: "Morgan Stanley",
    basePrice: 102,
    volatility: 1.2,
    mktCap: "$174B",
    employees: "80K",
    founded: 1935,
    description: "Global investment bank and wealth manager with $5T+ in client assets and top-tier M&A advisory."
  }]
}, {
  id: "esg",
  label: "ESG",
  color: "#00f5c4",
  icon: "🌱",
  stocks: [{
    ticker: "ENPH",
    name: "Enphase Energy",
    basePrice: 108,
    volatility: 2.0,
    mktCap: "$14B",
    employees: "4K",
    founded: 2006,
    description: "Leading manufacturer of microinverter systems for residential and commercial solar energy generation."
  }, {
    ticker: "VWSYF",
    name: "Vestas Wind Systems",
    basePrice: 24,
    volatility: 1.6,
    mktCap: "$17B",
    employees: "30K",
    founded: 1945,
    description: "World's leading wind turbine manufacturer having installed 170+ GW across 88 countries worldwide."
  }, {
    ticker: "BEP",
    name: "Brookfield Renewable",
    basePrice: 32,
    volatility: 1.3,
    mktCap: "$12B",
    employees: "4K",
    founded: 1999,
    description: "One of the world's largest publicly traded renewable power platforms with 33 GW of installed capacity."
  }, {
    ticker: "ORSTED",
    name: "Ørsted",
    basePrice: 38,
    volatility: 1.8,
    mktCap: "$12B",
    employees: "8K",
    founded: 2006,
    description: "Danish energy company transformed from fossil fuels to become the world's top offshore wind developer."
  }, {
    ticker: "FSLR",
    name: "First Solar",
    basePrice: 188,
    volatility: 1.9,
    mktCap: "$20B",
    employees: "8K",
    founded: 1999,
    description: "America's largest solar panel manufacturer using thin-film technology for utility-scale projects."
  }, {
    ticker: "NEE",
    name: "NextEra Energy",
    basePrice: 72,
    volatility: 1.1,
    mktCap: "$147B",
    employees: "15K",
    founded: 1925,
    description: "America's largest electric utility and the world's leading generator of renewable wind and solar energy."
  }]
}, {
  id: "energy",
  label: "Energy",
  color: "#f472b6",
  icon: "⚡",
  stocks: [{
    ticker: "XOM",
    name: "ExxonMobil",
    basePrice: 108,
    volatility: 1.1,
    mktCap: "$461B",
    employees: "61K",
    founded: 1870,
    description: "World's largest publicly traded oil and gas company spanning exploration, refining, and chemicals."
  }, {
    ticker: "CVX",
    name: "Chevron",
    basePrice: 152,
    volatility: 1.0,
    mktCap: "$282B",
    employees: "43K",
    founded: 1879,
    description: "Integrated energy company with major upstream, downstream, and chemical operations in 180+ countries."
  }, {
    ticker: "SHEL",
    name: "Shell",
    basePrice: 68,
    volatility: 1.0,
    mktCap: "$207B",
    employees: "103K",
    founded: 1907,
    description: "Anglo-Dutch energy giant leading in LNG, integrated gas, and transitioning toward renewable energy solutions."
  }, {
    ticker: "BP",
    name: "BP",
    basePrice: 38,
    volatility: 1.2,
    mktCap: "$95B",
    employees: "90K",
    founded: 1908,
    description: "British energy major pivoting toward low-carbon energy while maintaining significant oil and gas production."
  }, {
    ticker: "TTE",
    name: "TotalEnergies",
    basePrice: 65,
    volatility: 1.1,
    mktCap: "$148B",
    employees: "101K",
    founded: 1924,
    description: "French multinational energy company integrating oil, gas, renewables and electricity across 130+ countries."
  }, {
    ticker: "SLB",
    name: "SLB (Schlumberger)",
    basePrice: 48,
    volatility: 1.3,
    mktCap: "$68B",
    employees: "99K",
    founded: 1926,
    description: "World's largest oilfield services company providing drilling, evaluation, and production technology globally."
  }]
}, {
  id: "manufacturing",
  label: "Manufacturing & Industrials",
  color: "#f97316",
  icon: "🏭",
  stocks: [{
    ticker: "CAT",
    name: "Caterpillar",
    basePrice: 352,
    volatility: 1.1,
    mktCap: "$178B",
    employees: "113K",
    founded: 1925,
    description: "World's largest construction and mining equipment maker. A bellwether for global infrastructure spend and commodity cycles."
  }, {
    ticker: "HON",
    name: "Honeywell",
    basePrice: 198,
    volatility: 0.9,
    mktCap: "$132B",
    employees: "99K",
    founded: 1906,
    description: "Industrial conglomerate spanning aerospace, building automation, safety tech and advanced materials across 100+ countries."
  }, {
    ticker: "MMM",
    name: "3M",
    basePrice: 112,
    volatility: 1.1,
    mktCap: "$61B",
    employees: "85K",
    founded: 1902,
    description: "Diversified manufacturer behind 60,000+ products from Post-it notes to surgical drapes, N95 masks and optical films."
  }, {
    ticker: "GE",
    name: "GE Aerospace",
    basePrice: 175,
    volatility: 1.3,
    mktCap: "$190B",
    employees: "172K",
    founded: 1892,
    description: "Spun-off aviation division of General Electric making jet engines for 70% of commercial flights worldwide."
  }, {
    ticker: "ABB",
    name: "ABB",
    basePrice: 48,
    volatility: 1.0,
    mktCap: "$98B",
    employees: "105K",
    founded: 1988,
    description: "Swiss-Swedish electrification and automation giant powering factories, grids and EV charging infrastructure globally."
  }, {
    ticker: "EMR",
    name: "Emerson Electric",
    basePrice: 108,
    volatility: 1.0,
    mktCap: "$62B",
    employees: "76K",
    founded: 1890,
    description: "Industrial automation leader supplying process control, HVAC and measurement instruments to energy and chemical plants."
  }]
}, {
  id: "etf",
  label: "Index Funds & ETFs",
  color: "#e879f9",
  icon: "📊",
  stocks: [{
    ticker: "BPHX",
    name: "Bull Pit Healthcare Index",
    basePrice: 95,
    volatility: 0.85,
    mktCap: "$42B",
    employees: "N/A",
    founded: 2024,
    description: "Tracks JNJ, PFE, NVO, AZN, UNH & ABBV. Equal-weighted basket of all 6 healthcare & pharma stocks in the simulation. Defensive, low-drama.",
    constituents: ["JNJ", "PFE", "NVO", "AZN", "UNH", "ABBV"]
  }, {
    ticker: "BTEC",
    name: "Bull Pit Tech Giants Fund",
    basePrice: 350,
    volatility: 1.4,
    mktCap: "$128B",
    employees: "N/A",
    founded: 2024,
    description: "Tracks AAPL, MSFT, NVDA, TSLA & SIEM. Captures the full Bull Pit tech sector. NVDA's 2.2x volatility makes this fund swing hard.",
    constituents: ["AAPL", "MSFT", "NVDA", "TSLA", "SIEM"]
  }, {
    ticker: "BGRN",
    name: "Bull Pit Green Future ETF",
    basePrice: 88,
    volatility: 1.6,
    mktCap: "$19B",
    employees: "N/A",
    founded: 2024,
    description: "Tracks ENPH, FSLR, NEE, BEP & ORSTED. Pure-play renewable energy basket. Explodes on climate policy events, crashes on rate hikes.",
    constituents: ["ENPH", "FSLR", "NEE", "BEP", "ORSTED"]
  }, {
    ticker: "BFIN",
    name: "Bull Pit Global Finance Index",
    basePrice: 325,
    volatility: 1.05,
    mktCap: "$86B",
    employees: "N/A",
    founded: 2024,
    description: "Tracks JPM, GS, BLK, MS & HSBC. Covers investment banking, asset management and retail banking. Sensitive to Fed rate shocks and sanctions.",
    constituents: ["JPM", "GS", "BLK", "MS", "HSBC"]
  }, {
    ticker: "BCMD",
    name: "Bull Pit Commodity & Energy ETF",
    basePrice: 90,
    volatility: 1.15,
    mktCap: "$31B",
    employees: "N/A",
    founded: 2024,
    description: "Tracks XOM, CVX, SLB, ADM & BG. Blends oil majors with agricultural commodity giants. Surges on supply shocks, trade wars and embargoes.",
    constituents: ["XOM", "CVX", "SLB", "ADM", "BG"]
  }, {
    ticker: "BMFG",
    name: "Bull Pit Industrials Index",
    basePrice: 165,
    volatility: 1.05,
    mktCap: "$58B",
    employees: "N/A",
    founded: 2024,
    description: "Tracks CAT, HON, MMM, GE, ABB & EMR. Equal-weighted basket of all 6 manufacturing & industrial stocks. Surges on infrastructure booms, tanks on supply chain crises.",
    constituents: ["CAT", "HON", "MMM", "GE", "ABB", "EMR"]
  }, {
    ticker: "BDEF",
    name: "Bull Pit Defensive All-Weather Fund",
    basePrice: 168,
    volatility: 0.75,
    mktCap: "$74B",
    employees: "N/A",
    founded: 2024,
    description: "CROSS-SECTOR: Picks the steadiest names from Healthcare, Food, Banking & ESG — JNJ, UNH, KO, NESN, JPM, HSBC & NEE. Lowest volatility fund in the game. Capital preservation over growth.",
    constituents: ["JNJ", "UNH", "KO", "NESN", "JPM", "HSBC", "NEE"],
    crossSector: true
  }, {
    ticker: "BCRSH",
    name: "Bull Pit Crisis Hedge Index",
    basePrice: 82,
    volatility: 1.1,
    mktCap: "$28B",
    employees: "N/A",
    founded: 2024,
    description: "CROSS-SECTOR: Built for storms — draws from Healthcare, Energy & ESG defensives. Tracks NVO, PFE, XOM, BEP, ORSTED, JNJ & ADM. Historically outperforms when political shocks hit.",
    constituents: ["NVO", "PFE", "XOM", "BEP", "ORSTED", "JNJ", "ADM"],
    crossSector: true
  }, {
    ticker: "BGROW",
    name: "Bull Pit Growth Engine ETF",
    basePrice: 265,
    volatility: 1.85,
    mktCap: "$52B",
    employees: "N/A",
    founded: 2024,
    description: "CROSS-SECTOR: High-octane growth across Tech & ESG. Tracks NVDA, TSLA, ENPH, FSLR, AAPL, VWSYF & MSFT. Highest upside of any fund — and highest downside.",
    constituents: ["NVDA", "TSLA", "ENPH", "FSLR", "AAPL", "VWSYF", "MSFT"],
    crossSector: true
  }, {
    ticker: "BALL",
    name: "Bull Pit Total Market Index",
    basePrice: 155,
    volatility: 0.95,
    mktCap: "$420B",
    employees: "N/A",
    founded: 2024,
    description: "TOTAL MARKET: Tracks every single stock in the Bull Pit universe — all 53 stocks across all 9 sectors, equal weighted. The ultimate diversified play. If the whole market moves, so do you.",
    constituents: ["JNJ", "PFE", "NVO", "AZN", "UNH", "ABBV", "UPS", "FDX", "MAER", "DHER", "XPO", "EXPD", "AAPL", "MSFT", "TSLA", "SMSN", "SIEM", "NVDA", "NESN", "ADM", "MDLZ", "BG", "DANO", "KO", "JPM", "GS", "HSBC", "BLK", "AXP", "MS", "ENPH", "VWSYF", "BEP", "ORSTED", "FSLR", "NEE", "XOM", "CVX", "SHEL", "BP", "TTE", "SLB", "CAT", "HON", "MMM", "GE", "ABB", "EMR", "BPHX", "BTEC", "BGRN", "BFIN", "BCMD"],
    crossSector: true,
    totalMarket: true
  }]
}];

// Flatten all stocks with sector info
const ALL_STOCKS = SECTORS.flatMap(s => s.stocks.map(st => ({
  ...st,
  sectorId: s.id,
  sectorLabel: s.label,
  color: s.color
})));

// ETF constituent map — ticker → array of constituent tickers
const ETF_CONSTITUENTS = Object.fromEntries(ALL_STOCKS.filter(s => s.constituents).map(s => [s.ticker, s.constituents]));

// ─── POLITICAL DISRUPTION CATALOG ────────────────────────────────────────────
// Each event hits multiple sectors simultaneously with sector-specific impacts
// ─── MACRO ECONOMIC EVENT LIBRARY ────────────────────────────────────────────
// DESIGN PRINCIPLE: Teams see ONLY the headline — no hints about which stocks/
// sectors will move. They must apply economic knowledge to infer consequences.
// 'concept' is shown only in the GM Rulebook for facilitator reference.
// 'sectors' is the hidden impact vector — never displayed to players.
const POLITICAL_EVENTS = [
// ── MONETARY POLICY EVENTS ────────────────────────────────────────────────
{
  id: "rate_hike_emergency",
  icon: "📈",
  headline: "Central Bank Raises Interest Rates by 200 Basis Points",
  subheadline: "Emergency monetary tightening announced to combat runaway inflation",
  concept: "Contractionary monetary policy — higher rates increase cost of capital, hurt growth stocks, help banks via NIM expansion, crush bond-proxy equities",
  sectors: {
    banking: 22,
    healthcare: -8,
    esg: -32,
    tech: -20,
    food: -6,
    logistics: -10,
    energy: -5,
    manufacturing: -14,
    etf: -18
  }
}, {
  id: "rate_cut_pivot",
  icon: "📉",
  headline: "Central Bank Pivots — Cuts Rates to Near-Zero",
  subheadline: "Dovish pivot signals end of tightening cycle; liquidity flooding markets",
  concept: "Expansionary monetary policy — cheap money boosts growth stocks, ESG, tech; banks lose NIM; risk-on environment drives equities broadly",
  sectors: {
    banking: -15,
    esg: 35,
    tech: 28,
    manufacturing: 18,
    logistics: 12,
    food: 8,
    healthcare: 5,
    energy: 10,
    etf: 20
  }
}, {
  id: "quantitative_easing",
  icon: "💵",
  headline: "Central Bank Launches $2 Trillion Quantitative Easing Programme",
  subheadline: "Asset purchase programme injects liquidity into financial system",
  concept: "QE expands money supply, inflates asset prices, devalues currency — benefits real assets, equities; hurts cash holders; creates inflationary pressure",
  sectors: {
    esg: 30,
    tech: 22,
    manufacturing: 15,
    banking: 10,
    energy: 18,
    food: 12,
    healthcare: 8,
    logistics: 10,
    etf: 25
  }
}, {
  id: "inflation_cpi_shock",
  icon: "🔥",
  headline: "Consumer Price Index Hits 40-Year High",
  subheadline: "Inflation at 12.4% forces emergency economic summit",
  concept: "Cost-push and demand-pull inflation — commodity producers win, manufacturers squeezed on margins, consumers reduce discretionary spend, real wages fall",
  sectors: {
    energy: 28,
    food: 22,
    banking: -10,
    esg: -18,
    tech: -15,
    manufacturing: -20,
    logistics: -12,
    healthcare: -5,
    etf: -14
  }
}, {
  id: "deflation_spiral",
  icon: "❄️",
  headline: "Economy Enters Deflationary Spiral — Prices Fall Third Consecutive Month",
  subheadline: "Falling prices trigger demand destruction and corporate earnings warnings",
  concept: "Deflation causes consumers to defer spending, hurts corporate revenues, increases real debt burden — defensives outperform, commodities crash",
  sectors: {
    healthcare: 15,
    food: 10,
    banking: -18,
    energy: -25,
    manufacturing: -22,
    logistics: -15,
    tech: -12,
    esg: -8,
    etf: -16
  }
},
// ── FISCAL POLICY EVENTS ──────────────────────────────────────────────────
{
  id: "fiscal_stimulus",
  icon: "🏗️",
  headline: "Government Announces $5 Trillion Infrastructure Spending Package",
  subheadline: "Multi-year public investment programme passed with bipartisan support",
  concept: "Expansionary fiscal policy via government expenditure — multiplier effect boosts aggregate demand, benefits capital goods producers, creates jobs",
  sectors: {
    manufacturing: 40,
    logistics: 28,
    energy: 18,
    banking: 15,
    esg: 14,
    tech: 10,
    food: 5,
    healthcare: 3,
    etf: 16
  }
}, {
  id: "austerity_measures",
  icon: "✂️",
  headline: "Government Announces Emergency Austerity — Cuts Spending by 30%",
  subheadline: "Sovereign debt crisis forces drastic fiscal consolidation",
  concept: "Contractionary fiscal policy reduces aggregate demand — government contractors suffer, healthcare spending cut, defensive sectors stabilise",
  sectors: {
    manufacturing: -28,
    logistics: -20,
    healthcare: -22,
    banking: -10,
    esg: -15,
    tech: -8,
    food: 5,
    energy: 2,
    etf: -18
  }
}, {
  id: "carbon_tax",
  icon: "🌡️",
  headline: "Landmark Carbon Pricing Legislation Enacted — $150 Per Tonne",
  subheadline: "Polluters face immediate compliance costs; exemptions denied",
  concept: "Pigouvian tax corrects negative externality — increases costs for polluters, creates competitive advantage for clean producers, drives substitution",
  sectors: {
    energy: -32,
    manufacturing: -20,
    esg: 42,
    logistics: -12,
    food: -8,
    tech: 15,
    banking: 5,
    healthcare: 3,
    etf: 8
  }
}, {
  id: "sovereign_default",
  icon: "💀",
  headline: "Major Economy Declares Sovereign Debt Default",
  subheadline: "Government unable to service $3.2 trillion in outstanding obligations",
  concept: "Debt default triggers contagion — banking sector exposed via bond holdings, capital flight from risk assets, safe-haven demand spikes",
  sectors: {
    banking: -38,
    esg: -20,
    tech: -15,
    manufacturing: -18,
    logistics: -15,
    healthcare: 12,
    food: 8,
    energy: 5,
    etf: -28
  }
},
// ── SUPPLY-SIDE SHOCKS ────────────────────────────────────────────────────
{
  id: "oil_supply_shock",
  icon: "🛢️",
  headline: "OPEC+ Announces Coordinated 40% Production Cut",
  subheadline: "Cartel exercises pricing power as inventories hit multi-decade lows",
  concept: "Negative supply shock — cost-push inflation, energy windfall, manufacturing margin compression, transport costs surge, substitution to renewables",
  sectors: {
    energy: 38,
    esg: 22,
    food: -18,
    logistics: -24,
    manufacturing: -16,
    banking: -8,
    tech: -10,
    healthcare: -6,
    etf: -12
  }
}, {
  id: "semiconductor_shortage",
  icon: "💾",
  headline: "Global Semiconductor Shortage Reaches Critical Level",
  subheadline: "Lead times extend to 52 weeks as fab capacity exhausted",
  concept: "Bottleneck in complementary goods — industries requiring chips face production halts; chip producers gain pricing power; substitution impossible in short run",
  sectors: {
    tech: -18,
    manufacturing: -30,
    logistics: -12,
    banking: -8,
    energy: 5,
    esg: -5,
    healthcare: -10,
    food: -3,
    etf: -16
  }
}, {
  id: "labour_strike",
  icon: "✊",
  headline: "Global Dockworkers Strike Enters Third Week",
  subheadline: "Port shutdowns across 40 countries halting $800B in trade",
  concept: "Labour market shock reduces productive capacity — supply constrained, inventories depleted, input costs rise for manufacturers and retailers",
  sectors: {
    logistics: -35,
    manufacturing: -25,
    food: -18,
    energy: 10,
    tech: -10,
    banking: -8,
    healthcare: -5,
    esg: -5,
    etf: -15
  }
}, {
  id: "commodity_supercycle",
  icon: "⛏️",
  headline: "Commodity Supercycle Declared — Raw Material Prices at Record Highs",
  subheadline: "Synchronised global demand surge exhausts commodity inventories",
  concept: "Commodity supercycle driven by underinvestment in supply meeting demand surge — resource producers profit, downstream industries face margin compression",
  sectors: {
    energy: 32,
    manufacturing: -22,
    food: 18,
    logistics: -15,
    esg: 10,
    banking: 8,
    tech: -8,
    healthcare: -3,
    etf: 5
  }
},
// ── TRADE AND GLOBALISATION ───────────────────────────────────────────────
{
  id: "trade_war_escalation",
  icon: "⚔️",
  headline: "Sweeping Tariffs Announced — 60% on All Imported Manufactured Goods",
  subheadline: "Retaliatory measures expected from trading partners within 48 hours",
  concept: "Trade protectionism raises costs of imported inputs, disrupts global value chains, domestic producers benefit temporarily but overall welfare falls",
  sectors: {
    manufacturing: -20,
    logistics: -22,
    tech: -18,
    food: -14,
    banking: -12,
    energy: 8,
    healthcare: 5,
    esg: -8,
    etf: -16
  }
}, {
  id: "free_trade_agreement",
  icon: "🤝",
  headline: "Historic Multilateral Free Trade Agreement Signed by 80 Nations",
  subheadline: "Largest trade liberalisation in history eliminates barriers across $28T in trade",
  concept: "Trade liberalisation increases comparative advantage specialisation, lowers consumer prices, expands market access — logistics and exporting industries benefit most",
  sectors: {
    logistics: 28,
    manufacturing: 22,
    food: 15,
    tech: 18,
    banking: 12,
    energy: 10,
    esg: 8,
    healthcare: 5,
    etf: 16
  }
}, {
  id: "currency_crisis",
  icon: "💱",
  headline: "Reserve Currency Loses 25% of Value in 48-Hour Flash Crash",
  subheadline: "Currency intervention fails as speculative attack overwhelms reserves",
  concept: "Currency devaluation makes exports cheap, imports expensive — exporters win, import-dependent industries lose; foreign debt becomes more expensive",
  sectors: {
    tech: 18,
    energy: 15,
    food: -14,
    manufacturing: 10,
    logistics: -16,
    banking: -22,
    healthcare: 5,
    esg: -10,
    etf: -8
  }
},
// ── MARKET STRUCTURE EVENTS ───────────────────────────────────────────────
{
  id: "antitrust_breakup",
  icon: "⚖️",
  headline: "Antitrust Authorities Order Forced Breakup of Dominant Market Players",
  subheadline: "Monopoly power dismantled — divestiture mandated within 90 days",
  concept: "Antitrust intervention corrects monopoly market failure — competitive entry increases, prices fall, incumbent loses pricing power, innovation accelerates",
  sectors: {
    tech: -30,
    banking: 12,
    healthcare: 10,
    esg: 5,
    logistics: -5,
    food: 3,
    energy: 2,
    manufacturing: -8,
    etf: -15
  }
}, {
  id: "market_failure_fraud",
  icon: "🚨",
  headline: "Information Asymmetry Crisis — Systemic Accounting Fraud Uncovered",
  subheadline: "Regulators freeze trading in 40 major companies pending investigation",
  concept: "Market failure from information asymmetry — rational market impossible without accurate pricing; trust collapses, adverse selection, regulatory overreach follows",
  sectors: {
    banking: -32,
    tech: -18,
    esg: -24,
    manufacturing: -15,
    logistics: -12,
    healthcare: -8,
    food: -5,
    energy: -6,
    etf: -26
  }
}, {
  id: "natural_monopoly_regulation",
  icon: "🏛️",
  headline: "Regulators Impose Price Caps on Essential Services Sector",
  subheadline: "Price ceiling set 40% below market rate citing public interest",
  concept: "Price ceiling below equilibrium creates shortage — producers exit, quality falls, black markets emerge; regulation often produces unintended consequences",
  sectors: {
    healthcare: -28,
    energy: -15,
    logistics: -10,
    manufacturing: -8,
    banking: 5,
    tech: 5,
    food: -12,
    esg: 3,
    etf: -12
  }
}, {
  id: "mega_merger",
  icon: "🏢",
  headline: "Largest Corporate Merger in History Announced — $900B Deal",
  subheadline: "Consolidation creates entity controlling 35% of global market share",
  concept: "Horizontal merger creates economies of scale but reduces competition — merger arbitrage opportunity, industry rationalisation, regulatory uncertainty",
  sectors: {
    manufacturing: 25,
    logistics: 18,
    banking: 15,
    tech: 10,
    energy: 8,
    food: 5,
    healthcare: 5,
    esg: 3,
    etf: 14
  }
},
// ── DEMAND-SIDE SHOCKS ────────────────────────────────────────────────────
{
  id: "recession_declaration",
  icon: "📊",
  headline: "Economy Officially Enters Recession — Two Consecutive Quarters of Negative GDP",
  subheadline: "Unemployment rises to 9.2%; consumer confidence at historic low",
  concept: "Recessionary demand shock — Keynesian multiplier in reverse; income effect reduces all spending; defensive sectors maintain but cyclicals collapse",
  sectors: {
    healthcare: 18,
    food: 12,
    banking: -20,
    manufacturing: -28,
    logistics: -22,
    tech: -15,
    energy: -18,
    esg: -12,
    etf: -20
  }
}, {
  id: "consumer_boom",
  icon: "🛒",
  headline: "Consumer Confidence Hits All-Time High — Household Spending Surges 18%",
  subheadline: "Post-recession pent-up demand unleashed as employment recovers",
  concept: "Positive demand shock via increased consumer spending — multiplier effect boosts aggregate demand; cyclical sectors outperform; capacity utilisation rises",
  sectors: {
    food: 22,
    tech: 18,
    manufacturing: 20,
    logistics: 25,
    banking: 15,
    healthcare: 8,
    energy: 12,
    esg: 10,
    etf: 18
  }
}, {
  id: "demographic_shift",
  icon: "👥",
  headline: "Ageing Population Report: One in Three Citizens Over 65 by 2030",
  subheadline: "Structural demographic shift redraws economic demand landscape",
  concept: "Demographic demand shift — secular increase in healthcare demand; pension fund behaviour changes bond/equity allocation; labour supply contracts",
  sectors: {
    healthcare: 28,
    food: 12,
    banking: 10,
    esg: 5,
    tech: -8,
    manufacturing: -15,
    logistics: -5,
    energy: -8,
    etf: 5
  }
},
// ── TECHNOLOGICAL DISRUPTION ──────────────────────────────────────────────
{
  id: "ai_productivity_leap",
  icon: "🤖",
  headline: "AI Breakthrough Promises 40% Productivity Gains Across Knowledge Industries",
  subheadline: "Autonomous systems deployed in professional services and manufacturing",
  concept: "Technological progress shifts production possibility frontier — labour-saving tech increases output per worker, creative destruction displaces incumbents",
  sectors: {
    tech: 35,
    manufacturing: 15,
    banking: 10,
    logistics: 12,
    healthcare: 8,
    food: 5,
    energy: -5,
    esg: 8,
    etf: 20
  }
}, {
  id: "energy_transition",
  icon: "⚡",
  headline: "Renewable Energy Achieves Grid Parity — Cost Equals Fossil Fuels",
  subheadline: "Structural shift in energy economics as renewables become cost-competitive",
  concept: "Technological disruption via substitute goods — renewables become viable substitute for fossil fuels, stranded asset risk emerges, creative destruction of oil majors",
  sectors: {
    esg: 40,
    energy: -30,
    manufacturing: 12,
    tech: 10,
    banking: 5,
    food: 3,
    logistics: -5,
    healthcare: 2,
    etf: 8
  }
}];
const DEFAULT_TEAMS = [{
  id: "t1",
  name: "Alpha Squad",
  password: "alpha123",
  color: "#00f5c4"
}, {
  id: "t2",
  name: "Bull Runners",
  password: "bull456",
  color: "#fbbf24"
}, {
  id: "t3",
  name: "Bear Force",
  password: "bear789",
  color: "#f472b6"
}, {
  id: "t4",
  name: "Quantum Traders",
  password: "quant321",
  color: "#a78bfa"
}, {
  id: "t5",
  name: "Solar Surge",
  password: "solar654",
  color: "#38bdf8"
}, {
  id: "t6",
  name: "Dark Pool",
  password: "dark987",
  color: "#fb923c"
}];
const AI_BOTS = [{
  id: "bot_m",
  name: "MOMENTUM",
  avatar: "M",
  color: "#00f5c4",
  personality: "aggressive momentum trader who chases breakouts and hot sectors"
}, {
  id: "bot_w",
  name: "WARREN.AI",
  avatar: "W",
  color: "#fbbf24",
  personality: "patient value investor buying MNC blue chips and holding through volatility"
}, {
  id: "bot_s",
  name: "SCALP-3",
  avatar: "S",
  color: "#f472b6",
  personality: "high-frequency scalper making many small trades across different sectors"
}];

// ─── LEADERBOARD SCORING FORMULA ─────────────────────────────────────────────
// Composite score from 5 pillars:
//   1. Total Return %        (35%) – raw performance
//   2. Sharpe-proxy          (25%) – return per unit of max-drawdown risk
//   3. Diversification       (20%) – unique sectors held (max 7)
//   4. Win Rate              (10%) – % of closed trades in profit
//   5. Capital Efficiency    (10%) – deployed capital ratio (1 - cash%)
// ─── 9-INDICATOR SCORING ENGINE ──────────────────────────────────────────────
// Three tiers: Performance (50pts), Risk Management (30pts), Trading Quality (20pts)
// Total: 100 points maximum
// Tiebreaker chain: Calmar → MaxDD → Alpha → Sectors → LastTradeTs
// ─────────────────────────────────────────────────────────────────────────────

// BALL index base price used to compute portfolio beta / alpha
const BALL_BASE = 155;
function calcScore(entry, initCash, allEntries) {
  const ic = initCash || INITIAL_CASH;
  const total = entry.total || ic;
  const cash = entry.cash || ic;

  // ── TIER 1: PERFORMANCE (50 pts) ──────────────────────────────────────────

  // 1A. Absolute Return (15pts)
  //     Formula: (total - initCash) / initCash × 100
  //     Range: clamped −30% to +200% → mapped to 0–15 pts
  const absoluteReturn = (total - ic) / ic * 100;
  const t1a = clamp((absoluteReturn + 30) / 230 * 15, 0, 15);

  // 1B. Risk-Adjusted Return — Sharpe Proxy (15pts)
  //     Formula: absoluteReturn / maxDrawdown
  //     Higher = better return per unit of risk taken
  const maxDrawdown = Math.max(0.5, entry.maxDrawdown || 0.5);
  const sharpe = absoluteReturn / maxDrawdown;
  const t1b = clamp((sharpe + 5) / 25 * 15, 0, 15);

  // 1C. Alpha vs Market Benchmark (12pts)
  //     Formula: portfolio return − BALL index return (simulated)
  //     BALL base = 155 → current BALL price tracked via entry.ballPrice if available
  //     Positive alpha = outperformed the market
  const ballReturn = entry.ballReturn || 0; // % return of BALL this session
  const alpha = absoluteReturn - ballReturn;
  const t1c = clamp((alpha + 20) / 60 * 12, 0, 12);

  // 1D. Round Consistency (8pts)
  //     Formula: geometric mean of per-round return snapshots
  //     Penalises one-lucky-round players; rewards sustained performance
  //     entry.roundReturns = array of % returns per completed round
  const roundReturns = entry.roundReturns || [];
  let consistency = 0;
  if (roundReturns.length > 0) {
    const geomMean = Math.pow(roundReturns.reduce((prod, r) => prod * (1 + r / 100), 1), 1 / roundReturns.length) - 1;
    consistency = geomMean * 100;
  }
  const t1d = clamp((consistency + 5) / 15 * 8, 0, 8);
  const tier1 = t1a + t1b + t1c + t1d; // max 50

  // ── TIER 2: RISK MANAGEMENT (30 pts) ──────────────────────────────────────

  // 2A. Max Drawdown Control (10pts)
  //     Formula: inversely scaled — lower drawdown = higher score
  //     0% drawdown = 10pts, 50%+ drawdown = 0pts
  const t2a = clamp((1 - maxDrawdown / 50) * 10, 0, 10);

  // 2B. Calmar Ratio (10pts)
  //     Formula: absoluteReturn / maxDrawdown
  //     Better than Sharpe for fat-tail events — used as primary tiebreaker
  const calmar = maxDrawdown > 0 ? absoluteReturn / maxDrawdown : 0;
  const t2b = clamp((calmar + 2) / 8 * 10, 0, 10);

  // 2C. Portfolio Beta — Independence of Thought (10pts)
  //     Formula: 1 − |correlation with market|
  //     Low beta = made independent decisions, not just buying the index
  //     entry.beta: correlation coefficient with BALL — stored from trading pattern
  const beta = entry.beta !== undefined ? Math.abs(entry.beta) : 0.5;
  const t2c = clamp((1 - beta) * 10, 0, 10);
  const tier2 = t2a + t2b + t2c; // max 30

  // ── TIER 3: TRADING QUALITY (20 pts) ──────────────────────────────────────

  // 3A. Win Rate on Closed Trades (8pts)
  //     Formula: wins / closedTrades × 100
  //     Default 50% if no trades (neutral — neither rewarded nor penalised)
  const winRate = entry.closedTrades > 0 ? entry.wins / entry.closedTrades * 100 : 50;
  const t3a = clamp(winRate / 100 * 8, 0, 8);

  // 3B. Sector Diversification — Time-Weighted (7pts)
  //     Formula: unique sectors held, capped at 9 (all sectors)
  //     Uses uniqueSectors count as proxy for time-weighted exposure
  const sectors = Math.min(9, entry.uniqueSectors || 0);
  const t3b = sectors / 9 * 7;

  // 3C. Prediction Accuracy — Economic Knowledge (5pts)
  //     Formula: correct predictions / total predictions × 5
  //     Tests whether teams understand the macro theory behind events
  const predTotal = entry.predTotal || 0;
  const predCorrect = entry.predCorrect || 0;
  const predRate = predTotal > 0 ? predCorrect / predTotal : 0;
  const t3c = predRate * 5;
  const tier3 = t3a + t3b + t3c; // max 20

  // ── COMPOSITE SCORE ───────────────────────────────────────────────────────
  const score = tier1 + tier2 + tier3;

  // ── TIEBREAKER FIELDS (sequential) ────────────────────────────────────────
  // TB1: Calmar ratio (higher wins)
  // TB2: Max drawdown (lower wins → negate)
  // TB3: Alpha vs market (higher wins)
  // TB4: Unique sectors (higher wins)
  // TB5: Last trade timestamp (earlier wins → negate)
  const tb1 = +calmar.toFixed(4);
  const tb2 = -maxDrawdown; // negated: lower DD = higher tiebreaker
  const tb3 = +alpha.toFixed(4);
  const tb4 = sectors;
  const tb5 = -(entry.lastTradeTs || Date.now()); // negated: earlier = higher tiebreaker

  return {
    score: +score.toFixed(3),
    // Tier scores
    tier1,
    tier2,
    tier3,
    // Individual indicators
    absoluteReturn: +absoluteReturn.toFixed(2),
    sharpe: +sharpe.toFixed(3),
    alpha: +alpha.toFixed(2),
    consistency: +consistency.toFixed(2),
    maxDrawdown: +maxDrawdown.toFixed(2),
    calmar: +calmar.toFixed(3),
    beta: +beta.toFixed(3),
    winRate: +winRate.toFixed(1),
    sectors,
    predRate: +(predRate * 100).toFixed(1),
    // Point contributions (for scorecard transparency)
    t1a: +t1a.toFixed(2),
    t1b: +t1b.toFixed(2),
    t1c: +t1c.toFixed(2),
    t1d: +t1d.toFixed(2),
    t2a: +t2a.toFixed(2),
    t2b: +t2b.toFixed(2),
    t2c: +t2c.toFixed(2),
    t3a: +t3a.toFixed(2),
    t3b: +t3b.toFixed(2),
    t3c: +t3c.toFixed(2),
    // Tiebreaker values
    tb1,
    tb2,
    tb3,
    tb4,
    tb5,
    // Legacy fields (kept for compatibility)
    totalReturn: +absoluteReturn.toFixed(2),
    deployed: total > 0 ? +(Math.min(1, (total - cash) / total) * 100).toFixed(1) : 0
  };
}

// Sort leaderboard with tiebreaker chain
function sortLeaderboard(entries) {
  return [...entries].sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score; // primary
    if (Math.abs(b.tb1 - a.tb1) > 0.0001) return b.tb1 - a.tb1; // TB1: Calmar
    if (Math.abs(b.tb2 - a.tb2) > 0.0001) return b.tb2 - a.tb2; // TB2: -MaxDD
    if (Math.abs(b.tb3 - a.tb3) > 0.0001) return b.tb3 - a.tb3; // TB3: Alpha
    if (b.tb4 !== a.tb4) return b.tb4 - a.tb4; // TB4: Sectors
    return b.tb5 - a.tb5; // TB5: -lastTradeTs
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmt = (n, d = 2) => Number(n).toLocaleString("en-US", {
  minimumFractionDigits: d,
  maximumFractionDigits: d
});
const fmtUSD = n => "$" + fmt(n);
const fmtK = n => Math.abs(n) >= 1000 ? (n < 0 ? "-" : "") + "$" + fmt(Math.abs(n) / 1000, 1) + "K" : fmtUSD(n);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const fmtTS = ts => new Date(ts).toLocaleTimeString([], {
  hour: "2-digit",
  minute: "2-digit"
});
const fmtDT = (ts, tf) => {
  const d = new Date(ts);
  if (tf === "5m" || tf === "15m") return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  }) + " " + fmtTS(ts);
  if (tf === "1h" || tf === "4h") return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  if (tf === "1D") return d.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  return d.toLocaleDateString([], {
    month: "short",
    year: "numeric"
  });
};
const nowShort = () => new Date().toLocaleTimeString([], {
  hour: "2-digit",
  minute: "2-digit"
});
const nowFull = () => new Date().toLocaleTimeString([], {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});
function initPrices() {
  return Object.fromEntries(ALL_STOCKS.map(s => [s.ticker, s.basePrice * (0.85 + Math.random() * 0.3)]));
}
function initHistory(p) {
  return Object.fromEntries(ALL_STOCKS.map(s => [s.ticker, Array(HISTORY_LEN).fill(p[s.ticker])]));
}
function initBots() {
  return AI_BOTS.map(b => ({
    ...b,
    cash: INITIAL_CASH,
    holdings: {},
    pnl: 0,
    trades: 0,
    wins: 0,
    closedTrades: 0,
    maxDrawdown: 1,
    uniqueSectors: 0,
    peakValue: INITIAL_CASH
  }));
}

// ─── PORTFOLIO ANALYTICS ─────────────────────────────────────────────────────
function PortfolioAnalytics({
  holdings,
  transactions,
  prices,
  cash,
  initCash
}) {
  const openPnL = {};
  Object.entries(holdings).forEach(([ticker, pos]) => {
    const cur = prices[ticker] || pos.avgCost;
    openPnL[ticker] = {
      unrealized: (cur - pos.avgCost) * pos.qty,
      pct: (cur - pos.avgCost) / pos.avgCost * 100,
      qty: pos.qty,
      avgCost: pos.avgCost,
      curPrice: cur,
      value: cur * pos.qty
    };
  });
  const totalHoldingsValue = Object.values(openPnL).reduce((s, p) => s + p.value, 0);
  const totalUnrealized = Object.values(openPnL).reduce((s, p) => s + p.unrealized, 0);
  const realizedByTicker = {};
  let totalRealized = 0,
    wins = 0,
    losses = 0;
  transactions.filter(t => t.type === "SELL").forEach(t => {
    const gain = (t.price - t.avgCostAtSell) * t.qty;
    if (!realizedByTicker[t.ticker]) realizedByTicker[t.ticker] = 0;
    realizedByTicker[t.ticker] += gain;
    totalRealized += gain;
    if (gain > 0) wins++;else losses++;
  });
  const totalPnL = totalUnrealized + totalRealized;
  const totalVal = cash + totalHoldingsValue;
  const roi = (totalVal - initCash) / initCash * 100;
  return {
    openPnL,
    totalHoldingsValue,
    totalUnrealized,
    totalRealized,
    totalPnL,
    roi,
    totalVal,
    wins,
    losses,
    realizedByTicker
  };
}

// ─── SPARKLINE ───────────────────────────────────────────────────────────────
function Spark({
  data,
  color,
  w = 100,
  h = 32
}) {
  if (!data || data.length < 2) return /*#__PURE__*/React.createElement("div", {
    style: {
      width: w,
      height: h
    }
  });
  const mn = Math.min(...data),
    mx = Math.max(...data),
    rng = mx - mn || 1;
  const pts = data.map((v, i) => `${i / (data.length - 1) * w},${h - (v - mn) / rng * (h - 3) + 1}`).join(" ");
  const up = data[data.length - 1] >= data[0];
  const c = up ? color : "#ef4444";
  return /*#__PURE__*/React.createElement("svg", {
    width: w,
    height: h,
    viewBox: `0 0 ${w} ${h}`,
    style: {
      display: "block",
      width: "100%"
    }
  }, /*#__PURE__*/React.createElement("polygon", {
    points: `0,${h} ${pts} ${w},${h}`,
    fill: `${c}22`
  }), /*#__PURE__*/React.createElement("polyline", {
    points: pts,
    fill: "none",
    stroke: c,
    strokeWidth: "1.8",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }));
}

// ─── SECTOR BADGE ─────────────────────────────────────────────────────────────
function SectorBadge({
  sectorId,
  small
}) {
  const s = SECTORS.find(x => x.id === sectorId);
  if (!s) return null;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      fontSize: small ? 9 : 10,
      padding: small ? "1px 5px" : "2px 7px",
      borderRadius: 4,
      border: `1px solid ${s.color}44`,
      background: `${s.color}18`,
      color: s.color,
      fontWeight: 700,
      letterSpacing: "0.04em",
      whiteSpace: "nowrap"
    }
  }, s.icon, " ", s.label);
}

// ─── LEADERBOARD PANEL ────────────────────────────────────────────────────────
function LeaderboardPanel({
  entries,
  teams,
  initCash,
  highlight,
  showDetail,
  leaderHidden
}) {
  const [expandedRow, setExpandedRow] = useState(null);
  if (!entries || entries.length === 0) return /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#334155",
      fontSize: 12,
      padding: "12px 0"
    }
  }, "No players yet.");
  if (leaderHidden) return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0a0f1e",
      border: "1px solid #a78bfa44",
      borderRadius: 12,
      padding: "24px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 32,
      marginBottom: 8
    }
  }, "\uD83C\uDF11"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 800,
      fontSize: 14,
      color: "#a78bfa",
      marginBottom: 6
    }
  }, "DARK POOL ROUND"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#475569"
    }
  }, "Leaderboard hidden \u2014 trade on conviction alone."));
  const ic = initCash || INITIAL_CASH;
  const scored = entries.map(e => ({
    ...e,
    ...calcScore(e, ic, entries)
  }));
  const ranked = sortLeaderboard(scored);
  const maxScore = Math.max(ranked[0]?.score || 1, 1);

  // Rank each team on each individual indicator for percentile display
  const rankOn = (field, higherBetter = true) => {
    const sorted = [...ranked].sort((a, b) => higherBetter ? b[field] - a[field] : a[field] - b[field]);
    return Object.fromEntries(sorted.map((e, i) => [e.name, i + 1]));
  };
  const rankReturn = rankOn("absoluteReturn");
  const rankSharpe = rankOn("sharpe");
  const rankAlpha = rankOn("alpha");
  const rankDD = rankOn("maxDrawdown", false); // lower DD = better rank
  const rankCalmar = rankOn("calmar");
  const rankWinRate = rankOn("winRate");
  const rankSectors = rankOn("sectors");
  const rankPred = rankOn("predRate");
  const n = ranked.length;
  const medalColor = rank => rank === 1 ? "#fbbf24" : rank === 2 ? "#94a3b8" : rank === 3 ? "#cd7c2f" : "#334155";
  const indColor = (pts, max) => pts >= max * 0.8 ? "#00f5c4" : pts >= max * 0.5 ? "#fbbf24" : pts >= max * 0.25 ? "#f97316" : "#ef4444";
  const rankBadge = rank => rank <= 3 ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      padding: "1px 5px",
      borderRadius: 3,
      fontWeight: 800,
      background: medalColor(rank) + "22",
      color: medalColor(rank)
    }
  }, "#", rank) : /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      color: "#334155"
    }
  }, "#", rank);
  return /*#__PURE__*/React.createElement("div", null, ranked.map((e, i) => {
    const team = teams?.find(t => t.name === e.name);
    const color = team?.color || e.color || "#64748b";
    const isMe = e.name === highlight;
    const barPct = clamp(e.score / maxScore * 100, 0, 100);
    const isExpanded = expandedRow === e.name;
    // Detect if tiebreaker was used
    const tieWithPrev = i > 0 && Math.abs(ranked[i - 1].score - e.score) < 0.001;
    return /*#__PURE__*/React.createElement("div", {
      key: e.name + i,
      style: {
        background: isMe ? "rgba(0,245,196,0.06)" : "#0a0f1e",
        border: `1px solid ${isMe ? "#00f5c460" : "#111827"}`,
        borderRadius: 10,
        marginBottom: 7,
        overflow: "hidden",
        transition: "all 0.3s"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "11px 14px",
        cursor: "pointer"
      },
      onClick: () => setExpandedRow(isExpanded ? null : e.name)
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 6
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 24,
        textAlign: "center",
        fontFamily: "'Bebas Neue',sans-serif",
        fontSize: 18,
        color: i === 0 ? "#fbbf24" : i === 1 ? "#94a3b8" : i === 2 ? "#cd7c2f" : "#475569"
      }
    }, i + 1), /*#__PURE__*/React.createElement("div", {
      style: {
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: color,
        flexShrink: 0
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        fontWeight: 700,
        fontSize: 12,
        color: isMe ? "#00f5c4" : color,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, e.name, isMe ? " (YOU)" : ""), tieWithPrev && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 8,
        padding: "1px 5px",
        borderRadius: 3,
        background: "#fbbf2415",
        color: "#fbbf24",
        border: "1px solid #fbbf2430"
      }
    }, "TIE\u2192TB"), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "right"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Bebas Neue',sans-serif",
        fontSize: 20,
        color: e.score >= 60 ? "#00f5c4" : e.score >= 40 ? "#fbbf24" : e.score >= 20 ? "#f97316" : "#ef4444"
      }
    }, e.score.toFixed(1)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 8,
        color: "#334155"
      }
    }, "/100 pts")), /*#__PURE__*/React.createElement("div", {
      style: {
        color: "#334155",
        fontSize: 10
      }
    }, isExpanded ? "▲" : "▼")), /*#__PURE__*/React.createElement("div", {
      style: {
        height: 3,
        background: "#0f172a",
        borderRadius: 2,
        marginBottom: 5
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: `${barPct}%`,
        height: "100%",
        background: color,
        borderRadius: 2,
        transition: "width 0.5s ease"
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        flexWrap: "wrap"
      }
    }, [{
      label: "Performance",
      pts: e.tier1,
      max: 50,
      color: "#38bdf8"
    }, {
      label: "Risk Mgmt",
      pts: e.tier2,
      max: 30,
      color: "#a78bfa"
    }, {
      label: "Quality",
      pts: e.tier3,
      max: 20,
      color: "#00f5c4"
    }].map(tier => /*#__PURE__*/React.createElement("span", {
      key: tier.label,
      style: {
        fontSize: 8,
        padding: "1px 6px",
        borderRadius: 3,
        background: `${tier.color}15`,
        color: tier.color,
        fontWeight: 700
      }
    }, tier.label, " ", tier.pts?.toFixed(1), "/", tier.max)), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 8,
        color: "#475569",
        marginLeft: "auto"
      }
    }, e.absoluteReturn >= 0 ? "+" : "", e.absoluteReturn, "% return"))), isExpanded && /*#__PURE__*/React.createElement("div", {
      style: {
        borderTop: "1px solid #1e293b",
        padding: "14px",
        background: "#060c18",
        animation: "fadein 0.2s"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: "#38bdf8",
        fontWeight: 800,
        letterSpacing: "0.1em",
        marginBottom: 8
      }
    }, "TIER 1 \u2014 PERFORMANCE (", e.tier1?.toFixed(1), "/50 pts)"), [{
      label: "Absolute Return",
      formula: "(Portfolio − Start) ÷ Start × 100",
      value: `${e.absoluteReturn >= 0 ? "+" : ""}${e.absoluteReturn}%`,
      pts: e.t1a,
      max: 15,
      rank: rankReturn[e.name],
      n,
      tip: "Your raw profit as % of starting capital"
    }, {
      label: "Risk-Adj Return (Sharpe)",
      formula: "Return ÷ Max Drawdown",
      value: e.sharpe?.toFixed(2),
      pts: e.t1b,
      max: 15,
      rank: rankSharpe[e.name],
      n,
      tip: "Higher = better return per unit of risk taken"
    }, {
      label: "Alpha vs Market",
      formula: "Your Return − BALL Index Return",
      value: `${e.alpha >= 0 ? "+" : ""}${e.alpha}%`,
      pts: e.t1c,
      max: 12,
      rank: rankAlpha[e.name],
      n,
      tip: "Did you beat the total market benchmark?"
    }, {
      label: "Round Consistency",
      formula: "Geometric mean of per-round returns",
      value: `${e.consistency >= 0 ? "+" : ""}${e.consistency}%`,
      pts: e.t1d,
      max: 8,
      rank: null,
      n,
      tip: "Penalises one-lucky-round players"
    }].map(ind => renderIndicator(ind, color))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: "#a78bfa",
        fontWeight: 800,
        letterSpacing: "0.1em",
        marginBottom: 8
      }
    }, "TIER 2 \u2014 RISK MANAGEMENT (", e.tier2?.toFixed(1), "/30 pts)"), [{
      label: "Max Drawdown Control",
      formula: "Inversely scaled — lower DD = more pts",
      value: `${e.maxDrawdown}%`,
      pts: e.t2a,
      max: 10,
      rank: rankDD[e.name],
      n,
      tip: "Peak-to-trough loss. Lower = more disciplined"
    }, {
      label: "Calmar Ratio",
      formula: "Return ÷ Max Drawdown",
      value: e.calmar?.toFixed(3),
      pts: e.t2b,
      max: 10,
      rank: rankCalmar[e.name],
      n,
      tip: "Primary tiebreaker. Rewards efficient risk use"
    }, {
      label: "Portfolio Beta",
      formula: "1 − |Holdings concentration|",
      value: e.beta?.toFixed(3),
      pts: e.t2c,
      max: 10,
      rank: null,
      n,
      tip: "Low beta = independent thinking, not just indexing"
    }].map(ind => renderIndicator(ind, color))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: "#00f5c4",
        fontWeight: 800,
        letterSpacing: "0.1em",
        marginBottom: 8
      }
    }, "TIER 3 \u2014 TRADING QUALITY (", e.tier3?.toFixed(1), "/20 pts)"), [{
      label: "Win Rate",
      formula: "Profitable sells ÷ Total sells × 100",
      value: `${e.winRate}%`,
      pts: e.t3a,
      max: 8,
      rank: rankWinRate[e.name],
      n,
      tip: "% of your closed trades that made money"
    }, {
      label: "Sector Diversification",
      formula: "Unique sectors held (max 9)",
      value: `${e.sectors}/9 sectors`,
      pts: e.t3b,
      max: 7,
      rank: rankSectors[e.name],
      n,
      tip: "Rewards spreading risk across industries"
    }, {
      label: "Prediction Accuracy",
      formula: "Correct economic predictions ÷ Total",
      value: `${e.predRate}%`,
      pts: e.t3c,
      max: 5,
      rank: rankPred[e.name],
      n,
      tip: "% of prediction market questions answered correctly"
    }].map(ind => renderIndicator(ind, color))), tieWithPrev && /*#__PURE__*/React.createElement("div", {
      style: {
        background: "#fbbf2408",
        border: "1px solid #fbbf2430",
        borderRadius: 6,
        padding: "8px 10px",
        fontSize: 9,
        color: "#fbbf24"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        marginBottom: 4
      }
    }, "TIEBREAKER APPLIED"), /*#__PURE__*/React.createElement("div", {
      style: {
        color: "#94a3b8",
        lineHeight: 1.7
      }
    }, "Same composite score as the team above. Resolved by: Calmar Ratio (", e.calmar?.toFixed(3), ") \u2192 Max Drawdown (", e.maxDrawdown, "%) \u2192 Alpha (", e.alpha, "%) \u2192 Sectors (", e.sectors, ")")), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        padding: "8px 10px",
        background: "#0a0f1e",
        borderRadius: 6,
        border: "1px solid #1e293b",
        fontSize: 10,
        color: "#64748b",
        lineHeight: 1.7
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#f1f5f9",
        fontWeight: 700
      }
    }, "Summary: "), e.absoluteReturn > 0 ? `Generated ${e.absoluteReturn}% return` : `Lost ${Math.abs(e.absoluteReturn)}% of capital`, ".", " ", "Ranked #", rankAlpha[e.name] || "?", " in alpha vs market", " ", "and #", rankDD[e.name] || "?", " in risk control.", " ", e.winRate >= 60 ? "Strong" : e.winRate >= 45 ? "Average" : "Weak", " trade quality", " ", "at ", e.winRate, "% win rate.", " ", "Used ", e.sectors, " of 9 sectors.")));
  }));
}

// Helper: render a single indicator row in the scorecard
function renderIndicator({
  label,
  formula,
  value,
  pts,
  max,
  rank,
  n,
  tip
}, teamColor) {
  const pct = max > 0 ? pts / max * 100 : 0;
  const barCol = pct >= 80 ? "#00f5c4" : pct >= 50 ? "#fbbf24" : pct >= 25 ? "#f97316" : "#ef4444";
  return /*#__PURE__*/React.createElement("div", {
    key: label,
    style: {
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      marginBottom: 3
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: "#f1f5f9",
      fontWeight: 600
    }
  }, label), rank && n && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 8,
      color: "#475569",
      marginLeft: 6
    }
  }, "#", rank, " of ", n)), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: barCol,
      fontWeight: 700
    }
  }, pts?.toFixed(1), "/", max), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      color: "#475569",
      marginLeft: 6
    }
  }, value))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 4,
      background: "#0f172a",
      borderRadius: 2,
      marginBottom: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${Math.min(100, pct)}%`,
      height: "100%",
      background: barCol,
      borderRadius: 2,
      transition: "width 0.4s ease"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "#334155"
    }
  }, formula));
}
// ─── EMERGENCY NEWS MODAL ─────────────────────────────────────────────────────
function EmergencyModal({
  events,
  bufferLeft,
  onApply,
  onClose
}) {
  const [applied, setApplied] = useState(false);
  const bm = Math.floor(Math.max(0, bufferLeft || 0) / 60);
  const bs = Math.max(0, bufferLeft || 0) % 60;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      background: "rgba(2,8,23,0.97)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'JetBrains Mono','Courier New',monospace"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.12) 2px,rgba(0,0,0,0.12) 4px)",
      pointerEvents: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      width: "min(680px,95vw)",
      background: "#0a0f1e",
      border: "2px solid #ef4444",
      borderRadius: 16,
      boxShadow: "0 0 80px rgba(239,68,68,0.3)",
      overflow: "hidden",
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "linear-gradient(135deg,#7f1d1d,#450a0a)",
      padding: "16px 22px",
      borderBottom: "1px solid #ef444440",
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 26,
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
      color: "#fef2f2"
    }
  }, "MARKET DISRUPTION BULLETIN"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#fca5a5",
      letterSpacing: "0.15em",
      marginTop: 2
    }
  }, "TAKING EFFECT NEXT ROUND \u2014 PLAN ACCORDINGLY")), bufferLeft != null && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#fca5a5",
      marginBottom: 2
    }
  }, "NEXT ROUND IN"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontSize: 28,
      fontWeight: 900,
      color: bm < 1 ? "#ef4444" : "#f1f5f9"
    }
  }, String(bm).padStart(2, "0"), ":", String(bs).padStart(2, "0")))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 22px",
      maxHeight: "55vh",
      overflowY: "auto"
    }
  }, events[0]?.political && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "linear-gradient(135deg,#3b0764,#1e1b4b)",
      border: "1px solid #7c3aed",
      borderRadius: 10,
      padding: "10px 14px",
      marginBottom: 12,
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 22
    }
  }, events[0].eventIcon), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#a78bfa",
      fontWeight: 800,
      letterSpacing: "0.08em"
    }
  }, "POLITICAL SHOCK EVENT"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "#e9d5ff",
      fontWeight: 700
    }
  }, events[0].eventName), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#6d28d9",
      marginTop: 2
    }
  }, events.length, " stocks across ", new Set(events.map(e => e.sectorId)).size, " sectors affected"))), events.map((evt, i) => {
    const stock = ALL_STOCKS.find(s => s.ticker === evt.ticker);
    const up = evt.impact > 0;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        background: "#0f172a",
        border: `1px solid ${up ? "#16653440" : "#7f1d1d40"}`,
        borderLeft: `4px solid ${up ? "#00f5c4" : "#ef4444"}`,
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 7
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: stock?.color || "#94a3b8",
        fontWeight: 800,
        fontSize: 15
      }
    }, evt.ticker), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#64748b",
        fontSize: 12
      }
    }, stock?.name), stock && /*#__PURE__*/React.createElement(SectorBadge, {
      sectorId: stock.sectorId,
      small: true
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: "auto",
        display: "flex",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 15,
        fontWeight: 900,
        color: up ? "#00f5c4" : "#ef4444"
      }
    }, up ? "▲" : "▼", " ", Math.abs(evt.impact), "%"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 4,
        fontWeight: 700,
        background: up ? "rgba(0,245,196,0.12)" : "rgba(239,68,68,0.12)",
        color: up ? "#00f5c4" : "#ef4444"
      }
    }, up ? "BULLISH" : "BEARISH"))), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: "#f1f5f9",
        fontWeight: 600,
        lineHeight: 1.5,
        marginBottom: 5
      }
    }, evt.headline), evt.detail && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "#64748b",
        fontStyle: "italic"
      }
    }, evt.detail));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "14px 22px",
      borderTop: "1px solid #1e293b",
      display: "flex",
      gap: 10,
      justifyContent: "flex-end"
    }
  }, !applied ? /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      onApply();
      setApplied(true);
    },
    style: {
      padding: "12px 28px",
      background: "linear-gradient(135deg,#7f1d1d,#dc2626)",
      border: "none",
      borderRadius: 8,
      color: "#fff",
      fontWeight: 700,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 12
    }
  }, "\u26A1 APPLY TO MARKET") : /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: {
      padding: "12px 28px",
      background: "#166534",
      border: "none",
      borderRadius: 8,
      color: "#4ade80",
      fontWeight: 700,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 12
    }
  }, "\u2713 START NEXT ROUND \u2192"))));
}

// ═══════════════════════════════════════════════════════════════
// CHART ENGINE — Timeframes, Candle Generator, Indicators, Chart
// ═══════════════════════════════════════════════════════════════
// ─── TIMEFRAMES ───────────────────────────────────────────────────────────────
// 1 trading day = 9:30–16:00 = 390 minutes = 78 × 5m bars
const TIMEFRAMES = [{
  key: "5m",
  label: "5m",
  desc: "1 WEEK · 5-MIN BARS",
  bars: 390,
  xEvery: 78
}, {
  key: "15m",
  label: "15m",
  desc: "1 WEEK · 15-MIN BARS",
  bars: 130,
  xEvery: 26
}, {
  key: "1h",
  label: "1h",
  desc: "1 MONTH · HOURLY BARS",
  bars: 160,
  xEvery: 24
}, {
  key: "4h",
  label: "4h",
  desc: "3 MONTHS · 4-HR BARS",
  bars: 180,
  xEvery: 30
}, {
  key: "1D",
  label: "1D",
  desc: "1 YEAR · DAILY BARS",
  bars: 252,
  xEvery: 21
}, {
  key: "1W",
  label: "10Y",
  desc: "10 YEARS · WEEKLY BARS",
  bars: 520,
  xEvery: 52
}];

// ─── CANDLE GENERATOR ─────────────────────────────────────────────────────────
function generateCandles(basePrice, volatility, tf) {
  const {
    bars,
    key
  } = tf;
  const MS = {
    "5m": 5 * 60e3,
    "15m": 15 * 60e3,
    "1h": 3600e3,
    "4h": 14400e3,
    "1D": 86400e3,
    "1W": 7 * 86400e3
  };
  const barMs = MS[key];
  const now = Date.now();

  // Start price: lower for long-frame charts (growth story), near current for short-frame
  const startMult = key === "1W" ? rnd(0.30, 0.52) : key === "1D" ? rnd(0.70, 0.88) : key === "4h" ? rnd(0.82, 0.95) : key === "1h" ? rnd(0.90, 0.98) : rnd(0.94, 1.03);
  let price = basePrice * startMult;

  // Annualised drift broken into per-bar
  const barsPerYear = 365 * 24 * 3600e3 / barMs;
  const barDrift = 0.09 / barsPerYear;

  // Structural events (indices into bar array)
  const events = new Map([[Math.floor(bars * 0.12), rnd(-0.08, -0.03)],
  // early dip
  [Math.floor(bars * 0.28), rnd(0.04, 0.10)],
  // bull leg
  [Math.floor(bars * 0.45), rnd(-0.12, -0.05)],
  // correction
  [Math.floor(bars * 0.55), rnd(0.06, 0.14)],
  // recovery
  [Math.floor(bars * 0.68), rnd(-0.04, -0.02)],
  // pause
  [Math.floor(bars * 0.73), rnd(-0.18, -0.08)],
  // major crash
  [Math.floor(bars * 0.78), rnd(0.08, 0.18)],
  // V-shape bounce
  [Math.floor(bars * 0.88), rnd(0.03, 0.09)],
  // late rally
  [Math.floor(bars * 0.95), rnd(-0.03, 0.05)] // consolidation
  ]);

  // Intraday volatility multipliers
  function intradayMult(ts) {
    if (key !== "5m" && key !== "15m") return 1;
    const d = new Date(ts),
      h = d.getHours(),
      m = d.getMinutes();
    if (h === 9 && m <= 45) return 2.8; // open range
    if (h === 15 && m >= 30) return 2.0; // close rush
    if (h >= 12 && h <= 13) return 0.6; // lunch lull
    return 1.0;
  }
  const candles = [];
  for (let i = 0; i < bars; i++) {
    const ts = now - (bars - i) * barMs;

    // No time filtering — always generate all bars for consistent chart display

    const baseVol = volatility * 0.01 * Math.sqrt(barMs / 86400e3);
    const vol = clamp(baseVol, 0.0005, 0.05);
    const iMult = intradayMult(ts);
    const shock = events.get(i) || 0;
    const drift = barDrift + shock + rnd(-vol, vol) * iMult;
    const open = price;
    const close = Math.max(0.5, price * (1 + drift));
    const span = Math.abs(close - open);
    const wMult = rnd(0.3, 1.4) * iMult;
    const high = Math.max(open, close) + span * wMult * rnd(0.2, 0.9) + price * vol * rnd(0.1, 0.4);
    const low = Math.min(open, close) - span * wMult * rnd(0.2, 0.9) - price * vol * rnd(0.1, 0.4);
    const volume = Math.round(rnd(400_000, 9_000_000) * (1 + Math.abs(drift) * 25) * iMult);
    candles.push({
      ts,
      open,
      high: Math.max(open, close, high),
      low: Math.min(open, close, low),
      close,
      volume
    });
    price = close;
  }
  return candles;
}

// ─── TECHNICAL INDICATORS ─────────────────────────────────────────────────────
function ema(closes, p) {
  const k = 2 / (p + 1);
  let e = closes[0];
  const out = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < p - 1) {
      out.push(null);
      continue;
    }
    e = closes[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}
function bollingerBands(closes, p = 20, m = 2) {
  const mid = [],
    up = [],
    lo = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < p - 1) {
      mid.push(null);
      up.push(null);
      lo.push(null);
      continue;
    }
    const sl = closes.slice(i - p + 1, i + 1),
      mn = sl.reduce((a, b) => a + b, 0) / p;
    const sd = Math.sqrt(sl.reduce((a, b) => a + (b - mn) ** 2, 0) / p);
    mid.push(mn);
    up.push(mn + m * sd);
    lo.push(mn - m * sd);
  }
  return {
    mid,
    up,
    lo
  };
}
function rsi(closes, p = 14) {
  const out = [];
  let g = 0,
    l = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (i <= p) {
      if (d > 0) g += d;else l += Math.abs(d);
      if (i === p) {
        g /= p;
        l /= p;
      }
      out.push(null);
      continue;
    }
    g = (g * (p - 1) + Math.max(0, d)) / p;
    l = (l * (p - 1) + Math.abs(Math.min(0, d))) / p;
    out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
  }
  return out;
}
function macd(closes, f = 12, s = 26, sig = 9) {
  const mf = ema(closes, f),
    ms = ema(closes, s);
  const line = mf.map((v, i) => v != null && ms[i] != null ? v - ms[i] : null);
  const sigL = ema(line.map(v => v ?? 0), sig);
  const hist = line.map((v, i) => v != null && sigL[i] != null ? v - sigL[i] : null);
  return {
    line,
    sigL,
    hist
  };
}
function vwap(candles) {
  let cumTP = 0,
    cumVol = 0;
  const out = [];
  candles.forEach(c => {
    const tp = (c.high + c.low + c.close) / 3;
    cumTP += tp * c.volume;
    cumVol += c.volume;
    out.push(cumVol ? cumTP / cumVol : null);
  });
  return out;
}

// ─── CANDLE CHART ─────────────────────────────────────────────────────────────
const MIN_VISIBLE = 10; // fewest candles allowed in view

function CandleChart({
  candles,
  color,
  price,
  tf
}) {
  const mainRef = useRef(null);
  const navRef = useRef(null);
  const total = candles?.length || 0;

  // Zoom/pan state: [startIdx, endIdx] inclusive
  const [view, setView] = useState([0, total - 1]);
  const [ind, setInd] = useState({
    ema9: true,
    ema21: true,
    bb: false,
    vwap: false
  });
  const [showVol, setShowVol] = useState(true);
  const [showRSI, setShowRSI] = useState(true);
  const [showMACD, setShowMACD] = useState(false);
  const [tip, setTip] = useState(null);
  const [cross, setCross] = useState(null);
  // Drag-to-zoom brush on navigator
  const [brush, setBrush] = useState(null); // {startX, endX} in navigator SVG coords
  const brushRef = useRef(null);
  // Pan via mouse drag on main chart
  const dragRef = useRef(null); // {startX, startView}
  // Selection-brush on main chart (ctrl+drag or dedicated mode)
  const [zoomMode, setZoomMode] = useState(false); // when true, drag selects region
  const selRef = useRef(null); // {startIdx}
  const [selRange, setSelRange] = useState(null); // {a,b} indices while dragging

  // Reset view when candles change (new tf/ticker)
  useEffect(() => {
    if (total > 0) {
      setView([0, total - 1]);
      setTip(null);
      setCross(null);
    }
  }, [total]);
  if (!candles || total < 5) return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 460,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#1e293b",
      fontSize: 12
    }
  }, "Generating chart\u2026");

  // ── visible slice ──────────────────────────────────────────────────────────
  const vStart = clamp(view[0], 0, Math.max(0, total - MIN_VISIBLE));
  const vEnd = clamp(view[1], vStart + MIN_VISIBLE - 1, total - 1);
  const vis = candles.slice(vStart, vEnd + 1);
  const vLen = vis.length;
  if (vLen < 2) return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 460,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#1e293b",
      fontSize: 12
    }
  }, "Generating chart\u2026");

  // ── layout ────────────────────────────────────────────────────────────────
  const W = 1040,
    PAD = {
      top: 16,
      right: 82,
      bot: 12,
      left: 14
    };
  const mainH = 300;
  const volH = showVol ? 52 : 0;
  const subH = showRSI || showMACD ? 100 : 0;
  const subGap = subH > 0 ? 12 : 0;
  const navH = 44; // navigator bar height
  const navGap = 8;
  const H = PAD.top + mainH + volH + subGap + subH + PAD.bot;
  const CW = W - PAD.left - PAD.right;

  // ── indicators on ALL candles (for consistency at edges) ──────────────────
  const allCloses = candles.map(c => c.close);
  const allE9 = ema(allCloses, 9);
  const allE21 = ema(allCloses, 21);
  const allBB = bollingerBands(allCloses, 20, 2);
  const allRSI = rsi(allCloses, 14);
  const allMACD = macd(allCloses, 12, 26, 9);
  const allVWAP = tf === "5m" || tf === "15m" ? vwap(candles) : null;

  // Slice indicators to visible window
  const slice = arr => arr.slice(vStart, vEnd + 1);
  const visE9 = slice(allE9),
    visE21 = slice(allE21);
  const visBB = {
    up: slice(allBB.up),
    lo: slice(allBB.lo),
    mid: slice(allBB.mid)
  };
  const visRSI = slice(allRSI);
  const visMACDl = slice(allMACD.line),
    visMACDs = slice(allMACD.sigL),
    visMACDh = slice(allMACD.hist);
  const visVWAP = allVWAP ? slice(allVWAP) : null;

  // ── price range for visible candles ───────────────────────────────────────
  const lo = vis.length ? Math.min(...vis.map(c => c.low)) : 0;
  const hi = vis.length ? Math.max(...vis.map(c => c.high)) : 1;
  const rng = hi - lo || 1;

  // ── geometry helpers ──────────────────────────────────────────────────────
  const cw = CW / vLen;
  const bw = Math.max(1.5, cw * 0.72);
  const hbw = bw / 2;
  const toX = i => PAD.left + (i + 0.5) * cw;
  const toY = p => PAD.top + mainH - (p - lo) / rng * mainH;
  const volY = PAD.top + mainH;
  const maxV = vis.length ? Math.max(...vis.map(c => c.volume), 1) : 1;
  const subTop = PAD.top + mainH + volH + subGap;
  const toRSI = v => subTop + subH - v / 100 * subH;
  const macdVV = visMACDh.filter(v => v != null);
  const mExt = macdVV.length ? Math.max(0.001, Math.abs(Math.min(...macdVV, 0)), Math.abs(Math.max(...macdVV, 0))) : 0.001;
  const toMCD = v => subTop + subH / 2 - v / mExt * (subH / 2);
  const curY = toY(price);

  // ── price grid ────────────────────────────────────────────────────────────
  const gCount = 6,
    gStep = rng / gCount;
  const grid = Array.from({
    length: gCount + 1
  }, (_, i) => lo + gStep * i);

  // ── x labels on visible slice ─────────────────────────────────────────────
  const tfObj = TIMEFRAMES.find(t => t.key === tf) || TIMEFRAMES[0];
  const xEvery = Math.max(1, Math.floor(tfObj.xEvery * vLen / total));
  const xLbls = vis.map((c, i) => {
    if (i % xEvery !== 0 && i !== vLen - 1) return null;
    const d = new Date(c.ts);
    const lbl = tf === "5m" || tf === "15m" ? d.getHours() === 9 && d.getMinutes() <= 35 ? d.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric"
    }) : fmtTS(c.ts) : tf === "1h" || tf === "4h" ? d.toLocaleDateString([], {
      month: "short",
      day: "numeric"
    }) : tf === "1D" ? d.toLocaleDateString([], {
      month: "short",
      year: "2-digit"
    }) : String(d.getFullYear());
    return {
      i,
      lbl
    };
  }).filter(Boolean);

  // ── NAVIGATOR geometry ────────────────────────────────────────────────────
  const NW = 1040,
    NH = navH;
  const NPAD = {
    l: 14,
    r: 82
  };
  const NCW = NW - NPAD.l - NPAD.r;
  const navLo = candles.length ? Math.min(...candles.map(c => c.low)) : 0;
  const navHi = candles.length ? Math.max(...candles.map(c => c.high)) : 1;
  const navRng = navHi - navLo || 1;
  const ncw = NCW / total;
  const nToX = i => NPAD.l + (i + 0.5) * ncw;
  const nToY = p => NH - (p - navLo) / navRng * NH * 0.85 - NH * 0.05;
  // close-line path for navigator
  const navPts = candles.map((c, i) => `${nToX(i)},${nToY(c.close)}`).join(" ");
  // navigator window handles
  const wxL = NPAD.l + vStart / total * NCW;
  const wxR = NPAD.l + (vEnd + 1) / total * NCW;

  // ── ZOOM helpers ─────────────────────────────────────────────────────────
  const zoomBy = useCallback((factor, centerFrac = 0.5) => {
    setView(([s, e]) => {
      const len = e - s + 1;
      const newLen = clamp(Math.round(len * factor), MIN_VISIBLE, total);
      const center = s + len * centerFrac;
      const ns = clamp(Math.round(center - newLen * centerFrac), 0, total - newLen);
      return [ns, ns + newLen - 1];
    });
  }, [total]);
  const panBy = useCallback(delta => {
    setView(([s, e]) => {
      const len = e - s + 1;
      const ns = clamp(s + delta, 0, total - len);
      return [ns, ns + len - 1];
    });
  }, [total]);

  // ── MAIN CHART mouse events ───────────────────────────────────────────────
  function svgCoordX(e, svgRef) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return (e.clientX - rect.left) * (W / rect.width);
  }
  function xToIdx(svgX) {
    return clamp(Math.floor((svgX - PAD.left) / cw), 0, vLen - 1);
  }
  function onMainMove(e) {
    const mx = svgCoordX(e, mainRef);

    // Pan drag
    if (dragRef.current && !zoomMode) {
      const dx = mx - dragRef.current.startX;
      const dBars = -Math.round(dx / cw);
      const [s0, e0] = dragRef.current.startView;
      const len = e0 - s0 + 1;
      const ns = clamp(s0 + dBars, 0, total - len);
      setView([ns, ns + len - 1]);
      setCross(null);
      setTip(null);
      return;
    }
    // Zoom-mode selection drag
    if (selRef.current && zoomMode) {
      const idx = xToIdx(mx) + vStart;
      setSelRange({
        a: Math.min(selRef.current.startIdx, idx),
        b: Math.max(selRef.current.startIdx, idx)
      });
      setCross(null);
      setTip(null);
      return;
    }

    // Normal crosshair + tooltip
    const idx = xToIdx(mx);
    if (idx < 0 || idx >= vLen) return;
    const c = vis[idx];
    const ai = idx + vStart; // absolute index
    setCross({
      x: toX(idx),
      y: toY(c.close)
    });
    setTip({
      ...c,
      idx,
      ai,
      e9: allE9[ai],
      e21: allE21[ai],
      bbU: allBB.up[ai],
      bbL: allBB.lo[ai],
      bbM: allBB.mid[ai],
      rsiV: allRSI[ai],
      macdV: allMACD.line[ai],
      histV: allMACD.hist[ai],
      vwapV: allVWAP ? allVWAP[ai] : null
    });
  }
  function onMainDown(e) {
    if (zoomMode) {
      const mx = svgCoordX(e, mainRef);
      const idx = xToIdx(mx) + vStart;
      selRef.current = {
        startIdx: idx
      };
      setSelRange(null);
    } else {
      dragRef.current = {
        startX: svgCoordX(e, mainRef),
        startView: [vStart, vEnd]
      };
    }
  }
  function onMainUp(e) {
    if (zoomMode && selRef.current && selRange) {
      const {
        a,
        b
      } = selRange;
      const newLen = b - a + 1;
      if (newLen >= MIN_VISIBLE) setView([a, b]);
      selRef.current = null;
      setSelRange(null);
    }
    dragRef.current = null;
  }

  // Wheel zoom
  function onWheel(e) {
    e.preventDefault();
    const rect = mainRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const frac = clamp((mx - PAD.left) / CW, 0, 1);
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    zoomBy(factor, frac);
  }

  // ── NAVIGATOR mouse ────────────────────────────────────────────────────────
  const navDragRef = useRef(null);
  function onNavDown(e) {
    const rect = navRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = (e.clientX - rect.left) * (NW / rect.width);
    // If click inside window handle → pan
    if (nx >= wxL - 4 && nx <= wxR + 4) {
      navDragRef.current = {
        type: "pan",
        startNx: nx,
        startView: [vStart, vEnd]
      };
    } else {
      // Click outside → jump view centre
      const clickFrac = clamp((nx - NPAD.l) / NCW, 0, 1);
      const len = vEnd - vStart + 1;
      const ns = clamp(Math.round(clickFrac * total - len / 2), 0, total - len);
      setView([ns, ns + len - 1]);
    }
  }
  function onNavMove(e) {
    if (!navDragRef.current) return;
    const rect = navRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = (e.clientX - rect.left) * (NW / rect.width);
    if (navDragRef.current.type === "pan") {
      const dFrac = (nx - navDragRef.current.startNx) / NCW;
      const dBars = Math.round(dFrac * total);
      const [s0, e0] = navDragRef.current.startView;
      const len = e0 - s0 + 1;
      const ns = clamp(s0 + dBars, 0, total - len);
      setView([ns, ns + len - 1]);
    }
  }
  function onNavUp() {
    navDragRef.current = null;
  }

  // ── cursor ────────────────────────────────────────────────────────────────
  const mainCursor = zoomMode ? "crosshair" : dragRef.current ? "grabbing" : "grab";

  // ── sel range SVG coords ──────────────────────────────────────────────────
  const selX1 = selRange ? PAD.left + (selRange.a - vStart) * cw : null;
  const selX2 = selRange ? PAD.left + (selRange.b - vStart + 1) * cw : null;

  // ── candle drawn count badge ──────────────────────────────────────────────
  const zoomPct = Math.round(vLen / total * 100);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      userSelect: "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: 10,
      flexWrap: "wrap",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      color: "#1e293b",
      letterSpacing: "0.12em"
    }
  }, "OVERLAY"), [{
    k: "ema9",
    l: "EMA 9",
    c: "#fbbf24"
  }, {
    k: "ema21",
    l: "EMA 21",
    c: "#38bdf8"
  }, {
    k: "bb",
    l: "BB(20)",
    c: "#a78bfa"
  }, ...(allVWAP ? [{
    k: "vwap",
    l: "VWAP",
    c: "#fb923c"
  }] : [])].map(o => /*#__PURE__*/React.createElement("button", {
    key: o.k,
    onClick: () => setInd(p => ({
      ...p,
      [o.k]: !p[o.k]
    })),
    style: {
      padding: "3px 9px",
      borderRadius: 4,
      cursor: "pointer",
      background: ind[o.k] ? `${o.c}22` : "#0a0f1e",
      border: `1px solid ${ind[o.k] ? o.c : "#0f172a"}`,
      color: ind[o.k] ? o.c : "#334155",
      fontFamily: "inherit",
      fontSize: 9,
      fontWeight: 700
    }
  }, o.l)), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      height: 14,
      background: "#0f172a"
    }
  }), [{
    l: "Vol",
    s: showVol,
    fn: v => {
      setShowVol(v);
    }
  }, {
    l: "RSI",
    s: showRSI,
    fn: v => {
      setShowRSI(v);
      if (v) setShowMACD(false);
    }
  }, {
    l: "MACD",
    s: showMACD,
    fn: v => {
      setShowMACD(v);
      if (v) setShowRSI(false);
    }
  }].map(p => /*#__PURE__*/React.createElement("button", {
    key: p.l,
    onClick: () => p.fn(!p.s),
    style: {
      padding: "3px 9px",
      borderRadius: 4,
      cursor: "pointer",
      background: p.s ? "#1e293b" : "#0a0f1e",
      border: `1px solid ${p.s ? "#334155" : "#0f172a"}`,
      color: p.s ? "#64748b" : "#1e293b",
      fontFamily: "inherit",
      fontSize: 9
    }
  }, p.l)), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      height: 14,
      background: "#0f172a"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      color: "#1e293b",
      letterSpacing: "0.1em"
    }
  }, "ZOOM"), [{
    l: "🔍−",
    title: "Zoom out",
    fn: () => zoomBy(1.3, 0.5)
  }, {
    l: "🔍+",
    title: "Zoom in",
    fn: () => zoomBy(0.72, 0.5)
  }, {
    l: "◀",
    title: "Pan left",
    fn: () => panBy(-Math.max(1, Math.round((vEnd - vStart) * 0.15)))
  }, {
    l: "▶",
    title: "Pan right",
    fn: () => panBy(Math.max(1, Math.round((vEnd - vStart) * 0.15)))
  }, {
    l: "↺",
    title: "Reset view",
    fn: () => setView([0, total - 1])
  }].map(b => /*#__PURE__*/React.createElement("button", {
    key: b.l,
    title: b.title,
    onClick: b.fn,
    style: {
      padding: "3px 9px",
      borderRadius: 4,
      cursor: "pointer",
      background: "#0a0f1e",
      border: "1px solid #0f172a",
      color: "#475569",
      fontFamily: "inherit",
      fontSize: 10
    }
  }, b.l)), /*#__PURE__*/React.createElement("button", {
    title: "Drag to select zoom region",
    onClick: () => setZoomMode(z => !z),
    style: {
      padding: "3px 10px",
      borderRadius: 4,
      cursor: "pointer",
      background: zoomMode ? "#1e3a5f" : "#0a0f1e",
      border: `1px solid ${zoomMode ? "#38bdf8" : "#0f172a"}`,
      color: zoomMode ? "#38bdf8" : "#334155",
      fontFamily: "inherit",
      fontSize: 9,
      fontWeight: zoomMode ? 700 : 400
    }
  }, zoomMode ? "✕ CANCEL SELECT" : "⬚ SELECT ZOOM"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      gap: 10,
      fontSize: 9,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#1e293b"
    }
  }, vLen, " bars (", zoomPct, "%)"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#00f5c4"
    }
  }, "\u25AE Bull"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#ef4444"
    }
  }, "\u25AE Bear"), ind.ema9 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#fbbf24"
    }
  }, "\u2501 EMA9"), ind.ema21 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#38bdf8"
    }
  }, "\u2501 EMA21"), ind.bb && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#a78bfa"
    }
  }, "\u25C8 BB"), ind.vwap && allVWAP && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#fb923c"
    }
  }, "\u2501 VWAP"))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      background: "#060c18",
      borderRadius: "12px 12px 0 0",
      border: "1px solid #0d1420",
      borderBottom: "none",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    ref: mainRef,
    width: "100%",
    viewBox: `0 0 ${W} ${H}`,
    style: {
      display: "block",
      cursor: mainCursor,
      touchAction: "none"
    },
    onMouseMove: onMainMove,
    onMouseDown: onMainDown,
    onMouseUp: onMainUp,
    onMouseLeave: () => {
      setTip(null);
      setCross(null);
      dragRef.current = null;
    },
    onWheel: onWheel
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: `bg_${color.replace(/\W/g, "")}`,
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: color,
    stopOpacity: "0.05"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: color,
    stopOpacity: "0"
  })), /*#__PURE__*/React.createElement("clipPath", {
    id: "mc"
  }, /*#__PURE__*/React.createElement("rect", {
    x: PAD.left,
    y: PAD.top,
    width: CW,
    height: mainH
  })), /*#__PURE__*/React.createElement("clipPath", {
    id: "vc"
  }, /*#__PURE__*/React.createElement("rect", {
    x: PAD.left,
    y: volY,
    width: CW,
    height: volH
  })), /*#__PURE__*/React.createElement("clipPath", {
    id: "sc"
  }, /*#__PURE__*/React.createElement("rect", {
    x: PAD.left,
    y: subTop,
    width: CW,
    height: subH
  }))), /*#__PURE__*/React.createElement("rect", {
    x: PAD.left,
    y: PAD.top,
    width: CW,
    height: mainH,
    fill: `url(#bg_${color.replace(/\W/g, "")})`
  }), grid.map((p, i) => /*#__PURE__*/React.createElement("g", {
    key: i
  }, /*#__PURE__*/React.createElement("line", {
    x1: PAD.left,
    y1: toY(p),
    x2: W - PAD.right,
    y2: toY(p),
    stroke: "#0d1420",
    strokeWidth: "1",
    strokeDasharray: "3 7"
  }), /*#__PURE__*/React.createElement("text", {
    x: W - PAD.right + 5,
    y: toY(p) + 4,
    fill: "#1e293b",
    fontSize: "9",
    fontFamily: "JetBrains Mono,monospace"
  }, p >= 1000 ? `$${fmt(p / 1000, 1)}K` : `$${fmt(p, 2)}`))), ind.bb && (() => {
    const uPts = vis.map((c, i) => visBB.up[i] != null ? `${toX(i)},${toY(visBB.up[i])}` : null).filter(Boolean).join(" ");
    const lPts = vis.map((c, i) => visBB.lo[i] != null ? `${toX(i)},${toY(visBB.lo[i])}` : null).filter(Boolean).join(" ");
    const mPts = vis.map((c, i) => visBB.mid[i] != null ? `${toX(i)},${toY(visBB.mid[i])}` : null).filter(Boolean).join(" ");
    const fill = [...uPts.split(" "), ...lPts.split(" ").reverse()].join(" ");
    return /*#__PURE__*/React.createElement("g", {
      clipPath: "url(#mc)"
    }, /*#__PURE__*/React.createElement("polygon", {
      points: fill,
      fill: "#a78bfa10"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: uPts,
      fill: "none",
      stroke: "#a78bfa",
      strokeWidth: "0.8",
      strokeDasharray: "3 3",
      opacity: "0.55"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: mPts,
      fill: "none",
      stroke: "#a78bfa",
      strokeWidth: "0.6",
      strokeDasharray: "5 4",
      opacity: "0.35"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: lPts,
      fill: "none",
      stroke: "#a78bfa",
      strokeWidth: "0.8",
      strokeDasharray: "3 3",
      opacity: "0.55"
    }));
  })(), ind.vwap && visVWAP && (() => {
    const pts = vis.map((c, i) => visVWAP[i] != null ? `${toX(i)},${toY(visVWAP[i])}` : null).filter(Boolean).join(" ");
    return /*#__PURE__*/React.createElement("polyline", {
      clipPath: "url(#mc)",
      points: pts,
      fill: "none",
      stroke: "#fb923c",
      strokeWidth: "1.1",
      strokeDasharray: "4 2",
      opacity: "0.8"
    });
  })(), /*#__PURE__*/React.createElement("g", {
    clipPath: "url(#mc)"
  }, vis.map((c, i) => {
    const up = c.close >= c.open,
      fc = up ? "#00f5c4" : "#ef4444";
    const bT = toY(Math.max(c.open, c.close)),
      bB = toY(Math.min(c.open, c.close));
    const bH = Math.max(0.8, bB - bT),
      cx = toX(i);
    return /*#__PURE__*/React.createElement("g", {
      key: i
    }, /*#__PURE__*/React.createElement("line", {
      x1: cx,
      y1: toY(c.high),
      x2: cx,
      y2: toY(c.low),
      stroke: fc,
      strokeWidth: Math.max(0.5, cw * 0.06),
      opacity: "0.7"
    }), /*#__PURE__*/React.createElement("rect", {
      x: cx - hbw,
      y: bT,
      width: bw,
      height: bH,
      fill: up ? fc : "none",
      stroke: fc,
      strokeWidth: up ? 0 : Math.max(0.5, cw * 0.05),
      rx: "0.4",
      opacity: "0.92"
    }));
  })), zoomMode && selRange && selX1 != null && selX2 != null && /*#__PURE__*/React.createElement("g", {
    clipPath: "url(#mc)"
  }, /*#__PURE__*/React.createElement("rect", {
    x: Math.min(selX1, selX2),
    y: PAD.top,
    width: Math.abs(selX2 - selX1),
    height: mainH,
    fill: "#38bdf820",
    stroke: "#38bdf8",
    strokeWidth: "1",
    strokeDasharray: "4 2"
  }), /*#__PURE__*/React.createElement("text", {
    x: (selX1 + selX2) / 2,
    y: PAD.top + 14,
    textAnchor: "middle",
    fill: "#38bdf8",
    fontSize: "9",
    fontFamily: "JetBrains Mono,monospace"
  }, Math.abs(selRange.b - selRange.a) + 1, " bars selected")), ind.ema9 && (() => {
    const pts = vis.map((c, i) => visE9[i] != null ? `${toX(i)},${toY(visE9[i])}` : null).filter(Boolean).join(" ");
    return /*#__PURE__*/React.createElement("polyline", {
      clipPath: "url(#mc)",
      points: pts,
      fill: "none",
      stroke: "#fbbf24",
      strokeWidth: "1.1",
      opacity: "0.9"
    });
  })(), ind.ema21 && (() => {
    const pts = vis.map((c, i) => visE21[i] != null ? `${toX(i)},${toY(visE21[i])}` : null).filter(Boolean).join(" ");
    return /*#__PURE__*/React.createElement("polyline", {
      clipPath: "url(#mc)",
      points: pts,
      fill: "none",
      stroke: "#38bdf8",
      strokeWidth: "1.1",
      opacity: "0.9"
    });
  })(), price >= lo && price <= hi && /*#__PURE__*/React.createElement("g", null, /*#__PURE__*/React.createElement("line", {
    x1: PAD.left,
    y1: curY,
    x2: W - PAD.right,
    y2: curY,
    stroke: color,
    strokeWidth: "0.8",
    strokeDasharray: "5 3",
    opacity: "0.45"
  }), /*#__PURE__*/React.createElement("rect", {
    x: W - PAD.right + 1,
    y: curY - 9,
    width: 74,
    height: 18,
    fill: color,
    rx: "3"
  }), /*#__PURE__*/React.createElement("text", {
    x: W - PAD.right + 5,
    y: curY + 5,
    fill: "#020817",
    fontSize: "10",
    fontFamily: "JetBrains Mono,monospace",
    fontWeight: "bold"
  }, price >= 1000 ? `$${fmt(price / 1000, 2)}K` : `$${fmt(price, 2)}`)), showVol && /*#__PURE__*/React.createElement("g", {
    clipPath: "url(#vc)"
  }, /*#__PURE__*/React.createElement("line", {
    x1: PAD.left,
    y1: volY,
    x2: W - PAD.right,
    y2: volY,
    stroke: "#0d1420",
    strokeWidth: "1"
  }), vis.map((c, i) => {
    const up = c.close >= c.open,
      vh = maxV ? c.volume / maxV * volH : 0;
    return /*#__PURE__*/React.createElement("rect", {
      key: i,
      x: toX(i) - hbw,
      y: volY + volH - vh,
      width: bw,
      height: vh,
      fill: up ? "#00f5c418" : "#ef444418"
    });
  }), /*#__PURE__*/React.createElement("text", {
    x: W - PAD.right + 5,
    y: volY + 10,
    fill: "#1e293b",
    fontSize: "8",
    fontFamily: "JetBrains Mono,monospace"
  }, "VOL")), showRSI && subH > 0 && (() => {
    const pts = visRSI.map((v, i) => v != null ? `${toX(i)},${toRSI(v)}` : null).filter(Boolean).join(" ");
    return /*#__PURE__*/React.createElement("g", null, /*#__PURE__*/React.createElement("rect", {
      x: PAD.left,
      y: subTop,
      width: CW,
      height: subH,
      fill: "#03070f"
    }), /*#__PURE__*/React.createElement("line", {
      x1: PAD.left,
      y1: subTop,
      x2: W - PAD.right,
      y2: subTop,
      stroke: "#0d1420",
      strokeWidth: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: PAD.left,
      y: toRSI(70),
      width: CW,
      height: toRSI(30) - toRSI(70),
      fill: "#fbbf2406"
    }), [30, 50, 70].map(v => /*#__PURE__*/React.createElement("g", {
      key: v
    }, /*#__PURE__*/React.createElement("line", {
      x1: PAD.left,
      y1: toRSI(v),
      x2: W - PAD.right,
      y2: toRSI(v),
      stroke: v === 50 ? "#0f172a" : "#fbbf2430",
      strokeWidth: "0.6",
      strokeDasharray: v === 50 ? "4 6" : "3 4"
    }), /*#__PURE__*/React.createElement("text", {
      x: W - PAD.right + 5,
      y: toRSI(v) + 4,
      fill: "#fbbf2450",
      fontSize: "8",
      fontFamily: "JetBrains Mono,monospace"
    }, v))), /*#__PURE__*/React.createElement("polyline", {
      clipPath: "url(#sc)",
      points: pts,
      fill: "none",
      stroke: "#fbbf24",
      strokeWidth: "1.3",
      opacity: "0.9"
    }), /*#__PURE__*/React.createElement("text", {
      x: PAD.left + 4,
      y: subTop + 12,
      fill: "#1e293b",
      fontSize: "8",
      fontFamily: "JetBrains Mono,monospace"
    }, "RSI(14)"), tip?.rsiV != null && /*#__PURE__*/React.createElement("text", {
      x: PAD.left + 48,
      y: subTop + 12,
      fill: "#fbbf24",
      fontSize: "8",
      fontFamily: "JetBrains Mono,monospace",
      fontWeight: "bold"
    }, fmt(tip.rsiV, 1)));
  })(), showMACD && subH > 0 && (() => {
    const mPts = visMACDl.map((v, i) => v != null ? `${toX(i)},${toMCD(v)}` : null).filter(Boolean).join(" ");
    const sPts = visMACDs.map((v, i) => v != null ? `${toX(i)},${toMCD(v)}` : null).filter(Boolean).join(" ");
    return /*#__PURE__*/React.createElement("g", null, /*#__PURE__*/React.createElement("rect", {
      x: PAD.left,
      y: subTop,
      width: CW,
      height: subH,
      fill: "#03070f"
    }), /*#__PURE__*/React.createElement("line", {
      x1: PAD.left,
      y1: subTop,
      x2: W - PAD.right,
      y2: subTop,
      stroke: "#0d1420",
      strokeWidth: "1"
    }), /*#__PURE__*/React.createElement("line", {
      x1: PAD.left,
      y1: subTop + subH / 2,
      x2: W - PAD.right,
      y2: subTop + subH / 2,
      stroke: "#0f172a",
      strokeWidth: "0.8"
    }), /*#__PURE__*/React.createElement("g", {
      clipPath: "url(#sc)"
    }, visMACDh.map((h, i) => h != null && /*#__PURE__*/React.createElement("rect", {
      key: i,
      x: toX(i) - hbw,
      y: h >= 0 ? toMCD(h) : toMCD(0),
      width: bw,
      height: Math.abs(toMCD(0) - toMCD(h)),
      fill: h >= 0 ? "#00f5c428" : "#ef444428"
    }))), /*#__PURE__*/React.createElement("polyline", {
      clipPath: "url(#sc)",
      points: mPts,
      fill: "none",
      stroke: "#00f5c4",
      strokeWidth: "1.2",
      opacity: "0.9"
    }), /*#__PURE__*/React.createElement("polyline", {
      clipPath: "url(#sc)",
      points: sPts,
      fill: "none",
      stroke: "#f472b6",
      strokeWidth: "1.0",
      opacity: "0.9"
    }), /*#__PURE__*/React.createElement("text", {
      x: PAD.left + 4,
      y: subTop + 12,
      fill: "#1e293b",
      fontSize: "8",
      fontFamily: "JetBrains Mono,monospace"
    }, "MACD(12,26,9)"));
  })(), xLbls.map(l => /*#__PURE__*/React.createElement("text", {
    key: l.i,
    x: toX(l.i),
    y: PAD.top + mainH + volH + subGap + subH + 11,
    textAnchor: "middle",
    fill: "#1e293b",
    fontSize: "8",
    fontFamily: "JetBrains Mono,monospace"
  }, l.lbl)), cross && !selRange && /*#__PURE__*/React.createElement("g", null, /*#__PURE__*/React.createElement("line", {
    x1: cross.x,
    y1: PAD.top,
    x2: cross.x,
    y2: PAD.top + mainH + volH + subGap + subH,
    stroke: "#1e293b",
    strokeWidth: "0.7",
    strokeDasharray: "2 5",
    opacity: "0.9"
  }), /*#__PURE__*/React.createElement("line", {
    x1: PAD.left,
    y1: cross.y,
    x2: W - PAD.right,
    y2: cross.y,
    stroke: "#1e293b",
    strokeWidth: "0.7",
    strokeDasharray: "2 5",
    opacity: "0.9"
  }), tip && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: W - PAD.right + 1,
    y: cross.y - 8,
    width: 74,
    height: 16,
    fill: "#1e293b",
    rx: "2"
  }), /*#__PURE__*/React.createElement("text", {
    x: W - PAD.right + 5,
    y: cross.y + 4,
    fill: "#64748b",
    fontSize: "9",
    fontFamily: "JetBrains Mono,monospace"
  }, `$${fmt(tip.close, 2)}`))), /*#__PURE__*/React.createElement("line", {
    x1: W - PAD.right,
    y1: PAD.top,
    x2: W - PAD.right,
    y2: PAD.top + mainH + volH + subGap + subH,
    stroke: "#0d1420",
    strokeWidth: "1"
  }), /*#__PURE__*/React.createElement("line", {
    x1: PAD.left,
    y1: PAD.top,
    x2: PAD.left,
    y2: PAD.top + mainH,
    stroke: "#0d1420",
    strokeWidth: "1"
  })), tip && !selRange && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 6,
      left: 20,
      background: "rgba(3,7,14,0.96)",
      border: "1px solid #0f172a",
      borderRadius: 10,
      padding: "10px 15px",
      fontFamily: "'JetBrains Mono',monospace",
      pointerEvents: "none",
      backdropFilter: "blur(8px)",
      display: "flex",
      gap: 16,
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155",
      marginBottom: 5,
      letterSpacing: "0.1em"
    }
  }, fmtDT(tip.ts, tf)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "auto auto",
      columnGap: 10,
      rowGap: 2,
      fontSize: 11
    }
  }, [["O", tip.open], ["H", tip.high], ["L", tip.low], ["C", tip.close]].map(([l, v]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      display: "contents"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#334155"
    }
  }, l), /*#__PURE__*/React.createElement("span", {
    style: {
      color: tip.close >= tip.open ? "#00f5c4" : "#ef4444",
      fontWeight: 800
    }
  }, `$${fmt(v, 2)}`))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "contents"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#334155"
    }
  }, "Vol"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#475569"
    }
  }, (tip.volume / 1e6).toFixed(2), "M")))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155",
      marginBottom: 5,
      letterSpacing: "0.1em"
    }
  }, "CHANGE"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 800,
      fontSize: 16,
      color: tip.close >= tip.open ? "#00f5c4" : "#ef4444"
    }
  }, tip.close >= tip.open ? "+" : "", fmt((tip.close - tip.open) / tip.open * 100), "%"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      marginTop: 2
    }
  }, tip.close >= tip.open ? "+" : "", `$${fmt(tip.close - tip.open, 2)}`)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155",
      marginBottom: 5,
      letterSpacing: "0.1em"
    }
  }, "INDICATORS"), ind.ema9 && tip.e9 != null && /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#fbbf24",
      marginBottom: 2
    }
  }, "EMA9  ", `$${fmt(tip.e9, 2)}`), ind.ema21 && tip.e21 != null && /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#38bdf8",
      marginBottom: 2
    }
  }, "EMA21 ", `$${fmt(tip.e21, 2)}`), ind.bb && tip.bbU != null && /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#a78bfa",
      marginBottom: 2
    }
  }, "BB  ", `$${fmt(tip.bbL, 2)}`, "\u2013", `$${fmt(tip.bbU, 2)}`), ind.vwap && tip.vwapV != null && /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#fb923c",
      marginBottom: 2
    }
  }, "VWAP ", `$${fmt(tip.vwapV, 2)}`), showRSI && tip.rsiV != null && /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#fbbf24",
      marginBottom: 2
    }
  }, "RSI  ", fmt(tip.rsiV, 1)), showMACD && tip.macdV != null && /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#00f5c4"
    }
  }, "MACD ", fmt(tip.macdV, 3)))), zoomMode && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      bottom: 6,
      right: 90,
      background: "rgba(56,189,248,0.12)",
      border: "1px solid #38bdf840",
      borderRadius: 5,
      padding: "3px 10px",
      fontSize: 9,
      color: "#38bdf8",
      fontFamily: "JetBrains Mono,monospace"
    }
  }, "Click and drag to select a region to zoom into")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      background: "#040912",
      border: "1px solid #0d1420",
      borderTop: "none",
      borderRadius: "0 0 12px 12px",
      overflow: "hidden",
      cursor: "ew-resize"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    ref: navRef,
    width: "100%",
    viewBox: `0 0 ${NW} ${NH + 6}`,
    style: {
      display: "block"
    },
    onMouseDown: onNavDown,
    onMouseMove: onNavMove,
    onMouseUp: onNavUp,
    onMouseLeave: onNavUp
  }, /*#__PURE__*/React.createElement("polyline", {
    points: navPts,
    fill: "none",
    stroke: color,
    strokeWidth: "1",
    opacity: "0.4"
  }), /*#__PURE__*/React.createElement("rect", {
    x: NPAD.l,
    y: 0,
    width: wxL - NPAD.l,
    height: NH + 6,
    fill: "rgba(0,0,0,0.55)"
  }), /*#__PURE__*/React.createElement("rect", {
    x: wxR,
    y: 0,
    width: NPAD.l + NCW - wxR,
    height: NH + 6,
    fill: "rgba(0,0,0,0.55)"
  }), /*#__PURE__*/React.createElement("rect", {
    x: wxL,
    y: 0,
    width: wxR - wxL,
    height: NH + 6,
    fill: "none",
    stroke: color,
    strokeWidth: "1.2",
    opacity: "0.7"
  }), /*#__PURE__*/React.createElement("rect", {
    x: wxL,
    y: 0,
    width: wxR - wxL,
    height: NH + 6,
    fill: `${color}0a`
  }), [wxL, wxR].map((x, i) => /*#__PURE__*/React.createElement("rect", {
    key: i,
    x: x - (i === 0 ? 3 : 0),
    y: 0,
    width: 3,
    height: NH + 6,
    fill: color,
    opacity: "0.5",
    rx: "1"
  })), /*#__PURE__*/React.createElement("text", {
    x: NPAD.l + 4,
    y: NH - 2,
    fill: "#0d1420",
    fontSize: "8",
    fontFamily: "JetBrains Mono,monospace"
  }, "NAVIGATOR \xB7 DRAG TO PAN \xB7 SCROLL OR BUTTONS TO ZOOM"), /*#__PURE__*/React.createElement("text", {
    x: NW - NPAD.r + 5,
    y: NH - 2,
    fill: "#1e293b",
    fontSize: "8",
    fontFamily: "JetBrains Mono,monospace"
  }, vLen, "/", total))));
}

// ─── STOCK DETAIL MODAL
function StockDetailModal({
  stock,
  sector,
  price,
  prevPrice,
  history,
  holdings,
  cash,
  canTrade,
  onBuy,
  onSell,
  onClose
}) {
  const [qty, setQty] = useState(1);
  const [detTab, setDetTab] = useState("chart");
  const [tf, setTF] = useState("1D");
  const cacheRef = useRef({});
  if (!stock) return null;
  const color = sector?.color || "#00f5c4";
  const chg = prevPrice > 0 ? (price - prevPrice) / prevPrice * 100 : 0;
  const up = chg >= 0;
  const held = holdings[stock.ticker];
  const heldQty = held?.qty || 0;
  const buyTotal = price * qty;
  const canBuy = canTrade && cash >= buyTotal && qty > 0;
  const canSell = canTrade && heldQty >= qty && qty > 0;
  const unrealized = held ? (price - held.avgCost) * held.qty : 0;
  const unrPct = held ? (price - held.avgCost) / held.avgCost * 100 : 0;

  // Generate/cache candles per ticker+timeframe (pure, no setState)
  const cacheKey = `${stock.ticker}_${tf}`;
  if (!cacheRef.current[cacheKey]) {
    const tfObj = TIMEFRAMES.find(t => t.key === tf) || TIMEFRAMES[0];
    const c = generateCandles(stock.basePrice || 100, stock.volatility || 1, tfObj);
    if (c.length > 0) c[c.length - 1].close = price;
    cacheRef.current = {
      ...cacheRef.current,
      [cacheKey]: c
    };
  }
  const candles = cacheRef.current[cacheKey] || [];
  const tfObj = TIMEFRAMES.find(t => t.key === tf) || TIMEFRAMES[0];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 9000,
      background: "rgba(2,8,23,0.93)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backdropFilter: "blur(6px)",
      padding: "10px"
    },
    onClick: e => {
      if (e.target === e.currentTarget) onClose();
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "min(1120px,99vw)",
      background: "#060c18",
      border: `1px solid ${color}55`,
      borderRadius: 18,
      boxShadow: `0 0 80px ${color}18`,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      maxHeight: "97vh",
      animation: "fadeup 0.2s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "13px 22px 11px",
      background: `linear-gradient(135deg,${color}0d,transparent 60%)`,
      borderBottom: `1px solid ${color}22`,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 900,
      fontSize: 26,
      color,
      lineHeight: 1
    }
  }, stock.ticker), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      padding: "3px 8px",
      borderRadius: 4,
      background: `${color}18`,
      border: `1px solid ${color}35`,
      color,
      fontWeight: 700
    }
  }, sector?.icon, " ", sector?.label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "#64748b"
    }
  }, stock.name)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: 32,
      lineHeight: 1,
      color: "#f1f5f9"
    }
  }, "$", Number(price).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: up ? "#00f5c4" : "#ef4444"
    }
  }, up ? "▲ +" : "▼ ", Math.abs(chg).toFixed(2), "%")), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: {
      width: 32,
      height: 32,
      borderRadius: 8,
      background: "#0f172a",
      border: "1px solid #1e293b",
      color: "#64748b",
      fontSize: 18,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0
    }
  }, "\u2715"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      borderBottom: "1px solid #0f172a",
      flexShrink: 0,
      padding: "0 22px"
    }
  }, ["chart", "about"].map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    onClick: () => setDetTab(t),
    style: {
      padding: "9px 14px",
      background: "none",
      border: "none",
      color: detTab === t ? color : "#475569",
      borderBottom: detTab === t ? `2px solid ${color}` : "2px solid transparent",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 10,
      fontWeight: detTab === t ? 700 : 400,
      letterSpacing: "0.1em",
      textTransform: "uppercase"
    }
  }, t)), detTab === "chart" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      height: 16,
      background: "#0f172a",
      margin: "0 12px"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 3,
      alignItems: "center"
    }
  }, TIMEFRAMES.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.key,
    onClick: () => setTF(t.key),
    style: {
      padding: "3px 9px",
      borderRadius: 4,
      cursor: "pointer",
      background: tf === t.key ? `${color}1a` : "#060c18",
      border: `1px solid ${tf === t.key ? color : "#0d1420"}`,
      color: tf === t.key ? color : "#334155",
      fontFamily: "inherit",
      fontSize: 9,
      fontWeight: tf === t.key ? 700 : 400,
      transition: "all 0.15s"
    }
  }, t.label)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 8,
      color: "#1e293b",
      marginLeft: 8,
      letterSpacing: "0.08em"
    }
  }, tfObj.desc)))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      overflowX: "hidden",
      padding: "16px 20px"
    }
  }, detTab === "chart" && /*#__PURE__*/React.createElement("div", {
    style: {
      animation: "fadeup 0.2s ease"
    }
  }, /*#__PURE__*/React.createElement(CandleChart, {
    candles: candles,
    color: color,
    price: price,
    tf: tf
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: 8,
      marginTop: 14
    }
  }, [{
    l: "MKT CAP",
    v: stock.mktCap || "—",
    c: "#f1f5f9"
  }, {
    l: "EMPLOYEES",
    v: stock.employees || "—",
    c: "#94a3b8"
  }, {
    l: "FOUNDED",
    v: stock.founded || "—",
    c: "#64748b"
  }, {
    l: "VOLATILITY",
    v: `${stock.volatility}×`,
    c: stock.volatility >= 1.5 ? "#ef4444" : stock.volatility >= 1.2 ? "#fbbf24" : "#00f5c4"
  }].map(m => /*#__PURE__*/React.createElement("div", {
    key: m.l,
    style: {
      background: "#0a0f1e",
      border: "1px solid #111827",
      borderRadius: 8,
      padding: "10px 12px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "#334155",
      letterSpacing: "0.1em",
      marginBottom: 4
    }
  }, m.l), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 800,
      color: m.c
    }
  }, m.v)))), held && /*#__PURE__*/React.createElement("div", {
    style: {
      background: `${color}0a`,
      border: `1px solid ${color}25`,
      borderRadius: 10,
      padding: "12px 14px",
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color,
      letterSpacing: "0.12em",
      marginBottom: 8,
      fontWeight: 700
    }
  }, "YOUR POSITION"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: 8,
      fontSize: 11
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#334155",
      fontSize: 9,
      marginBottom: 2
    }
  }, "SHARES"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#f1f5f9",
      fontWeight: 700
    }
  }, heldQty)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#334155",
      fontSize: 9,
      marginBottom: 2
    }
  }, "AVG COST"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#f1f5f9",
      fontWeight: 700
    }
  }, "$", held.avgCost.toFixed(2))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#334155",
      fontSize: 9,
      marginBottom: 2
    }
  }, "VALUE"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#f1f5f9",
      fontWeight: 700
    }
  }, "$", (price * heldQty).toFixed(0))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#334155",
      fontSize: 9,
      marginBottom: 2
    }
  }, "UNREALIZED P&L"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: unrealized >= 0 ? "#00f5c4" : "#ef4444",
      fontWeight: 700
    }
  }, unrealized >= 0 ? "+" : "", "$", Math.abs(unrealized).toFixed(0), " (", unrPct >= 0 ? "+" : "", unrPct.toFixed(1), "%)"))))), detTab === "about" && /*#__PURE__*/React.createElement("div", {
    style: {
      animation: "fadeup 0.2s ease"
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: "#64748b",
      lineHeight: 1.8,
      marginBottom: 20
    }
  }, stock.description || "No description available."), stock.constituents && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      letterSpacing: "0.1em",
      marginBottom: 6
    }
  }, "TRACKS ", stock.constituents.length, " STOCKS"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 5
    }
  }, stock.constituents.map(t => {
    const st = ALL_STOCKS.find(x => x.ticker === t);
    return /*#__PURE__*/React.createElement("div", {
      key: t,
      style: {
        padding: "4px 10px",
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 700,
        background: `${st?.color || color}15`,
        border: `1px solid ${st?.color || color}40`,
        color: st?.color || color
      }
    }, t, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 8,
        fontWeight: 400,
        marginLeft: 4,
        color: "#64748b"
      }
    }, st?.name?.split(" ")[0]));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 8
    }
  }, [{
    l: "TICKER",
    v: stock.ticker,
    c: color
  }, {
    l: "MKT CAP",
    v: stock.mktCap || "—",
    c: "#f1f5f9"
  }, {
    l: "EMPLOYEES",
    v: stock.employees || "—",
    c: "#94a3b8"
  }, {
    l: "FOUNDED",
    v: stock.founded || "—",
    c: "#64748b"
  }, {
    l: "SECTOR",
    v: sector?.label || "—",
    c: color
  }, {
    l: "VOLATILITY",
    v: `${stock.volatility}×`,
    c: stock.volatility >= 1.5 ? "#ef4444" : stock.volatility >= 1.2 ? "#fbbf24" : "#00f5c4"
  }].map(m => /*#__PURE__*/React.createElement("div", {
    key: m.l,
    style: {
      background: "#0a0f1e",
      border: "1px solid #111827",
      borderRadius: 8,
      padding: "10px 12px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "#334155",
      letterSpacing: "0.1em",
      marginBottom: 4
    }
  }, m.l), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 800,
      color: m.c
    }
  }, m.v)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: `1px solid ${color}22`,
      background: "#040b17",
      padding: "13px 22px",
      flexShrink: 0
    }
  }, !canTrade && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#ef4444",
      marginBottom: 8,
      textAlign: "center",
      padding: "6px",
      background: "rgba(239,68,68,0.08)",
      borderRadius: 6
    }
  }, "\u26A0 Trading locked \u2014 wait for a live round"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      marginBottom: 4,
      letterSpacing: "0.1em"
    }
  }, "QUANTITY"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setQty(q => Math.max(1, q - 1)),
    style: {
      width: 28,
      height: 36,
      background: "#0f172a",
      border: "1px solid #1e293b",
      color: "#94a3b8",
      borderRadius: 5,
      cursor: "pointer",
      fontSize: 14,
      fontFamily: "inherit"
    }
  }, "\u2212"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: 1,
    value: qty,
    onChange: e => setQty(Math.max(1, parseInt(e.target.value) || 1)),
    style: {
      width: 60,
      padding: "8px 0",
      textAlign: "center",
      background: "#020817",
      border: "1px solid #1e293b",
      color: "#f1f5f9",
      borderRadius: 5,
      fontSize: 15,
      fontFamily: "inherit"
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => setQty(q => q + 1),
    style: {
      width: 28,
      height: 36,
      background: "#0f172a",
      border: "1px solid #1e293b",
      color: "#94a3b8",
      borderRadius: 5,
      cursor: "pointer",
      fontSize: 14,
      fontFamily: "inherit"
    }
  }, "+"))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      marginBottom: 4
    }
  }, "TOTAL COST"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      fontWeight: 800,
      color: "#f1f5f9"
    }
  }, "$", buyTotal.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#334155",
      marginTop: 2
    }
  }, "Cash: $", cash.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }), heldQty > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 8,
      color: "#475569"
    }
  }, "\xB7 Held: ", heldQty))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4
    }
  }, [1, 5, 10, 25].map(n => /*#__PURE__*/React.createElement("button", {
    key: n,
    onClick: () => setQty(n),
    style: {
      padding: "5px 9px",
      background: qty === n ? `${color}22` : "#0f172a",
      border: `1px solid ${qty === n ? color : "#1e293b"}`,
      color: qty === n ? color : "#475569",
      borderRadius: 5,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 10,
      fontWeight: 700
    }
  }, n)), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const m = Math.floor(cash / price);
      if (m > 0) setQty(m);
    },
    style: {
      padding: "5px 9px",
      background: "#0f172a",
      border: "1px solid #1e293b",
      color: "#fbbf24",
      borderRadius: 5,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 9,
      fontWeight: 700
    }
  }, "MAX")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      onBuy(stock.ticker, qty);
      onClose();
    },
    disabled: !canBuy,
    style: {
      padding: "12px 28px",
      background: canBuy ? "linear-gradient(135deg,#00f5c4,#00d4aa)" : "#1e293b",
      color: canBuy ? "#020817" : "#334155",
      border: "none",
      borderRadius: 8,
      fontWeight: 800,
      cursor: canBuy ? "pointer" : "not-allowed",
      fontFamily: "inherit",
      fontSize: 14
    }
  }, "\u25B2 BUY"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      onSell(stock.ticker, qty);
      onClose();
    },
    disabled: !canSell,
    style: {
      padding: "12px 28px",
      background: canSell ? "linear-gradient(135deg,#ef4444,#dc2626)" : "#1e293b",
      color: canSell ? "#fff" : "#334155",
      border: "none",
      borderRadius: 8,
      fontWeight: 800,
      cursor: canSell ? "pointer" : "not-allowed",
      fontFamily: "inherit",
      fontSize: 14
    }
  }, "\u25BC SELL"))))));
}

// ─── DISRUPTION BLAST OVERLAY ─────────────────────────────────────────────────
// Full-screen blurred overlay shown on ALL screens when GM fires a disruption
function DisruptionBlast({
  events,
  roundNum,
  onDismiss,
  isGM
}) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setStep(s => Math.min(s + 1, events.length)), 600);
    return () => clearTimeout(t);
  }, [step, events.length]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 10000,
      background: "rgba(2,4,12,0.97)",
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'JetBrains Mono','Courier New',monospace",
      backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(239,68,68,0.03) 3px,rgba(239,68,68,0.03) 4px)",
      animation: "fadein 0.4s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      border: "3px solid #ef444440",
      boxShadow: "inset 0 0 120px rgba(239,68,68,0.15)",
      pointerEvents: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      width: "min(760px,95vw)",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#ef4444",
      letterSpacing: "0.5em",
      marginBottom: 16,
      animation: "pulse 1s infinite"
    }
  }, "\u25CF LIVE ALERT \xB7 ROUND ", roundNum), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: "clamp(42px,7vw,80px)",
      lineHeight: 1,
      color: "#ef4444",
      textShadow: "0 0 60px rgba(239,68,68,0.8), 0 0 120px rgba(239,68,68,0.4)",
      marginBottom: 8,
      animation: "pulse 2s infinite"
    }
  }, "MARKET DISRUPTION"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 900,
      fontSize: "clamp(14px,2.5vw,22px)",
      color: "#fca5a5",
      letterSpacing: "0.2em",
      marginBottom: 36
    }
  }, "TAKING EFFECT THIS ROUND \u2014 TRADE ACCORDINGLY"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      marginBottom: 32
    }
  }, events.map((evt, i) => {
    const stock = ALL_STOCKS.find(s => s.ticker === evt.ticker);
    const up = evt.impact > 0;
    const visible = i < step;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        opacity: visible ? 1 : 0,
        transform: visible ? "none" : "translateY(20px)",
        transition: "all 0.5s ease",
        background: up ? "rgba(0,245,196,0.06)" : "rgba(239,68,68,0.06)",
        border: `1px solid ${up ? "#00f5c430" : "#ef444430"}`,
        borderLeft: `4px solid ${up ? "#00f5c4" : "#ef4444"}`,
        borderRadius: 12,
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        textAlign: "left"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flexShrink: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Bebas Neue',sans-serif",
        fontSize: 32,
        color: stock?.color || "#94a3b8",
        letterSpacing: "0.05em"
      }
    }, evt.ticker), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: "#475569"
      }
    }, stock?.name)), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: "clamp(12px,1.8vw,16px)",
        fontWeight: 700,
        color: "#f1f5f9",
        lineHeight: 1.5,
        marginBottom: 4
      }
    }, evt.headline), evt.detail && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "#64748b",
        fontStyle: "italic"
      }
    }, evt.detail)), /*#__PURE__*/React.createElement("div", {
      style: {
        flexShrink: 0,
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Bebas Neue',sans-serif",
        fontSize: 40,
        color: up ? "#00f5c4" : "#ef4444",
        lineHeight: 1
      }
    }, up ? "▲" : "", evt.impact > 0 ? "+" : "", evt.impact, "%"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: up ? "#00f5c4" : "#ef4444",
        letterSpacing: "0.1em"
      }
    }, up ? "SURGE" : "CRASH")));
  })), isGM && step >= events.length && /*#__PURE__*/React.createElement("button", {
    onClick: onDismiss,
    style: {
      padding: "14px 40px",
      background: "linear-gradient(135deg,#7f1d1d,#dc2626)",
      border: "none",
      borderRadius: 10,
      color: "#fff",
      fontFamily: "inherit",
      fontSize: 13,
      fontWeight: 800,
      cursor: "pointer",
      letterSpacing: "0.1em",
      boxShadow: "0 0 30px rgba(220,38,38,0.5)",
      animation: "pulse 1.5s infinite"
    }
  }, "\u26A1 LAUNCH ROUND ", roundNum, " \u2192"), !isGM && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#334155",
      letterSpacing: "0.2em"
    }
  }, "AWAITING GAME MASTER TO LAUNCH ROUND\u2026")));
}

// ─── WINNER CEREMONY ──────────────────────────────────────────────────────────
function WinnerCeremony({
  ranked,
  teams,
  roundNum,
  totalRounds,
  generating,
  onNext
}) {
  const isFinal = roundNum >= totalRounds;
  const medals = ["🥇", "🥈", "🥉"];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 9000,
      background: "rgba(2,8,23,0.96)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: 20,
      fontFamily: "'JetBrains Mono','Courier New',monospace",
      animation: "fadeup 0.5s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: isFinal ? 48 : 36,
      marginBottom: 6
    }
  }, isFinal ? "🏆" : "🎉"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: isFinal ? 52 : 40,
      background: "linear-gradient(135deg,#fbbf24,#f59e0b)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent"
    }
  }, isFinal ? "GRAND CHAMPION" : `ROUND ${roundNum} RESULTS`), isFinal && ranked[0] && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 20,
      color: "#fbbf24",
      fontWeight: 800,
      marginTop: 6
    }
  }, ranked[0].name)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8,
      width: 360
    }
  }, ranked.slice(0, 5).map((e, i) => /*#__PURE__*/React.createElement("div", {
    key: e.name,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 16px",
      background: i === 0 ? "#1a1200" : "#0a0f1e",
      border: `1px solid ${i === 0 ? "#fbbf24" : e.color + "44"}`,
      borderRadius: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 20,
      minWidth: 28
    }
  }, medals[i] || `#${i + 1}`), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: e.color || "#f1f5f9",
      fontSize: 13
    }
  }, e.name), e.isBot && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569"
    }
  }, "AI BOT")), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 800,
      fontSize: 14,
      color: e.total >= INITIAL_CASH ? "#00f5c4" : "#ef4444"
    }
  }, "$", e.total?.toLocaleString(undefined, {
    maximumFractionDigits: 0
  }) || "—"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569"
    }
  }, e.total >= INITIAL_CASH ? "+" : "", ((e.total - INITIAL_CASH) / INITIAL_CASH * 100).toFixed(1), "%"))))), !isFinal && /*#__PURE__*/React.createElement("button", {
    onClick: onNext,
    disabled: generating,
    style: {
      marginTop: 8,
      padding: "14px 36px",
      background: generating ? "#0f172a" : "linear-gradient(135deg,#00f5c4,#38bdf8)",
      border: "none",
      borderRadius: 10,
      color: "#020817",
      fontWeight: 800,
      fontSize: 14,
      cursor: generating ? "wait" : "pointer",
      fontFamily: "inherit",
      letterSpacing: "0.08em"
    }
  }, generating ? "⏳ GENERATING NEXT ROUND…" : `🚀 LAUNCH ROUND ${roundNum + 1} →`), isFinal && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "#475569",
      marginTop: 4
    }
  }, "Game complete \u2014 reset to play again."));
}

// ─── TEAM EDITOR ──────────────────────────────────────────────────────────────
function TeamEditor({
  teams,
  onSave
}) {
  const [draft, setDraft] = useState(teams.map(t => ({
    ...t
  })));
  const [saved, setSaved] = useState(false);
  const [colorPicker, setColorPicker] = useState(null); // index of team whose picker is open

  const COLORS = ["#00f5c4", "#38bdf8", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#4ade80", "#f87171", "#c084fc", "#67e8f9", "#fde68a", "#86efac", "#e879f9", "#f97316", "#84cc16", "#06b6d4", "#ec4899", "#8b5cf6", "#14b8a6", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#6366f1", "#d946ef", "#0ea5e9", "#22c55e", "#eab308", "#64748b", "#94a3b8"];
  const DEFAULT_NAMES = ["Alpha Squad", "Bull Runners", "Bear Force", "Quantum Traders", "Solar Surge", "Dark Pool", "Iron Hawks", "Neon Tigers", "Ghost Traders", "Storm Capital", "Red Wolves", "Blue Chip", "Apex Fund", "Zenith Crew", "Volt Trade", "Lunar Assets", "Shadow Bulls", "Delta Force", "Nova Traders", "Titan Group", "Cyber Fund", "Blaze Squad", "Arctic Bears", "Steel Wolves", "Jade Capital", "Echo Markets", "Fusion Pit", "Prime Assets", "Vortex Fund", "Omega Trade"];
  function upd(i, field, val) {
    setDraft(d => d.map((t, j) => j === i ? {
      ...t,
      [field]: val
    } : t));
    setColorPicker(null);
  }
  function addTeam() {
    if (draft.length >= MAX_TEAMS) return;
    const idx = draft.length;
    const id = `t${Date.now()}`;
    const name = DEFAULT_NAMES[idx] || `Team ${idx + 1}`;
    const pw = name.toLowerCase().replace(/\s/g, "") + Math.floor(100 + Math.random() * 900);
    const color = COLORS[idx % COLORS.length];
    setDraft(d => [...d, {
      id,
      name,
      password: pw,
      color
    }]);
  }
  function removeTeam(i) {
    if (draft.length <= 1) return;
    setDraft(d => d.filter((_, j) => j !== i));
    setColorPicker(null);
  }
  function handleSave() {
    onSave(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }
  const inp = {
    width: "100%",
    padding: "6px 8px",
    background: "#020817",
    border: "1px solid #1e293b",
    color: "#f1f5f9",
    borderRadius: 5,
    fontFamily: "inherit",
    fontSize: 11,
    outline: "none"
  };
  const atMax = draft.length >= MAX_TEAMS;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      letterSpacing: "0.1em"
    }
  }, "TEAM EDITOR", /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 8,
      color: atMax ? "#ef4444" : "#00f5c4",
      fontWeight: 700
    }
  }, draft.length, " / ", MAX_TEAMS)), /*#__PURE__*/React.createElement("button", {
    onClick: addTeam,
    disabled: atMax,
    style: {
      padding: "5px 12px",
      background: atMax ? "#0f172a" : "#0a2a1a",
      border: `1px solid ${atMax ? "#1e293b" : "#00f5c4"}`,
      color: atMax ? "#334155" : "#00f5c4",
      borderRadius: 6,
      cursor: atMax ? "not-allowed" : "pointer",
      fontFamily: "inherit",
      fontSize: 10,
      fontWeight: 700,
      opacity: atMax ? 0.5 : 1
    }
  }, "+ ADD TEAM ", atMax ? `(MAX ${MAX_TEAMS})` : "")), /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 460,
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: 5,
      paddingRight: 2
    }
  }, draft.map((t, i) => /*#__PURE__*/React.createElement("div", {
    key: t.id,
    style: {
      background: "#0a0f1e",
      border: `1px solid ${t.color}33`,
      borderLeft: `3px solid ${t.color}`,
      borderRadius: 8,
      padding: "8px 10px",
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "26px 1fr 1fr auto auto",
      gap: 6,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      fontWeight: 700,
      textAlign: "center"
    }
  }, "#", i + 1), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "#475569",
      marginBottom: 2
    }
  }, "NAME"), /*#__PURE__*/React.createElement("input", {
    value: t.name,
    onChange: e => upd(i, "name", e.target.value),
    style: inp
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "#475569",
      marginBottom: 2
    }
  }, "PASSWORD"), /*#__PURE__*/React.createElement("input", {
    value: t.password,
    onChange: e => upd(i, "password", e.target.value),
    style: inp
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "#475569",
      marginBottom: 2
    }
  }, "COLOR"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setColorPicker(colorPicker === i ? null : i),
    style: {
      width: 32,
      height: 28,
      background: t.color,
      border: "2px solid #1e293b",
      borderRadius: 5,
      cursor: "pointer",
      display: "block"
    }
  }), colorPicker === i && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      right: 0,
      top: 48,
      zIndex: 100,
      background: "#0f172a",
      border: "1px solid #334155",
      borderRadius: 8,
      padding: 8,
      display: "grid",
      gridTemplateColumns: "repeat(6,22px)",
      gap: 4,
      boxShadow: "0 8px 32px #000a"
    }
  }, COLORS.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    onClick: () => {
      upd(i, "color", c);
      setColorPicker(null);
    },
    title: c,
    style: {
      width: 22,
      height: 22,
      background: c,
      border: t.color === c ? "2px solid #fff" : "2px solid transparent",
      borderRadius: 4,
      cursor: "pointer",
      padding: 0
    }
  })))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "transparent",
      marginBottom: 2
    }
  }, "DEL"), /*#__PURE__*/React.createElement("button", {
    onClick: () => removeTeam(i),
    disabled: draft.length <= 1,
    style: {
      width: 28,
      height: 28,
      background: "#7f1d1d",
      border: "1px solid #ef444455",
      borderRadius: 5,
      color: "#fca5a5",
      cursor: draft.length <= 1 ? "not-allowed" : "pointer",
      fontSize: 12,
      fontFamily: "inherit",
      opacity: draft.length <= 1 ? 0.3 : 1
    }
  }, "\u2715")))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: addTeam,
    disabled: atMax,
    style: {
      flex: 1,
      padding: "8px",
      background: atMax ? "#0f172a" : "#0a1a2a",
      border: `1px solid ${atMax ? "#1e293b" : "#38bdf855"}`,
      color: atMax ? "#334155" : "#38bdf8",
      borderRadius: 6,
      cursor: atMax ? "not-allowed" : "pointer",
      fontFamily: "inherit",
      fontSize: 10,
      fontWeight: 700,
      opacity: atMax ? 0.4 : 1
    }
  }, "+ ADD TEAM"), /*#__PURE__*/React.createElement("button", {
    onClick: handleSave,
    style: {
      flex: 2,
      padding: "8px",
      fontWeight: 800,
      fontSize: 11,
      letterSpacing: "0.06em",
      background: saved ? "linear-gradient(135deg,#166534,#15803d)" : "linear-gradient(135deg,#1e3a5f,#1d4ed8)",
      border: "none",
      borderRadius: 6,
      color: "#fff",
      cursor: "pointer",
      fontFamily: "inherit",
      transition: "all 0.3s"
    }
  }, saved ? "✓ TEAMS SAVED!" : "💾 SAVE TEAMS")), atMax && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#ef4444",
      textAlign: "center",
      marginTop: -4
    }
  }, "Maximum ", MAX_TEAMS, " teams reached"));
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
function App() {
  const [screen, setScreen] = useState("login");
  const [loginTab, setLoginTab] = useState("player");
  const [nameInput, setNameInput] = useState("");
  const [passInput, setPassInput] = useState("");
  const [gmPass, setGmPass] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [currentTeam, setCurrentTeam] = useState(null);
  const [teams, setTeams] = useState(DEFAULT_TEAMS);

  // Market
  const [prices, setPrices] = useState(initPrices);
  const [history, setHistory] = useState(() => initHistory(initPrices()));
  const [prevPrices, setPrevPrices] = useState(initPrices);
  const [bots, setBots] = useState(initBots);
  const [aiLog, setAiLog] = useState([]);
  const [news, setNews] = useState([]);
  const [tick, setTick] = useState(0);
  const [sentiment, setSentiment] = useState("neutral");
  const [activeSector, setActiveSector] = useState("all");
  // Per-sector biases: override global sentiment for each sector
  const [sectorBiases, setSectorBiases] = useState(() => Object.fromEntries(SECTORS.map(s => [s.id, "neutral"])));
  // Live sector disruption news (AI-generated, applied continuously when automation is on)
  const [sectorDisruptions, setSectorDisruptions] = useState({});
  const [generatingSector, setGeneratingSector] = useState(null);
  const [activeDisruptSectors, setActiveDisruptSectors] = useState(new Set());
  const [selectedSectors, setSelectedSectors] = useState(new Set());

  // Player portfolio — holdings stores { qty, avgCost, totalCost }
  const [cash, setCash] = useState(INITIAL_CASH);
  const [holdings, setHoldings] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [tab, setTab] = useState("market");
  const [selTicker, setSelTicker] = useState(null);
  const [orderQty, setOrderQty] = useState(1);
  const [marketSearch, setMarketSearch] = useState("");

  // Player stat tracking
  const [peakValue, setPeakValue] = useState(INITIAL_CASH);
  const [maxDrawdown, setMaxDrawdown] = useState(0);

  // Game flow
  const [gamePhase, setGamePhase] = useState("idle");
  const [roundNum, setRoundNum] = useState(1);
  const [roundDurations, setRoundDurations] = useState([...DEFAULT_ROUND_DURATIONS]); // per-round seconds
  const roundDur = roundDurations[Math.min(roundNum - 1, TOTAL_ROUNDS - 1)]; // current round's duration
  const [startTime, setStartTime] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const [bufferLeft, setBufferLeft] = useState(null);
  const [bufferStart, setBufferStart] = useState(null);
  const [initCash, setInitCash] = useState(INITIAL_CASH);
  const [gmTab, setGmTab] = useState("control");
  // Round identity + special mechanics
  const [roundRules, setRoundRules] = useState(ROUND_RULES[0]);
  const [volMultiplier, setVolMultiplier] = useState(1.0);
  const [leaderHidden, setLeaderHidden] = useState(false);
  const [taxPending, setTaxPending] = useState(false);
  const [taxAmount, setTaxAmount] = useState(0);
  const [liquidatePending, setLiquidatePending] = useState(false);
  // Power-up cards
  const [usedCards, setUsedCards] = useState(new Set());
  const [frozenUntil, setFrozenUntil] = useState(null);
  const [activePowerup, setActivePowerup] = useState(null);
  // Prediction market
  const [predictionOpen, setPredictionOpen] = useState(false);
  const [playerPrediction, setPlayerPrediction] = useState(null);
  const [predResult, setPredResult] = useState(null);
  // Achievements
  const [achievements, setAchievements] = useState([]);
  // GM rulebook panel
  const [showRulebook, setShowRulebook] = useState(false);
  // 30-team score throttle
  const lastScoreWrite = useRef(0);
  const predCorrectCount = useRef({
    total: 0,
    correct: 0
  });
  const [detailStock, setDetailStock] = useState(null);
  const [shockTicker, setShockTicker] = useState(ALL_STOCKS[0].ticker);
  const [polEventIdx, setPolEventIdx] = useState(0);
  const [generatingPol, setGeneratingPol] = useState(false);
  const [shockPct, setShockPct] = useState(15);

  // Inter-round
  const [disruptions, setDisruptions] = useState([]);
  const [showCeremony, setShowCeremony] = useState(false);
  const [showBlast, setShowBlast] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [winnerRanked, setWinnerRanked] = useState([]);

  // Shared
  const [sharedLB, setSharedLB] = useState([]);
  const [broadcast, setBroadcast] = useState(null);
  const pricesRef = useRef(prices);
  const historyRef = useRef(history);
  const phaseRef = useRef(gamePhase);
  const tickRef = useRef(0);
  const aiRef = useRef(false);
  const sentimentRef = useRef(sentiment);
  const sectorBiasRef = useRef(sectorBiases);
  const lastBcRef = useRef(null);
  const volMultiplierRef = useRef(1.0);
  const frozenRef = useRef(null);
  pricesRef.current = prices;
  historyRef.current = history;
  phaseRef.current = gamePhase;
  tickRef.current = tick;
  sentimentRef.current = sentiment;
  sectorBiasRef.current = sectorBiases;
  volMultiplierRef.current = volMultiplier;
  frozenRef.current = frozenUntil;
  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Syne:wght@700;800;900&family=Bebas+Neue&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}body{background:#020817;}
    ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:#0f172a;}
    ::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px;}
    input:focus,textarea:focus,select:focus{outline:none;border-color:#00f5c4!important;}
    button:hover{opacity:0.82;}
    @keyframes fadeup{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
    @keyframes fadein{from{opacity:0}to{opacity:1}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
    @keyframes ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
    @keyframes slidedown{from{transform:translateY(-60px);opacity:0}to{transform:none;opacity:1}}
  `;

  // ─── STORAGE ──────────────────────────────────────────────────────────────────
  const saveScore = useCallback(async (name, color, total, cash_, holdings_, transactions_, initC, maxDD) => {
    const uniqueSectors = new Set(Object.keys(holdings_).map(t => ALL_STOCKS.find(s => s.ticker === t)?.sectorId).filter(Boolean)).size;
    const closedSells = transactions_.filter(t => t.type === "SELL");
    const wins_ = closedSells.filter(t => t.price - t.avgCostAtSell > 0).length;
    const lastSell = closedSells.length > 0 ? closedSells[0].id : Date.now(); // id = timestamp

    // Compute per-round returns from transactions snapshots
    // Approximation: use ratio of current total vs initCash per round
    const ic = initC || INITIAL_CASH;
    const absoluteReturn = (total - ic) / ic * 100;

    // Beta approximation: ratio of holdings to total (proxy for market exposure)
    // True beta would require covariance with BALL — we use holdings concentration as proxy
    const holdingValue = total - cash_;
    const beta = total > 0 ? Math.min(1, holdingValue / total) : 0.5;
    try {
      await window.storage.set(`lb:${name}`, JSON.stringify({
        name,
        color,
        total,
        cash: cash_,
        uniqueSectors,
        closedTrades: closedSells.length,
        wins: wins_,
        maxDrawdown: maxDD || 1,
        isBot: false,
        beta,
        lastTradeTs: lastSell,
        predTotal: predCorrectCount.current.total,
        predCorrect: predCorrectCount.current.correct,
        updatedAt: nowShort()
      }), true);
    } catch {}
  }, []);
  const loadLB = useCallback(async () => {
    try {
      const res = await window.storage.list("lb:", true);
      const keys = res?.keys || [];
      const rows = (await Promise.all(keys.map(async k => {
        try {
          const r = await window.storage.get(k, true);
          return r ? JSON.parse(r.value) : null;
        } catch {
          return null;
        }
      }))).filter(Boolean);
      const scored = rows.map(e => ({
        ...e,
        ...calcScore(e, INITIAL_CASH, rows)
      }));
      const ranked = sortLeaderboard(scored);
      setSharedLB(ranked);
      return ranked;
    } catch {
      return [];
    }
  }, []);
  const pushGMState = useCallback(async (o = {}) => {
    try {
      await window.storage.set("gm:state", JSON.stringify({
        phase: phaseRef.current,
        round: roundNum,
        roundLeft: timeLeft,
        bufferLeft,
        initCash,
        sentiment,
        volMultiplier,
        leaderHidden,
        frozenUntil,
        roundRulesIdx: roundNum - 1,
        ...o
      }), true);
    } catch {}
  }, [roundNum, timeLeft, bufferLeft, initCash, sentiment, volMultiplier, leaderHidden, frozenUntil]);
  const pushPrices = useCallback(async (p, h) => {
    try {
      await window.storage.set("gm:prices", JSON.stringify({
        prices: p,
        history: h
      }), true);
    } catch {}
  }, []);
  const pushTeams = useCallback(async t => {
    try {
      await window.storage.set("gm:teams", JSON.stringify(t), true);
    } catch {}
  }, []);
  const pushDisrupts = useCallback(async evts => {
    try {
      await window.storage.set("gm:disruptions", JSON.stringify({
        events: evts
      }), true);
    } catch {}
  }, []);
  const pushTrade = useCallback(async trade => {
    try {
      await window.storage.set("cd:trades", JSON.stringify({
        ...trade,
        id: Date.now()
      }), true);
    } catch {}
  }, []);
  const sendBcast = useCallback(async text => {
    const m = {
      text,
      id: Date.now()
    };
    setBroadcast(m);
    setTimeout(() => setBroadcast(null), 7000);
    try {
      await window.storage.set("gm:broadcast", JSON.stringify(m), true);
    } catch {}
  }, []);

  // ─── POLLING ──────────────────────────────────────────────────────────────────
  const prevRoundRef = useRef(1);
  useEffect(() => {
    loadLB();
    (async () => {
      try {
        const r = await window.storage.get("gm:teams", true);
        if (r) setTeams(JSON.parse(r.value));
      } catch {}
    })();
    const id = setInterval(async () => {
      await loadLB();
      try {
        const r = await window.storage.get("gm:broadcast", true);
        if (r) {
          const m = JSON.parse(r.value);
          if (m.id !== lastBcRef.current) {
            lastBcRef.current = m.id;
            setBroadcast(m);
            setTimeout(() => setBroadcast(null), 7000);
          }
        }
      } catch {}
      try {
        const gs = await window.storage.get("gm:state", true);
        if (gs) {
          const parsed = JSON.parse(gs.value);
          if (parsed.phase) setGamePhase(parsed.phase);
          if (parsed.volMultiplier !== undefined) setVolMultiplier(parsed.volMultiplier);
          if (parsed.leaderHidden !== undefined) setLeaderHidden(parsed.leaderHidden);
          if (parsed.frozenUntil !== undefined) setFrozenUntil(parsed.frozenUntil);
          if (parsed.predictionOpen !== undefined && screen === "player") setPredictionOpen(parsed.predictionOpen);
          // Wild card: redistribute 10% of cash
          if (parsed.wildcard && parsed.wildcard.ts && screen === "player") {
            const wc = parsed.wildcard;
            if (!window._lastWildcard || window._lastWildcard !== wc.ts) {
              window._lastWildcard = wc.ts;
              setCash(c => Math.round(c * (1 - wc.pct / 100)));
            }
          }
          // If GM reset, reset our round counter so carry logic works cleanly next game
          if (parsed.phase === "idle" && parsed.round === 1 && prevRoundRef.current > 1) {
            prevRoundRef.current = 0;
          }
          if (parsed.round && parsed.round > prevRoundRef.current && parsed.round > 1) {
            // Round transitions handled server-side via ROUND_RULES in startNextRound
            prevRoundRef.current = parsed.round;
          } else if (parsed.round) {
            prevRoundRef.current = parsed.round;
          }
        }
        const di = await window.storage.get("gm:disruptions", true);
        if (di) {
          const d = JSON.parse(di.value);
          if (d.events) setDisruptions(d.events);
        }
      } catch {}
    }, 4000);
    return () => clearInterval(id);
  }, [loadLB]);

  // ─── SAVE SCORE periodically ──────────────────────────────────────────────────
  // Use refs for peakValue/maxDrawdown to avoid them in deps causing infinite loop
  const peakValueRef = useRef(peakValue);
  const maxDrawdownRef = useRef(maxDrawdown);
  peakValueRef.current = peakValue;
  maxDrawdownRef.current = maxDrawdown;
  useEffect(() => {
    if (!currentTeam || screen !== "player") return;
    const hv = Object.entries(holdings).reduce((s, [t, p]) => s + (prices[t] || 0) * p.qty, 0);
    const total = cash + hv;
    // drawdown tracking — read from refs, write to state without adding to deps
    if (total > peakValueRef.current) setPeakValue(total);
    const dd = peakValueRef.current > 0 ? (peakValueRef.current - total) / peakValueRef.current * 100 : 0;
    if (dd > maxDrawdownRef.current) setMaxDrawdown(dd);
    // Throttle score writes: max once per SCORE_WRITE_INTERVAL for 30-team scale
    if (Date.now() - lastScoreWrite.current >= SCORE_WRITE_INTERVAL) {
      saveScore(currentTeam.name, currentTeam.color, total, cash, holdings, transactions, initCash, maxDrawdownRef.current);
      lastScoreWrite.current = Date.now();
    }
  }, [tick, cash, holdings, prices, currentTeam, screen, initCash, transactions, saveScore]);

  // push prices every tick when GM
  useEffect(() => {
    if (screen === "gm") pushPrices(prices, history);
  }, [tick, prices, history, screen, pushPrices]);

  // ─── TIMERS ───────────────────────────────────────────────────────────────────
  const triggerRoundEndRef = useRef(null);
  useEffect(() => {
    if (phaseRef.current !== "running" || !startTime) {
      setTimeLeft(null);
      return;
    }
    const id = setInterval(() => {
      if (phaseRef.current !== "running") {
        clearInterval(id);
        return;
      }
      const left = Math.max(0, roundDur - Math.floor((Date.now() - startTime) / 1000));
      setTimeLeft(left);
      pushGMState({
        roundLeft: left
      });
      if (left <= 0) {
        clearInterval(id);
        triggerRoundEndRef.current?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [startTime, roundDur, pushGMState]);
  useEffect(() => {
    if (phaseRef.current !== "buffer" || !bufferStart) {
      setBufferLeft(null);
      return;
    }
    const id = setInterval(() => {
      const left = Math.max(0, BUFFER_SECS - Math.floor((Date.now() - bufferStart) / 1000));
      setBufferLeft(left);
      pushGMState({
        phase: "buffer",
        bufferLeft: left
      });
      if (left <= 0 && phaseRef.current === "buffer") {
        clearInterval(id);
        setGamePhase("disruption");
        pushGMState({
          phase: "disruption"
        });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [bufferStart, pushGMState]);

  // ─── PRICE ENGINE ─────────────────────────────────────────────────────────────
  const advancePrices = useCallback((cur, hist, sent, secBiases) => {
    const globalBias = sent === "bull" ? 0.005 : sent === "bear" ? -0.005 : 0;
    const globalVm = sent === "volatile" ? 3 : 1;
    const newP = {},
      newH = {
        ...hist
      };
    // First pass: price all non-ETF stocks normally
    ALL_STOCKS.forEach(s => {
      if (ETF_CONSTITUENTS[s.ticker]) return; // ETFs handled in second pass
      const secB = secBiases?.[s.sectorId] || "neutral";
      const sectorBias = secB === "bull" ? 0.009 : secB === "bear" ? -0.009 : globalBias;
      const sectorVm = secB === "volatile" ? 3.5 : secB === "neutral" ? globalVm : 1;
      const vol = rnd(0.004, 0.018) * s.volatility * sectorVm;
      const drift = sectorBias + rnd(-vol, vol);
      const shock = Math.random() < 0.03 ? rnd(-0.08, 0.1) : 0;
      newP[s.ticker] = Math.max(0.5, cur[s.ticker] * (1 + drift + shock));
      newH[s.ticker] = [...hist[s.ticker].slice(1), newP[s.ticker]];
    });
    // Helper: price an ETF from its constituents using prices already in newP
    const priceEtf = etfStock => {
      const tickers = ETF_CONSTITUENTS[etfStock.ticker];
      const avgChg = tickers.reduce((sum, t) => {
        const prev = cur[t] || 1;
        const next = newP[t] || prev; // newP has constituent prices by now
        return sum + (next - prev) / prev;
      }, 0) / tickers.length;
      const etfNoise = rnd(-0.001, 0.001);
      newP[etfStock.ticker] = Math.max(0.5, cur[etfStock.ticker] * (1 + avgChg + etfNoise));
      newH[etfStock.ticker] = [...hist[etfStock.ticker].slice(1), newP[etfStock.ticker]];
    };
    // Second pass: sector ETFs (constituents are all non-ETF stocks, already priced)
    ALL_STOCKS.forEach(s => {
      if (!ETF_CONSTITUENTS[s.ticker]) return;
      if (s.crossSector || s.totalMarket) return; // handled in third pass
      priceEtf(s);
    });
    // Third pass: cross-sector + total market ETFs (may reference sector ETFs from pass 2)
    ALL_STOCKS.forEach(s => {
      if (!ETF_CONSTITUENTS[s.ticker]) return;
      if (!s.crossSector && !s.totalMarket) return;
      priceEtf(s);
    });
    return {
      newP,
      newH
    };
  }, []);

  // ─── AI BOT TRADES ────────────────────────────────────────────────────────────
  const runBotTrades = useCallback(async (curP, curBots) => {
    if (aiRef.current) return curBots;
    aiRef.current = true;
    const updated = curBots.map(b => ({
      ...b,
      holdings: {
        ...b.holdings
      }
    }));
    const tickerList = ALL_STOCKS.map(s => `${s.ticker}(${s.sectorLabel})`).join(",");
    for (let i = 0; i < updated.length; i++) {
      const b = updated[i];
      const held = Object.entries(b.holdings).map(([t, d]) => `${t}:${d?.qty || d}@$${fmt(curP[t])}`).join(",") || "none";
      const prStr = ALL_STOCKS.slice(0, 10).map(s => `${s.ticker}=$${fmt(curP[s.ticker])}`).join(",");
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 130,
            system: `You are ${b.name}, a ${b.personality}. 35 stocks across 7 sectors available.
Respond ONLY JSON no markdown: {"action":"buy"|"sell"|"hold","ticker":"TICKER","qty":NUMBER,"reason":"max 8 words"}
qty 1-15. Use REAL tickers from: ${tickerList.slice(0, 200)}`,
            messages: [{
              role: "user",
              content: `Sample prices:${prStr}... Cash:$${fmt(b.cash)}. Holdings:${held}. Pick a trade.`
            }]
          })
        });
        const data = await res.json();
        const raw = data.content?.[0]?.text || "{}";
        const dec = JSON.parse(raw.replace(/```[\w]*|```/g, "").trim());
        const stk = ALL_STOCKS.find(s => s.ticker === dec.ticker);
        if (!stk) continue;
        if (dec.action === "buy" && dec.qty > 0) {
          const cost = curP[dec.ticker] * dec.qty;
          if (b.cash >= cost) {
            b.cash -= cost;
            const ex = b.holdings[dec.ticker];
            if (ex) {
              const tc = ex.totalCost + cost;
              b.holdings[dec.ticker] = {
                qty: ex.qty + dec.qty,
                avgCost: tc / (ex.qty + dec.qty),
                totalCost: tc
              };
            } else b.holdings[dec.ticker] = {
              qty: dec.qty,
              avgCost: curP[dec.ticker],
              totalCost: cost
            };
            b.trades++;
            pushTrade({
              team: b.name,
              teamColor: b.color,
              action: "BUY",
              ticker: dec.ticker,
              qty: dec.qty,
              price: curP[dec.ticker],
              time: nowShort()
            });
          }
        } else if (dec.action === "sell" && (b.holdings[dec.ticker]?.qty || 0) >= dec.qty) {
          const pos = b.holdings[dec.ticker];
          const gain = (curP[dec.ticker] - pos.avgCost) * dec.qty;
          b.cash += curP[dec.ticker] * dec.qty;
          b.holdings[dec.ticker].qty -= dec.qty;
          b.holdings[dec.ticker].totalCost -= pos.avgCost * dec.qty;
          if (b.holdings[dec.ticker].qty <= 0) delete b.holdings[dec.ticker];
          b.trades++;
          b.closedTrades++;
          if (gain > 0) b.wins++;
          pushTrade({
            team: b.name,
            teamColor: b.color,
            action: "SELL",
            ticker: dec.ticker,
            qty: dec.qty,
            price: curP[dec.ticker],
            time: nowShort()
          });
        }
        const hv = Object.values(b.holdings).reduce((s, p) => s + (curP[p.ticker] || 0) * (p?.qty || 0), 0) + Object.keys(b.holdings).reduce((s, t) => s + (curP[t] || 0) * (b.holdings[t]?.qty || 0), 0);
        const totalHv = Object.entries(b.holdings).reduce((s, [t, p]) => s + (curP[t] || 0) * (p?.qty || 0), 0);
        b.pnl = b.cash + totalHv - INITIAL_CASH;
        if (b.cash + totalHv > b.peakValue) b.peakValue = b.cash + totalHv;
        b.uniqueSectors = new Set(Object.keys(b.holdings).map(t => ALL_STOCKS.find(s => s.ticker === t)?.sectorId).filter(Boolean)).size;
        // save bot score
        const botTotal = b.cash + totalHv;
        try {
          await window.storage.set(`lb:${b.name}`, JSON.stringify({
            name: b.name,
            color: b.color,
            total: botTotal,
            cash: b.cash,
            uniqueSectors: b.uniqueSectors,
            closedTrades: b.closedTrades,
            wins: b.wins,
            maxDrawdown: 1,
            isBot: true,
            updatedAt: nowShort()
          }), true);
        } catch {}
        setAiLog(p => [{
          time: nowShort(),
          trader: b.name,
          action: dec.action,
          ticker: dec.ticker,
          qty: dec.qty,
          reason: dec.reason,
          color: b.color
        }, ...p.slice(0, 39)]);
      } catch {}
    }
    aiRef.current = false;
    return updated;
  }, [pushTrade]);

  // ─── TICK NEWS ────────────────────────────────────────────────────────────────
  const genNews = useCallback(async (newP, prevP) => {
    const movers = ALL_STOCKS.map(s => ({
      ...s,
      chg: (newP[s.ticker] - prevP[s.ticker]) / (prevP[s.ticker] || 1) * 100
    })).filter(s => Math.abs(s.chg) > 2).sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg));
    if (!movers.length) return;
    const top = movers[0];
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 70,
          system: "Write a fake financial news headline. Max 14 words. No quotes. Headline only.",
          messages: [{
            role: "user",
            content: `${top.name} (${top.ticker}, ${top.sectorLabel}) ${top.chg > 0 ? "surged" : "dropped"} ${fmt(Math.abs(top.chg))}%. One-line headline:`
          }]
        })
      });
      const data = await res.json();
      const h = data.content?.[0]?.text?.trim() || "";
      if (h) setNews(p => [{
        ticker: top.ticker,
        sectorId: top.sectorId,
        headline: h,
        sentiment: top.chg > 0 ? "bull" : "bear",
        time: nowShort()
      }, ...p.slice(0, 24)]);
    } catch {}
  }, []);

  // ─── GAME TICK ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (gamePhase !== "running") return;
    const id = setInterval(() => {
      const curP = pricesRef.current;
      const curH = historyRef.current;
      const {
        newP,
        newH
      } = advancePrices(curP, curH, sentimentRef.current, sectorBiasRef.current);
      setPrevPrices(curP);
      setPrices(newP);
      setHistory(newH);
      setTick(t => t + 1);
      genNews(newP, curP);
      pushPrices(newP, newH);
      if (tickRef.current % 2 === 0) {
        setBots(prevB => {
          runBotTrades(newP, prevB).then(u => setBots(u));
          return prevB;
        });
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [gamePhase, advancePrices, genNews, pushPrices, runBotTrades]);

  // ─── ROUND END ────────────────────────────────────────────────────────────────
  const triggerRoundEnd = useCallback(async () => {
    if (["buffer", "disruption", "ceremony", "ended"].includes(phaseRef.current)) return;
    setGamePhase("ceremony");
    pushGMState({
      phase: "ceremony"
    });
    const lb = await loadLB();
    const botEntries = bots.map(b => {
      const hv = Object.entries(b.holdings).reduce((s, [t, p]) => s + (pricesRef.current[t] || 0) * (p?.qty || 0), 0);
      return {
        name: b.name,
        color: b.color,
        total: b.cash + hv,
        cash: b.cash,
        uniqueSectors: b.uniqueSectors || 0,
        closedTrades: b.closedTrades || 0,
        wins: b.wins || 0,
        maxDrawdown: 1,
        isBot: true
      };
    });
    const all = [...lb.filter(e => !e.isBot), ...botEntries];
    const rules = ROUND_RULES[roundNum - 1] || ROUND_RULES[0];
    // Calculate tax for this round
    if (rules.tax) {
      const hv = Object.entries(holdings).reduce((s, [t, p]) => s + (pricesRef.current[t] || 0) * p.qty, 0);
      const total = cash + hv;
      const profit = total - INITIAL_CASH;
      const tax = profit > 0 ? Math.round(profit * TAX_RATE) : 0;
      setTaxAmount(tax);
      setTaxPending(true);
      // Broadcast tax warning
      sendBcast(`💸 TAX TIME: 20% profit tax = $${tax.toLocaleString()} deducted from your gains!`);
    }
    if (rules.liquidate) {
      setLiquidatePending(true);
      sendBcast(`🔴 FORCED LIQUIDATION: All positions will be cleared at round end!`);
    }
    // Achievements check
    const newAch = [];
    const hv2 = Object.entries(holdings).reduce((s2, [t, p]) => s2 + (pricesRef.current[t] || 0) * p.qty, 0);
    const roundProfit = cash + hv2 - INITIAL_CASH;
    if (sentiment === "bear" && roundProfit > 0) newAch.push({
      id: "bull_whisperer",
      icon: "🐂",
      name: "Bull Whisperer",
      desc: "Profited in a BEAR round — against the trend"
    });
    // Prediction market result
    const pq = PREDICTION_QUESTIONS.find(q => q.round === roundNum);
    if (pq && playerPrediction) {
      if (playerPrediction === pq.correct) {
        newAch.push({
          id: `pred_correct_r${roundNum}`,
          icon: "🎯",
          name: "Market Oracle",
          desc: `Correct prediction: ${pq.concept}`
        });
        // Apply bonus
        const bonus = Math.round((cash + hv2) * pq.bonus);
        setCash(c => c + bonus);
        predCorrectCount.current.correct += 1;
        sendBcast(`🎯 ${currentTeam?.name} predicted correctly! +${Math.round(pq.bonus * 100)}% capital bonus applied.`);
        setPredResult({
          correct: true,
          answer: pq.options.find(o => o.id === pq.correct)?.text,
          explanation: pq.explanation,
          bonus
        });
      } else {
        setPredResult({
          correct: false,
          answer: pq.options.find(o => o.id === pq.correct)?.text,
          explanation: pq.explanation,
          bonus: 0
        });
      }
      predCorrectCount.current.total += 1;
    }
    setAchievements(prev => {
      const ids = prev.map(a => a.id);
      return [...prev, ...newAch.filter(a => !ids.includes(a.id))];
    });
    const allScored = all.map(e => ({
      ...e,
      ...calcScore(e, initCash, all)
    }));
    setWinnerRanked(sortLeaderboard(allScored));
    setShowCeremony(true);
    // Reset prediction for next round
    setPlayerPrediction(null);
  }, [bots, initCash, loadLB, pushGMState, roundNum, cash, holdings, sentiment, sendBcast]);
  triggerRoundEndRef.current = triggerRoundEnd;

  // ─── GENERATE DISRUPTION ──────────────────────────────────────────────────────
  const generateDisruption = useCallback(async () => {
    setGenerating(true);
    const chosen = [...ALL_STOCKS].sort(() => Math.random() - 0.5).slice(0, 4);
    const events = [];
    for (const s of chosen) {
      const impact = Math.random() < 0.5 ? rnd(10, 40) : -rnd(10, 40);
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 200,
            system: `Respond ONLY with valid JSON no markdown:
{"headline":"dramatic breaking news max 15 words","detail":"one sentence context max 20 words"}`,
            messages: [{
              role: "user",
              content: `Write a ${impact > 0 ? "bullish" : "bearish"} emergency market disruption event for ${s.name} (${s.ticker}) in the ${s.sectorLabel} sector that justifies a ${fmt(Math.abs(impact))}% price ${impact > 0 ? "surge" : "crash"} next round. Be dramatic and specific to this company.`
            }]
          })
        });
        const data = await res.json();
        const parsed = JSON.parse((data.content?.[0]?.text || "{}").replace(/```[\w]*|```/g, "").trim());
        events.push({
          ticker: s.ticker,
          headline: parsed.headline || `Shock event hits ${s.name}`,
          detail: parsed.detail || "",
          impact: Math.round(impact)
        });
      } catch {
        events.push({
          ticker: s.ticker,
          headline: `Major development shakes ${s.name}`,
          detail: "Analysts scrambling for details.",
          impact: Math.round(impact)
        });
      }
    }
    setDisruptions(events);
    await pushDisrupts(events);
    setGenerating(false);
    setShowCeremony(false);
    const now = Date.now();
    setBufferStart(now);
    setBufferLeft(BUFFER_SECS);
    setGamePhase("buffer");
    pushGMState({
      phase: "buffer",
      bufferLeft: BUFFER_SECS
    });
    setShowEmergency(true);
  }, [roundNum, pushDisrupts, pushGMState]);
  const generatePoliticalDisruption = useCallback(async eventIdx => {
    const evt = POLITICAL_EVENTS[eventIdx ?? polEventIdx];
    if (!evt) return;
    setGeneratingPol(true);

    // Build affected stocks: pick 1-2 stocks per impacted sector, weighted by impact magnitude
    const affectedStocks = [];
    for (const [sectorId, sectorImpact] of Object.entries(evt.sectors)) {
      if (Math.abs(sectorImpact) < 5) continue; // skip negligible impacts
      const sector = SECTORS.find(s => s.id === sectorId);
      if (!sector) continue;
      // Pick the 2 most representative stocks from this sector
      const picks = sector.stocks.slice(0, 2);
      for (const st of picks) {
        // Add some variance per stock within the sector impact
        const variance = rnd(-8, 8);
        const stockImpact = Math.round(clamp(sectorImpact + variance, -60, 60));
        affectedStocks.push({
          ...st,
          sectorId,
          sectorLabel: sector.label,
          impact: stockImpact
        });
      }
    }

    // Generate AI narrative for the political event
    const events = [];
    for (const st of affectedStocks) {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 150,
            system: `Respond ONLY with valid JSON: {"headline":"max 12 words","detail":"max 15 words"}`,
            messages: [{
              role: "user",
              content: `Macro-economic event: "${evt.headline}". ` + `Write a realistic follow-up consequence headline (under 12 words) for ${st.name}. ` + `Do NOT mention stock prices, % moves, or signal direction. ` + `Be factual — players must infer implications from economic reasoning. ` + `Underlying direction: ${st.impact > 0 ? "positive" : "negative"} — do not reveal.`
            }]
          })
        });
        const data = await res.json();
        const raw = (data.content?.[0]?.text || "{}").replace(/```[\w]*|```/g, "").trim();
        const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");
        events.push({
          ticker: st.ticker,
          sectorId: st.sectorId,
          headline: parsed.headline || `${evt.headline.slice(0, 50)} — consequences emerge`,
          detail: parsed.detail || evt.subheadline,
          impact: st.impact,
          political: true,
          eventName: evt.headline,
          eventIcon: evt.icon,
          concept: evt.concept // GM-only, not shown to players
        });
      } catch {
        events.push({
          ticker: st.ticker,
          sectorId: st.sectorId,
          headline: `${evt.headline.slice(0, 50)} — ${st.name}`,
          detail: evt.subheadline,
          impact: st.impact,
          political: true,
          eventName: evt.name,
          eventIcon: evt.icon
        });
      }
    }
    setDisruptions(events);
    await pushDisrupts(events);
    setGeneratingPol(false);
    setShowCeremony(false);
    const now = Date.now();
    setBufferStart(now);
    setBufferLeft(BUFFER_SECS);
    setGamePhase("buffer");
    pushGMState({
      phase: "buffer",
      bufferLeft: BUFFER_SECS
    });
    setShowEmergency(true);
    sendBcast(`📊 MACRO EVENT: ${evt.icon} ${evt.headline}`);
  }, [polEventIdx, pushDisrupts, pushGMState, sendBcast]);
  const applyDisruption = useCallback(() => {
    const cur = pricesRef.current;
    const next = {
      ...cur
    };
    disruptions.forEach(evt => {
      if (next[evt.ticker]) next[evt.ticker] = Math.max(0.5, next[evt.ticker] * (1 + evt.impact / 100));
    });
    setPrices(next);
    setHistory(prevH => {
      const newH = {
        ...prevH
      };
      disruptions.forEach(evt => {
        if (newH[evt.ticker]) newH[evt.ticker] = [...newH[evt.ticker].slice(1), next[evt.ticker]];
      });
      pushPrices(next, newH);
      return newH;
    });
    const summary = disruptions.map(e => `${e.ticker} ${e.impact > 0 ? "+" : ""}${e.impact}%`).join(" · ");
    sendBcast(`🚨 DISRUPTION APPLIED: ${summary} — Round ${roundNum + 1} begins!`);
  }, [disruptions, pushPrices, sendBcast, roundNum]);
  function startNextRound() {
    const next = roundNum + 1;
    if (next > TOTAL_ROUNDS) {
      setGamePhase("ended");
      pushGMState({
        phase: "ended",
        allEnded: true
      });
      setShowEmergency(false);
      return;
    }
    const rules = ROUND_RULES[next - 1] || ROUND_RULES[ROUND_RULES.length - 1];
    setRoundRules(rules);

    // Apply tax if pending (deduct from player cash)
    if (taxPending && taxAmount > 0) {
      setCash(c => Math.max(0, c - taxAmount));
      setTaxPending(false);
      setTaxAmount(0);
    }

    // Apply liquidation if pending
    if (liquidatePending) {
      const curP = pricesRef.current;
      setHoldings(prevH => {
        const totalHV = Object.entries(prevH).reduce((s, [t, p]) => s + (curP[t] || 0) * p.qty, 0);
        setCash(c => {
          // Grand Final (R7): equal capital restart
          if (next === 7) {
            setInitCash(INITIAL_CASH);
            return INITIAL_CASH;
          }
          return c + totalHV;
        });
        return {};
      });
      setTransactions([]);
      setLiquidatePending(false);
    }

    // Apply round identity: volatility, sentiment lock, leaderboard hide
    setVolMultiplier(rules.volMult || 1.0);
    setLeaderHidden(rules.leaderHidden || false);
    if (rules.sentLock) {
      setSentiment(rules.sentLock);
      sendBcast(`🔒 SENTIMENT LOCKED: ${rules.sentLock.toUpperCase()} for Round ${next} — ${rules.name}!`);
    }

    // Announce round identity
    sendBcast(`🎯 ROUND ${next}: ${rules.icon} ${rules.name} — ${rules.briefing}`);
    setShowEmergency(false);
    setDisruptions([]);
    setRoundNum(next);
    const st = Date.now();
    setStartTime(st);
    setGamePhase("running");
    setTimeLeft(roundDurations[next - 1] || roundDur);
    setBufferLeft(null);
    // Close prediction market
    setPredictionOpen(false);
    setPredResult(null);
    pushGMState({
      phase: "running",
      round: next,
      roundLeft: roundDurations[next - 1] || roundDur,
      bufferLeft: 0,
      volMultiplier: rules.volMult || 1.0,
      leaderHidden: rules.leaderHidden || false
    });
  }

  // ─── SECTOR AUTOMATION ────────────────────────────────────────────────────────
  const generateSectorNews = useCallback(async (sectorId, bias) => {
    const sector = SECTORS.find(s => s.id === sectorId);
    if (!sector) return;
    setGeneratingSector(sectorId);
    const events = [];
    for (const st of sector.stocks.slice(0, 3)) {
      const isBull = bias === "bull" || bias === "volatile" && Math.random() > 0.45;
      const impact = isBull ? rnd(8, 28) : -rnd(8, 28);
      let headline = `${isBull ? "Surge" : "Crash"} hits ${st.name} amid sector upheaval`;
      let detail = "Analysts rapidly reassessing sector valuations.";
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 200,
            system: "You generate dramatic market disruption news for a stock simulation game. Respond ONLY with a valid JSON object. No markdown, no code fences. Format: {headline: string, detail: string}",
            messages: [{
              role: "user",
              content: `Write a ${isBull ? "BULLISH" : "BEARISH"} breaking news event for ${st.name} (${st.ticker}) in the ${sector.label} sector that justifies a ${Math.abs(impact).toFixed(0)}% price ${isBull ? "surge" : "crash"}. Keep headline under 13 words, detail under 20 words. Be dramatic and company-specific.`
            }]
          })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const rawText = data?.content?.[0]?.text || "";

        // Robust JSON extraction — strip markdown fences and find first { ... }
        const cleaned = rawText.replace(/```[\w]*/g, "").replace(/```/g, "").trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.headline) headline = parsed.headline;
          if (parsed.detail) detail = parsed.detail;
        }
      } catch (err) {
        // Fallback headlines so the game never breaks
        const bullHeadlines = [`${st.name} reports record-breaking quarterly results`, `Major institutional investors flood into ${st.ticker}`, `${sector.label} sector surges on regulatory approval`];
        const bearHeadlines = [`${st.name} faces unexpected regulatory investigation`, `${st.ticker} misses earnings amid sector headwinds`, `Analysts downgrade ${sector.label} sector outlook sharply`];
        const pool = isBull ? bullHeadlines : bearHeadlines;
        headline = pool[Math.floor(Math.random() * pool.length)];
      }
      events.push({
        ticker: st.ticker,
        sectorId,
        headline,
        detail,
        impact: Math.round(impact)
      });
    }

    // Store disruption events
    setSectorDisruptions(prev => ({
      ...prev,
      [sectorId]: events
    }));

    // Apply price shocks — use functional updates separately to avoid nesting
    const priceUpdates = {};
    events.forEach(evt => {
      priceUpdates[evt.ticker] = evt.impact;
    });
    const curPForSector = pricesRef.current;
    const nextPForSector = {
      ...curPForSector
    };
    Object.entries(priceUpdates).forEach(([ticker, impactPct]) => {
      if (nextPForSector[ticker] != null) nextPForSector[ticker] = Math.max(0.5, nextPForSector[ticker] * (1 + impactPct / 100));
    });
    setPrices(nextPForSector);
    setHistory(prev => {
      const newH = {
        ...prev
      };
      events.forEach(evt => {
        if (newH[evt.ticker]) newH[evt.ticker] = [...newH[evt.ticker].slice(1), nextPForSector[evt.ticker] || Math.max(0.5, (curPForSector[evt.ticker] || 1) * (1 + evt.impact / 100))];
      });
      return newH;
    });

    // Push updated prices to central display
    setTimeout(() => pushPrices(pricesRef.current, undefined), 100);

    // Add to news feed
    const timeStr = nowShort();
    setNews(prev => [...events.map(evt => ({
      ticker: evt.ticker,
      sectorId,
      headline: evt.headline,
      sentiment: evt.impact > 0 ? "bull" : "bear",
      time: timeStr
    })), ...prev].slice(0, 25));

    // Broadcast to all players
    const modeLabel = bias === "bull" ? "BULLISH SURGE" : bias === "bear" ? "BEARISH CRASH" : "VOLATILE SWING";
    const summary = events.map(e => `${e.ticker} ${e.impact > 0 ? "+" : ""}${e.impact}%`).join(" · ");
    sendBcast(`${sector.icon} ${sector.label} ${modeLabel}: ${summary}`);
    setGeneratingSector(null);
  }, [pushPrices, sendBcast]);

  // ─── SECTOR AUTOMATION LOOP ─────────────────────────────────────────────────
  // Every 45 seconds, auto-regenerate AI news for all sectors with automation on
  const activeDisruptRef2 = useRef(activeDisruptSectors);
  activeDisruptRef2.current = activeDisruptSectors;
  useEffect(() => {
    if (gamePhase !== "running") return;
    const INTERVAL = 45000;
    const id = setInterval(async () => {
      if (activeDisruptRef2.current.size === 0) return;
      for (const sectorId of activeDisruptRef2.current) {
        const bias = sectorBiasRef.current[sectorId] || "volatile";
        await generateSectorNews(sectorId, bias === "neutral" ? "volatile" : bias);
        await new Promise(r => setTimeout(r, 2000));
      }
    }, INTERVAL);
    return () => clearInterval(id);
  }, [gamePhase, generateSectorNews]);

  // ─── GM COMMANDS ──────────────────────────────────────────────────────────────
  const gmCmd = useCallback((cmd, payload = {}) => {
    if (cmd === "start") {
      const st = Date.now();
      setStartTime(st);
      setGamePhase("running");
      setTimeLeft(roundDur);
      pushGMState({
        phase: "running",
        round: roundNum,
        roundLeft: roundDur
      });
    } else if (cmd === "pause") {
      setGamePhase("paused");
      pushGMState({
        phase: "paused"
      });
    } else if (cmd === "resume") {
      setGamePhase("running");
      pushGMState({
        phase: "running"
      });
    } else if (cmd === "stop") {
      setGamePhase("idle");
      pushGMState({
        phase: "idle"
      });
    } else if (cmd === "forceEnd") {
      triggerRoundEnd();
    } else if (cmd === "shock") {
      const cur = pricesRef.current;
      const next = {
        ...cur,
        [payload.ticker]: Math.max(0.5, cur[payload.ticker] * (1 + payload.pct / 100))
      };
      setPrices(next);
      setHistory(prevH => {
        const h = {
          ...prevH,
          [payload.ticker]: [...prevH[payload.ticker].slice(1), next[payload.ticker]]
        };
        pushPrices(next, h);
        return h;
      });
    } else if (cmd === "sentiment") {
      setSentiment(payload.s);
      pushGMState({
        sentiment: payload.s
      });
    } else if (cmd === "reset") {
      const newP = initPrices(),
        newH = initHistory(newP);
      const resetCash = payload.cash || initCash;
      // Reset all game state
      setPrices(newP);
      setHistory(newH);
      setPrevPrices(newP);
      setBots(initBots());
      setAiLog([]);
      setNews([]);
      setCash(resetCash);
      setHoldings({});
      setTransactions([]);
      setTick(0);
      setRoundNum(1);
      setStartTime(null);
      setTimeLeft(null);
      setRoundDurations([...DEFAULT_ROUND_DURATIONS]);
      setBufferLeft(null);
      setBufferStart(null);
      setGamePhase("idle");
      // Clear all overlay modals
      setShowCeremony(false);
      setShowEmergency(false);
      setShowBlast(false);
      setDisruptions([]);
      setWinnerRanked([]);
      setPeakValue(resetCash);
      setMaxDrawdown(0);
      // Reset sector state
      setSectorBiases(Object.fromEntries(SECTORS.map(s => [s.id, "neutral"])));
      setActiveDisruptSectors(new Set());
      setSectorDisruptions({});
      setSelectedSectors(new Set());
      setSentiment("neutral");
      // Reset player-side round tracking ref so carry logic works on next game
      prevRoundRef.current = 0;
      // Clear leaderboard scores from shared storage
      (async () => {
        try {
          const res = await window.storage.list("lb:", true);
          const keys = res?.keys || [];
          await Promise.all(keys.map(k => window.storage.delete(k, true)));
        } catch {}
      })();
      pushPrices(newP, newH);
      pushGMState({
        phase: "idle",
        round: 1,
        roundLeft: null,
        bufferLeft: null,
        allEnded: false,
        sentiment: "neutral"
      });
    } else if (cmd === "broadcast") {
      sendBcast(payload.text);
    } else if (cmd === "powerup") {
      const card = POWERUP_CARDS.find(c => c.id === payload.id);
      if (!card || usedCards.has(card.id)) return;
      setUsedCards(prev => new Set([...prev, card.id]));
      setActivePowerup(card);
      setTimeout(() => setActivePowerup(null), 4000);
      if (card.effect.type === "market") {
        // Tsunami: crash everything
        const cur = pricesRef.current;
        const next2 = {};
        ALL_STOCKS.forEach(s => {
          next2[s.ticker] = Math.max(0.5, cur[s.ticker] * (1 + card.effect.pct / 100));
        });
        setPrices(next2);
        setHistory(prevH => {
          const newH = {
            ...prevH
          };
          ALL_STOCKS.forEach(s => {
            newH[s.ticker] = [...newH[s.ticker].slice(1), next2[s.ticker]];
          });
          pushPrices(next2, newH);
          return newH;
        });
        sendBcast(`🌊 TSUNAMI CARD! Entire market ${card.effect.pct}% — chaos reigns!`);
      } else if (card.effect.type === "spike") {
        // Moon Shot: random stock +40% then corrects
        const target = ALL_STOCKS.filter(s => !s.constituents)[Math.floor(Math.random() * 35)];
        const cur = pricesRef.current;
        const spiked = Math.max(0.5, cur[target.ticker] * (1 + card.effect.pct / 100));
        setPrices(p => ({
          ...p,
          [target.ticker]: spiked
        }));
        sendBcast(`🚀 MOON SHOT! ${target.ticker} surges ${card.effect.pct}% for 60 seconds!`);
        setTimeout(() => {
          setPrices(p => ({
            ...p,
            [target.ticker]: Math.max(0.5, spiked * 0.75)
          }));
          sendBcast(`📉 Moon Shot correction — ${target.ticker} pulling back.`);
        }, card.effect.duration * 1000);
      } else if (card.effect.type === "freeze") {
        const until = Date.now() + card.effect.duration * 1000;
        setFrozenUntil(until);
        pushGMState({
          frozenUntil: until
        });
        sendBcast(`🧊 FREEZE CARD! Trading locked for ${card.effect.duration} seconds — prices keep moving!`);
        setTimeout(() => {
          setFrozenUntil(null);
          pushGMState({
            frozenUntil: null
          });
          sendBcast("🔓 Freeze lifted — trading resumes!");
        }, card.effect.duration * 1000);
      } else if (card.effect.type === "shuffle") {
        sendBcast(`🎲 WILD CARD! The GM is redistributing 10% of all team cash — check your balance!`);
        // Note: actual redistribution happens on player side when they read gm:wildcard key
        pushGMState({
          wildcard: {
            pct: card.effect.pct,
            ts: Date.now()
          }
        });
      }
    } else if (cmd === "openPrediction") {
      setPredictionOpen(true);
      pushGMState({
        predictionOpen: true,
        predictionRound: roundNum
      });
      sendBcast("🎯 PREDICTION MARKET OPEN! Pick which sector will gain most this round — correct = +8% capital bonus!");
    } else if (cmd === "closePrediction") {
      setPredictionOpen(false);
      pushGMState({
        predictionOpen: false
      });
    } else if (cmd === "setInitCash") {
      setInitCash(payload.cash);
      setCash(payload.cash);
      setHoldings({});
      setTransactions([]);
    }
  }, [roundDur, roundNum, initCash, triggerRoundEnd, pushGMState, pushPrices, sendBcast]);

  // ─── DERIVED ──────────────────────────────────────────────────────────────────
  const analytics = PortfolioAnalytics({
    holdings,
    transactions,
    prices,
    cash,
    initCash
  });
  const totalVal = analytics.totalVal;
  const myRank = sharedLB.findIndex(e => e.name === currentTeam?.name) + 1;
  const selStock = ALL_STOCKS.find(s => s.ticker === selTicker);
  const selPrice = selTicker ? prices[selTicker] : null;
  const buyTotal = selTicker ? selPrice * orderQty : 0;
  const isFrozen = frozenUntil && Date.now() < frozenUntil;
  const canTrade = gamePhase === "running" && !isFrozen;
  const canBuy = canTrade && cash >= buyTotal && orderQty > 0 && selTicker;
  const canSell = canTrade && selTicker && (holdings[selTicker]?.qty || 0) >= orderQty && orderQty > 0;
  const timerMins = timeLeft != null ? Math.floor(timeLeft / 60) : null;
  const timerSecs = timeLeft != null ? timeLeft % 60 : null;
  const bufMins = bufferLeft != null ? Math.floor(bufferLeft / 60) : null;
  const bufSecs = bufferLeft != null ? bufferLeft % 60 : null;

  // Filtered stocks for market tab
  const filteredStocks = ALL_STOCKS.filter(s => {
    const inSector = activeSector === "all" || s.sectorId === activeSector;
    const inSearch = !marketSearch || s.ticker.includes(marketSearch.toUpperCase()) || s.name.toLowerCase().includes(marketSearch.toLowerCase());
    return inSector && inSearch;
  });
  function execBuy(ticker, qty) {
    const stk = ALL_STOCKS.find(s => s.ticker === ticker);
    const p = prices[ticker];
    const total = p * qty;
    if (!stk || !p || cash < total || qty <= 0) return;
    const ex = holdings[ticker];
    const newHolding = ex ? {
      qty: ex.qty + qty,
      avgCost: (ex.totalCost + total) / (ex.qty + qty),
      totalCost: ex.totalCost + total
    } : {
      qty,
      avgCost: p,
      totalCost: total
    };
    setCash(c => c - total);
    setHoldings(h => ({
      ...h,
      [ticker]: newHolding
    }));
    const tx = {
      id: Date.now(),
      type: "BUY",
      ticker,
      sectorId: stk.sectorId,
      qty,
      price: p,
      avgCostAtBuy: p,
      total,
      time: nowFull(),
      date: new Date().toLocaleDateString()
    };
    setTransactions(prev => [tx, ...prev]);
    pushTrade({
      team: currentTeam?.name,
      teamColor: currentTeam?.color,
      action: "BUY",
      ticker,
      qty,
      price: p,
      time: nowShort()
    });
  }
  function execSell(ticker, qty) {
    const stk = ALL_STOCKS.find(s => s.ticker === ticker);
    const p = prices[ticker];
    const pos = holdings[ticker];
    if (!stk || !p || !pos || pos.qty < qty || qty <= 0) return;
    const proceeds = p * qty;
    const gain = (p - pos.avgCost) * qty;
    const newQty = pos.qty - qty;
    setCash(c => c + proceeds);
    setHoldings(h => {
      const n = {
        ...h
      };
      if (newQty <= 0) delete n[ticker];else n[ticker] = {
        qty: newQty,
        avgCost: pos.avgCost,
        totalCost: pos.avgCost * newQty
      };
      return n;
    });
    const tx = {
      id: Date.now(),
      type: "SELL",
      ticker,
      sectorId: stk.sectorId,
      qty,
      price: p,
      avgCostAtSell: pos.avgCost,
      proceeds,
      gain,
      gainPct: (p - pos.avgCost) / pos.avgCost * 100,
      time: nowFull(),
      date: new Date().toLocaleDateString()
    };
    setTransactions(prev => [tx, ...prev]);
    pushTrade({
      team: currentTeam?.name,
      teamColor: currentTeam?.color,
      action: "SELL",
      ticker,
      qty,
      price: p,
      time: nowShort()
    });
  }
  function doBuy() {
    execBuy(selTicker, orderQty);
  }
  function doSell() {
    execSell(selTicker, orderQty);
  }

  // ─── GM RULEBOOK MODAL ────────────────────────────────────────────────────────
  if (showRulebook) return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 10000,
      background: "rgba(2,8,23,0.97)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'JetBrains Mono','Courier New',monospace",
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "min(900px,98vw)",
      maxHeight: "96vh",
      background: "#0a0f1e",
      border: "1px solid #a78bfa",
      borderRadius: 16,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 24px",
      borderBottom: "1px solid #1e293b",
      background: "linear-gradient(135deg,#1a0a2e,#0a0f1e)",
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 24
    }
  }, "\uD83D\uDCD6"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 800,
      fontSize: 18,
      color: "#a78bfa"
    }
  }, "BULL PIT \u2014 GM RULEBOOK"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569"
    }
  }, "Complete Game Master Reference \u2014 30 Teams")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowRulebook(false),
    style: {
      background: "none",
      border: "1px solid #334155",
      color: "#94a3b8",
      padding: "6px 14px",
      borderRadius: 6,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 11
    }
  }, "CLOSE")), /*#__PURE__*/React.createElement("div", {
    style: {
      overflowY: "auto",
      padding: "20px 24px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#060c18",
      border: "1px solid #1e293b",
      borderRadius: 10,
      padding: "14px 18px",
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 800,
      fontSize: 13,
      color: "#00f5c4",
      marginBottom: 10
    }
  }, "COMPETITION OVERVIEW"), [["Teams", "Up to 30 teams, each with $100,000 starting capital"], ["Rounds", "7 rounds, each with a unique identity and special rules"], ["Duration", "~90 minutes total (60 min play + 30 min buffers + breaks)"], ["Tax", "20% profit tax applied at end of Rounds 2, 4, and 6"], ["Liquidation", "Forced at Round 3 (partial reset) and Round 7 (full equal reset)"], ["Winner", "Highest composite score after Round 7 — 5 scoring pillars"], ["Power-Ups", "GM has 4 one-time-use cards: Tsunami, Moon Shot, Freeze, Wild Card"]].map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      display: "flex",
      gap: 12,
      marginBottom: 6,
      fontSize: 11
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 110,
      color: "#fbbf24",
      fontWeight: 700,
      flexShrink: 0
    }
  }, k), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#94a3b8"
    }
  }, v)))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 800,
      fontSize: 13,
      color: "#f1f5f9",
      marginBottom: 10
    }
  }, "ROUND-BY-ROUND GM GUIDE"), ROUND_RULES.map((rules, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      background: "#060c18",
      border: `1px solid ${rules.color}44`,
      borderRadius: 10,
      padding: "14px 18px",
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 20
    }
  }, rules.icon), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 800,
      fontSize: 13,
      color: rules.color
    }
  }, "Round ", rules.round, ": ", rules.name), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginTop: 4,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 8,
      padding: "1px 6px",
      borderRadius: 3,
      background: `${rules.color}20`,
      color: rules.color,
      fontWeight: 700
    }
  }, rules.volMult, "\xD7 VOLATILITY"), rules.sentLock && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 8,
      padding: "1px 6px",
      borderRadius: 3,
      background: "#fbbf2420",
      color: "#fbbf24",
      fontWeight: 700
    }
  }, "SENTIMENT LOCKED: ", rules.sentLock.toUpperCase()), rules.tax && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 8,
      padding: "1px 6px",
      borderRadius: 3,
      background: "#ef444420",
      color: "#ef4444",
      fontWeight: 700
    }
  }, "20% TAX"), rules.liquidate && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 8,
      padding: "1px 6px",
      borderRadius: 3,
      background: "#ef444420",
      color: "#ef4444",
      fontWeight: 700
    }
  }, "FORCED LIQUIDATION"), rules.leaderHidden && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 8,
      padding: "1px 6px",
      borderRadius: 3,
      background: "#a78bfa20",
      color: "#a78bfa",
      fontWeight: 700
    }
  }, "LEADERBOARD HIDDEN")))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#64748b",
      marginBottom: 8
    }
  }, rules.briefing), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0a0f1e",
      border: "1px solid #1e293b",
      borderRadius: 6,
      padding: "10px 14px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#fbbf24",
      fontWeight: 700,
      marginBottom: 6
    }
  }, "GM ACTION CHECKLIST"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#94a3b8",
      lineHeight: 1.8
    }
  }, rules.gmNote)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      fontSize: 9,
      color: "#334155"
    }
  }, "DISRUPTION PLAN:", " ", Object.entries(rules.disruptionPlan).map(([timing, plan]) => plan.map(p => `${timing}: ${p.count || 1}× ${p.type}${p.eventHint ? ` (${p.eventHint})` : ""}`)).flat().join(" | ")))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 800,
      fontSize: 13,
      color: "#f1f5f9",
      marginBottom: 10,
      marginTop: 4
    }
  }, "POWER-UP CARD REFERENCE"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8,
      marginBottom: 16
    }
  }, POWERUP_CARDS.map(card => /*#__PURE__*/React.createElement("div", {
    key: card.id,
    style: {
      background: "#060c18",
      border: `1px solid ${card.color}44`,
      borderRadius: 8,
      padding: "12px 14px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 20,
      marginBottom: 4
    }
  }, card.icon), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: card.color,
      fontWeight: 800,
      marginBottom: 4
    }
  }, card.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#64748b",
      lineHeight: 1.6
    }
  }, card.desc), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155",
      marginTop: 6
    }
  }, "One-time use. Click in GM Control tab during a live round.")))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#060c18",
      border: "1px solid #1e293b",
      borderRadius: 10,
      padding: "14px 18px",
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 800,
      fontSize: 13,
      color: "#fbbf24",
      marginBottom: 4
    }
  }, "9-INDICATOR SCORING SYSTEM (100 pts total)"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      marginBottom: 12
    }
  }, "Three tiers. Every team sees their full scorecard with formulas. Tiebreaker chain resolves dead heats."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#38bdf8",
      fontWeight: 800,
      marginBottom: 6
    }
  }, "TIER 1 \u2014 PERFORMANCE (50 pts)"), [["15pts", "Absolute Return", "(Portfolio − Start) ÷ Start × 100", "Raw P&L. The baseline. Everyone understands it."], ["15pts", "Risk-Adj Return (Sharpe)", "Return ÷ Max Drawdown", "Penalises volatile gains. Rewards consistent outperformance."], ["12pts", "Alpha vs Market", "Your Return − BALL Index Return", "Did you beat the market or just ride the wave?"], ["8pts", "Round Consistency", "Geometric mean of per-round returns", "Penalises one-lucky-round players. Rewards sustained skill."]].map(([pts, name, formula, why]) => /*#__PURE__*/React.createElement("div", {
    key: name,
    style: {
      display: "flex",
      gap: 10,
      marginBottom: 6,
      fontSize: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 34,
      color: "#38bdf8",
      fontWeight: 800,
      flexShrink: 0
    }
  }, pts), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#f1f5f9",
      fontWeight: 700
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#475569",
      fontSize: 9
    }
  }, "Formula: ", formula), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#334155",
      fontSize: 9
    }
  }, why))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#a78bfa",
      fontWeight: 800,
      marginBottom: 6
    }
  }, "TIER 2 \u2014 RISK MANAGEMENT (30 pts)"), [["10pts", "Max Drawdown Control", "Inversely scaled — 0% DD = 10pts, 50%+ DD = 0pts", "Measures capital preservation discipline."], ["10pts", "Calmar Ratio", "Return ÷ Max Drawdown (primary tiebreaker)", "Better than Sharpe for fat-tail events. Primary tiebreaker."], ["10pts", "Portfolio Beta", "1 − |Holdings concentration ratio|", "Low beta = independent thinking, not just buying the index."]].map(([pts, name, formula, why]) => /*#__PURE__*/React.createElement("div", {
    key: name,
    style: {
      display: "flex",
      gap: 10,
      marginBottom: 6,
      fontSize: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 34,
      color: "#a78bfa",
      fontWeight: 800,
      flexShrink: 0
    }
  }, pts), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#f1f5f9",
      fontWeight: 700
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#475569",
      fontSize: 9
    }
  }, "Formula: ", formula), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#334155",
      fontSize: 9
    }
  }, why))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#00f5c4",
      fontWeight: 800,
      marginBottom: 6
    }
  }, "TIER 3 \u2014 TRADING QUALITY (20 pts)"), [["8pts", "Win Rate", "Profitable sells ÷ Total sells × 100", "% of closed trades that made money."], ["7pts", "Sector Diversification", "Unique sectors held (9 max)", "Rewards sustained diversification across industries."], ["5pts", "Prediction Accuracy", "Correct economic predictions ÷ Total", "Tests if teams understood the macro events — not just got lucky."]].map(([pts, name, formula, why]) => /*#__PURE__*/React.createElement("div", {
    key: name,
    style: {
      display: "flex",
      gap: 10,
      marginBottom: 6,
      fontSize: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 34,
      color: "#00f5c4",
      fontWeight: 800,
      flexShrink: 0
    }
  }, pts), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#f1f5f9",
      fontWeight: 700
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#475569",
      fontSize: 9
    }
  }, "Formula: ", formula), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#334155",
      fontSize: 9
    }
  }, why))))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0a0f1e",
      border: "1px solid #fbbf2430",
      borderRadius: 6,
      padding: "10px 12px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#fbbf24",
      fontWeight: 800,
      marginBottom: 6
    }
  }, "TIEBREAKER CHAIN (sequential \u2014 applied only when scores are equal)"), [["TB1", "Calmar Ratio", "Higher Calmar wins — better risk-adjusted efficiency"], ["TB2", "Max Drawdown", "Lower drawdown wins — more capital-preserving"], ["TB3", "Alpha vs Market", "Higher alpha wins — beat the benchmark more"], ["TB4", "Sectors Traded", "More unique sectors wins — more diversified"], ["TB5", "Last Trade Time", "Earlier timestamp wins — more decisive"]].map(([tb, name, desc]) => /*#__PURE__*/React.createElement("div", {
    key: tb,
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 4,
      fontSize: 9
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#fbbf24",
      fontWeight: 800,
      width: 28,
      flexShrink: 0
    }
  }, tb), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#f1f5f9",
      width: 110,
      flexShrink: 0
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#475569"
    }
  }, desc))))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#060c18",
      border: "1px solid #ef444444",
      borderRadius: 10,
      padding: "14px 18px",
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 800,
      fontSize: 13,
      color: "#ef4444",
      marginBottom: 10
    }
  }, "TAX & LIQUIDATION RULES"), [["20% Tax", "Rounds 2, 4, 6", "20% of profit above starting $100K is deducted at round end"], ["Tax on profit only", "Not on capital", "If a team lost money, no tax is applied"], ["Liquidation R3", "Forced clear", "All positions sold at market price — proceeds kept as cash"], ["Liquidation R7", "Full equal reset", "All teams reset to exactly $100,000 — true skill final"], ["Initial capital", "Never destroyed", "Teams always keep at least their starting $100K as floor"]].map(([k, w, v]) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      marginBottom: 8,
      fontSize: 11
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#ef4444",
      fontWeight: 700
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#fbbf24",
      marginLeft: 8
    }
  }, "(", w, ")"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#64748b",
      marginTop: 2
    }
  }, v)))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#060c18",
      border: "1px solid #38bdf844",
      borderRadius: 10,
      padding: "14px 18px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 800,
      fontSize: 13,
      color: "#38bdf8",
      marginBottom: 10
    }
  }, "30-TEAM OPERATION TIPS"), ["Assign 1 co-facilitator to monitor leaderboard and announce top 3 every 2 minutes", "Disable bot AI trades before the event to reduce API load (GM Panel → Market Tab)", "Use the Prediction Market at the start of each buffer to keep teams engaged during breaks", "Fire disruptions every 3-4 minutes to maintain excitement — don't let the market go flat", "Announce the round identity and special rules on a speaker before each round starts", "Keep the Central Display on a projector visible to all teams at all times", "Have the Freeze card ready for moments when one team is running away with the lead", "In Round 5 (Dark Pool), do NOT show the leaderboard on the projector either"].map((tip, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 8,
      fontSize: 11
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#38bdf8",
      flexShrink: 0
    }
  }, i + 1, "."), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#64748b"
    }
  }, tip)))))));

  // ════════════════════════════════════════════════════════════════════════════
  // LOGIN
  // ════════════════════════════════════════════════════════════════════════════
  if (screen === "login") return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      background: "#020817",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'JetBrains Mono','Courier New',monospace"
    }
  }, /*#__PURE__*/React.createElement("style", null, CSS), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 440,
      padding: 44,
      animation: "fadeup 0.5s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginBottom: 36
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      letterSpacing: "0.4em",
      color: "#334155",
      marginBottom: 12
    }
  }, "7 ROUNDS \xB7 58 STOCKS \xB7 9 SECTORS"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: 68,
      lineHeight: 1,
      background: "linear-gradient(135deg,#00f5c4,#38bdf8)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      marginBottom: 6
    }
  }, "BULL PIT"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#475569"
    }
  }, "Where fortunes are forged in seconds"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "center",
      gap: 6,
      marginTop: 12,
      flexWrap: "wrap"
    }
  }, SECTORS.map(s => /*#__PURE__*/React.createElement("span", {
    key: s.id,
    style: {
      fontSize: 9,
      padding: "2px 7px",
      borderRadius: 4,
      background: `${s.color}18`,
      border: `1px solid ${s.color}44`,
      color: s.color
    }
  }, s.icon, " ", s.label)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      background: "#0f172a",
      borderRadius: 10,
      padding: 4,
      marginBottom: 24
    }
  }, ["player", "gm"].map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    onClick: () => setLoginTab(t),
    style: {
      flex: 1,
      padding: "10px",
      background: loginTab === t ? "#1e293b" : "none",
      border: "none",
      borderRadius: 7,
      color: loginTab === t ? "#f1f5f9" : "#475569",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 11,
      fontWeight: loginTab === t ? 700 : 400,
      letterSpacing: "0.08em",
      textTransform: "uppercase"
    }
  }, t === "gm" ? "⚡ Game Master" : "👤 Team Login"))), loginTab === "player" ? /*#__PURE__*/React.createElement("div", {
    style: {
      animation: "fadein 0.3s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      marginBottom: 6
    }
  }, "SELECT YOUR TEAM"), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      marginBottom: 12
    }
  }, nameInput && (() => {
    const t = teams.find(x => x.name === nameInput);
    return t ? /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        left: 14,
        top: "50%",
        transform: "translateY(-50%)",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: t.color,
        pointerEvents: "none",
        zIndex: 1
      }
    }) : null;
  })(), /*#__PURE__*/React.createElement("select", {
    value: nameInput,
    onChange: e => {
      setNameInput(e.target.value);
      setLoginErr("");
    },
    style: {
      width: "100%",
      padding: `12px 14px 12px ${nameInput ? "32px" : "14px"}`,
      background: "#0f172a",
      border: `1px solid ${nameInput ? teams.find(x => x.name === nameInput)?.color || "#1e293b" : "#1e293b"}`,
      color: nameInput ? teams.find(x => x.name === nameInput)?.color || "#f1f5f9" : "#475569",
      borderRadius: 8,
      fontSize: 13,
      fontFamily: "inherit",
      cursor: "pointer",
      appearance: "none",
      WebkitAppearance: "none",
      outline: "none"
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: "",
    disabled: true,
    style: {
      color: "#475569",
      background: "#0f172a"
    }
  }, "Choose your team..."), teams.map(t => /*#__PURE__*/React.createElement("option", {
    key: t.id,
    value: t.name,
    style: {
      color: t.color,
      background: "#0f172a",
      fontWeight: 700
    }
  }, t.name))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      right: 14,
      top: "50%",
      transform: "translateY(-50%)",
      pointerEvents: "none",
      color: "#475569",
      fontSize: 12
    }
  }, "v")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      marginBottom: 6
    }
  }, "TEAM PASSWORD"), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: passInput,
    onChange: e => {
      setPassInput(e.target.value);
      setLoginErr("");
    },
    placeholder: "Enter password\u2026",
    style: {
      width: "100%",
      padding: "12px 14px",
      background: "#0f172a",
      border: `1px solid ${loginErr ? "#ef4444" : "#1e293b"}`,
      color: "#f1f5f9",
      borderRadius: 8,
      fontSize: 13,
      fontFamily: "inherit",
      marginBottom: 8
    }
  }), loginErr && /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#ef4444",
      fontSize: 11,
      marginBottom: 8
    }
  }, loginErr), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const team = teams.find(t => t.name === nameInput && t.password === passInput);
      if (team) {
        setCurrentTeam(team);
        setScreen("player");
      } else setLoginErr("Invalid team or password.");
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
      letterSpacing: "0.08em"
    }
  }, "ENTER MARKET \u2192")) : loginTab === "gm" ? /*#__PURE__*/React.createElement("div", {
    style: {
      animation: "fadein 0.3s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      marginBottom: 8
    }
  }, "GM ACCESS"), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: gmPass,
    onChange: e => {
      setGmPass(e.target.value);
      setLoginErr("");
    },
    placeholder: "GM password\u2026",
    style: {
      width: "100%",
      padding: "12px 14px",
      background: "#0f172a",
      border: `1px solid ${loginErr ? "#ef4444" : "#1e293b"}`,
      color: "#f1f5f9",
      borderRadius: 8,
      fontSize: 13,
      fontFamily: "inherit",
      marginBottom: 8
    }
  }), loginErr && /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#ef4444",
      fontSize: 11,
      marginBottom: 8
    }
  }, loginErr), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (gmPass === GM_PASSWORD) setScreen("gm");else setLoginErr("Incorrect GM password.");
    },
    style: {
      width: "100%",
      padding: "13px",
      background: "linear-gradient(135deg,#7c2d12,#dc2626)",
      border: "none",
      borderRadius: 9,
      color: "#fff",
      fontSize: 13,
      fontWeight: 800,
      cursor: "pointer",
      fontFamily: "inherit",
      letterSpacing: "0.08em"
    }
  }, "\u26A1 ENTER GM PANEL \u2192")) : /*#__PURE__*/React.createElement("div", {
    style: {
      animation: "fadein 0.3s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0a0f1e",
      border: "1px solid #1e293b",
      borderRadius: 10,
      padding: "16px 18px",
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\uD83D\uDCFA"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 800,
      fontSize: 14,
      color: "#38bdf8"
    }
  }, "CENTRAL DISPLAY")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#475569",
      lineHeight: 1.7,
      marginBottom: 12
    }
  }, "The Central Display is a separate screen for projectors or main screens. Open it in a new tab and enter the password below to launch."), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#020817",
      borderRadius: 8,
      padding: "12px 14px",
      border: "1px solid #38bdf830"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155",
      letterSpacing: "0.15em",
      marginBottom: 6
    }
  }, "DISPLAY PASSWORD"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: 28,
      color: "#38bdf8",
      letterSpacing: "0.1em"
    }
  }, "BULLPIT2025"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 6,
      marginBottom: 12
    }
  }, [{
    icon: "🏆",
    label: "Live Leaderboard",
    desc: "2-col, auto-updating"
  }, {
    icon: "📡",
    label: "Trade Stream",
    desc: "Real-time buy/sell feed"
  }, {
    icon: "🚨",
    label: "Disruption News",
    desc: "AI-generated events"
  }, {
    icon: "⏳",
    label: "Round Timer",
    desc: "Countdown + phase status"
  }].map(f => /*#__PURE__*/React.createElement("div", {
    key: f.label,
    style: {
      background: "#0a0f1e",
      border: "1px solid #1e293b",
      borderRadius: 7,
      padding: "8px 10px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      marginBottom: 3
    }
  }, f.icon, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: "#64748b",
      fontWeight: 700
    }
  }, f.label)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155"
    }
  }, f.desc)))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#334155",
      textAlign: "center",
      padding: "8px",
      background: "#0a0f1e",
      borderRadius: 6,
      border: "1px solid #1e293b"
    }
  }, "Open central-display.jsx in a separate browser tab"))));

  // ─── GM BUTTON STYLE HELPER ───────────────────────────────────────────────
  const gmBtn = (bg, col, enabled = true) => ({
    padding: "9px 10px",
    background: enabled ? bg : "#0f172a",
    border: `1px solid ${enabled ? col + "55" : "#1e293b"}`,
    color: enabled ? col : "#334155",
    borderRadius: 6,
    cursor: enabled ? "pointer" : "not-allowed",
    fontFamily: "inherit",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.06em",
    opacity: enabled ? 1 : 0.45,
    transition: "opacity 0.2s"
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GM SCREEN
  // ════════════════════════════════════════════════════════════════════════════
  if (screen === "gm") return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      background: "#020817",
      fontFamily: "'JetBrains Mono','Courier New',monospace",
      color: "#f1f5f9",
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("style", null, CSS), showCeremony && /*#__PURE__*/React.createElement(WinnerCeremony, {
    ranked: winnerRanked,
    teams: teams,
    roundNum: roundNum,
    totalRounds: TOTAL_ROUNDS,
    generating: generating,
    onNext: generateDisruption
  }), showEmergency && /*#__PURE__*/React.createElement(EmergencyModal, {
    events: disruptions,
    bufferLeft: bufferLeft,
    onApply: applyDisruption,
    onClose: startNextRound
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 20px",
      borderBottom: "1px solid #1e293b",
      background: "linear-gradient(90deg,#0a0518,#020817)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: 28,
      background: "linear-gradient(135deg,#f59e0b,#ef4444)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent"
    }
  }, "BULL PIT"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      letterSpacing: "0.12em"
    }
  }, "GAME MASTER"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4
    }
  }, Array.from({
    length: TOTAL_ROUNDS
  }, (_, i) => {
    const rn = i + 1,
      done = rn < roundNum,
      active = rn === roundNum;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        width: active ? 20 : 12,
        height: 12,
        borderRadius: 6,
        background: done ? "#00f5c4" : active ? "#fbbf24" : "#1e293b",
        border: active ? "2px solid #fbbf24" : "2px solid transparent",
        transition: "all 0.3s"
      }
    });
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: "#fbbf24",
      fontWeight: 700
    }
  }, "R", roundNum, "/", TOTAL_ROUNDS, " \xB7 ", gamePhase.toUpperCase()), timerMins != null && gamePhase === "running" && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: 22,
      color: timerMins < 3 ? "#ef4444" : "#f1f5f9"
    }
  }, String(timerMins).padStart(2, "0"), ":", String(timerSecs).padStart(2, "0")), bufMins != null && gamePhase === "buffer" && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: "#38bdf8"
    }
  }, "BUFFER ", String(bufMins).padStart(2, "0"), ":", String(bufSecs).padStart(2, "0")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setScreen("login"),
    style: {
      padding: "6px 14px",
      background: "#1e293b",
      border: "1px solid #334155",
      color: "#94a3b8",
      borderRadius: 6,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 11
    }
  }, "\u2190 EXIT"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "290px 1fr",
      flex: 1,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      borderRight: "1px solid #1e293b",
      display: "flex",
      flexDirection: "column",
      overflowY: "auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      borderBottom: "1px solid #1e293b"
    }
  }, ["control", "market", "teams", "broadcast"].map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    onClick: () => setGmTab(t),
    style: {
      flex: 1,
      padding: "8px 2px",
      background: "none",
      border: "none",
      color: gmTab === t ? "#f59e0b" : "#475569",
      cursor: "pointer",
      borderBottom: gmTab === t ? "2px solid #f59e0b" : "2px solid transparent",
      fontSize: 9,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      fontFamily: "inherit",
      fontWeight: gmTab === t ? 700 : 400
    }
  }, t))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 14,
      flex: 1
    }
  }, gmTab === "control" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, gamePhase === "running" && (() => {
    const rules = ROUND_RULES[roundNum - 1] || ROUND_RULES[0];
    return /*#__PURE__*/React.createElement("div", {
      style: {
        background: `linear-gradient(135deg,${rules.color}22,${rules.color}08)`,
        border: `1px solid ${rules.color}55`,
        borderRadius: 10,
        padding: "10px 14px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 6
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 20
      }
    }, rules.icon), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Syne',sans-serif",
        fontWeight: 800,
        fontSize: 14,
        color: rules.color
      }
    }, rules.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: "#64748b"
      }
    }, "Round ", roundNum, " of ", TOTAL_ROUNDS)), /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: "auto",
        display: "flex",
        gap: 6
      }
    }, rules.tax && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        padding: "2px 6px",
        borderRadius: 4,
        background: "#fbbf2422",
        border: "1px solid #fbbf2440",
        color: "#fbbf24",
        fontWeight: 700
      }
    }, "TAX ROUND"), rules.liquidate && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        padding: "2px 6px",
        borderRadius: 4,
        background: "#ef444422",
        border: "1px solid #ef444440",
        color: "#ef4444",
        fontWeight: 700
      }
    }, "LIQUIDATION"), rules.leaderHidden && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        padding: "2px 6px",
        borderRadius: 4,
        background: "#a78bfa22",
        border: "1px solid #a78bfa40",
        color: "#a78bfa",
        fontWeight: 700
      }
    }, "HIDDEN LB"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        padding: "2px 6px",
        borderRadius: 4,
        background: "#38bdf822",
        border: "1px solid #38bdf840",
        color: "#38bdf8",
        fontWeight: 700
      }
    }, rules.volMult, "\xD7 VOL"))), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: "#64748b",
        lineHeight: 1.5
      }
    }, rules.briefing));
  })(), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0f172a",
      border: "1px solid #1e293b",
      borderRadius: 8,
      padding: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      letterSpacing: "0.1em"
    }
  }, "POWER-UP CARDS"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "#334155"
    }
  }, 4 - usedCards.size, " remaining")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 5
    }
  }, POWERUP_CARDS.map(card => {
    const used = usedCards.has(card.id);
    return /*#__PURE__*/React.createElement("button", {
      key: card.id,
      onClick: () => gmCmd("powerup", {
        id: card.id
      }),
      disabled: used || gamePhase !== "running",
      style: {
        padding: "8px 6px",
        background: used ? "#0a0f1e" : `${card.color}15`,
        border: `1px solid ${used ? "#1e293b" : card.color + "55"}`,
        borderRadius: 7,
        cursor: used ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        opacity: used ? 0.35 : 1,
        textAlign: "left"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        marginBottom: 2
      }
    }, card.icon), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: used ? "#334155" : card.color,
        fontWeight: 700
      }
    }, card.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 8,
        color: "#475569",
        lineHeight: 1.4,
        marginTop: 2
      }
    }, card.desc), used && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 8,
        color: "#ef4444",
        marginTop: 2
      }
    }, "USED"));
  })), /*#__PURE__*/React.createElement("button", {
    onClick: () => gmCmd("openPrediction"),
    disabled: predictionOpen || gamePhase !== "running",
    style: {
      width: "100%",
      marginTop: 6,
      padding: "7px",
      fontSize: 9,
      fontWeight: 700,
      background: predictionOpen ? "#0f172a" : "rgba(0,245,196,0.1)",
      border: `1px solid ${predictionOpen ? "#1e293b" : "#00f5c4"}`,
      color: predictionOpen ? "#334155" : "#00f5c4",
      borderRadius: 6,
      cursor: predictionOpen ? "not-allowed" : "pointer",
      fontFamily: "inherit"
    }
  }, predictionOpen ? "🎯 Prediction Market OPEN" : "🎯 Open Prediction Market")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowRulebook(true),
    style: {
      width: "100%",
      padding: "8px",
      background: "rgba(168,139,250,0.1)",
      border: "1px solid #a78bfa44",
      borderRadius: 8,
      color: "#a78bfa",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 10,
      fontWeight: 700
    }
  }, "\uD83D\uDCD6 GM RULEBOOK"), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0f172a",
      border: "1px solid #1e293b",
      borderRadius: 8,
      padding: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      letterSpacing: "0.1em",
      marginBottom: 8
    }
  }, "COMPETITION SCHEDULE"), roundDurations.map((dur, i) => {
    const rn = i + 1;
    const done = rn < roundNum;
    const active = rn === roundNum && gamePhase === "running";
    const mins = Math.floor(dur / 60);
    const label = ROUND_LABELS[i];
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 0",
        borderBottom: i < 6 ? "1px solid #0f172a" : "none",
        opacity: done ? 0.4 : 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 10,
        height: 10,
        borderRadius: "50%",
        flexShrink: 0,
        background: done ? "#00f5c4" : active ? "#fbbf24" : "#1e293b",
        border: active ? "2px solid #fbbf24" : "none",
        boxShadow: active ? "0 0 6px #fbbf24" : "none"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        fontSize: 9,
        color: active ? "#fbbf24" : done ? "#334155" : "#64748b"
      }
    }, label), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 3
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "number",
      min: 1,
      max: 30,
      value: mins,
      onChange: e => {
        const v = Math.max(1, Math.min(30, +e.target.value || 1));
        setRoundDurations(prev => {
          const next = [...prev];
          next[i] = v * 60;
          return next;
        });
      },
      style: {
        width: 34,
        padding: "2px 4px",
        textAlign: "center",
        background: "#020817",
        border: `1px solid ${active ? "#fbbf24" : "#1e293b"}`,
        color: active ? "#fbbf24" : "#f1f5f9",
        borderRadius: 4,
        fontFamily: "inherit",
        fontSize: 11,
        opacity: done ? 0.4 : 1
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        color: "#334155"
      }
    }, "m")), done && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        color: "#00f5c4"
      }
    }, "\u2713"));
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      paddingTop: 8,
      borderTop: "1px solid #1e293b",
      fontSize: 9,
      color: "#334155"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      marginBottom: 2
    }
  }, /*#__PURE__*/React.createElement("span", null, "Play time"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#64748b"
    }
  }, Math.floor(roundDurations.reduce((a, b) => a + b, 0) / 60), "m")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      marginBottom: 2
    }
  }, /*#__PURE__*/React.createElement("span", null, "Buffer time (\xD76)"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#64748b"
    }
  }, Math.round(BUFFER_SECS / 60 * 6), "m")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontWeight: 700
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#94a3b8"
    }
  }, "Total"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#fbbf24"
    }
  }, "~", Math.ceil((roundDurations.reduce((a, b) => a + b, 0) + BUFFER_SECS * 6) / 60), "m")))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0f172a",
      border: "1px solid #1e293b",
      borderRadius: 8,
      padding: "8px 10px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      letterSpacing: "0.1em"
    }
  }, "CURRENT ROUND"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "#f1f5f9",
      fontWeight: 700,
      marginTop: 2
    }
  }, ROUND_LABELS[roundNum - 1] || `Round ${roundNum}`)), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      letterSpacing: "0.1em"
    }
  }, "DURATION"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: 22,
      color: roundNum <= 1 ? "#00f5c4" : roundNum <= 4 ? "#38bdf8" : "#f472b6"
    }
  }, Math.floor(roundDur / 60), ":00"))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0f172a",
      border: "1px solid #7c3aed44",
      borderRadius: 8,
      padding: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#a78bfa",
      letterSpacing: "0.1em",
      marginBottom: 8,
      fontWeight: 700
    }
  }, "\uD83C\uDFDB POLITICAL SHOCK \u2014 MULTI-SECTOR EVENT"), /*#__PURE__*/React.createElement("select", {
    value: polEventIdx,
    onChange: e => setPolEventIdx(+e.target.value),
    style: {
      width: "100%",
      padding: "8px 10px",
      background: "#060c18",
      border: "1px solid #7c3aed55",
      color: "#e9d5ff",
      borderRadius: 6,
      fontFamily: "inherit",
      fontSize: 10,
      marginBottom: 8,
      cursor: "pointer",
      outline: "none"
    }
  }, POLITICAL_EVENTS.map((ev, i) => /*#__PURE__*/React.createElement("option", {
    key: ev.id,
    value: i,
    style: {
      background: "#0f172a"
    }
  }, ev.icon, " ", ev.name))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#020817",
      borderRadius: 6,
      padding: "8px 10px",
      marginBottom: 8,
      border: "1px solid #7c3aed33"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "#7c3aed",
      fontWeight: 700,
      marginBottom: 4
    }
  }, "GM ONLY \u2014 ECONOMIC CONCEPT"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#64748b",
      lineHeight: 1.6,
      marginBottom: 6
    }
  }, POLITICAL_EVENTS[polEventIdx]?.concept), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 3
    }
  }, Object.entries(POLITICAL_EVENTS[polEventIdx]?.sectors || {}).map(([sid, impact]) => {
    const sec = SECTORS.find(s => s.id === sid);
    if (!sec) return null;
    const col = impact > 0 ? "#00f5c4" : "#ef4444";
    return /*#__PURE__*/React.createElement("span", {
      key: sid,
      style: {
        fontSize: 8,
        padding: "1px 5px",
        borderRadius: 3,
        fontWeight: 700,
        background: `${col}15`,
        border: `1px solid ${col}40`,
        color: col
      }
    }, sec.icon, " ", impact > 0 ? "+" : "", impact, "%");
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0a0f1e",
      borderRadius: 6,
      padding: "8px 10px",
      marginBottom: 8,
      border: "1px solid #1e293b"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      marginBottom: 4
    }
  }, "WHAT TEAMS WILL SEE"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#f1f5f9",
      fontWeight: 700,
      lineHeight: 1.5
    }
  }, POLITICAL_EVENTS[polEventIdx]?.headline), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#64748b",
      marginTop: 3,
      lineHeight: 1.4
    }
  }, POLITICAL_EVENTS[polEventIdx]?.subheadline)), /*#__PURE__*/React.createElement("button", {
    onClick: () => generatePoliticalDisruption(polEventIdx),
    disabled: generatingPol || !["idle", "ceremony", "running"].includes(gamePhase),
    style: {
      width: "100%",
      padding: "9px 6px",
      background: generatingPol ? "#0f172a" : "linear-gradient(135deg,#3b0764,#1e1b4b)",
      border: `1px solid ${generatingPol ? "#1e293b" : "#7c3aed"}`,
      color: generatingPol ? "#334155" : "#c4b5fd",
      borderRadius: 6,
      cursor: generatingPol ? "wait" : "pointer",
      fontFamily: "inherit",
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: "0.06em"
    }
  }, generatingPol ? "🔄 GENERATING POLITICAL SHOCK…" : "🏛 FIRE POLITICAL SHOCK")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: generateDisruption,
    disabled: generating || !["idle", "ceremony"].includes(gamePhase),
    style: {
      ...gmBtn("#450a0a", "#ef4444", ["idle", "ceremony"].includes(gamePhase) && !generating),
      gridColumn: "1/-1",
      fontSize: 11,
      letterSpacing: "0.06em"
    }
  }, generating ? "🔄 GENERATING…" : `🚨 GENERATE DISRUPTION ${roundNum === 1 && gamePhase === "idle" ? "→ LAUNCH R1" : `→ LAUNCH R${roundNum + 1}`}`), [{
    l: "⏸ PAUSE",
    c: "pause",
    col: "#fbbf24",
    bg: "#713f12",
    en: gamePhase === "running"
  }, {
    l: "▶ RESUME",
    c: "resume",
    col: "#38bdf8",
    bg: "#0c4a6e",
    en: gamePhase === "paused"
  }, {
    l: "■ STOP",
    c: "stop",
    col: "#ef4444",
    bg: "#7f1d1d",
    en: !["idle", "ended", "predisruption"].includes(gamePhase)
  }, {
    l: "⏭ END ROUND",
    c: "forceEnd",
    col: "#a78bfa",
    bg: "#3b0764",
    en: gamePhase === "running"
  }, {
    l: "🔄 RESET",
    c: "reset",
    col: "#64748b",
    bg: "#1e293b",
    en: true
  }, {
    l: "⚡ RELAUNCH",
    c: "relaunch",
    col: "#00f5c4",
    bg: "#064e3b",
    en: gamePhase === "predisruption"
  }].map(b => /*#__PURE__*/React.createElement("button", {
    key: b.c,
    onClick: b.c === "relaunch" ? () => {
      setShowBlast(true);
    } : () => gmCmd(b.c),
    disabled: !b.en,
    style: gmBtn(b.bg, b.col, b.en)
  }, b.l))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid #1e293b",
      paddingTop: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      marginBottom: 6
    }
  }, "STARTING CASH (per team)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: initCash,
    onChange: e => setInitCash(+e.target.value),
    style: {
      flex: 1,
      padding: "7px 9px",
      background: "#0f172a",
      border: "1px solid #1e293b",
      color: "#f1f5f9",
      borderRadius: 5,
      fontFamily: "inherit",
      fontSize: 13
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => gmCmd("setInitCash", {
      cash: initCash
    }),
    style: {
      padding: "7px 10px",
      background: "#1e293b",
      border: "1px solid #334155",
      color: "#94a3b8",
      borderRadius: 5,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 10,
      fontWeight: 700
    }
  }, "SET"))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0f172a",
      borderRadius: 8,
      padding: 10,
      fontSize: 10,
      color: "#64748b",
      lineHeight: 1.9
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#fbbf24",
      fontWeight: 700,
      marginBottom: 4
    }
  }, "5-PILLAR SCORING"), /*#__PURE__*/React.createElement("div", null, "35% \u2013 Total Return %"), /*#__PURE__*/React.createElement("div", null, "25% \u2013 Sharpe (Return/Drawdown)"), /*#__PURE__*/React.createElement("div", null, "20% \u2013 Sector Diversification (7 max)"), /*#__PURE__*/React.createElement("div", null, "10% \u2013 Win Rate on closed trades"), /*#__PURE__*/React.createElement("div", null, "10% \u2013 Capital Efficiency"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      borderTop: "1px solid #1e293b",
      paddingTop: 6,
      color: "#334155"
    }
  }, "Buffer: ", BUFFER_SECS, "s between rounds"))), gmTab === "market" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0f172a",
      border: "1px solid #1e293b",
      borderRadius: 8,
      padding: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      letterSpacing: "0.1em",
      marginBottom: 7
    }
  }, "GLOBAL SENTIMENT"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 5
    }
  }, [["bull", "📈 BULL", "#00f5c4"], ["bear", "📉 BEAR", "#ef4444"], ["volatile", "⚡ VOLATILE", "#fbbf24"], ["neutral", "〰 NEUTRAL", "#64748b"]].map(([s, l, c]) => /*#__PURE__*/React.createElement("button", {
    key: s,
    onClick: () => gmCmd("sentiment", {
      s
    }),
    style: {
      ...gmBtn(sentiment === s ? "#1e293b" : "#0f172a", c, true),
      border: `1px solid ${sentiment === s ? c : "#1e293b"}`
    }
  }, l)))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0f172a",
      border: "1px solid #1e293b",
      borderRadius: 8,
      padding: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 9
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      letterSpacing: "0.1em"
    }
  }, "SECTOR COMMAND"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setSelectedSectors(new Set(SECTORS.map(s => s.id))),
    style: {
      padding: "2px 8px",
      background: "#1e293b",
      border: "1px solid #334155",
      color: "#94a3b8",
      borderRadius: 4,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 9
    }
  }, "ALL"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setSelectedSectors(new Set()),
    style: {
      padding: "2px 8px",
      background: "#1e293b",
      border: "1px solid #334155",
      color: "#64748b",
      borderRadius: 4,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 9
    }
  }, "NONE"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 5,
      marginBottom: 9
    }
  }, SECTORS.map(sec => {
    const isSel = selectedSectors.has(sec.id);
    const bias = sectorBiases[sec.id];
    const biasColor = bias === "bull" ? "#00f5c4" : bias === "bear" ? "#ef4444" : bias === "volatile" ? "#fbbf24" : "#334155";
    const isAutoOn = activeDisruptSectors.has(sec.id);
    return /*#__PURE__*/React.createElement("div", {
      key: sec.id,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: isSel ? `${sec.color}12` : "#060c18",
        border: `1px solid ${isSel ? sec.color + "60" : "#111827"}`,
        borderRadius: 7,
        padding: "5px 8px",
        cursor: "pointer",
        transition: "all 0.15s"
      },
      onClick: () => setSelectedSectors(prev => {
        const n = new Set(prev);
        n.has(sec.id) ? n.delete(sec.id) : n.add(sec.id);
        return n;
      })
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 14,
        height: 14,
        borderRadius: 3,
        background: isSel ? sec.color : "#1e293b",
        border: `1px solid ${isSel ? sec.color : "#334155"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 9,
        color: "#020817",
        flexShrink: 0
      }
    }, isSel && "✓"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9
      }
    }, sec.icon), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        color: isSel ? sec.color : "#475569",
        fontWeight: isSel ? 700 : 400,
        flex: 1
      }
    }, sec.label), bias !== "neutral" && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 8,
        padding: "1px 5px",
        borderRadius: 3,
        background: `${biasColor}18`,
        color: biasColor,
        fontWeight: 700
      }
    }, bias.toUpperCase()), isAutoOn && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 8,
        color: "#a78bfa",
        animation: "pulse 1s infinite"
      }
    }, "\u26A1AUTO"));
  })), selectedSectors.size > 0 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: "#334155",
      marginBottom: 5,
      letterSpacing: "0.08em"
    }
  }, "APPLY TO ", selectedSectors.size, " SELECTED SECTOR", selectedSectors.size > 1 ? "S" : ""), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 5,
      marginBottom: 8
    }
  }, [{
    k: "bull",
    l: "📈 BULLISH",
    c: "#00f5c4",
    bg: "#064e3b"
  }, {
    k: "bear",
    l: "📉 BEARISH",
    c: "#ef4444",
    bg: "#7f1d1d"
  }, {
    k: "volatile",
    l: "⚡ VOLATILE",
    c: "#fbbf24",
    bg: "#713f12"
  }, {
    k: "neutral",
    l: "〰 NEUTRAL",
    c: "#64748b",
    bg: "#1e293b"
  }].map(b => /*#__PURE__*/React.createElement("button", {
    key: b.k,
    onClick: () => {
      const updates = {};
      selectedSectors.forEach(id => {
        updates[id] = b.k;
      });
      setSectorBiases(prev => ({
        ...prev,
        ...updates
      }));
    },
    style: {
      padding: "7px 4px",
      background: b.bg,
      border: `1px solid ${b.c}44`,
      color: b.c,
      borderRadius: 5,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: "0.04em"
    }
  }, b.l))), /*#__PURE__*/React.createElement("button", {
    disabled: !!generatingSector,
    onClick: async () => {
      for (const sectorId of selectedSectors) {
        const bias = sectorBiases[sectorId];
        await generateSectorNews(sectorId, bias === "neutral" ? "volatile" : bias);
      }
    },
    style: {
      width: "100%",
      padding: "9px 6px",
      background: generatingSector ? "#0f172a" : "linear-gradient(135deg,#1e3a5f,#0f172a)",
      border: `1px solid ${generatingSector ? "#1e293b" : "#38bdf8"}`,
      color: generatingSector ? "#334155" : "#38bdf8",
      borderRadius: 6,
      cursor: generatingSector ? "wait" : "pointer",
      fontFamily: "inherit",
      fontSize: 10,
      fontWeight: 700,
      marginBottom: 5
    }
  }, generatingSector ? `🔄 Generating for ${SECTORS.find(s => s.id === generatingSector)?.label}…` : `🤖 GENERATE AI NEWS for ${selectedSectors.size} sector${selectedSectors.size > 1 ? "s" : ""}`), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setActiveDisruptSectors(prev => {
        const n = new Set(prev);
        const allOn = [...selectedSectors].every(id => n.has(id));
        selectedSectors.forEach(id => allOn ? n.delete(id) : n.add(id));
        return n;
      });
    },
    style: {
      width: "100%",
      padding: "7px 6px",
      background: "#1e293b",
      border: "1px solid #334155",
      color: "#a78bfa",
      borderRadius: 6,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 9,
      fontWeight: 700
    }
  }, [...selectedSectors].every(id => activeDisruptSectors.has(id)) ? "⏹ STOP AUTOMATION" : "⚡ AUTO-REPEAT NEWS"))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0f172a",
      border: "1px solid #1e293b",
      borderRadius: 8,
      padding: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      letterSpacing: "0.1em",
      marginBottom: 7
    }
  }, "SINGLE STOCK SHOCK"), /*#__PURE__*/React.createElement("select", {
    value: shockTicker,
    onChange: e => setShockTicker(e.target.value),
    style: {
      width: "100%",
      padding: "7px",
      background: "#060c18",
      border: "1px solid #1e293b",
      color: "#f1f5f9",
      borderRadius: 5,
      fontFamily: "inherit",
      fontSize: 10,
      marginBottom: 7
    }
  }, SECTORS.map(sec => /*#__PURE__*/React.createElement("optgroup", {
    key: sec.id,
    label: `${sec.icon} ${sec.label}`
  }, sec.stocks.map(st => /*#__PURE__*/React.createElement("option", {
    key: st.ticker,
    value: st.ticker
  }, st.ticker, " \u2014 ", st.name))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 7,
      alignItems: "center",
      marginBottom: 7
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "range",
    min: -60,
    max: 60,
    value: shockPct,
    onChange: e => setShockPct(+e.target.value),
    style: {
      flex: 1,
      accentColor: shockPct >= 0 ? "#00f5c4" : "#ef4444"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 46,
      textAlign: "right",
      fontWeight: 700,
      fontSize: 11,
      color: shockPct >= 0 ? "#00f5c4" : "#ef4444"
    }
  }, shockPct >= 0 ? "+" : "", shockPct, "%")), /*#__PURE__*/React.createElement("button", {
    onClick: () => gmCmd("shock", {
      ticker: shockTicker,
      pct: shockPct
    }),
    style: {
      ...gmBtn(shockPct >= 0 ? "#064e3b" : "#7f1d1d", shockPct >= 0 ? "#00f5c4" : "#ef4444"),
      padding: "8px"
    }
  }, "\u26A1 SHOCK ", shockTicker))), gmTab === "teams" && /*#__PURE__*/React.createElement(TeamEditor, {
    teams: teams,
    onSave: t => {
      setTeams(t);
      pushTeams(t);
    }
  }), gmTab === "broadcast" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      letterSpacing: "0.1em"
    }
  }, "BROADCAST TO ALL"), /*#__PURE__*/React.createElement(BroadcastInline, {
    onSend: text => gmCmd("broadcast", {
      text
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      borderTop: "1px solid #1e293b",
      paddingTop: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#ef4444",
      letterSpacing: "0.1em",
      marginBottom: 8
    }
  }, "\uD83D\uDEA8 DISRUPTION NEWS UPDATE"), /*#__PURE__*/React.createElement(ManualDisruption, {
    stocks: ALL_STOCKS,
    prices: prices,
    onPublish: async events => {
      setDisruptions(events);
      await pushDisrupts(events);
      setShowEmergency(true);
      sendBcast("🚨 BREAKING: New market disruption bulletin released!");
    }
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      overflowY: "auto",
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 360px",
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      letterSpacing: "0.1em",
      marginBottom: 12
    }
  }, "MARKET OVERVIEW \xB7 ", ALL_STOCKS.length, " STOCKS"), SECTORS.map(sec => {
    const bias = sectorBiases[sec.id];
    const biasColor = bias === "bull" ? "#00f5c4" : bias === "bear" ? "#ef4444" : bias === "volatile" ? "#fbbf24" : "#334155";
    const isAuto = activeDisruptSectors.has(sec.id);
    const isSelected = selectedSectors.has(sec.id);
    const secNews = sectorDisruptions[sec.id] || [];
    return /*#__PURE__*/React.createElement("div", {
      key: sec.id,
      style: {
        marginBottom: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 7,
        padding: "6px 8px",
        borderRadius: 7,
        background: isSelected ? `${sec.color}10` : "transparent",
        border: `1px solid ${isSelected ? sec.color + "40" : "transparent"}`,
        cursor: "pointer"
      },
      onClick: () => setSelectedSectors(prev => {
        const n = new Set(prev);
        n.has(sec.id) ? n.delete(sec.id) : n.add(sec.id);
        return n;
      })
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13
      }
    }, sec.icon), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 700,
        color: isSelected ? sec.color : sec.color + "99",
        fontSize: 11
      }
    }, sec.label), bias !== "neutral" && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 8,
        padding: "1px 6px",
        borderRadius: 3,
        fontWeight: 800,
        background: `${biasColor}18`,
        border: `1px solid ${biasColor}40`,
        color: biasColor
      }
    }, bias.toUpperCase()), isAuto && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        color: "#a78bfa",
        animation: "pulse 1s infinite"
      }
    }, "\u26A1AUTO"), generatingSector === sec.id && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        color: "#38bdf8",
        animation: "pulse 0.5s infinite"
      }
    }, "\uD83D\uDD04"), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        height: 1,
        background: "#111827"
      }
    }), isSelected && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        color: sec.color,
        fontWeight: 700
      }
    }, "\u2713 SELECTED")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(5,1fr)",
        gap: 5
      }
    }, sec.stocks.map(st => {
      const p = prices[st.ticker] || 0,
        prev = prevPrices[st.ticker] || p;
      const chg = (p - prev) / (prev || 1) * 100;
      const hasNews = secNews.find(e => e.ticker === st.ticker);
      return /*#__PURE__*/React.createElement("div", {
        key: st.ticker,
        style: {
          background: "#0a0f1e",
          border: `1px solid ${hasNews ? hasNews.impact > 0 ? "#00f5c440" : "#ef444440" : "#111827"}`,
          borderRadius: 8,
          padding: "7px 9px",
          boxShadow: hasNews ? `0 0 8px ${hasNews.impact > 0 ? "#00f5c420" : "#ef444420"}` : "none"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 700,
          color: sec.color,
          fontSize: 10
        }
      }, st.ticker), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 8,
          color: "#1e293b",
          marginBottom: 3,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis"
        }
      }, st.name), /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 700,
          fontSize: 11
        }
      }, fmtUSD(p)), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 9,
          color: chg >= 0 ? "#00f5c4" : "#ef4444"
        }
      }, chg >= 0 ? "▲" : "▼", fmt(Math.abs(chg)), "%"), hasNews && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 7,
          color: hasNews.impact > 0 ? "#00f5c4" : "#ef4444",
          marginTop: 3,
          lineHeight: 1.3,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }
      }, hasNews.impact > 0 ? "+" : "", hasNews.impact, "% \xB7 ", hasNews.headline?.slice(0, 30), "\u2026"));
    })), secNews.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 5,
        padding: "5px 8px",
        background: "#060c18",
        borderRadius: 6,
        borderLeft: `3px solid ${biasColor}`
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: biasColor,
        fontWeight: 700,
        marginBottom: 3
      }
    }, sec.icon, " ACTIVE DISRUPTION"), secNews.slice(0, 2).map((n, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        fontSize: 9,
        color: "#64748b",
        lineHeight: 1.4
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: n.impact > 0 ? "#00f5c4" : "#ef4444"
      }
    }, n.ticker, " ", n.impact > 0 ? "+" : "", n.impact, "%"), " — ", n.headline))));
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      letterSpacing: "0.1em",
      marginBottom: 12
    }
  }, "LEADERBOARD"), /*#__PURE__*/React.createElement(LeaderboardPanel, {
    entries: sharedLB,
    teams: teams,
    initCash: initCash,
    highlight: "",
    showDetail: true
  }))))));

  // ════════════════════════════════════════════════════════════════════════════
  // PLAYER SCREEN
  // ════════════════════════════════════════════════════════════════════════════
  const roundEndActive = ["ceremony", "buffer", "disruption", "ended"].includes(gamePhase);
  const pnlColor = analytics.totalPnL >= 0 ? "#00f5c4" : "#ef4444";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      background: "#020817",
      color: "#f1f5f9",
      fontFamily: "'JetBrains Mono','Courier New',monospace",
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("style", null, CSS), isFrozen && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 8900,
      background: "linear-gradient(90deg,#0c4a6e,#020817)",
      border: "2px solid #38bdf8",
      padding: "10px 20px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      fontFamily: "'JetBrains Mono',monospace"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 22
    }
  }, "\uD83E\uDDCA"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#38bdf8",
      fontWeight: 800,
      fontSize: 13
    }
  }, "TRADING FROZEN"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#64748b",
      fontSize: 10
    }
  }, "GM activated Freeze card \u2014 prices keep moving but you cannot trade")), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#38bdf8",
      fontWeight: 800
    }
  }, "\u23F3 ", frozenUntil ? Math.max(0, Math.ceil((frozenUntil - Date.now()) / 1000)) : 0, "s")), activePowerup && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 9500,
      pointerEvents: "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(2,8,23,0.88)",
      animation: "fadein 0.2s"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      animation: "fadeup 0.3s"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 80,
      marginBottom: 12
    }
  }, activePowerup.icon), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: 52,
      color: activePowerup.color,
      letterSpacing: "0.05em"
    }
  }, activePowerup.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: "#94a3b8",
      marginTop: 8
    }
  }, activePowerup.desc))), taxPending && taxAmount > 0 && screen === "player" && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      bottom: 80,
      right: 20,
      zIndex: 8500,
      background: "linear-gradient(135deg,#7f1d1d,#450a0a)",
      border: "2px solid #ef4444",
      borderRadius: 12,
      padding: "14px 18px",
      fontFamily: "'JetBrains Mono',monospace",
      maxWidth: 280,
      animation: "fadeup 0.4s",
      boxShadow: "0 0 30px rgba(239,68,68,0.4)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#ef4444",
      fontWeight: 800,
      fontSize: 13,
      marginBottom: 4
    }
  }, "\uD83D\uDCB8 ROUND TAX INCOMING"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#94a3b8",
      fontSize: 11,
      lineHeight: 1.6
    }
  }, "20% profit tax at round end:"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#fbbf24",
      fontWeight: 800,
      fontSize: 20,
      marginTop: 4
    }
  }, "\u2212$", taxAmount.toLocaleString()), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#64748b",
      marginTop: 4
    }
  }, "Applied when next round begins")), predictionOpen && !playerPrediction && screen === "player" && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 8800,
      background: "rgba(2,8,23,0.93)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'JetBrains Mono',monospace"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "min(480px,95vw)",
      background: "#0a0f1e",
      border: "2px solid #00f5c4",
      borderRadius: 14,
      padding: "24px",
      animation: "fadeup 0.3s"
    }
  }, (() => {
    const pq = PREDICTION_QUESTIONS.find(q => q.round === roundNum) || PREDICTION_QUESTIONS[0];
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        marginBottom: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 32,
        marginBottom: 6
      }
    }, "\uD83C\uDFAF"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: "'Syne',sans-serif",
        fontWeight: 800,
        fontSize: 16,
        color: "#00f5c4",
        marginBottom: 4
      }
    }, "PREDICTION MARKET"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: "#7c3aed",
        marginBottom: 8,
        padding: "2px 8px",
        borderRadius: 4,
        background: "#7c3aed15",
        display: "inline-block"
      }
    }, "CONCEPT: ", pq.concept), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "#94a3b8",
        lineHeight: 1.6
      }
    }, pq.question), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: "#334155",
        marginTop: 6
      }
    }, "Correct answer = +8% capital bonus at round end")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        marginBottom: 12
      }
    }, pq.options.map(opt => /*#__PURE__*/React.createElement("button", {
      key: opt.id,
      onClick: () => {
        setPlayerPrediction(opt.id);
        setPredictionOpen(false);
      },
      style: {
        padding: "10px 14px",
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 8,
        color: "#94a3b8",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 11,
        textAlign: "left",
        lineHeight: 1.5,
        transition: "all 0.15s"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#00f5c4",
        fontWeight: 700,
        marginRight: 8
      }
    }, opt.id.toUpperCase(), "."), opt.text))), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        fontSize: 9,
        color: "#334155"
      }
    }, "Choose based on economic reasoning \u2014 you cannot change your answer"));
  })())), achievements.length > 0 && achievements.slice(-1).map(ach => /*#__PURE__*/React.createElement("div", {
    key: ach.id,
    style: {
      position: "fixed",
      bottom: 20,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: 8600,
      background: "linear-gradient(135deg,#14532d,#064e3b)",
      border: "2px solid #00f5c4",
      borderRadius: 10,
      padding: "10px 18px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontFamily: "'JetBrains Mono',monospace",
      animation: "fadeup 0.4s",
      boxShadow: "0 0 30px rgba(0,245,196,0.3)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 24
    }
  }, ach.icon), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#00f5c4",
      fontWeight: 800,
      fontSize: 12
    }
  }, "ACHIEVEMENT UNLOCKED: ", ach.name), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#64748b",
      fontSize: 10
    }
  }, ach.desc)))), predResult && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 8700,
      background: "rgba(2,8,23,0.95)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'JetBrains Mono',monospace"
    },
    onClick: () => setPredResult(null)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "min(520px,95vw)",
      background: "#0a0f1e",
      border: `2px solid ${predResult.correct ? "#00f5c4" : "#ef4444"}`,
      borderRadius: 14,
      padding: "28px",
      animation: "fadeup 0.4s"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 48,
      marginBottom: 8
    }
  }, predResult.correct ? "🎯" : "❌"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontWeight: 800,
      fontSize: 20,
      color: predResult.correct ? "#00f5c4" : "#ef4444",
      marginBottom: 4
    }
  }, predResult.correct ? "CORRECT!" : "INCORRECT"), predResult.correct && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: "#fbbf24",
      fontWeight: 700
    }
  }, "+$", predResult.bonus.toLocaleString(), " bonus applied!")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#060c18",
      borderRadius: 8,
      padding: "14px",
      marginBottom: 14,
      border: "1px solid #1e293b"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      marginBottom: 6
    }
  }, "CORRECT ANSWER"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "#f1f5f9",
      lineHeight: 1.6
    }
  }, predResult.answer)), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#060c18",
      borderRadius: 8,
      padding: "14px",
      border: "1px solid #7c3aed44"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#7c3aed",
      fontWeight: 700,
      marginBottom: 6
    }
  }, "ECONOMIC EXPLANATION"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#94a3b8",
      lineHeight: 1.7
    }
  }, predResult.explanation)), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginTop: 14,
      fontSize: 9,
      color: "#334155"
    }
  }, "Tap anywhere to continue"))), gamePhase === "running" && (() => {
    const rules = ROUND_RULES[roundNum - 1] || ROUND_RULES[0];
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 7000,
        background: `${rules.color}18`,
        borderTop: `2px solid ${rules.color}55`,
        padding: "6px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "'JetBrains Mono',monospace"
      }
    }, /*#__PURE__*/React.createElement("span", null, rules.icon), /*#__PURE__*/React.createElement("span", {
      style: {
        color: rules.color,
        fontWeight: 800,
        fontSize: 11
      }
    }, rules.name), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#475569",
        fontSize: 9
      }
    }, rules.briefing), rules.tax && /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 9,
        padding: "2px 6px",
        background: "#ef444420",
        border: "1px solid #ef444440",
        color: "#ef4444",
        borderRadius: 4,
        fontWeight: 700
      }
    }, "TAX ROUND"), rules.liquidate && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        padding: "2px 6px",
        background: "#ef444420",
        border: "1px solid #ef444440",
        color: "#ef4444",
        borderRadius: 4,
        fontWeight: 700
      }
    }, "LIQUIDATION"), playerPrediction && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        padding: "2px 6px",
        background: "#00f5c420",
        border: "1px solid #00f5c440",
        color: "#00f5c4",
        borderRadius: 4
      }
    }, "Predicted: ", SECTORS.find(s => s.id === playerPrediction)?.icon, " ", playerPrediction));
  })(), broadcast && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: "linear-gradient(135deg,#0c4a6e,#0f172a)",
      borderBottom: "2px solid #38bdf8",
      padding: "12px 20px",
      animation: "slidedown 0.4s ease",
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "\uD83D\uDCE2"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#e0f2fe",
      fontWeight: 600,
      fontSize: 12
    }
  }, broadcast.text), /*#__PURE__*/React.createElement("button", {
    onClick: () => setBroadcast(null),
    style: {
      marginLeft: "auto",
      background: "none",
      border: "none",
      color: "#94a3b8",
      cursor: "pointer",
      fontSize: 16
    }
  }, "\xD7")), roundEndActive && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 400,
      background: "rgba(2,8,23,0.9)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Syne',sans-serif",
      fontSize: 36,
      fontWeight: 900,
      color: gamePhase === "buffer" ? "#38bdf8" : "#fbbf24"
    }
  }, gamePhase === "ended" ? "🏆 COMPETITION OVER" : gamePhase === "buffer" ? "⏳ BUFFER PERIOD" : "ROUND COMPLETE"), gamePhase === "buffer" && bufMins != null && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: 48,
      color: "#38bdf8"
    }
  }, String(bufMins).padStart(2, "0"), ":", String(bufSecs).padStart(2, "0")), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 400
    }
  }, /*#__PURE__*/React.createElement(LeaderboardPanel, {
    entries: sharedLB,
    teams: teams,
    initCash: initCash,
    highlight: currentTeam?.name,
    showDetail: true
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 18px",
      borderBottom: "1px solid #1e293b",
      background: "#020817",
      position: "sticky",
      top: 0,
      zIndex: 100
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: 24,
      background: "linear-gradient(135deg,#00f5c4,#38bdf8)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent"
    }
  }, "BULL PIT"), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 7,
      height: 7,
      borderRadius: "50%",
      flexShrink: 0,
      background: gamePhase === "running" ? "#00f5c4" : gamePhase === "paused" ? "#fbbf24" : gamePhase === "buffer" ? "#38bdf8" : "#64748b",
      animation: gamePhase === "running" ? "pulse 2s infinite" : "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      color: "#475569",
      letterSpacing: "0.1em"
    }
  }, ROUND_LABELS[roundNum - 1] || `Round ${roundNum}`, " \xB7 ", gamePhase.toUpperCase()), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 8,
      color: "#334155"
    }
  }, "R", roundNum, "/", TOTAL_ROUNDS, " \xB7 ", Math.floor(roundDur / 60), "min round \xB7 ", BUFFER_SECS, "s buffer")), timerMins != null && gamePhase === "running" && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: 22,
      lineHeight: 1,
      color: timerMins < 1 ? "#ef4444" : timerMins < 3 ? "#fbbf24" : "#94a3b8",
      animation: timerMins < 1 ? "pulse 0.5s infinite" : timerMins < 3 ? "pulse 2s infinite" : "none"
    }
  }, String(timerMins).padStart(2, "0"), ":", String(timerSecs).padStart(2, "0")), bufMins != null && gamePhase === "buffer" && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: "#38bdf8"
    }
  }, "\u23F3 ", String(bufMins).padStart(2, "0"), ":", String(bufSecs).padStart(2, "0"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, myRank > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      padding: "3px 8px",
      borderRadius: 4,
      background: "#0f172a",
      border: "1px solid #1e293b",
      color: "#64748b"
    }
  }, "RANK #", myRank, "/", sharedLB.length), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: currentTeam?.color,
      fontWeight: 700
    }
  }, currentTeam?.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 13,
      color: analytics.totalPnL >= 0 ? "#00f5c4" : "#ef4444"
    }
  }, fmtUSD(totalVal), " ", analytics.totalPnL >= 0 ? "▲" : "▼", fmtUSD(Math.abs(analytics.totalPnL)))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setScreen("login"),
    style: {
      padding: "5px 10px",
      background: "#0f172a",
      border: "1px solid #1e293b",
      color: "#475569",
      borderRadius: 5,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 10
    }
  }, "\u2190 EXIT"))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#040d1a",
      borderBottom: "1px solid #0f172a",
      padding: "5px 0",
      overflow: "hidden",
      whiteSpace: "nowrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      gap: 20,
      animation: "ticker 60s linear infinite"
    }
  }, [...ALL_STOCKS, ...ALL_STOCKS].map((s, i) => {
    const p = prices[s.ticker] || 0,
      prev = prevPrices[s.ticker] || p;
    const chg = (p - prev) / (prev || 1) * 100;
    return /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        fontSize: 11,
        display: "inline-flex",
        gap: 5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: s.color,
        fontWeight: 700
      }
    }, s.ticker), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#64748b"
      }
    }, fmtUSD(p)), /*#__PURE__*/React.createElement("span", {
      style: {
        color: chg >= 0 ? "#00f5c4" : "#ef4444"
      }
    }, chg >= 0 ? "▲" : "▼", fmt(Math.abs(chg)), "%"));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      borderBottom: "1px solid #1e293b",
      padding: "0 18px",
      overflowX: "auto"
    }
  }, ["market", "portfolio", "leaderboard", "news"].map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    onClick: () => setTab(t),
    style: {
      padding: "10px 14px",
      background: "none",
      border: "none",
      color: tab === t ? "#00f5c4" : "#475569",
      cursor: "pointer",
      borderBottom: tab === t ? "2px solid #00f5c4" : "2px solid transparent",
      fontSize: 10,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      fontFamily: "inherit",
      fontWeight: tab === t ? 700 : 400,
      whiteSpace: "nowrap"
    }
  }, t))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "18px",
      maxWidth: 1200,
      margin: "0 auto"
    }
  }, tab === "market" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 16,
      flexWrap: "wrap",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: marketSearch,
    onChange: e => setMarketSearch(e.target.value),
    placeholder: "Search stocks\u2026",
    style: {
      padding: "7px 12px",
      background: "#0f172a",
      border: "1px solid #1e293b",
      color: "#f1f5f9",
      borderRadius: 7,
      fontFamily: "inherit",
      fontSize: 12,
      width: 160
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => setActiveSector("all"),
    style: {
      padding: "6px 12px",
      background: activeSector === "all" ? "#1e293b" : "#0a0f1e",
      border: `1px solid ${activeSector === "all" ? "#64748b" : "#1e293b"}`,
      color: activeSector === "all" ? "#f1f5f9" : "#475569",
      borderRadius: 6,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 10,
      fontWeight: 700
    }
  }, "ALL"), SECTORS.map(sec => /*#__PURE__*/React.createElement("button", {
    key: sec.id,
    onClick: () => setActiveSector(sec.id),
    style: {
      padding: "6px 10px",
      background: activeSector === sec.id ? `${sec.color}20` : "#0a0f1e",
      border: `1px solid ${activeSector === sec.id ? sec.color : "#1e293b"}`,
      color: activeSector === sec.id ? sec.color : "#475569",
      borderRadius: 6,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 10,
      fontWeight: 700
    }
  }, sec.icon, " ", sec.label.split(" ")[0]))), (() => {
    const ranked = ALL_STOCKS.map(st => {
      const p = prices[st.ticker] || 0,
        h = history[st.ticker] || [],
        open = h[0] || p;
      const chg = open ? (p - open) / open * 100 : 0;
      return {
        ...st,
        p,
        chg
      };
    }).filter(st => st.p > 0);
    const gainers = [...ranked].sort((a, b) => b.chg - a.chg).slice(0, 5);
    const losers = [...ranked].sort((a, b) => a.chg - b.chg).slice(0, 5);
    // renderMover is a plain function (not a React component) — no hooks, no remount issue
    const renderMover = (st, isGainer) => {
      const held = holdings[st.ticker]?.qty || 0;
      const qBuy = canTrade && cash >= st.p,
        qSell = canTrade && held > 0;
      const accentColor = isGainer ? "#00f5c4" : "#ef4444";
      return /*#__PURE__*/React.createElement("div", {
        key: st.ticker,
        style: {
          background: "#0a0f1e",
          border: `1px solid ${isGainer ? "#00f5c420" : "#ef444420"}`,
          borderLeft: `3px solid ${accentColor}`,
          borderRadius: 10,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer"
        },
        onClick: () => setDetailStock(st.ticker)
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1,
          minWidth: 0
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 800,
          color: st.color,
          fontSize: 13
        }
      }, st.ticker), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 9,
          color: "#334155",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 90
        }
      }, st.name)), /*#__PURE__*/React.createElement(Spark, {
        data: (history[st.ticker] || []).slice(-20),
        color: accentColor,
        w: 50,
        h: 22
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          textAlign: "right",
          flexShrink: 0
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 12,
          fontWeight: 700,
          color: "#f1f5f9"
        }
      }, fmtUSD(st.p)), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 11,
          fontWeight: 800,
          color: accentColor
        }
      }, isGainer ? "▲ +" : "▼ ", fmt(Math.abs(st.chg)), "%")), /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 3,
          flexShrink: 0
        },
        onClick: e => e.stopPropagation()
      }, /*#__PURE__*/React.createElement("button", {
        onClick: () => execBuy(st.ticker, 1),
        disabled: !qBuy,
        style: {
          padding: "3px 8px",
          fontSize: 9,
          fontWeight: 800,
          background: qBuy ? "#00f5c422" : "#0f172a",
          border: `1px solid ${qBuy ? "#00f5c4" : "#1e293b"}`,
          color: qBuy ? "#00f5c4" : "#334155",
          borderRadius: 4,
          cursor: qBuy ? "pointer" : "not-allowed",
          fontFamily: "inherit"
        }
      }, "\u25B2 BUY"), /*#__PURE__*/React.createElement("button", {
        onClick: () => execSell(st.ticker, 1),
        disabled: !qSell,
        style: {
          padding: "3px 8px",
          fontSize: 9,
          fontWeight: 800,
          background: qSell ? "#ef444422" : "#0f172a",
          border: `1px solid ${qSell ? "#ef4444" : "#1e293b"}`,
          color: qSell ? "#ef4444" : "#334155",
          borderRadius: 4,
          cursor: qSell ? "pointer" : "not-allowed",
          fontFamily: "inherit"
        }
      }, "\u25BC SELL")));
    };
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        marginBottom: 20
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: "#030810",
        border: "1px solid #0d1f10",
        borderRadius: 12,
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "10px 14px",
        borderBottom: "1px solid #0d1f10",
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14
      }
    }, "\uD83D\uDE80"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "'Syne',sans-serif",
        fontWeight: 800,
        fontSize: 13,
        color: "#00f5c4"
      }
    }, "TOP GAINERS"), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 9,
        color: "#334155"
      }
    }, "SESSION %")), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 6
      }
    }, gainers.map(st => renderMover(st, true)))), /*#__PURE__*/React.createElement("div", {
      style: {
        background: "#030810",
        border: "1px solid #1f0d0d",
        borderRadius: 12,
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "10px 14px",
        borderBottom: "1px solid #1f0d0d",
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14
      }
    }, "\uD83D\uDCC9"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "'Syne',sans-serif",
        fontWeight: 800,
        fontSize: 13,
        color: "#ef4444"
      }
    }, "TOP LOSERS"), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 9,
        color: "#334155"
      }
    }, "SESSION %")), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 6
      }
    }, losers.map(st => renderMover(st, false)))));
  })(), detailStock && (() => {
    const ds = ALL_STOCKS.find(x => x.ticker === detailStock);
    const dsec = SECTORS.find(x => x.id === ds?.sectorId);
    return /*#__PURE__*/React.createElement(StockDetailModal, {
      stock: ds,
      sector: dsec,
      price: prices[detailStock] || 0,
      prevPrice: prevPrices[detailStock] || 0,
      history: history[detailStock] || [],
      holdings: holdings,
      cash: cash,
      canTrade: canTrade,
      onBuy: execBuy,
      onSell: execSell,
      onClose: () => setDetailStock(null)
    });
  })(), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
      gap: 8,
      marginBottom: 14
    }
  }, filteredStocks.map(s => {
    const p = prices[s.ticker] || 0,
      h = history[s.ticker] || [],
      prev = prevPrices[s.ticker] || p;
    const sessionChg = h[0] ? (p - h[0]) / h[0] * 100 : 0;
    const tickChg = (p - prev) / (prev || 1) * 100;
    const isSel = selTicker === s.ticker;
    const held = holdings[s.ticker]?.qty || 0;
    const canQuickBuy = canTrade && cash >= p;
    const canQuickSell = canTrade && held > 0;
    return /*#__PURE__*/React.createElement("div", {
      key: s.ticker,
      style: {
        background: "#0a0f1e",
        border: `1px solid ${isSel ? s.color : "#111827"}`,
        borderRadius: 10,
        padding: "12px 14px",
        cursor: "pointer",
        boxShadow: isSel ? `0 0 20px ${s.color}18` : "none",
        transition: "all 0.2s",
        position: "relative"
      },
      onClick: () => setSelTicker(isSel ? null : s.ticker)
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 4
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 800,
        color: s.color,
        fontSize: 13
      }
    }, s.ticker), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: "#334155",
        maxWidth: 90,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, s.name)), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "right"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        fontSize: 13
      }
    }, fmtUSD(p)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: tickChg >= 0 ? "#00f5c4" : "#ef4444"
      }
    }, tickChg >= 0 ? "▲" : "▼", fmt(Math.abs(tickChg)), "%"))), /*#__PURE__*/React.createElement(Spark, {
      data: h.slice(-30),
      color: s.color,
      h: 24
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        marginTop: 5,
        fontSize: 9
      }
    }, s.totalMarket ? /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 8,
        padding: "1px 5px",
        borderRadius: 3,
        background: "#e879f920",
        border: "1px solid #e879f960",
        color: "#e879f9",
        fontWeight: 800
      }
    }, "ALL MARKET") : s.crossSector ? /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 8,
        padding: "1px 5px",
        borderRadius: 3,
        background: "#e879f915",
        border: "1px solid #e879f940",
        color: "#e879f9",
        fontWeight: 700
      }
    }, "CROSS-SECTOR") : /*#__PURE__*/React.createElement(SectorBadge, {
      sectorId: s.sectorId,
      small: true
    }), held > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        color: s.color
      }
    }, "\xD7", held)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        marginTop: 8
      },
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setDetailStock(s.ticker),
      style: {
        flex: 1,
        padding: "5px 0",
        fontSize: 9,
        fontWeight: 700,
        background: "#0f172a",
        border: `1px solid ${s.color}44`,
        color: s.color,
        borderRadius: 5,
        cursor: "pointer",
        fontFamily: "inherit",
        letterSpacing: "0.06em"
      }
    }, "\u2B21 DETAILS"), /*#__PURE__*/React.createElement("button", {
      onClick: () => execBuy(s.ticker, 1),
      disabled: !canQuickBuy,
      style: {
        flex: 1,
        padding: "5px 0",
        fontSize: 9,
        fontWeight: 800,
        background: canQuickBuy ? "#00f5c422" : "#0f172a",
        border: `1px solid ${canQuickBuy ? "#00f5c4" : "#1e293b"}`,
        color: canQuickBuy ? "#00f5c4" : "#334155",
        borderRadius: 5,
        cursor: canQuickBuy ? "pointer" : "not-allowed",
        fontFamily: "inherit"
      }
    }, "\u25B2 BUY"), /*#__PURE__*/React.createElement("button", {
      onClick: () => execSell(s.ticker, 1),
      disabled: !canQuickSell,
      style: {
        flex: 1,
        padding: "5px 0",
        fontSize: 9,
        fontWeight: 800,
        background: canQuickSell ? "#ef444422" : "#0f172a",
        border: `1px solid ${canQuickSell ? "#ef4444" : "#1e293b"}`,
        color: canQuickSell ? "#ef4444" : "#334155",
        borderRadius: 5,
        cursor: canQuickSell ? "pointer" : "not-allowed",
        fontFamily: "inherit"
      }
    }, "\u25BC SELL")));
  })), selTicker && selStock && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0a0f1e",
      border: `1px solid ${selStock.color}55`,
      borderRadius: 12,
      padding: 20,
      marginBottom: 12,
      boxShadow: `0 0 30px ${selStock.color}0d`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: selStock.color,
      fontWeight: 900,
      fontSize: 22
    }
  }, selTicker), /*#__PURE__*/React.createElement(SectorBadge, {
    sectorId: selStock.sectorId
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#64748b",
      fontSize: 12
    }
  }, selStock.name), holdings[selTicker] && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      fontSize: 11,
      color: "#475569"
    }
  }, "Avg cost: ", fmtUSD(holdings[selTicker].avgCost), " \xB7 Held: ", holdings[selTicker].qty, " shares \xB7 Unrealized: ", ' ', /*#__PURE__*/React.createElement("span", {
    style: {
      color: prices[selTicker] - holdings[selTicker].avgCost >= 0 ? "#00f5c4" : "#ef4444",
      fontWeight: 700
    }
  }, fmtUSD((prices[selTicker] - holdings[selTicker].avgCost) * holdings[selTicker].qty), ' ', "(", fmt((prices[selTicker] - holdings[selTicker].avgCost) / holdings[selTicker].avgCost * 100), "%)"))), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 900,
      fontSize: 26
    }
  }, fmtUSD(selPrice)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#64748b"
    }
  }, "Session: ", (() => {
    const h = history[selTicker] || [],
      open = h[0] || selPrice,
      chg = (selPrice - open) / open * 100;
    return /*#__PURE__*/React.createElement("span", {
      style: {
        color: chg >= 0 ? "#00f5c4" : "#ef4444"
      }
    }, chg >= 0 ? "+" : "", fmt(chg), "%");
  })()))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Spark, {
    data: (history[selTicker] || []).slice(-50),
    color: selStock.color,
    w: undefined,
    h: 50
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#475569",
      marginBottom: 4
    }
  }, "QUANTITY"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: 1,
    value: orderQty,
    onChange: e => setOrderQty(Math.max(1, parseInt(e.target.value) || 1)),
    style: {
      width: 80,
      padding: "10px 12px",
      background: "#020817",
      border: "1px solid #1e293b",
      color: "#f1f5f9",
      borderRadius: 6,
      fontSize: 15,
      fontFamily: "inherit"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "#475569",
      alignSelf: "flex-end",
      paddingBottom: 8
    }
  }, "= ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "#f1f5f9"
    }
  }, fmtUSD(buyTotal))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      gap: 8,
      alignSelf: "flex-end"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: doBuy,
    disabled: !canBuy,
    style: {
      padding: "11px 32px",
      background: canBuy ? "#00f5c4" : "#1e293b",
      color: canBuy ? "#020817" : "#334155",
      border: "none",
      borderRadius: 7,
      fontWeight: 800,
      cursor: canBuy ? "pointer" : "not-allowed",
      fontFamily: "inherit",
      fontSize: 13
    }
  }, "BUY"), /*#__PURE__*/React.createElement("button", {
    onClick: doSell,
    disabled: !canSell,
    style: {
      padding: "11px 32px",
      background: canSell ? "#ef4444" : "#1e293b",
      color: canSell ? "#fff" : "#334155",
      border: "none",
      borderRadius: 7,
      fontWeight: 800,
      cursor: canSell ? "pointer" : "not-allowed",
      fontFamily: "inherit",
      fontSize: 13
    }
  }, "SELL"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      fontSize: 10,
      color: "#475569"
    }
  }, "Cash available: ", fmtUSD(cash), !canTrade && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#ef4444",
      marginLeft: 10
    }
  }, "\u26A0 Trading locked outside live rounds")))), tab === "portfolio" && /*#__PURE__*/React.createElement("div", null, detailStock && (() => {
    const ds = ALL_STOCKS.find(x => x.ticker === detailStock);
    const dsec = SECTORS.find(x => x.id === ds?.sectorId);
    return /*#__PURE__*/React.createElement(StockDetailModal, {
      stock: ds,
      sector: dsec,
      price: prices[detailStock] || 0,
      prevPrice: prevPrices[detailStock] || 0,
      history: history[detailStock] || [],
      holdings: holdings,
      cash: cash,
      canTrade: canTrade,
      onBuy: execBuy,
      onSell: execSell,
      onClose: () => setDetailStock(null)
    });
  })(), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: 10,
      marginBottom: 20
    }
  }, [{
    l: "TOTAL VALUE",
    v: fmtUSD(totalVal),
    c: "#f1f5f9"
  }, {
    l: "CASH",
    v: fmtUSD(cash),
    c: "#38bdf8"
  }, {
    l: "UNREALIZED P&L",
    v: (analytics.totalUnrealized >= 0 ? "+" : "") + fmtUSD(analytics.totalUnrealized),
    c: analytics.totalUnrealized >= 0 ? "#00f5c4" : "#ef4444"
  }, {
    l: "REALIZED P&L",
    v: (analytics.totalRealized >= 0 ? "+" : "") + fmtUSD(analytics.totalRealized),
    c: analytics.totalRealized >= 0 ? "#00f5c4" : "#ef4444"
  }].map(c => /*#__PURE__*/React.createElement("div", {
    key: c.l,
    style: {
      background: "#0a0f1e",
      border: "1px solid #111827",
      borderRadius: 10,
      padding: "14px 16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155",
      letterSpacing: "0.12em",
      marginBottom: 6
    }
  }, c.l), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 800,
      fontSize: 18,
      color: c.c
    }
  }, c.v)))), (() => {
    const uniqueSectors = new Set(Object.keys(holdings).map(t => ALL_STOCKS.find(s => s.ticker === t)?.sectorId).filter(Boolean)).size;
    const closedTrades = transactions.filter(t => t.type === "SELL").length;
    const entry = {
      total: totalVal,
      cash,
      uniqueSectors,
      closedTrades,
      wins: analytics.wins,
      maxDrawdown: Math.max(1, maxDrawdown),
      predTotal: predCorrectCount.current.total,
      predCorrect: predCorrectCount.current.correct,
      beta: totalVal > 0 ? Math.min(1, (totalVal - cash) / totalVal) : 0.5,
      ballReturn: 0,
      roundReturns: []
    };
    const sc = calcScore(entry, initCash);
    const TierHeader = ({
      label,
      color,
      pts,
      max
    }) => /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8,
        paddingBottom: 6,
        borderBottom: `1px solid ${color}22`
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        fontWeight: 800,
        color,
        letterSpacing: "0.12em"
      }
    }, label), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 800,
        color
      }
    }, fmt(pts, 1), " ", /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        color: "#475569"
      }
    }, "/ ", max, " pts")));
    const Row = ({
      label,
      formula,
      value,
      pts,
      max,
      color
    }) => {
      const pct = Math.min(100, pts / max * 100);
      return /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: 8
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 3
        }
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 10,
          color: "#94a3b8",
          fontWeight: 700
        }
      }, label), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 9,
          color: "#334155",
          marginLeft: 6
        }
      }, formula)), /*#__PURE__*/React.createElement("div", {
        style: {
          textAlign: "right"
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11,
          fontWeight: 800,
          color
        }
      }, value), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 9,
          color: "#475569",
          marginLeft: 6
        }
      }, fmt(pts, 1), "/", max, "pt"))), /*#__PURE__*/React.createElement("div", {
        style: {
          height: 4,
          background: "#0f172a",
          borderRadius: 2
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          width: `${pct}%`,
          height: "100%",
          background: color,
          borderRadius: 2,
          transition: "width 0.6s",
          boxShadow: `0 0 6px ${color}88`
        }
      })));
    };
    return /*#__PURE__*/React.createElement("div", {
      style: {
        background: "linear-gradient(135deg,#0a0f1e,#060c18)",
        border: "1px solid #111827",
        borderRadius: 12,
        padding: 16,
        marginBottom: 20
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: "#475569",
        letterSpacing: "0.12em"
      }
    }, "YOUR SCORE BREAKDOWN"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "baseline",
        gap: 4
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "'Syne',sans-serif",
        fontWeight: 900,
        fontSize: 28,
        color: "#fbbf24"
      }
    }, fmt(sc.score, 1)), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        color: "#475569"
      }
    }, "/ 100 pts"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(3,1fr)",
        gap: 6,
        marginBottom: 16
      }
    }, [{
      l: "PERFORMANCE",
      pts: sc.tier1,
      max: 50,
      c: "#00f5c4"
    }, {
      l: "RISK MGMT",
      pts: sc.tier2,
      max: 30,
      c: "#a78bfa"
    }, {
      l: "TRADING QUALITY",
      pts: sc.tier3,
      max: 20,
      c: "#fbbf24"
    }].map(t => /*#__PURE__*/React.createElement("div", {
      key: t.l,
      style: {
        background: "#020817",
        borderRadius: 8,
        padding: "10px 12px",
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 8,
        color: "#475569",
        letterSpacing: "0.1em",
        marginBottom: 4
      }
    }, t.l), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 20,
        fontWeight: 800,
        color: t.c
      }
    }, fmt(t.pts, 1)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: "#334155"
      }
    }, "/ ", t.max, " pts"), /*#__PURE__*/React.createElement("div", {
      style: {
        height: 3,
        background: "#0f172a",
        borderRadius: 2,
        marginTop: 6
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: `${t.pts / t.max * 100}%`,
        height: "100%",
        background: t.c,
        borderRadius: 2,
        transition: "width 0.6s"
      }
    }))))), /*#__PURE__*/React.createElement("div", {
      style: {
        background: "#020817",
        borderRadius: 10,
        padding: "12px 14px",
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement(TierHeader, {
      label: "TIER 1 \u2014 PERFORMANCE",
      color: "#00f5c4",
      pts: sc.tier1,
      max: 50
    }), /*#__PURE__*/React.createElement(Row, {
      label: "Absolute Return",
      formula: "(total \u2212 start) / start",
      value: `${sc.absoluteReturn >= 0 ? "+" : ""}${fmt(sc.absoluteReturn)}%`,
      pts: sc.t1a,
      max: 15,
      color: "#00f5c4"
    }), /*#__PURE__*/React.createElement(Row, {
      label: "Sharpe Proxy",
      formula: "return / max drawdown",
      value: fmt(sc.sharpe, 2),
      pts: sc.t1b,
      max: 15,
      color: "#34d399"
    }), /*#__PURE__*/React.createElement(Row, {
      label: "Alpha vs Market",
      formula: "return \u2212 BALL index",
      value: `${sc.alpha >= 0 ? "+" : ""}${fmt(sc.alpha)}%`,
      pts: sc.t1c,
      max: 12,
      color: "#6ee7b7"
    }), /*#__PURE__*/React.createElement(Row, {
      label: "Round Consistency",
      formula: "geometric mean of rounds",
      value: `${sc.consistency >= 0 ? "+" : ""}${fmt(sc.consistency)}%`,
      pts: sc.t1d,
      max: 8,
      color: "#a7f3d0"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        background: "#020817",
        borderRadius: 10,
        padding: "12px 14px",
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement(TierHeader, {
      label: "TIER 2 \u2014 RISK MANAGEMENT",
      color: "#a78bfa",
      pts: sc.tier2,
      max: 30
    }), /*#__PURE__*/React.createElement(Row, {
      label: "Max Drawdown",
      formula: "inverse: lower DD = more pts",
      value: `${fmt(sc.maxDrawdown, 1)}% DD`,
      pts: sc.t2a,
      max: 10,
      color: "#a78bfa"
    }), /*#__PURE__*/React.createElement(Row, {
      label: "Calmar Ratio",
      formula: "return / max drawdown",
      value: fmt(sc.calmar, 2),
      pts: sc.t2b,
      max: 10,
      color: "#c4b5fd"
    }), /*#__PURE__*/React.createElement(Row, {
      label: "Portfolio Beta",
      formula: "1 \u2212 |mkt correlation|",
      value: fmt(sc.beta, 2),
      pts: sc.t2c,
      max: 10,
      color: "#ddd6fe"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        background: "#020817",
        borderRadius: 10,
        padding: "12px 14px"
      }
    }, /*#__PURE__*/React.createElement(TierHeader, {
      label: "TIER 3 \u2014 TRADING QUALITY",
      color: "#fbbf24",
      pts: sc.tier3,
      max: 20
    }), /*#__PURE__*/React.createElement(Row, {
      label: "Win Rate",
      formula: "wins / closed trades",
      value: `${fmt(sc.winRate, 0)}%`,
      pts: sc.t3a,
      max: 8,
      color: "#fbbf24"
    }), /*#__PURE__*/React.createElement(Row, {
      label: "Diversification",
      formula: "unique sectors held / 9",
      value: `${sc.sectors} / 9 sectors`,
      pts: sc.t3b,
      max: 7,
      color: "#fcd34d"
    }), /*#__PURE__*/React.createElement(Row, {
      label: "Prediction Acc.",
      formula: "correct econ. questions",
      value: `${entry.predCorrect}/${entry.predTotal || "—"}`,
      pts: sc.t3c,
      max: 5,
      color: "#fde68a"
    })));
  })(), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      letterSpacing: "0.12em",
      marginBottom: 12
    }
  }, "OPEN POSITIONS"), Object.keys(holdings).length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#334155",
      fontSize: 12,
      padding: "12px 0"
    }
  }, "No open positions. Go to Market tab to start trading.") : SECTORS.map(sec => {
    const secHoldings = Object.entries(analytics.openPnL).filter(([t]) => ALL_STOCKS.find(s => s.ticker === t)?.sectorId === sec.id);
    if (!secHoldings.length) return null;
    return /*#__PURE__*/React.createElement("div", {
      key: sec.id,
      style: {
        marginBottom: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12
      }
    }, sec.icon), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: sec.color,
        fontWeight: 700
      }
    }, sec.label), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        height: 1,
        background: "#111827"
      }
    })), secHoldings.map(([ticker, pos]) => {
      const stk = ALL_STOCKS.find(s => s.ticker === ticker);
      const pct = analytics.totalHoldingsValue > 0 ? clamp(pos.value / analytics.totalHoldingsValue * 100, 0, 100) : 0;
      return /*#__PURE__*/React.createElement("div", {
        key: ticker,
        style: {
          background: "#0a0f1e",
          border: "1px solid #111827",
          borderRadius: 10,
          padding: "12px 14px",
          marginBottom: 6
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 8
        }
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          color: sec.color,
          fontWeight: 800,
          fontSize: 14
        }
      }, ticker), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 10,
          color: "#475569"
        }
      }, pos.qty, " shares")), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 10,
          color: "#334155"
        }
      }, stk?.name)), /*#__PURE__*/React.createElement("div", {
        style: {
          textAlign: "right"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 700,
          fontSize: 15
        }
      }, fmtUSD(pos.value)), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 11,
          fontWeight: 700,
          color: pos.unrealized >= 0 ? "#00f5c4" : "#ef4444"
        }
      }, pos.unrealized >= 0 ? "▲ +" : "▼ ", fmtUSD(Math.abs(pos.unrealized)), ' ', "(", pos.pct >= 0 ? "+" : "", fmt(pos.pct), "%)"))), /*#__PURE__*/React.createElement("div", {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 6,
          marginBottom: 6,
          fontSize: 10
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          color: "#64748b"
        }
      }, "Avg Cost: ", /*#__PURE__*/React.createElement("span", {
        style: {
          color: "#94a3b8"
        }
      }, fmtUSD(pos.avgCost))), /*#__PURE__*/React.createElement("div", {
        style: {
          color: "#64748b"
        }
      }, "Cur Price: ", /*#__PURE__*/React.createElement("span", {
        style: {
          color: "#94a3b8"
        }
      }, fmtUSD(pos.curPrice))), /*#__PURE__*/React.createElement("div", {
        style: {
          color: "#64748b"
        }
      }, "Weight: ", /*#__PURE__*/React.createElement("span", {
        style: {
          color: "#94a3b8"
        }
      }, fmt(pct), "%"))), /*#__PURE__*/React.createElement("div", {
        style: {
          height: 3,
          background: "#1e293b",
          borderRadius: 2
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          width: `${pct}%`,
          height: "100%",
          background: pos.unrealized >= 0 ? sec.color : "#ef4444",
          borderRadius: 2,
          transition: "width 0.6s"
        }
      })), /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          gap: 6,
          marginTop: 10
        }
      }, /*#__PURE__*/React.createElement("button", {
        onClick: () => {
          setDetailStock(ticker);
          setTab("market");
        },
        style: {
          flex: 1,
          padding: "6px 0",
          fontSize: 9,
          fontWeight: 700,
          background: "#0f172a",
          border: `1px solid ${sec.color}44`,
          color: sec.color,
          borderRadius: 5,
          cursor: "pointer",
          fontFamily: "inherit"
        }
      }, "\u2B21 VIEW DETAILS"), /*#__PURE__*/React.createElement("button", {
        onClick: () => execBuy(ticker, 1),
        disabled: !canTrade || cash < (prices[ticker] || 0),
        style: {
          flex: 1,
          padding: "6px 0",
          fontSize: 9,
          fontWeight: 800,
          background: canTrade && cash >= (prices[ticker] || 0) ? "#00f5c422" : "#0f172a",
          border: `1px solid ${canTrade && cash >= (prices[ticker] || 0) ? "#00f5c4" : "#1e293b"}`,
          color: canTrade && cash >= (prices[ticker] || 0) ? "#00f5c4" : "#334155",
          borderRadius: 5,
          cursor: canTrade && cash >= (prices[ticker] || 0) ? "pointer" : "not-allowed",
          fontFamily: "inherit"
        }
      }, "\u25B2 BUY 1"), /*#__PURE__*/React.createElement("button", {
        onClick: () => execSell(ticker, 1),
        disabled: !canTrade,
        style: {
          flex: 1,
          padding: "6px 0",
          fontSize: 9,
          fontWeight: 800,
          background: canTrade ? "#ef444422" : "#0f172a",
          border: `1px solid ${canTrade ? "#ef4444" : "#1e293b"}`,
          color: canTrade ? "#ef4444" : "#334155",
          borderRadius: 5,
          cursor: canTrade ? "pointer" : "not-allowed",
          fontFamily: "inherit"
        }
      }, "\u25BC SELL 1"), /*#__PURE__*/React.createElement("button", {
        onClick: () => execSell(ticker, pos.qty),
        disabled: !canTrade,
        style: {
          flex: 1,
          padding: "6px 0",
          fontSize: 9,
          fontWeight: 800,
          background: canTrade ? "#7f1d1d33" : "#0f172a",
          border: `1px solid ${canTrade ? "#ef4444" : "#1e293b"}`,
          color: canTrade ? "#fca5a5" : "#334155",
          borderRadius: 5,
          cursor: canTrade ? "pointer" : "not-allowed",
          fontFamily: "inherit"
        }
      }, "\u2715 SELL ALL")));
    }));
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      letterSpacing: "0.12em",
      marginBottom: 12
    }
  }, "TRANSACTION HISTORY (", transactions.length, " trades)"), transactions.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#334155",
      fontSize: 12
    }
  }, "No transactions yet.") : /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0a0f1e",
      border: "1px solid #111827",
      borderRadius: 12,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "80px 70px 90px 80px 80px 80px 80px 100px",
      gap: 0,
      padding: "10px 14px",
      background: "#060c18",
      fontSize: 9,
      color: "#334155",
      letterSpacing: "0.1em",
      borderBottom: "1px solid #111827"
    }
  }, ["TIME", "TYPE", "TICKER", "QTY", "PRICE", "AVG COST", "P&L", "P&L %"].map(h => /*#__PURE__*/React.createElement("div", {
    key: h
  }, h))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 400,
      overflowY: "auto"
    }
  }, transactions.map((tx, i) => {
    const stk = ALL_STOCKS.find(s => s.ticker === tx.ticker);
    const isSell = tx.type === "SELL";
    return /*#__PURE__*/React.createElement("div", {
      key: tx.id || i,
      style: {
        display: "grid",
        gridTemplateColumns: "80px 70px 90px 80px 80px 80px 80px 100px",
        gap: 0,
        padding: "10px 14px",
        borderBottom: "1px solid #060c18",
        background: i % 2 === 0 ? "#0a0f1e" : "#080d18",
        fontSize: 11,
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        color: "#475569",
        fontSize: 9
      }
    }, tx.time), /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        color: isSell ? "#ef4444" : "#00f5c4"
      }
    }, tx.type), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 2
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: stk?.color || "#94a3b8",
        fontWeight: 700
      }
    }, tx.ticker), /*#__PURE__*/React.createElement(SectorBadge, {
      sectorId: tx.sectorId,
      small: true
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        color: "#94a3b8"
      }
    }, tx.qty), /*#__PURE__*/React.createElement("div", {
      style: {
        color: "#f1f5f9",
        fontWeight: 600
      }
    }, fmtUSD(tx.price)), /*#__PURE__*/React.createElement("div", {
      style: {
        color: "#64748b"
      }
    }, isSell ? fmtUSD(tx.avgCostAtSell || 0) : fmtUSD(tx.avgCostAtBuy || tx.price)), /*#__PURE__*/React.createElement("div", {
      style: {
        color: isSell ? tx.gain >= 0 ? "#00f5c4" : "#ef4444" : "#475569",
        fontWeight: 700
      }
    }, isSell ? (tx.gain >= 0 ? "+" : "") + fmtUSD(tx.gain || 0) : "—"), /*#__PURE__*/React.createElement("div", {
      style: {
        color: isSell ? tx.gainPct >= 0 ? "#00f5c4" : "#ef4444" : "#475569",
        fontWeight: 700
      }
    }, isSell ? (tx.gainPct >= 0 ? "+" : "") + fmt(tx.gainPct || 0) + "%" : "—"));
  })), analytics.totalRealized !== 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 14px",
      borderTop: "1px solid #111827",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      background: "#060c18"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: "#475569"
    }
  }, analytics.wins, "W / ", analytics.losses, "L on ", transactions.filter(t => t.type === "SELL").length, " closed trades"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 800,
      color: analytics.totalRealized >= 0 ? "#00f5c4" : "#ef4444"
    }
  }, "Realized P&L: ", analytics.totalRealized >= 0 ? "+" : "", fmtUSD(analytics.totalRealized)))))), tab === "leaderboard" && /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 700
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      letterSpacing: "0.1em"
    }
  }, "COMPETITION LEADERBOARD \xB7 R", roundNum, "/", TOTAL_ROUNDS), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155"
    }
  }, "5-pillar composite score")), /*#__PURE__*/React.createElement(LeaderboardPanel, {
    entries: sharedLB,
    teams: teams,
    initCash: initCash,
    highlight: currentTeam?.name,
    showDetail: true
  })), tab === "news" && /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 640
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: "#475569",
      letterSpacing: "0.12em",
      marginBottom: 14
    }
  }, "AI MARKET NEWS FEED"), news.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#334155",
      fontSize: 12
    }
  }, "News will appear as stocks move\u2026") : news.map((n, i) => {
    const stk = ALL_STOCKS.find(s => s.ticker === n.ticker);
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        borderLeft: `3px solid ${n.sentiment === "bull" ? "#00f5c4" : "#ef4444"}`,
        paddingLeft: 12,
        marginBottom: 16,
        paddingBottom: 16,
        borderBottom: "1px solid #0f172a"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: stk?.color || "#94a3b8",
        fontWeight: 800
      }
    }, n.ticker), /*#__PURE__*/React.createElement(SectorBadge, {
      sectorId: n.sectorId,
      small: true
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#475569",
        fontSize: 10
      }
    }, n.time)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: "#e2e8f0",
        lineHeight: 1.5,
        fontWeight: 500
      }
    }, n.headline));
  }))));
}

// ─── BROADCAST INLINE (avoiding hook-in-callback issue) ───────────────────────
function ManualDisruption({
  stocks,
  prices,
  onPublish
}) {
  const empty = () => ({
    ticker: stocks[0]?.ticker || "",
    impact: 15,
    headline: "",
    detail: ""
  });
  const [entries, setEntries] = useState([empty()]);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const upd = (i, field, val) => setEntries(prev => prev.map((e, idx) => idx === i ? {
    ...e,
    [field]: val
  } : e));
  const add = () => setEntries(prev => [...prev, empty()]);
  const remove = i => setEntries(prev => prev.filter((_, idx) => idx !== i));
  async function handlePublish() {
    const valid = entries.filter(e => e.ticker && e.headline.trim());
    if (!valid.length) return;
    setPublishing(true);
    const events = valid.map(e => ({
      ticker: e.ticker,
      headline: e.headline.trim(),
      detail: e.detail.trim(),
      impact: Number(e.impact) || 0
    }));
    await onPublish(events);
    setPublishing(false);
    setPublished(true);
    setTimeout(() => setPublished(false), 3000);
  }
  const inputStyle = {
    width: "100%",
    padding: "7px 9px",
    background: "#020817",
    border: "1px solid #1e293b",
    color: "#f1f5f9",
    borderRadius: 5,
    fontFamily: "inherit",
    fontSize: 11,
    outline: "none"
  };
  const labelStyle = {
    fontSize: 8,
    color: "#475569",
    letterSpacing: "0.1em",
    marginBottom: 3
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, entries.map((entry, i) => {
    const stk = stocks.find(s => s.ticker === entry.ticker);
    const isPos = Number(entry.impact) >= 0;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        background: "#0a0f1e",
        border: `1px solid ${isPos ? "#00f5c430" : "#ef444430"}`,
        borderLeft: `3px solid ${isPos ? "#00f5c4" : "#ef4444"}`,
        borderRadius: 8,
        padding: "10px 12px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr auto",
        gap: 6,
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: labelStyle
    }, "TICKER"), /*#__PURE__*/React.createElement("select", {
      value: entry.ticker,
      onChange: e => upd(i, "ticker", e.target.value),
      style: {
        ...inputStyle,
        cursor: "pointer"
      }
    }, stocks.map(s => /*#__PURE__*/React.createElement("option", {
      key: s.ticker,
      value: s.ticker,
      style: {
        background: "#0f172a"
      }
    }, s.ticker, " \u2014 ", s.name)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: labelStyle
    }, "IMPACT %"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 4
      }
    }, [-30, -15, -10, 10, 15, 30].map(v => /*#__PURE__*/React.createElement("button", {
      key: v,
      onClick: () => upd(i, "impact", v),
      style: {
        flex: 1,
        padding: "5px 0",
        fontSize: 9,
        fontWeight: 800,
        background: entry.impact === v ? v > 0 ? "#00f5c422" : "#ef444422" : "#0f172a",
        border: `1px solid ${entry.impact === v ? v > 0 ? "#00f5c4" : "#ef4444" : "#1e293b"}`,
        color: v > 0 ? "#00f5c4" : "#ef4444",
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, v > 0 ? "+" : "", v, "%"))), /*#__PURE__*/React.createElement("input", {
      type: "number",
      value: entry.impact,
      onChange: e => upd(i, "impact", e.target.value),
      style: {
        ...inputStyle,
        marginTop: 4
      },
      placeholder: "Custom %\u2026"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "flex-end",
        paddingBottom: 2
      }
    }, entries.length > 1 && /*#__PURE__*/React.createElement("button", {
      onClick: () => remove(i),
      style: {
        width: 28,
        height: 28,
        background: "#7f1d1d",
        border: "none",
        borderRadius: 5,
        color: "#fca5a5",
        cursor: "pointer",
        fontSize: 13,
        fontFamily: "inherit"
      }
    }, "\u2715"))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 6
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: labelStyle
    }, "HEADLINE ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#334155"
      }
    }, "(max 15 words)")), /*#__PURE__*/React.createElement("input", {
      value: entry.headline,
      onChange: e => upd(i, "headline", e.target.value),
      placeholder: isPos ? `${stk?.name || entry.ticker} surges on major breakthrough…` : `${stk?.name || entry.ticker} crashes amid crisis…`,
      style: {
        ...inputStyle,
        border: `1px solid ${entry.headline ? "#334155" : "#1e293b"}`
      }
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: labelStyle
    }, "DETAIL ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#334155"
      }
    }, "(optional context)")), /*#__PURE__*/React.createElement("input", {
      value: entry.detail,
      onChange: e => upd(i, "detail", e.target.value),
      placeholder: "One sentence of context for players\u2026",
      style: inputStyle
    })));
  }), /*#__PURE__*/React.createElement("button", {
    onClick: add,
    style: {
      padding: "7px",
      background: "#0f172a",
      border: "1px solid #1e293b",
      borderRadius: 6,
      color: "#475569",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 10,
      fontWeight: 700
    }
  }, "+ ADD ANOTHER STOCK"), /*#__PURE__*/React.createElement("button", {
    onClick: handlePublish,
    disabled: publishing || !entries.some(e => e.headline.trim()),
    style: {
      padding: "10px",
      fontWeight: 800,
      fontSize: 11,
      letterSpacing: "0.06em",
      background: published ? "linear-gradient(135deg,#166534,#15803d)" : "linear-gradient(135deg,#7f1d1d,#dc2626)",
      border: "none",
      borderRadius: 7,
      color: "#fff",
      cursor: publishing ? "wait" : "pointer",
      fontFamily: "inherit",
      opacity: !entries.some(e => e.headline.trim()) ? 0.4 : 1,
      transition: "all 0.3s"
    }
  }, published ? "✓ DISRUPTION PUBLISHED!" : publishing ? "⏳ PUBLISHING…" : "🚨 PUBLISH DISRUPTION NEWS"));
}
function BroadcastInline({
  onSend
}) {
  const [msg, setMsg] = useState("");
  const QUICK = ["⚠️ Market volatility ahead — trade carefully!", "🏆 Final 3 minutes! Lock in your positions.", "📊 Leaderboard updated — check your rank!", "🔔 Disruption news incoming — watch for shocks!", "🚨 Round ending soon — review your portfolio!"];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("textarea", {
    value: msg,
    onChange: e => setMsg(e.target.value),
    placeholder: "Custom message\u2026",
    rows: 3,
    style: {
      width: "100%",
      padding: "9px 11px",
      background: "#0f172a",
      border: "1px solid #1e293b",
      color: "#f1f5f9",
      borderRadius: 7,
      fontFamily: "inherit",
      fontSize: 12,
      resize: "vertical"
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (msg.trim()) {
        onSend(msg.trim());
        setMsg("");
      }
    },
    style: {
      padding: "9px",
      background: "#0c4a6e",
      border: "1px solid #38bdf8",
      borderRadius: 6,
      color: "#38bdf8",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 11,
      fontWeight: 700
    }
  }, "\uD83D\uDCE2 SEND BROADCAST"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: "#334155",
      marginTop: 2,
      marginBottom: 2
    }
  }, "QUICK ALERTS"), QUICK.map(q => /*#__PURE__*/React.createElement("button", {
    key: q,
    onClick: () => onSend(q),
    style: {
      padding: "7px 10px",
      background: "#0f172a",
      border: "1px solid #1e293b",
      borderRadius: 5,
      color: "#94a3b8",
      cursor: "pointer",
      textAlign: "left",
      fontFamily: "inherit",
      fontSize: 10
    }
  }, q)));
}
