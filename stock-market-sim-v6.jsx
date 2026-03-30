const { useState, useEffect, useRef, useCallback } = React;

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const INITIAL_CASH  = 100000;
const TICK_MS       = 2000;           // faster ticks for 60 teams
const HISTORY_LEN   = 60;
const GM_PASSWORD   = "GMMASTER99";
const TOTAL_ROUNDS  = 7;
const BUFFER_SECS         = 90;   // standard between-round buffer
const POLITICAL_BUFFER_SECS = 30; // shorter buffer after GM political shock
const PREDICTION_POLL_SECS  = 30;
const PREDICTION_REVEAL_SECS = 5;
const BRIEFING_SECS       = 90;   // auto-start countdown on briefing modal
const TAX_RATE      = 0.20;           // 20% profit tax
const SCORE_WRITE_INTERVAL = 10000;   // write scores every 10s (60-team optimisation)
const MAX_TEAMS     = 60;

// Per-round durations: R1=8min, R2=10, R3=10, R4=10, R5=10, R6=8, R7=12
const DEFAULT_ROUND_DURATIONS = [480, 600, 600, 600, 600, 480, 720];

// Round identity: name, special rules, volatility multiplier, sentiment lock,
// disruption schedule, tax/liquidation events
const ROUND_RULES = [
  {
    round:1, name:"Orientation",    color:"#00f5c4", icon:"🎓",
    volMult:0.5,     sentLock:null,   leaderHidden:false,
    tax:false,       liquidate:false,
    disruptionPlan:{ midRound:[{type:"ai",  count:1}] },
    briefing:"Volatility at 50%. Learn the market. No tax this round. One AI disruption mid-round.",
    gmNote:"Keep sentiment NEUTRAL. Fire 1 AI disruption at ~4 minute mark. Announce no tax."
  },
  {
    round:2, name:"Bull Run",       color:"#fbbf24", icon:"🐂",
    volMult:1.0,     sentLock:"bull", leaderHidden:false,
    tax:true,        liquidate:false,
    disruptionPlan:{ at5min:[{type:"political", eventHint:"green_subsidy"}] },
    briefing:"Sentiment locked BULL. Market only goes up — but 20% profit tax hits at round end.",
    gmNote:"Lock sentiment to BULL at start. Fire Green Subsidy political shock at 5-min mark. Announce tax warning at 2-min mark."
  },
  {
    round:3, name:"The Crash",      color:"#ef4444", icon:"💥",
    volMult:1.2,     sentLock:null,   leaderHidden:false,
    tax:false,       liquidate:true,
    disruptionPlan:{ atStart:[{type:"political", eventHint:"pandemic_scare"}], midRound:[{type:"ai", count:1}] },
    briefing:"FORCED LIQUIDATION. Market opens BEAR for 3 minutes. All positions cleared at round end.",
    gmNote:"Set BEAR at start. Fire Pandemic Scare political shock immediately. Switch to NEUTRAL at 3-min mark. Fire 1 AI disruption at 6-min mark. Liquidation happens automatically."
  },
  {
    round:4, name:"Sector Wars",    color:"#f97316", icon:"⚔️",
    volMult:1.3,     sentLock:null,   leaderHidden:false,
    tax:true,        liquidate:false,
    disruptionPlan:{ atStart:[{type:"ai", count:1}], midRound:[{type:"political", eventHint:"trade_war"}] },
    briefing:"GM buffs 2 sectors and crashes 2 others at start. 20% profit tax at end.",
    gmNote:"At start: set 2 sectors BULL, 2 sectors BEAR. Fire AI disruption immediately. Fire Trade War at 5-min mark. Announce sectors being boosted/crashed to players."
  },
  {
    round:5, name:"Dark Pool",      color:"#a78bfa", icon:"🌑",
    volMult:1.0,     sentLock:null,   leaderHidden:true,
    tax:false,       liquidate:false,
    disruptionPlan:{ midRound:[{type:"ai", count:2}] },
    briefing:"LEADERBOARD HIDDEN for entire round. Trade on conviction alone. Two AI disruptions.",
    gmNote:"Hide leaderboard. Fire 2 AI disruptions at 3-min and 7-min marks. Reveal leaderboard only at round end ceremony."
  },
  {
    round:6, name:"Volatility Storm", color:"#fb923c", icon:"⚡",
    volMult:3.0,     sentLock:null,   leaderHidden:false,
    tax:true,        liquidate:false,
    disruptionPlan:{ atStart:[{type:"political", eventHint:"fed_rate_shock"}], midRound:[{type:"ai",count:1}] },
    briefing:"3× VOLATILITY on all stocks. Massive swings every tick. 20% profit tax at end.",
    gmNote:"Set volatility multiplier to 3. Fire Fed Rate Shock immediately. Fire 1 AI disruption at 4-min mark. Use the Circuit Breaker power-up card for drama."
  },
  {
    round:7, name:"Grand Final",    color:"#e879f9", icon:"🏆",
    volMult:2.0,     sentLock:null,   leaderHidden:false,
    tax:false,       liquidate:true,
    disruptionPlan:{ atStart:[{type:"political", eventHint:"oil_embargo"}], midRound:[{type:"ai",count:2}], late:[{type:"political",eventHint:"cyberwar"}] },
    briefing:"EQUAL CAPITAL RESTART. 2× volatility. GM fires all remaining power-up cards. No tax — winner takes all.",
    gmNote:"Liquidate and reset all teams to equal capital. Fire Oil Embargo at start. Two AI disruptions at 4-min and 8-min. Fire Cyberwar at 10-min. Use all remaining power-up cards freely."
  }
];

// Power-up cards (GM one-time use)
const POWERUP_CARDS = [
  { id:"tsunami",   icon:"🌊", name:"Tsunami",     color:"#ef4444", desc:"Entire market crashes 15% instantly",                effect:{ type:"market",    pct:-15 } },
  { id:"moonshot",  icon:"🚀", name:"Moon Shot",   color:"#fbbf24", desc:"One random stock surges 40% for 60 seconds",         effect:{ type:"spike",     pct:40, duration:60 } },
  { id:"circuit",   icon:"⛔", name:"Circuit Breaker", color:"#38bdf8", desc:"Market-wide trading halt for 45 seconds — prices pause as well", effect:{ type:"circuit", duration:45 } },
  { id:"rotation",  icon:"🔄", name:"Sector Rotation", color:"#e879f9", desc:"One sector rallies 12% while another drops 12% instantly",       effect:{ type:"rotation", pct:12 } },
  { id:"polshock",  icon:"🏛️", name:"Political Shock", color:"#f97316", desc:"Fire a random macro-economic political event mid-round — immediate sector-wide price impact", effect:{ type:"political" } },
];


// ─── PREDICTION MARKET QUESTIONS ──────────────────────────────────────────────
// One per round. Tests specific economic concept. No sector hints in question.
// GM sees correct answer + explanation. Players must reason from first principles.
const PREDICTION_QUESTIONS = [
  {
    round: 1,
    concept: "Supply and Demand",
    question: "The central bank signals it may raise interest rates next quarter. What happens to the overall market in the SHORT TERM?",
    options: [
      { id:"a", text:"Markets rise — investors celebrate economic strength" },
      { id:"b", text:"Markets fall — higher rates mean higher discount rates on future earnings" },
      { id:"c", text:"No effect — rates are only relevant to banks" },
      { id:"d", text:"Markets are unpredictable — fundamentals don't matter" },
    ],
    correct: "b",
    explanation: "Higher interest rates increase the discount rate in DCF valuation, reducing the present value of future cash flows. Growth stocks with far-future earnings are hit hardest. This is the core inverse relationship between rates and equity valuations.",
    bonus: 0.08
  },
  {
    round: 2,
    concept: "Monetary Policy & Asset Bubbles",
    question: "Central bank has flooded markets with cheap money for 2 years (QE). Sentiment is BULL. Which risk should prudent investors watch for?",
    options: [
      { id:"a", text:"Deflation — too much money causes prices to fall" },
      { id:"b", text:"Asset bubble — cheap money inflates valuations beyond fundamentals" },
      { id:"c", text:"Currency appreciation — more money means stronger currency" },
      { id:"d", text:"No risk — bull markets always continue" },
    ],
    correct: "b",
    explanation: "Quantitative easing lowers the risk-free rate and pushes investors into riskier assets (search for yield). This inflates asset prices beyond what fundamentals justify — creating an asset bubble. When rates eventually rise, valuations correct sharply.",
    bonus: 0.08
  },
  {
    round: 3,
    concept: "Negative Demand Shock & Defensive vs Cyclical",
    question: "The economy enters recession. GDP contracts 3%. Which portfolio strategy is most likely to PRESERVE capital?",
    options: [
      { id:"a", text:"All-in on manufacturing and logistics — infrastructure is always needed" },
      { id:"b", text:"Concentrate in healthcare and food — inelastic demand sectors" },
      { id:"c", text:"Buy more technology — innovation continues regardless of economy" },
      { id:"d", text:"All-in on ESG — green transition is unstoppable" },
    ],
    correct: "b",
    explanation: "Defensive sectors with price-inelastic demand (healthcare, food staples) are recession-resistant because consumers cannot defer these purchases. Cyclical sectors (manufacturing, logistics, tech) suffer as demand falls and capex is cut.",
    bonus: 0.08
  },
  {
    round: 4,
    concept: "Sector Rotation & Comparative Advantage",
    question: "Capital is visibly rotating between sectors. Two sectors are surging, two are crashing. What economic principle drives sector rotation?",
    options: [
      { id:"a", text:"Random walk — markets have no memory or pattern" },
      { id:"b", text:"Relative valuation and risk-adjusted return — capital flows to better risk/reward" },
      { id:"c", text:"Insider trading — institutions always know more" },
      { id:"d", text:"Calendar effects — certain months are always better" },
    ],
    correct: "b",
    explanation: "Sector rotation is driven by rational capital allocation — investors continuously compare risk-adjusted returns across sectors. When macro conditions change (e.g., rate hike), sectors with better relative value attract flows from those with worse outlooks.",
    bonus: 0.08
  },
  {
    round: 5,
    concept: "Information Asymmetry & Market Efficiency",
    question: "DARK POOL ROUND: You cannot see the leaderboard. How does hidden information affect rational decision-making?",
    options: [
      { id:"a", text:"No effect — prices already reflect all information (strong-form efficiency)" },
      { id:"b", text:"Forces you to trade on fundamentals alone — removes behavioural bias" },
      { id:"c", text:"Makes trading impossible — you need to know others' positions" },
      { id:"d", text:"Hidden information benefits everyone equally" },
    ],
    correct: "b",
    explanation: "Information asymmetry is a core market failure. When leaderboard data is removed, traders must rely on fundamental analysis rather than anchoring to others' positions. This tests pure economic reasoning — the same condition as trading illiquid assets with no comparable transactions.",
    bonus: 0.08
  },
  {
    round: 6,
    concept: "Stagflation — The Policy Dilemma",
    question: "STAGFLATION: High inflation AND slow growth simultaneously. Why is this the hardest macro regime for policymakers?",
    options: [
      { id:"a", text:"Rate hikes cure inflation but worsen growth — no good policy option exists" },
      { id:"b", text:"Fiscal stimulus solves both problems simultaneously" },
      { id:"c", text:"Central banks should ignore inflation and focus on growth" },
      { id:"d", text:"Stagflation is impossible — inflation and slow growth cannot coexist" },
    ],
    correct: "a",
    explanation: "Stagflation creates a policy dilemma: contractionary policy (rate hikes) fights inflation but further suppresses growth and increases unemployment. Expansionary policy boosts growth but worsens inflation. This is why 1970s stagflation was so damaging — no policy tool addresses both simultaneously.",
    bonus: 0.08
  },
  {
    round: 7,
    concept: "Full Market Cycle — Capital Allocation",
    question: "GRAND FINAL: All teams start equal at $100,000. You have 12 minutes. What does modern portfolio theory say about optimal allocation?",
    options: [
      { id:"a", text:"Concentrate in one sector — highest conviction gives highest return" },
      { id:"b", text:"Diversify across uncorrelated assets — maximise Sharpe ratio" },
      { id:"c", text:"All-in on the market index — passive beats active always" },
      { id:"d", text:"Hold 100% cash — preserve capital when uncertain" },
    ],
    correct: "b",
    explanation: "Modern Portfolio Theory (Markowitz) shows that diversification across uncorrelated assets improves the risk-adjusted return (Sharpe ratio) without sacrificing expected return. In a competitive simulation, the winner is often the team that balances return AND risk — not just the highest absolute gainer.",
    bonus: 0.08
  },
];
const ROUND_LABELS = [
  "R1 · Orientation","R2 · Bull Run","R3 · The Crash",
  "R4 · Sector Wars","R5 · Dark Pool","R6 · Volatility Storm","R7 · Grand Final"
];

// ─── 7 SECTORS × 5 MNC STOCKS EACH = 35 STOCKS ───────────────────────────────
const SECTORS = [
  {
    id:"healthcare", label:"Healthcare & Pharma", color:"#a78bfa", icon:"⚕️",
    stocks:[
      { ticker:"JNJ",  name:"Johnson & Johnson",  basePrice:165, volatility:0.9, mktCap:"$398B", employees:"152K", founded:1886, description:"World's largest healthcare company spanning pharmaceuticals, medical devices, and consumer health products." },
      { ticker:"PFE",  name:"Pfizer",              basePrice:28,  volatility:1.3, mktCap:"$157B", employees:"83K",  founded:1849, description:"Global biopharmaceutical company known for COVID-19 vaccines, oncology, and rare disease treatments." },
      { ticker:"NVO",  name:"Novo Nordisk",        basePrice:108, volatility:1.1, mktCap:"$432B", employees:"64K",  founded:1923, description:"Danish pharma leader dominating the global diabetes and obesity drug markets with GLP-1 therapies." },
      { ticker:"AZN",  name:"AstraZeneca",         basePrice:72,  volatility:1.0, mktCap:"$227B", employees:"83K",  founded:1999, description:"Anglo-Swedish multinational specializing in oncology, cardiovascular, and respiratory medicines." },
      { ticker:"UNH",  name:"UnitedHealth Group",  basePrice:520, volatility:0.8, mktCap:"$487B", employees:"400K", founded:1977, description:"America's largest health insurer and healthcare services company operating Optum and UnitedHealthcare." },
      { ticker:"ABBV", name:"AbbVie",              basePrice:172, volatility:1.0, mktCap:"$304B", employees:"50K",  founded:2013, description:"US biopharmaceutical leader known for Humira and Skyrizi, with a strong oncology and immunology pipeline." },
    ]
  },
  {
    id:"logistics", label:"Logistics", color:"#fb923c", icon:"🚚",
    stocks:[
      { ticker:"UPS",  name:"United Parcel Service", basePrice:138, volatility:1.0, mktCap:"$117B", employees:"500K", founded:1907, description:"Global leader in package delivery and supply chain management operating in 220+ countries." },
      { ticker:"FDX",  name:"FedEx",                 basePrice:245, volatility:1.2, mktCap:"$62B",  employees:"547K", founded:1971, description:"International courier and logistics services with $90B+ revenue serving 220+ countries." },
      { ticker:"MAER", name:"A.P. Møller-Maersk",    basePrice:112, volatility:1.3, mktCap:"$24B",  employees:"110K", founded:1904, description:"World's largest container shipping company controlling ~17% of global container capacity." },
      { ticker:"DHER", name:"DHL Group",              basePrice:38,  volatility:1.0, mktCap:"$31B",  employees:"600K", founded:1969, description:"World's leading logistics company with Express, Freight, Supply Chain, and eCommerce divisions." },
      { ticker:"XPO",  name:"XPO Logistics",          basePrice:92,  volatility:1.4, mktCap:"$11B",  employees:"42K",  founded:2000, description:"Tech-enabled freight transportation company operating the third-largest LTL network in North America." },
      { ticker:"EXPD", name:"Expeditors International", basePrice:118, volatility:1.1, mktCap:"$18B", employees:"19K", founded:1979, description:"Global logistics company specializing in air and ocean freight forwarding and customs brokerage." },
    ]
  },
  {
    id:"tech", label:"Tech & Manufacturing", color:"#38bdf8", icon:"💻",
    stocks:[
      { ticker:"AAPL", name:"Apple",               basePrice:185, volatility:1.1, mktCap:"$2.9T", employees:"164K", founded:1976, description:"The world's most valuable company, maker of iPhone, Mac, iPad, and Apple Silicon. Leader in premium consumer tech." },
      { ticker:"MSFT", name:"Microsoft",           basePrice:415, volatility:0.9, mktCap:"$3.1T", employees:"221K", founded:1975, description:"Enterprise software giant powering Azure cloud, Microsoft 365, GitHub, and the Copilot AI ecosystem." },
      { ticker:"TSLA", name:"Tesla",               basePrice:195, volatility:2.0, mktCap:"$620B", employees:"140K", founded:2003, description:"Electric vehicle and clean energy pioneer with global manufacturing and Full Self-Driving ambitions." },
      { ticker:"SMSN", name:"Samsung Electronics", basePrice:68,  volatility:1.2, mktCap:"$318B", employees:"270K", founded:1969, description:"South Korea's tech titan dominating memory chips, displays, and flagship Android smartphones globally." },
      { ticker:"SIEM", name:"Siemens",             basePrice:182, volatility:0.9, mktCap:"$112B", employees:"320K", founded:1847, description:"German industrial conglomerate leading in automation, digitalization, smart infrastructure, and rail systems." },
      { ticker:"NVDA", name:"NVIDIA",              basePrice:875, volatility:2.2, mktCap:"$2.1T", employees:"29K",  founded:1993, description:"Dominant AI chip and GPU maker whose H100 accelerators power the global artificial intelligence revolution." },
    ]
  },
  {
    id:"food", label:"Food & Agriculture", color:"#4ade80", icon:"🌾",
    stocks:[
      { ticker:"NESN", name:"Nestlé",                  basePrice:105, volatility:0.7, mktCap:"$283B", employees:"275K", founded:1866, description:"World's largest food and beverage company with 2000+ brands across 186 countries including Nescafé and KitKat." },
      { ticker:"ADM",  name:"Archer-Daniels-Midland",  basePrice:58,  volatility:1.1, mktCap:"$27B",  employees:"41K",  founded:1902, description:"Global agricultural commodities trader processing oilseeds, corn, wheat and producing food ingredients." },
      { ticker:"MDLZ", name:"Mondelēz International",  basePrice:68,  volatility:0.8, mktCap:"$91B",  employees:"91K",  founded:2012, description:"Snacking powerhouse behind Oreo, Cadbury, Milka, and Toblerone sold in 150+ countries worldwide." },
      { ticker:"BG",   name:"Bunge Global",            basePrice:92,  volatility:1.2, mktCap:"$11B",  employees:"23K",  founded:1818, description:"Leading agribusiness and food company linking farmers to consumers through grain and oilseed operations." },
      { ticker:"DANO", name:"Danone",                  basePrice:62,  volatility:0.8, mktCap:"$42B",  employees:"96K",  founded:1919, description:"French multinational in dairy, plant-based foods, waters, and specialized nutrition including Activia and Evian." },
      { ticker:"KO",   name:"Coca-Cola",               basePrice:62,  volatility:0.6, mktCap:"$267B", employees:"79K",  founded:1892, description:"World's most recognised beverage brand selling 2 billion servings daily across 200+ countries." },
    ]
  },
  {
    id:"banking", label:"Banking & Finance", color:"#fbbf24", icon:"🏦",
    stocks:[
      { ticker:"JPM",  name:"JPMorgan Chase",   basePrice:198, volatility:1.0, mktCap:"$573B", employees:"309K", founded:1799, description:"America's largest bank with $3.9T in assets, spanning investment banking, retail, and asset management." },
      { ticker:"GS",   name:"Goldman Sachs",    basePrice:468, volatility:1.3, mktCap:"$162B", employees:"45K",  founded:1869, description:"Wall Street's premier investment bank known for M&A advisory, trading, and capital markets." },
      { ticker:"HSBC", name:"HSBC Holdings",    basePrice:42,  volatility:1.0, mktCap:"$163B", employees:"220K", founded:1865, description:"Asia's largest bank with $3T assets operating across 62 countries in retail and investment banking." },
      { ticker:"BLK",  name:"BlackRock",        basePrice:808, volatility:0.9, mktCap:"$130B", employees:"21K",  founded:1988, description:"World's largest asset manager with $10T+ AUM, known for iShares ETFs and the Aladdin risk platform." },
      { ticker:"AXP",  name:"American Express", basePrice:225, volatility:1.1, mktCap:"$168B", employees:"74K",  founded:1850, description:"Premium credit card and financial services company known for Centurion, Platinum, and corporate travel cards." },
      { ticker:"MS",   name:"Morgan Stanley",   basePrice:102, volatility:1.2, mktCap:"$174B", employees:"80K",  founded:1935, description:"Global investment bank and wealth manager with $5T+ in client assets and top-tier M&A advisory." },
    ]
  },
  {
    id:"esg", label:"ESG", color:"#00f5c4", icon:"🌱",
    stocks:[
      { ticker:"ENPH",  name:"Enphase Energy",      basePrice:108, volatility:2.0, mktCap:"$14B", employees:"4K",  founded:2006, description:"Leading manufacturer of microinverter systems for residential and commercial solar energy generation." },
      { ticker:"VWSYF", name:"Vestas Wind Systems",  basePrice:24,  volatility:1.6, mktCap:"$17B", employees:"30K", founded:1945, description:"World's leading wind turbine manufacturer having installed 170+ GW across 88 countries worldwide." },
      { ticker:"BEP",   name:"Brookfield Renewable", basePrice:32,  volatility:1.3, mktCap:"$12B", employees:"4K",  founded:1999, description:"One of the world's largest publicly traded renewable power platforms with 33 GW of installed capacity." },
      { ticker:"ORSTED",name:"Ørsted",               basePrice:38,  volatility:1.8, mktCap:"$12B", employees:"8K",  founded:2006, description:"Danish energy company transformed from fossil fuels to become the world's top offshore wind developer." },
      { ticker:"FSLR",  name:"First Solar",          basePrice:188, volatility:1.9, mktCap:"$20B", employees:"8K",  founded:1999, description:"America's largest solar panel manufacturer using thin-film technology for utility-scale projects." },
      { ticker:"NEE",   name:"NextEra Energy",       basePrice:72,  volatility:1.1, mktCap:"$147B", employees:"15K", founded:1925, description:"America's largest electric utility and the world's leading generator of renewable wind and solar energy." },
    ]
  },
  {
    id:"energy", label:"Energy", color:"#f472b6", icon:"⚡",
    stocks:[
      { ticker:"XOM",  name:"ExxonMobil",    basePrice:108, volatility:1.1, mktCap:"$461B", employees:"61K",  founded:1870, description:"World's largest publicly traded oil and gas company spanning exploration, refining, and chemicals." },
      { ticker:"CVX",  name:"Chevron",        basePrice:152, volatility:1.0, mktCap:"$282B", employees:"43K",  founded:1879, description:"Integrated energy company with major upstream, downstream, and chemical operations in 180+ countries." },
      { ticker:"SHEL", name:"Shell",          basePrice:68,  volatility:1.0, mktCap:"$207B", employees:"103K", founded:1907, description:"Anglo-Dutch energy giant leading in LNG, integrated gas, and transitioning toward renewable energy solutions." },
      { ticker:"BP",   name:"BP",             basePrice:38,  volatility:1.2, mktCap:"$95B",  employees:"90K",  founded:1908, description:"British energy major pivoting toward low-carbon energy while maintaining significant oil and gas production." },
      { ticker:"TTE",  name:"TotalEnergies",  basePrice:65,  volatility:1.1, mktCap:"$148B", employees:"101K", founded:1924, description:"French multinational energy company integrating oil, gas, renewables and electricity across 130+ countries." },
      { ticker:"SLB",  name:"SLB (Schlumberger)", basePrice:48, volatility:1.3, mktCap:"$68B", employees:"99K", founded:1926, description:"World's largest oilfield services company providing drilling, evaluation, and production technology globally." },
    ]
  },
  {
    id:"manufacturing", label:"Manufacturing & Industrials", color:"#f97316", icon:"🏭",
    stocks:[
      { ticker:"CAT",  name:"Caterpillar",         basePrice:352, volatility:1.1, mktCap:"$178B", employees:"113K", founded:1925, description:"World's largest construction and mining equipment maker. A bellwether for global infrastructure spend and commodity cycles." },
      { ticker:"HON",  name:"Honeywell",            basePrice:198, volatility:0.9, mktCap:"$132B", employees:"99K",  founded:1906, description:"Industrial conglomerate spanning aerospace, building automation, safety tech and advanced materials across 100+ countries." },
      { ticker:"MMM",  name:"3M",                  basePrice:112, volatility:1.1, mktCap:"$61B",  employees:"85K",  founded:1902, description:"Diversified manufacturer behind 60,000+ products from Post-it notes to surgical drapes, N95 masks and optical films." },
      { ticker:"GE",   name:"GE Aerospace",         basePrice:175, volatility:1.3, mktCap:"$190B", employees:"172K", founded:1892, description:"Spun-off aviation division of General Electric making jet engines for 70% of commercial flights worldwide." },
      { ticker:"ABB",  name:"ABB",                 basePrice:48,  volatility:1.0, mktCap:"$98B",  employees:"105K", founded:1988, description:"Swiss-Swedish electrification and automation giant powering factories, grids and EV charging infrastructure globally." },
      { ticker:"EMR",  name:"Emerson Electric",    basePrice:108, volatility:1.0, mktCap:"$62B",  employees:"76K",  founded:1890, description:"Industrial automation leader supplying process control, HVAC and measurement instruments to energy and chemical plants." },
    ]
  },
  {
    id:"etf", label:"Index Funds & ETFs", color:"#e879f9", icon:"📊",
    stocks:[
      {
        ticker:"BPHX",
        name:"Bull Pit Healthcare Index",
        basePrice:95,
        volatility:0.85,
        mktCap:"$42B",
        employees:"N/A",
        founded:2024,
        description:"Tracks JNJ, PFE, NVO, AZN, UNH & ABBV. Equal-weighted basket of all 6 healthcare & pharma stocks in the simulation. Defensive, low-drama.",
        constituents:["JNJ","PFE","NVO","AZN","UNH","ABBV"]
      },
      {
        ticker:"BTEC",
        name:"Bull Pit Tech Giants Fund",
        basePrice:350,
        volatility:1.4,
        mktCap:"$128B",
        employees:"N/A",
        founded:2024,
        description:"Tracks AAPL, MSFT, NVDA, TSLA & SIEM. Captures the full Bull Pit tech sector. NVDA's 2.2x volatility makes this fund swing hard.",
        constituents:["AAPL","MSFT","NVDA","TSLA","SIEM"]
      },
      {
        ticker:"BGRN",
        name:"Bull Pit Green Future ETF",
        basePrice:88,
        volatility:1.6,
        mktCap:"$19B",
        employees:"N/A",
        founded:2024,
        description:"Tracks ENPH, FSLR, NEE, BEP & ORSTED. Pure-play renewable energy basket. Explodes on climate policy events, crashes on rate hikes.",
        constituents:["ENPH","FSLR","NEE","BEP","ORSTED"]
      },
      {
        ticker:"BFIN",
        name:"Bull Pit Global Finance Index",
        basePrice:325,
        volatility:1.05,
        mktCap:"$86B",
        employees:"N/A",
        founded:2024,
        description:"Tracks JPM, GS, BLK, MS & HSBC. Covers investment banking, asset management and retail banking. Sensitive to Fed rate shocks and sanctions.",
        constituents:["JPM","GS","BLK","MS","HSBC"]
      },
      {
        ticker:"BCMD",
        name:"Bull Pit Commodity & Energy ETF",
        basePrice:90,
        volatility:1.15,
        mktCap:"$31B",
        employees:"N/A",
        founded:2024,
        description:"Tracks XOM, CVX, SLB, ADM & BG. Blends oil majors with agricultural commodity giants. Surges on supply shocks, trade wars and embargoes.",
        constituents:["XOM","CVX","SLB","ADM","BG"]
      },
      {
        ticker:"BMFG",
        name:"Bull Pit Industrials Index",
        basePrice:165,
        volatility:1.05,
        mktCap:"$58B",
        employees:"N/A",
        founded:2024,
        description:"Tracks CAT, HON, MMM, GE, ABB & EMR. Equal-weighted basket of all 6 manufacturing & industrial stocks. Surges on infrastructure booms, tanks on supply chain crises.",
        constituents:["CAT","HON","MMM","GE","ABB","EMR"]
      },
      {
        ticker:"BDEF",
        name:"Bull Pit Defensive All-Weather Fund",
        basePrice:168,
        volatility:0.75,
        mktCap:"$74B",
        employees:"N/A",
        founded:2024,
        description:"CROSS-SECTOR: Picks the steadiest names from Healthcare, Food, Banking & ESG — JNJ, UNH, KO, NESN, JPM, HSBC & NEE. Lowest volatility fund in the game. Capital preservation over growth.",
        constituents:["JNJ","UNH","KO","NESN","JPM","HSBC","NEE"],
        crossSector:true
      },
      {
        ticker:"BCRSH",
        name:"Bull Pit Crisis Hedge Index",
        basePrice:82,
        volatility:1.1,
        mktCap:"$28B",
        employees:"N/A",
        founded:2024,
        description:"CROSS-SECTOR: Built for storms — draws from Healthcare, Energy & ESG defensives. Tracks NVO, PFE, XOM, BEP, ORSTED, JNJ & ADM. Historically outperforms when political shocks hit.",
        constituents:["NVO","PFE","XOM","BEP","ORSTED","JNJ","ADM"],
        crossSector:true
      },
      {
        ticker:"BGROW",
        name:"Bull Pit Growth Engine ETF",
        basePrice:265,
        volatility:1.85,
        mktCap:"$52B",
        employees:"N/A",
        founded:2024,
        description:"CROSS-SECTOR: High-octane growth across Tech & ESG. Tracks NVDA, TSLA, ENPH, FSLR, AAPL, VWSYF & MSFT. Highest upside of any fund — and highest downside.",
        constituents:["NVDA","TSLA","ENPH","FSLR","AAPL","VWSYF","MSFT"],
        crossSector:true
      },
      {
        ticker:"BALL",
        name:"Bull Pit Total Market Index",
        basePrice:155,
        volatility:0.95,
        mktCap:"$420B",
        employees:"N/A",
        founded:2024,
        description:"TOTAL MARKET: Tracks every single stock in the Bull Pit universe — all 53 stocks across all 9 sectors, equal weighted. The ultimate diversified play. If the whole market moves, so do you.",
        constituents:["JNJ","PFE","NVO","AZN","UNH","ABBV","UPS","FDX","MAER","DHER","XPO","EXPD","AAPL","MSFT","TSLA","SMSN","SIEM","NVDA","NESN","ADM","MDLZ","BG","DANO","KO","JPM","GS","HSBC","BLK","AXP","MS","ENPH","VWSYF","BEP","ORSTED","FSLR","NEE","XOM","CVX","SHEL","BP","TTE","SLB","CAT","HON","MMM","GE","ABB","EMR","BPHX","BTEC","BGRN","BFIN","BCMD"],
        crossSector:true,
        totalMarket:true
      },
    ]
  }
];

// Flatten all stocks with sector info
const ALL_STOCKS = SECTORS.flatMap(s =>
  s.stocks.map(st => ({ ...st, sectorId: s.id, sectorLabel: s.label, color: s.color }))
);

// ETF constituent map — ticker → array of constituent tickers
const ETF_CONSTITUENTS = Object.fromEntries(
  ALL_STOCKS
    .filter(s => s.constituents)
    .map(s => [s.ticker, s.constituents])
);

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
    id:"rate_hike_emergency",
    icon:"📈",
    headline:"Central Bank Raises Interest Rates by 200 Basis Points",
    subheadline:"Emergency monetary tightening announced to combat runaway inflation",
    concept:"Contractionary monetary policy — higher rates increase cost of capital, hurt growth stocks, help banks via NIM expansion, crush bond-proxy equities",
    sectors:{ banking:22, healthcare:-8, esg:-32, tech:-20, food:-6, logistics:-10, energy:-5, manufacturing:-14, etf:-18 }
  },
  {
    id:"rate_cut_pivot",
    icon:"📉",
    headline:"Central Bank Pivots — Cuts Rates to Near-Zero",
    subheadline:"Dovish pivot signals end of tightening cycle; liquidity flooding markets",
    concept:"Expansionary monetary policy — cheap money boosts growth stocks, ESG, tech; banks lose NIM; risk-on environment drives equities broadly",
    sectors:{ banking:-15, esg:35, tech:28, manufacturing:18, logistics:12, food:8, healthcare:5, energy:10, etf:20 }
  },
  {
    id:"quantitative_easing",
    icon:"💵",
    headline:"Central Bank Launches $2 Trillion Quantitative Easing Programme",
    subheadline:"Asset purchase programme injects liquidity into financial system",
    concept:"QE expands money supply, inflates asset prices, devalues currency — benefits real assets, equities; hurts cash holders; creates inflationary pressure",
    sectors:{ esg:30, tech:22, manufacturing:15, banking:10, energy:18, food:12, healthcare:8, logistics:10, etf:25 }
  },
  {
    id:"inflation_cpi_shock",
    icon:"🔥",
    headline:"Consumer Price Index Hits 40-Year High",
    subheadline:"Inflation at 12.4% forces emergency economic summit",
    concept:"Cost-push and demand-pull inflation — commodity producers win, manufacturers squeezed on margins, consumers reduce discretionary spend, real wages fall",
    sectors:{ energy:28, food:22, banking:-10, esg:-18, tech:-15, manufacturing:-20, logistics:-12, healthcare:-5, etf:-14 }
  },
  {
    id:"deflation_spiral",
    icon:"❄️",
    headline:"Economy Enters Deflationary Spiral — Prices Fall Third Consecutive Month",
    subheadline:"Falling prices trigger demand destruction and corporate earnings warnings",
    concept:"Deflation causes consumers to defer spending, hurts corporate revenues, increases real debt burden — defensives outperform, commodities crash",
    sectors:{ healthcare:15, food:10, banking:-18, energy:-25, manufacturing:-22, logistics:-15, tech:-12, esg:-8, etf:-16 }
  },

  // ── FISCAL POLICY EVENTS ──────────────────────────────────────────────────
  {
    id:"fiscal_stimulus",
    icon:"🏗️",
    headline:"Government Announces $5 Trillion Infrastructure Spending Package",
    subheadline:"Multi-year public investment programme passed with bipartisan support",
    concept:"Expansionary fiscal policy via government expenditure — multiplier effect boosts aggregate demand, benefits capital goods producers, creates jobs",
    sectors:{ manufacturing:40, logistics:28, energy:18, banking:15, esg:14, tech:10, food:5, healthcare:3, etf:16 }
  },
  {
    id:"austerity_measures",
    icon:"✂️",
    headline:"Government Announces Emergency Austerity — Cuts Spending by 30%",
    subheadline:"Sovereign debt crisis forces drastic fiscal consolidation",
    concept:"Contractionary fiscal policy reduces aggregate demand — government contractors suffer, healthcare spending cut, defensive sectors stabilise",
    sectors:{ manufacturing:-28, logistics:-20, healthcare:-22, banking:-10, esg:-15, tech:-8, food:5, energy:2, etf:-18 }
  },
  {
    id:"carbon_tax",
    icon:"🌡️",
    headline:"Landmark Carbon Pricing Legislation Enacted — $150 Per Tonne",
    subheadline:"Polluters face immediate compliance costs; exemptions denied",
    concept:"Pigouvian tax corrects negative externality — increases costs for polluters, creates competitive advantage for clean producers, drives substitution",
    sectors:{ energy:-32, manufacturing:-20, esg:42, logistics:-12, food:-8, tech:15, banking:5, healthcare:3, etf:8 }
  },
  {
    id:"sovereign_default",
    icon:"💀",
    headline:"Major Economy Declares Sovereign Debt Default",
    subheadline:"Government unable to service $3.2 trillion in outstanding obligations",
    concept:"Debt default triggers contagion — banking sector exposed via bond holdings, capital flight from risk assets, safe-haven demand spikes",
    sectors:{ banking:-38, esg:-20, tech:-15, manufacturing:-18, logistics:-15, healthcare:12, food:8, energy:5, etf:-28 }
  },

  // ── SUPPLY-SIDE SHOCKS ────────────────────────────────────────────────────
  {
    id:"oil_supply_shock",
    icon:"🛢️",
    headline:"OPEC+ Announces Coordinated 40% Production Cut",
    subheadline:"Cartel exercises pricing power as inventories hit multi-decade lows",
    concept:"Negative supply shock — cost-push inflation, energy windfall, manufacturing margin compression, transport costs surge, substitution to renewables",
    sectors:{ energy:38, esg:22, food:-18, logistics:-24, manufacturing:-16, banking:-8, tech:-10, healthcare:-6, etf:-12 }
  },
  {
    id:"semiconductor_shortage",
    icon:"💾",
    headline:"Global Semiconductor Shortage Reaches Critical Level",
    subheadline:"Lead times extend to 52 weeks as fab capacity exhausted",
    concept:"Bottleneck in complementary goods — industries requiring chips face production halts; chip producers gain pricing power; substitution impossible in short run",
    sectors:{ tech:-18, manufacturing:-30, logistics:-12, banking:-8, energy:5, esg:-5, healthcare:-10, food:-3, etf:-16 }
  },
  {
    id:"labour_strike",
    icon:"✊",
    headline:"Global Dockworkers Strike Enters Third Week",
    subheadline:"Port shutdowns across 40 countries halting $800B in trade",
    concept:"Labour market shock reduces productive capacity — supply constrained, inventories depleted, input costs rise for manufacturers and retailers",
    sectors:{ logistics:-35, manufacturing:-25, food:-18, energy:10, tech:-10, banking:-8, healthcare:-5, esg:-5, etf:-15 }
  },
  {
    id:"commodity_supercycle",
    icon:"⛏️",
    headline:"Commodity Supercycle Declared — Raw Material Prices at Record Highs",
    subheadline:"Synchronised global demand surge exhausts commodity inventories",
    concept:"Commodity supercycle driven by underinvestment in supply meeting demand surge — resource producers profit, downstream industries face margin compression",
    sectors:{ energy:32, manufacturing:-22, food:18, logistics:-15, esg:10, banking:8, tech:-8, healthcare:-3, etf:5 }
  },

  // ── TRADE AND GLOBALISATION ───────────────────────────────────────────────
  {
    id:"trade_war_escalation",
    icon:"⚔️",
    headline:"Sweeping Tariffs Announced — 60% on All Imported Manufactured Goods",
    subheadline:"Retaliatory measures expected from trading partners within 48 hours",
    concept:"Trade protectionism raises costs of imported inputs, disrupts global value chains, domestic producers benefit temporarily but overall welfare falls",
    sectors:{ manufacturing:-20, logistics:-22, tech:-18, food:-14, banking:-12, energy:8, healthcare:5, esg:-8, etf:-16 }
  },
  {
    id:"free_trade_agreement",
    icon:"🤝",
    headline:"Historic Multilateral Free Trade Agreement Signed by 80 Nations",
    subheadline:"Largest trade liberalisation in history eliminates barriers across $28T in trade",
    concept:"Trade liberalisation increases comparative advantage specialisation, lowers consumer prices, expands market access — logistics and exporting industries benefit most",
    sectors:{ logistics:28, manufacturing:22, food:15, tech:18, banking:12, energy:10, esg:8, healthcare:5, etf:16 }
  },
  {
    id:"currency_crisis",
    icon:"💱",
    headline:"Reserve Currency Loses 25% of Value in 48-Hour Flash Crash",
    subheadline:"Currency intervention fails as speculative attack overwhelms reserves",
    concept:"Currency devaluation makes exports cheap, imports expensive — exporters win, import-dependent industries lose; foreign debt becomes more expensive",
    sectors:{ tech:18, energy:15, food:-14, manufacturing:10, logistics:-16, banking:-22, healthcare:5, esg:-10, etf:-8 }
  },

  // ── MARKET STRUCTURE EVENTS ───────────────────────────────────────────────
  {
    id:"antitrust_breakup",
    icon:"⚖️",
    headline:"Antitrust Authorities Order Forced Breakup of Dominant Market Players",
    subheadline:"Monopoly power dismantled — divestiture mandated within 90 days",
    concept:"Antitrust intervention corrects monopoly market failure — competitive entry increases, prices fall, incumbent loses pricing power, innovation accelerates",
    sectors:{ tech:-30, banking:12, healthcare:10, esg:5, logistics:-5, food:3, energy:2, manufacturing:-8, etf:-15 }
  },
  {
    id:"market_failure_fraud",
    icon:"🚨",
    headline:"Information Asymmetry Crisis — Systemic Accounting Fraud Uncovered",
    subheadline:"Regulators freeze trading in 40 major companies pending investigation",
    concept:"Market failure from information asymmetry — rational market impossible without accurate pricing; trust collapses, adverse selection, regulatory overreach follows",
    sectors:{ banking:-32, tech:-18, esg:-24, manufacturing:-15, logistics:-12, healthcare:-8, food:-5, energy:-6, etf:-26 }
  },
  {
    id:"natural_monopoly_regulation",
    icon:"🏛️",
    headline:"Regulators Impose Price Caps on Essential Services Sector",
    subheadline:"Price ceiling set 40% below market rate citing public interest",
    concept:"Price ceiling below equilibrium creates shortage — producers exit, quality falls, black markets emerge; regulation often produces unintended consequences",
    sectors:{ healthcare:-28, energy:-15, logistics:-10, manufacturing:-8, banking:5, tech:5, food:-12, esg:3, etf:-12 }
  },
  {
    id:"mega_merger",
    icon:"🏢",
    headline:"Largest Corporate Merger in History Announced — $900B Deal",
    subheadline:"Consolidation creates entity controlling 35% of global market share",
    concept:"Horizontal merger creates economies of scale but reduces competition — merger arbitrage opportunity, industry rationalisation, regulatory uncertainty",
    sectors:{ manufacturing:25, logistics:18, banking:15, tech:10, energy:8, food:5, healthcare:5, esg:3, etf:14 }
  },

  // ── DEMAND-SIDE SHOCKS ────────────────────────────────────────────────────
  {
    id:"recession_declaration",
    icon:"📊",
    headline:"Economy Officially Enters Recession — Two Consecutive Quarters of Negative GDP",
    subheadline:"Unemployment rises to 9.2%; consumer confidence at historic low",
    concept:"Recessionary demand shock — Keynesian multiplier in reverse; income effect reduces all spending; defensive sectors maintain but cyclicals collapse",
    sectors:{ healthcare:18, food:12, banking:-20, manufacturing:-28, logistics:-22, tech:-15, energy:-18, esg:-12, etf:-20 }
  },
  {
    id:"consumer_boom",
    icon:"🛒",
    headline:"Consumer Confidence Hits All-Time High — Household Spending Surges 18%",
    subheadline:"Post-recession pent-up demand unleashed as employment recovers",
    concept:"Positive demand shock via increased consumer spending — multiplier effect boosts aggregate demand; cyclical sectors outperform; capacity utilisation rises",
    sectors:{ food:22, tech:18, manufacturing:20, logistics:25, banking:15, healthcare:8, energy:12, esg:10, etf:18 }
  },
  {
    id:"demographic_shift",
    icon:"👥",
    headline:"Ageing Population Report: One in Three Citizens Over 65 by 2030",
    subheadline:"Structural demographic shift redraws economic demand landscape",
    concept:"Demographic demand shift — secular increase in healthcare demand; pension fund behaviour changes bond/equity allocation; labour supply contracts",
    sectors:{ healthcare:28, food:12, banking:10, esg:5, tech:-8, manufacturing:-15, logistics:-5, energy:-8, etf:5 }
  },

  // ── TECHNOLOGICAL DISRUPTION ──────────────────────────────────────────────
  {
    id:"ai_productivity_leap",
    icon:"🤖",
    headline:"AI Breakthrough Promises 40% Productivity Gains Across Knowledge Industries",
    subheadline:"Autonomous systems deployed in professional services and manufacturing",
    concept:"Technological progress shifts production possibility frontier — labour-saving tech increases output per worker, creative destruction displaces incumbents",
    sectors:{ tech:35, manufacturing:15, banking:10, logistics:12, healthcare:8, food:5, energy:-5, esg:8, etf:20 }
  },
  {
    id:"energy_transition",
    icon:"⚡",
    headline:"Renewable Energy Achieves Grid Parity — Cost Equals Fossil Fuels",
    subheadline:"Structural shift in energy economics as renewables become cost-competitive",
    concept:"Technological disruption via substitute goods — renewables become viable substitute for fossil fuels, stranded asset risk emerges, creative destruction of oil majors",
    sectors:{ esg:40, energy:-30, manufacturing:12, tech:10, banking:5, food:3, logistics:-5, healthcare:2, etf:8 }
  },
];


const DEFAULT_TEAMS = [
  { id:"t1", name:"Alpha Squad",      password:"alpha123", color:"#00f5c4" },
  { id:"t2", name:"Bull Runners",     password:"bull456",  color:"#fbbf24" },
  { id:"t3", name:"Bear Force",       password:"bear789",  color:"#f472b6" },
  { id:"t4", name:"Quantum Traders",  password:"quant321", color:"#a78bfa" },
  { id:"t5", name:"Solar Surge",      password:"solar654", color:"#38bdf8" },
  { id:"t6", name:"Dark Pool",        password:"dark987",  color:"#fb923c" },
];

const AI_BOTS = [
  { id:"bot_m", name:"MOMENTUM", avatar:"M", color:"#00f5c4",
    personality:"aggressive momentum trader who chases breakouts and hot sectors" },
  { id:"bot_w", name:"WARREN.AI", avatar:"W", color:"#fbbf24",
    personality:"patient value investor buying MNC blue chips and holding through volatility" },
  { id:"bot_s", name:"SCALP-3",  avatar:"S", color:"#f472b6",
    personality:"high-frequency scalper making many small trades across different sectors" },
];

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
  const ic    = initCash || INITIAL_CASH;
  const total = entry.total || ic;
  const cash  = entry.cash  || ic;

  // ── TIER 1: PERFORMANCE (50 pts) ──────────────────────────────────────────

  // 1A. Absolute Return (15pts)
  //     Formula: (total - initCash) / initCash × 100
  //     Range: clamped −30% to +200% → mapped to 0–15 pts
  const absoluteReturn = ((total - ic) / ic) * 100;
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
  const ballReturn  = entry.ballReturn || 0; // % return of BALL this session
  const alpha       = absoluteReturn - ballReturn;
  const t1c = clamp((alpha + 20) / 60 * 12, 0, 12);

  // 1D. Round Consistency (8pts)
  //     Formula: geometric mean of per-round return snapshots
  //     Penalises one-lucky-round players; rewards sustained performance
  //     entry.roundReturns = array of % returns per completed round
  const roundReturns = entry.roundReturns || [];
  let consistency = 0;
  if (roundReturns.length > 0) {
    const geomMean = Math.pow(
      roundReturns.reduce((prod, r) => prod * (1 + r/100), 1),
      1 / roundReturns.length
    ) - 1;
    consistency = geomMean * 100;
  }
  const t1d = clamp((consistency + 5) / 15 * 8, 0, 8);

  const tier1 = t1a + t1b + t1c + t1d;  // max 50

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
  const beta    = entry.beta !== undefined ? Math.abs(entry.beta) : 0.5;
  const t2c     = clamp((1 - beta) * 10, 0, 10);

  const tier2 = t2a + t2b + t2c;  // max 30

  // ── TIER 3: TRADING QUALITY (20 pts) ──────────────────────────────────────

  // 3A. Win Rate on Closed Trades (8pts)
  //     Formula: wins / closedTrades × 100
  //     Default 50% if no trades (neutral — neither rewarded nor penalised)
  const winRate = entry.closedTrades > 0
    ? (entry.wins / entry.closedTrades) * 100
    : 50;
  const t3a = clamp(winRate / 100 * 8, 0, 8);

  // 3B. Sector Diversification — Time-Weighted (7pts)
  //     Formula: unique sectors held, capped at 9 (all sectors)
  //     Uses uniqueSectors count as proxy for time-weighted exposure
  const sectors = Math.min(9, entry.uniqueSectors || 0);
  const t3b = (sectors / 9) * 7;

  // 3C. Prediction Accuracy — Economic Knowledge (5pts)
  //     Formula: correct predictions / total predictions × 5
  //     Tests whether teams understand the macro theory behind events
  const predTotal   = entry.predTotal   || 0;
  const predCorrect = entry.predCorrect || 0;
  const predRate    = predTotal > 0 ? predCorrect / predTotal : 0;
  const t3c         = predRate * 5;

  const tier3 = t3a + t3b + t3c;  // max 20

  // ── COMPOSITE SCORE ───────────────────────────────────────────────────────
  const score = tier1 + tier2 + tier3;

  // ── TIEBREAKER FIELDS (sequential) ────────────────────────────────────────
  // TB1: Calmar ratio (higher wins)
  // TB2: Max drawdown (lower wins → negate)
  // TB3: Alpha vs market (higher wins)
  // TB4: Unique sectors (higher wins)
  // TB5: Last trade timestamp (earlier wins → negate)
  const tb1 = +calmar.toFixed(4);
  const tb2 = -maxDrawdown;                          // negated: lower DD = higher tiebreaker
  const tb3 = +alpha.toFixed(4);
  const tb4 = sectors;
  const tb5 = -(entry.lastTradeTs || Date.now());    // negated: earlier = higher tiebreaker

  return {
    score:         +score.toFixed(3),
    // Tier scores
    tier1, tier2, tier3,
    // Individual indicators
    absoluteReturn: +absoluteReturn.toFixed(2),
    sharpe:         +sharpe.toFixed(3),
    alpha:          +alpha.toFixed(2),
    consistency:    +consistency.toFixed(2),
    maxDrawdown:    +maxDrawdown.toFixed(2),
    calmar:         +calmar.toFixed(3),
    beta:           +beta.toFixed(3),
    winRate:        +winRate.toFixed(1),
    sectors,
    predRate:       +(predRate * 100).toFixed(1),
    // Point contributions (for scorecard transparency)
    t1a: +t1a.toFixed(2), t1b: +t1b.toFixed(2), t1c: +t1c.toFixed(2), t1d: +t1d.toFixed(2),
    t2a: +t2a.toFixed(2), t2b: +t2b.toFixed(2), t2c: +t2c.toFixed(2),
    t3a: +t3a.toFixed(2), t3b: +t3b.toFixed(2), t3c: +t3c.toFixed(2),
    // Tiebreaker values
    tb1, tb2, tb3, tb4, tb5,
    // Legacy fields (kept for compatibility)
    totalReturn: +absoluteReturn.toFixed(2),
    deployed: total > 0 ? +((Math.min(1,(total-cash)/total))*100).toFixed(1) : 0,
  };
}

// Sort leaderboard with tiebreaker chain
function sortLeaderboard(entries) {
  return [...entries].sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;  // primary
    if (Math.abs(b.tb1 - a.tb1) > 0.0001) return b.tb1 - a.tb1;        // TB1: Calmar
    if (Math.abs(b.tb2 - a.tb2) > 0.0001) return b.tb2 - a.tb2;        // TB2: -MaxDD
    if (Math.abs(b.tb3 - a.tb3) > 0.0001) return b.tb3 - a.tb3;        // TB3: Alpha
    if (b.tb4 !== a.tb4) return b.tb4 - a.tb4;                          // TB4: Sectors
    return b.tb5 - a.tb5;                                                // TB5: -lastTradeTs
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmt      = (n, d=2) => Number(n).toLocaleString("en-US", { minimumFractionDigits:d, maximumFractionDigits:d });
const fmtUSD   = n => "$" + fmt(n);
const fmtK     = n => Math.abs(n) >= 1000 ? (n<0?"-":"") + "$" + fmt(Math.abs(n)/1000,1) + "K" : fmtUSD(n);
const clamp    = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rnd      = (lo, hi) => lo + Math.random() * (hi - lo);
const fmtTS    = ts => new Date(ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
const fmtDT    = (ts, tf) => {
  const d = new Date(ts);
  if (tf==="5m"||tf==="15m") return d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"})+" "+fmtTS(ts);
  if (tf==="1h"||tf==="4h")  return d.toLocaleDateString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
  if (tf==="1D")              return d.toLocaleDateString([],{month:"long",day:"numeric",year:"numeric"});
  return d.toLocaleDateString([],{month:"short",year:"numeric"});
};
const nowShort = () => new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
const nowFull  = () => new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
const positionSide = pos => (pos?.qty || 0) < 0 ? "short" : "long";
const longQty = pos => Math.max(0, pos?.qty || 0);
const shortQty = pos => Math.max(0, -(pos?.qty || 0));
const grossPositionValue = (price, pos) => Math.abs((price || pos?.avgCost || 0) * (pos?.qty || 0));
const calcBallReturn = prices => {
  const ballPrice = prices?.BALL || BALL_BASE;
  return ((ballPrice - BALL_BASE) / BALL_BASE) * 100;
};

function calcVariance(values) {
  if (!values || values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
}

function calcCovariance(xs, ys) {
  if (!xs || !ys) return 0;
  const len = Math.min(xs.length, ys.length);
  if (len < 2) return 0;
  const xSlice = xs.slice(xs.length - len);
  const ySlice = ys.slice(ys.length - len);
  const xMean = xSlice.reduce((sum, value) => sum + value, 0) / len;
  const yMean = ySlice.reduce((sum, value) => sum + value, 0) / len;
  return xSlice.reduce((sum, value, index) => sum + (value - xMean) * (ySlice[index] - yMean), 0) / len;
}

function priceSeriesReturns(series = []) {
  const returns = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const next = series[i];
    if (!prev || !next) continue;
    returns.push((next - prev) / prev);
  }
  return returns;
}

function calcAssetBetaFromSeries(assetSeries = [], marketSeries = []) {
  const assetReturns = priceSeriesReturns(assetSeries);
  const marketReturns = priceSeriesReturns(marketSeries);
  const len = Math.min(assetReturns.length, marketReturns.length);
  if (len < 2) return null;
  const assetSlice = assetReturns.slice(assetReturns.length - len);
  const marketSlice = marketReturns.slice(marketReturns.length - len);
  const marketVariance = calcVariance(marketSlice);
  if (marketVariance <= 0) return null;
  return calcCovariance(assetSlice, marketSlice) / marketVariance;
}

function calcPortfolioBeta(holdings = {}, prices = {}, history = {}) {
  const entries = Object.entries(holdings).filter(([, pos]) => (pos?.qty || 0) !== 0);
  if (entries.length === 0) return 0.5;

  const marketSeries = history?.BALL || [];
  const grossExposure = entries.reduce((sum, [ticker, pos]) => (
    sum + grossPositionValue(prices[ticker], pos)
  ), 0);

  if (grossExposure <= 0) return 0.5;

  let beta = 0;
  let weightedCoverage = 0;
  entries.forEach(([ticker, pos]) => {
    const assetBeta = ticker === "BALL"
      ? 1
      : calcAssetBetaFromSeries(history?.[ticker] || [], marketSeries);
    if (assetBeta == null || !Number.isFinite(assetBeta)) return;
    const weight = grossPositionValue(prices[ticker], pos) / grossExposure;
    beta += weight * assetBeta * (positionSide(pos) === "short" ? -1 : 1);
    weightedCoverage += weight;
  });

  if (weightedCoverage <= 0) return 0.5;
  return beta;
}

function initPrices()  { return Object.fromEntries(ALL_STOCKS.map(s => [s.ticker, s.basePrice * (0.85 + Math.random() * 0.3)])); }
function initHistory(p){ return Object.fromEntries(ALL_STOCKS.map(s => [s.ticker, Array(HISTORY_LEN).fill(p[s.ticker])])); }
function initBots()    { return AI_BOTS.map(b => ({ ...b, cash:INITIAL_CASH, holdings:{}, pnl:0, trades:0, wins:0, closedTrades:0, maxDrawdown:1, uniqueSectors:0, peakValue:INITIAL_CASH })); }

// ─── PORTFOLIO ANALYTICS ─────────────────────────────────────────────────────
function PortfolioAnalytics({ holdings, transactions, prices, cash, initCash }) {
  const openPnL = {};
  Object.entries(holdings).forEach(([ticker, pos]) => {
    const cur = prices[ticker] || pos.avgCost;
    const direction = pos.qty < 0 ? -1 : 1;
    openPnL[ticker] = {
      unrealized: (cur - pos.avgCost) * pos.qty,
      pct: ((cur - pos.avgCost) / pos.avgCost) * 100 * direction,
      qty: pos.qty, avgCost: pos.avgCost, curPrice: cur,
      value: cur * pos.qty,
      side: positionSide(pos),
    };
  });
  const totalHoldingsValue = Object.values(openPnL).reduce((s,p) => s + p.value, 0);
  const grossExposure      = Object.values(openPnL).reduce((s,p) => s + Math.abs(p.value), 0);
  const shortExposure      = Object.values(openPnL).reduce((s,p) => s + (p.side === "short" ? Math.abs(p.value) : 0), 0);
  const totalUnrealized    = Object.values(openPnL).reduce((s,p) => s + p.unrealized, 0);
  const realizedByTicker = {};
  let totalRealized = 0, wins = 0, losses = 0;
  transactions.filter(t => t.type === "SELL" || t.type === "COVER").forEach(t => {
    const gain = t.gain ?? (t.type === "COVER"
      ? (t.avgCostAtCover - t.price) * t.qty
      : (t.price - t.avgCostAtSell) * t.qty);
    if (!realizedByTicker[t.ticker]) realizedByTicker[t.ticker] = 0;
    realizedByTicker[t.ticker] += gain;
    totalRealized += gain;
    if (gain > 0) wins++; else losses++;
  });
  const totalPnL = totalUnrealized + totalRealized;
  const totalVal = cash + totalHoldingsValue;
  const roi      = ((totalVal - initCash) / initCash) * 100;
  return { openPnL, totalHoldingsValue, totalUnrealized, totalRealized,
           totalPnL, roi, totalVal, wins, losses, realizedByTicker,
           grossExposure, shortExposure };
}

// ─── SPARKLINE ───────────────────────────────────────────────────────────────
function Spark({ data, color, w=100, h=32 }) {
  if (!data || data.length < 2) return <div style={{ width:w, height:h }} />;
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v,i) => `${(i/(data.length-1))*w},${h - ((v-mn)/rng)*(h-3) + 1}`).join(" ");
  const up = data[data.length-1] >= data[0];
  const c  = up ? color : "#ef4444";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display:"block", width:"100%" }}>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`${c}22`} />
      <polyline points={pts} fill="none" stroke={c} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── SECTOR BADGE ─────────────────────────────────────────────────────────────
function SectorBadge({ sectorId, small }) {
  const s = SECTORS.find(x => x.id === sectorId);
  if (!s) return null;
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", gap:3,
      fontSize: small ? 9 : 10, padding: small ? "1px 5px" : "2px 7px",
      borderRadius:4, border:`1px solid ${s.color}44`,
      background:`${s.color}18`, color:s.color, fontWeight:700,
      letterSpacing:"0.04em", whiteSpace:"nowrap"
    }}>
      {s.icon} {s.label}
    </span>
  );
}

// ─── LEADERBOARD PANEL ────────────────────────────────────────────────────────
function LeaderboardPanel({ entries, teams, initCash, highlight, showDetail, leaderHidden }) {
  const [expandedRow, setExpandedRow] = useState(null);

  if (!entries || entries.length === 0)
    return <div style={{ color:"#334155", fontSize:12, padding:"12px 0" }}>No players yet.</div>;

  if (leaderHidden) return (
    <div style={{ background:"#0a0f1e", border:"1px solid #a78bfa44", borderRadius:12,
      padding:"24px", textAlign:"center" }}>
      <div style={{ fontSize:32, marginBottom:8 }}>🌑</div>
      <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:14,
        color:"#a78bfa", marginBottom:6 }}>DARK POOL ROUND</div>
      <div style={{ fontSize:11, color:"#475569" }}>Leaderboard hidden — trade on conviction alone.</div>
    </div>
  );

  const ic = initCash || INITIAL_CASH;
  const scored  = entries.map(e => ({ ...e, ...calcScore(e, ic, entries) }));
  const ranked  = sortLeaderboard(scored);
  const maxScore = Math.max(ranked[0]?.score || 1, 1);

  // Rank each team on each individual indicator for percentile display
  const rankOn = (field, higherBetter=true) => {
    const sorted = [...ranked].sort((a,b) => higherBetter ? b[field]-a[field] : a[field]-b[field]);
    return Object.fromEntries(sorted.map((e,i) => [e.name, i+1]));
  };
  const rankReturn   = rankOn("absoluteReturn");
  const rankSharpe   = rankOn("sharpe");
  const rankAlpha    = rankOn("alpha");
  const rankDD       = rankOn("maxDrawdown", false); // lower DD = better rank
  const rankCalmar   = rankOn("calmar");
  const rankWinRate  = rankOn("winRate");
  const rankSectors  = rankOn("sectors");
  const rankPred     = rankOn("predRate");

  const n = ranked.length;
  const medalColor = (rank) => rank===1?"#fbbf24":rank===2?"#94a3b8":rank===3?"#cd7c2f":"#334155";
  const indColor   = (pts, max) => pts >= max*0.8 ? "#00f5c4" : pts >= max*0.5 ? "#fbbf24" : pts >= max*0.25 ? "#f97316" : "#ef4444";
  const rankBadge  = (rank) => rank <= 3
    ? <span style={{ fontSize:9, padding:"1px 5px", borderRadius:3, fontWeight:800,
        background:medalColor(rank)+"22", color:medalColor(rank) }}>#{rank}</span>
    : <span style={{ fontSize:9, color:"#334155" }}>#{rank}</span>;

  return (
    <div>
      {ranked.map((e, i) => {
        const team    = teams?.find(t => t.name === e.name);
        const color   = team?.color || e.color || "#64748b";
        const isMe    = e.name === highlight;
        const barPct  = clamp((e.score / maxScore) * 100, 0, 100);
        const isExpanded = expandedRow === e.name;
        // Detect if tiebreaker was used
        const tieWithPrev = i > 0 && Math.abs(ranked[i-1].score - e.score) < 0.001;

        return (
          <div key={e.name + i} style={{
            background: isMe ? "rgba(0,245,196,0.06)" : "#0a0f1e",
            border: `1px solid ${isMe ? "#00f5c460" : "#111827"}`,
            borderRadius:10, marginBottom:7, overflow:"hidden", transition:"all 0.3s"
          }}>
            {/* Main row */}
            <div style={{ padding:"11px 14px", cursor:"pointer" }}
              onClick={() => setExpandedRow(isExpanded ? null : e.name)}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                {/* Rank */}
                <div style={{ width:24, textAlign:"center",
                  fontFamily:"'Bebas Neue',sans-serif", fontSize:18,
                  color: i===0?"#fbbf24":i===1?"#94a3b8":i===2?"#cd7c2f":"#475569" }}>
                  {i+1}
                </div>
                {/* Name + color */}
                <div style={{ width:10, height:10, borderRadius:"50%",
                  background:color, flexShrink:0 }}/>
                <div style={{ flex:1, fontWeight:700, fontSize:12, color:isMe?"#00f5c4":color,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {e.name}{isMe ? " (YOU)" : ""}
                </div>
                {tieWithPrev && (
                  <span style={{ fontSize:8, padding:"1px 5px", borderRadius:3,
                    background:"#fbbf2415", color:"#fbbf24", border:"1px solid #fbbf2430" }}>
                    TIE→TB
                  </span>
                )}
                {/* Score */}
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20,
                    color: e.score >= 60 ? "#00f5c4" : e.score >= 40 ? "#fbbf24" : e.score >= 20 ? "#f97316" : "#ef4444" }}>
                    {e.score.toFixed(1)}
                  </div>
                  <div style={{ fontSize:8, color:"#334155" }}>/100 pts</div>
                </div>
                <div style={{ color:"#334155", fontSize:10 }}>{isExpanded?"▲":"▼"}</div>
              </div>
              {/* Score bar */}
              <div style={{ height:3, background:"#0f172a", borderRadius:2, marginBottom:5 }}>
                <div style={{ width:`${barPct}%`, height:"100%", background:color,
                  borderRadius:2, transition:"width 0.5s ease" }}/>
              </div>
              {/* Tier summary chips */}
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                {[
                  { label:"Performance", pts:e.tier1, max:50, color:"#38bdf8" },
                  { label:"Risk Mgmt",  pts:e.tier2, max:30, color:"#a78bfa" },
                  { label:"Quality",    pts:e.tier3, max:20, color:"#00f5c4" },
                ].map(tier => (
                  <span key={tier.label} style={{ fontSize:8, padding:"1px 6px", borderRadius:3,
                    background:`${tier.color}15`, color:tier.color, fontWeight:700 }}>
                    {tier.label} {tier.pts?.toFixed(1)}/{tier.max}
                  </span>
                ))}
                <span style={{ fontSize:8, color:"#475569", marginLeft:"auto" }}>
                  {e.absoluteReturn >= 0 ? "+" : ""}{e.absoluteReturn}% return
                </span>
              </div>
            </div>

            {/* Expanded scorecard */}
            {isExpanded && (
              <div style={{ borderTop:"1px solid #1e293b", padding:"14px",
                background:"#060c18", animation:"fadein 0.2s" }}>

                {/* Tier 1: Performance */}
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:9, color:"#38bdf8", fontWeight:800,
                    letterSpacing:"0.1em", marginBottom:8 }}>
                    TIER 1 — PERFORMANCE ({e.tier1?.toFixed(1)}/50 pts)
                  </div>
                  {[
                    { label:"Absolute Return", formula:"(Portfolio − Start) ÷ Start × 100", value:`${e.absoluteReturn >= 0?"+":""}${e.absoluteReturn}%`, pts:e.t1a, max:15, rank:rankReturn[e.name], n, tip:"Your raw profit as % of starting capital" },
                    { label:"Risk-Adj Return (Sharpe)", formula:"Return ÷ Max Drawdown", value:e.sharpe?.toFixed(2), pts:e.t1b, max:15, rank:rankSharpe[e.name], n, tip:"Higher = better return per unit of risk taken" },
                    { label:"Alpha vs Market", formula:"Your Return − BALL Index Return", value:`${e.alpha >= 0?"+":""}${e.alpha}%`, pts:e.t1c, max:12, rank:rankAlpha[e.name], n, tip:"Did you beat the total market benchmark?" },
                    { label:"Round Consistency", formula:"Geometric mean of per-round returns", value:`${e.consistency >= 0?"+":""}${e.consistency}%`, pts:e.t1d, max:8, rank:null, n, tip:"Penalises one-lucky-round players" },
                  ].map(ind => renderIndicator(ind, color))}
                </div>

                {/* Tier 2: Risk Management */}
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:9, color:"#a78bfa", fontWeight:800,
                    letterSpacing:"0.1em", marginBottom:8 }}>
                    TIER 2 — RISK MANAGEMENT ({e.tier2?.toFixed(1)}/30 pts)
                  </div>
                  {[
                    { label:"Max Drawdown Control", formula:"Inversely scaled — lower DD = more pts", value:`${e.maxDrawdown}%`, pts:e.t2a, max:10, rank:rankDD[e.name], n, tip:"Peak-to-trough loss. Lower = more disciplined" },
                    { label:"Calmar Ratio", formula:"Return ÷ Max Drawdown", value:e.calmar?.toFixed(3), pts:e.t2b, max:10, rank:rankCalmar[e.name], n, tip:"Primary tiebreaker. Rewards efficient risk use" },
                    { label:"Portfolio Beta", formula:"cov(asset, BALL) / var(BALL)", value:e.beta?.toFixed(3), pts:e.t2c, max:10, rank:null, n, tip:"Low absolute beta = less dependence on the market benchmark" },
                  ].map(ind => renderIndicator(ind, color))}
                </div>

                {/* Tier 3: Trading Quality */}
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:9, color:"#00f5c4", fontWeight:800,
                    letterSpacing:"0.1em", marginBottom:8 }}>
                    TIER 3 — TRADING QUALITY ({e.tier3?.toFixed(1)}/20 pts)
                  </div>
                  {[
                    { label:"Win Rate", formula:"Profitable closes ÷ Total closes × 100", value:`${e.winRate}%`, pts:e.t3a, max:8, rank:rankWinRate[e.name], n, tip:"% of your closed long and short trades that made money" },
                    { label:"Sector Diversification", formula:"Unique sectors held (max 9)", value:`${e.sectors}/9 sectors`, pts:e.t3b, max:7, rank:rankSectors[e.name], n, tip:"Rewards spreading risk across industries" },
                    { label:"Prediction Accuracy", formula:"Correct economic predictions ÷ Total", value:`${e.predRate}%`, pts:e.t3c, max:5, rank:rankPred[e.name], n, tip:"% of prediction market questions answered correctly" },
                  ].map(ind => renderIndicator(ind, color))}
                </div>

                {/* Tiebreaker info */}
                {tieWithPrev && (
                  <div style={{ background:"#fbbf2408", border:"1px solid #fbbf2430",
                    borderRadius:6, padding:"8px 10px", fontSize:9, color:"#fbbf24" }}>
                    <div style={{ fontWeight:700, marginBottom:4 }}>TIEBREAKER APPLIED</div>
                    <div style={{ color:"#94a3b8", lineHeight:1.7 }}>
                      Same composite score as the team above. Resolved by:
                      Calmar Ratio ({e.calmar?.toFixed(3)}) →
                      Max Drawdown ({e.maxDrawdown}%) →
                      Alpha ({e.alpha}%) →
                      Sectors ({e.sectors})
                    </div>
                  </div>
                )}

                {/* Plain English summary */}
                <div style={{ marginTop:10, padding:"8px 10px", background:"#0a0f1e",
                  borderRadius:6, border:"1px solid #1e293b", fontSize:10,
                  color:"#64748b", lineHeight:1.7 }}>
                  <span style={{ color:"#f1f5f9", fontWeight:700 }}>Summary: </span>
                  {e.absoluteReturn > 0
                    ? `Generated ${e.absoluteReturn}% return`
                    : `Lost ${Math.abs(e.absoluteReturn)}% of capital`}.
                  {" "}Ranked #{rankAlpha[e.name] || "?"} in alpha vs market
                  {" "}and #{rankDD[e.name] || "?"} in risk control.
                  {" "}{e.winRate >= 60 ? "Strong" : e.winRate >= 45 ? "Average" : "Weak"} trade quality
                  {" "}at {e.winRate}% win rate.
                  {" "}Used {e.sectors} of 9 sectors.
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Helper: render a single indicator row in the scorecard
function renderIndicator({ label, formula, value, pts, max, rank, n, tip }, teamColor) {
  const pct = max > 0 ? (pts / max) * 100 : 0;
  const barCol = pct >= 80 ? "#00f5c4" : pct >= 50 ? "#fbbf24" : pct >= 25 ? "#f97316" : "#ef4444";
  return (
    <div key={label} style={{ marginBottom:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
        <div style={{ flex:1 }}>
          <span style={{ fontSize:10, color:"#f1f5f9", fontWeight:600 }}>{label}</span>
          {rank && n && (
            <span style={{ fontSize:8, color:"#475569", marginLeft:6 }}>
              #{rank} of {n}
            </span>
          )}
        </div>
        <div style={{ textAlign:"right", flexShrink:0 }}>
          <span style={{ fontSize:10, color:barCol, fontWeight:700 }}>
            {pts?.toFixed(1)}/{max}
          </span>
          <span style={{ fontSize:9, color:"#475569", marginLeft:6 }}>{value}</span>
        </div>
      </div>
      <div style={{ height:4, background:"#0f172a", borderRadius:2, marginBottom:2 }}>
        <div style={{ width:`${Math.min(100,pct)}%`, height:"100%",
          background:barCol, borderRadius:2, transition:"width 0.4s ease" }}/>
      </div>
      <div style={{ fontSize:8, color:"#334155" }}>{formula}</div>
    </div>
  );
}
// ─── EMERGENCY NEWS MODAL ─────────────────────────────────────────────────────
// Auto-applies disruption and starts next round without GM permission.
// For R1 briefing: 90s countdown then auto-start.
// For R2+ buffer: uses bufferLeft countdown then auto-starts.
function EmergencyModal({ events, bufferLeft, onApply, onClose, isFirstRound, passive=false, showConcept=true }) {
  const [applied, setApplied] = useState(false);
  const [briefingLeft, setBriefingLeft] = useState(isFirstRound ? BRIEFING_SECS : null);
  const appliedRef = useRef(false);
  const closedRef  = useRef(false);

  const bm = Math.floor(Math.max(0, bufferLeft||0)/60);
  const bs = Math.max(0, bufferLeft||0) % 60;

  // R1: 90s briefing countdown, then auto-start
  useEffect(() => {
    if (passive) return;
    if (!isFirstRound) return;
    const id = setInterval(() => {
      setBriefingLeft(prev => {
        if (prev == null) return prev;
        const next = Math.max(0, prev - 1);
        if (next <= 0 && !appliedRef.current) {
          clearInterval(id);
          appliedRef.current = true;
          setApplied(true);
          setTimeout(() => {
            if (!closedRef.current) { closedRef.current = true; onApply(); onClose(); }
          }, 300);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isFirstRound, onApply, onClose, passive]);

  // R2+: when bufferLeft reaches 0, auto-apply + auto-start
  useEffect(() => {
    if (passive) return;
    if (isFirstRound) return;
    if (bufferLeft === 0 && !appliedRef.current) {
      appliedRef.current = true;
      setApplied(true);
      setTimeout(() => {
        if (!closedRef.current) { closedRef.current = true; onApply(); onClose(); }
      }, 400);
    }
  }, [bufferLeft, isFirstRound, onApply, onClose, passive]);

  const countdown = isFirstRound ? briefingLeft : bufferLeft;
  const cm = Math.floor(Math.max(0, countdown||0)/60);
  const cs = Math.max(0, countdown||0) % 60;
  const countdownLabel = isFirstRound ? "AUTO-START IN" : "NEXT ROUND IN";
  const countdownUrgent = (countdown||0) < 10;

  return (
    <div style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(2,8,23,0.97)",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"'JetBrains Mono','Courier New',monospace" }}>
      <div style={{ position:"absolute", inset:0,
        backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.12) 2px,rgba(0,0,0,0.12) 4px)",
        pointerEvents:"none" }}/>
      <div style={{ width:"min(680px,95vw)", background:"#0a0f1e",
        border:`2px solid ${isFirstRound?"#00f5c4":"#ef4444"}`, borderRadius:16,
        boxShadow:`0 0 80px ${isFirstRound?"rgba(0,245,196,0.25)":"rgba(239,68,68,0.3)"}`, overflow:"hidden", position:"relative" }}>
        <div style={{ background: isFirstRound ? "linear-gradient(135deg,#0c2a1a,#064e3b)" : "linear-gradient(135deg,#7f1d1d,#450a0a)", padding:"16px 22px",
          borderBottom:`1px solid ${isFirstRound?"#00f5c440":"#ef444440"}`, display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ fontSize:26, animation: isFirstRound ? "none" : "blink 0.8s step-end infinite" }}>
            {isFirstRound ? "📊" : "🚨"}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:20, color:"#fef2f2" }}>
              {isFirstRound ? "PRE-ROUND MARKET BRIEFING" : "MARKET DISRUPTION BULLETIN"}
            </div>
            <div style={{ fontSize:10, color: isFirstRound ? "#6ee7b7" : "#fca5a5", letterSpacing:"0.15em", marginTop:2 }}>
              {isFirstRound
                ? "STUDY THE CONDITIONS — ROUND STARTS AUTOMATICALLY"
                : "TAKING EFFECT NEXT ROUND — STARTS AUTOMATICALLY"}
            </div>
          </div>
          {/* Countdown timer — always visible */}
          {countdown != null && (
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:10, color: isFirstRound?"#6ee7b7":"#fca5a5", marginBottom:2, letterSpacing:"0.1em" }}>
                {countdownLabel}
              </div>
              <div style={{ fontFamily:"'Syne',sans-serif", fontSize:28, fontWeight:900,
                color: countdownUrgent ? "#ef4444" : isFirstRound ? "#00f5c4" : "#f1f5f9",
                animation: countdownUrgent ? "blink 0.6s step-end infinite" : "none" }}>
                {String(cm).padStart(2,"0")}:{String(cs).padStart(2,"0")}
              </div>
            </div>
          )}
        </div>
        <div style={{ padding:"16px 22px", maxHeight:"55vh", overflowY:"auto" }}>
          {/* Political event banner */}
          {events[0]?.political && (
            <div style={{ background:"linear-gradient(135deg,#0c1a2e,#0a1628)",
              border:"1px solid #1e40af", borderRadius:10, padding:"12px 14px",
              marginBottom:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                <span style={{ fontSize:24 }}>{events[0].eventIcon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:9, color:"#60a5fa", fontWeight:800, letterSpacing:"0.1em", marginBottom:3 }}>
                    MACRO ECONOMIC EVENT
                  </div>
                  <div style={{ fontSize:13, color:"#e2e8f0", fontWeight:700, lineHeight:1.4 }}>
                    {events[0].eventName}
                  </div>
                </div>
                <div style={{ textAlign:"right", fontSize:9, color:"#475569" }}>
                  {events.length} stocks · {new Set(events.map(e=>e.sectorId)).size} sectors
                </div>
              </div>
              {showConcept && (
                <div style={{ background:"#0f172a", borderRadius:7, padding:"8px 10px",
                  border:"1px solid #1e3a5f" }}>
                  <div style={{ fontSize:8, color:"#3b82f6", fontWeight:800, letterSpacing:"0.12em", marginBottom:3 }}>
                    💡 ECONOMIC CONCEPT TO REASON FROM
                  </div>
                  <div style={{ fontSize:10, color:"#94a3b8", lineHeight:1.6 }}>
                    {events[0].concept}
                  </div>
                </div>
              )}
            </div>
          )}
          {events.map((evt, i) => {
            const stock = ALL_STOCKS.find(s => s.ticker === evt.ticker);
            const up = evt.impact > 0;
            return (
              <div key={i} style={{ background:"#0f172a",
                border:`1px solid ${up?"#16653440":"#7f1d1d40"}`,
                borderLeft:`4px solid ${up?"#00f5c4":"#ef4444"}`,
                borderRadius:10, padding:"14px 16px", marginBottom:10 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:7 }}>
                  <span style={{ color:stock?.color||"#94a3b8", fontWeight:800, fontSize:15 }}>{evt.ticker}</span>
                  <span style={{ color:"#64748b", fontSize:12 }}>{stock?.name}</span>
                  {stock && <SectorBadge sectorId={stock.sectorId} small />}
                  <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
                    <span style={{ fontSize:15, fontWeight:900, color:up?"#00f5c4":"#ef4444" }}>
                      {up?"▲":"▼"} {Math.abs(evt.impact)}%
                    </span>
                    <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4, fontWeight:700,
                      background:up?"rgba(0,245,196,0.12)":"rgba(239,68,68,0.12)",
                      color:up?"#00f5c4":"#ef4444" }}>{up?"BULLISH":"BEARISH"}</span>
                  </div>
                </div>
                <div style={{ fontSize:13, color:"#f1f5f9", fontWeight:600, lineHeight:1.5, marginBottom:5 }}>{evt.headline}</div>
                {evt.detail && <div style={{ fontSize:11, color:"#64748b", fontStyle:"italic" }}>{evt.detail}</div>}
              </div>
            );
          })}
        </div>
        <div style={{ padding:"14px 22px", borderTop:"1px solid #1e293b",
          display:"flex", gap:10, justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:9, color:"#334155", letterSpacing:"0.1em" }}>
            {passive
              ? "⏳ LIVE ON ALL TEAM SCREENS UNTIL THE BUFFER ENDS"
              : applied
                ? "✓ DISRUPTION APPLIED — LAUNCHING ROUND…"
                : "⏳ AUTO-STARTING WHEN COUNTDOWN REACHES 0"}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            {!passive && !applied && (
              <button onClick={() => { if (!appliedRef.current) { appliedRef.current = true; setApplied(true); setTimeout(() => { if (!closedRef.current) { closedRef.current = true; onApply(); onClose(); } }, 300); } }}
                style={{ padding:"10px 22px", background:"linear-gradient(135deg,#7f1d1d,#dc2626)",
                  border:"none", borderRadius:8, color:"#fff", fontWeight:700,
                  cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>
                ⚡ START NOW
              </button>
            )}
            {!passive && applied && (
              <div style={{ padding:"10px 22px", background:"#166534", border:"none",
                borderRadius:8, color:"#4ade80", fontWeight:700, fontSize:12 }}>
                🚀 LAUNCHING…
              </div>
            )}
            {passive && (
              <div style={{ padding:"10px 22px", background:"#0f172a", border:"1px solid #1e293b",
                borderRadius:8, color:"#94a3b8", fontWeight:700, fontSize:12 }}>
                TEAM VIEW
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PredictionMarketOverlay({ session, playerPrediction, onVote, isGM, teamName }) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!session || session.phase === "closed") return undefined;
    const computeLeft = () => {
      const target = session.phase === "revealing" ? session.revealEndsAt : session.endsAt;
      return Math.max(0, Math.ceil((target - Date.now()) / 1000));
    };
    setSecondsLeft(computeLeft());
    const id = setInterval(() => setSecondsLeft(computeLeft()), 200);
    return () => clearInterval(id);
  }, [session]);

  if (!session || session.phase === "closed") return null;

  const question = session.question;
  const isReveal = session.phase === "revealing";
  const selected = playerPrediction || null;

  return (
    <div style={{ position:"fixed", inset:0, zIndex:9800, background:"rgba(2,8,23,0.96)",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"'JetBrains Mono','Courier New',monospace" }}>
      <div style={{ width:"min(760px,95vw)", background:"#0a0f1e", border:"2px solid #00f5c4",
        borderRadius:18, overflow:"hidden", boxShadow:"0 0 80px rgba(0,245,196,0.16)" }}>
        <div style={{ padding:"18px 24px", borderBottom:"1px solid #1e293b",
          background:isReveal ? "linear-gradient(135deg,#06291f,#064e3b)" : "linear-gradient(135deg,#042533,#0c4a6e)",
          display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ fontSize:34 }}>{isReveal ? "✅" : "🎯"}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:22, color:"#f8fafc" }}>
              {isReveal ? "PREDICTION MARKET RESULT" : "PREDICTION MARKET POLLING"}
            </div>
            <div style={{ fontSize:10, color:isReveal ? "#86efac" : "#7dd3fc", letterSpacing:"0.15em", marginTop:3 }}>
              ROUND {session.round} · {question?.concept?.toUpperCase() || "ECONOMIC REASONING"}
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:9, color:"#cbd5e1", letterSpacing:"0.1em", marginBottom:4 }}>
              {isReveal ? "RESULT SCREEN" : "POLL CLOSES IN"}
            </div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:30,
              color:isReveal ? "#86efac" : secondsLeft <= 5 ? "#fbbf24" : "#f8fafc" }}>
              00:{String(secondsLeft).padStart(2,"0")}
            </div>
          </div>
        </div>
        <div style={{ padding:"22px 24px" }}>
          <div style={{ textAlign:"center", marginBottom:18 }}>
            <div style={{ fontSize:12, color:"#94a3b8", lineHeight:1.7 }}>{question?.question}</div>
            {!isReveal && (
              <div style={{ fontSize:10, color:"#38bdf8", marginTop:10 }}>
                Trading pauses while teams submit one answer each. Correct answer still awards the round-end bonus.
              </div>
            )}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {question?.options?.map(opt => {
              const pct = session.results?.[opt.id]?.pct || 0;
              const votes = session.results?.[opt.id]?.votes || 0;
              const isCorrect = question.correct === opt.id;
              const isChosen = selected === opt.id;
              const borderColor = isReveal && isCorrect ? "#22c55e" : isChosen ? "#38bdf8" : "#1e293b";
              const background = isReveal && isCorrect
                ? "linear-gradient(135deg,rgba(34,197,94,0.18),rgba(22,163,74,0.08))"
                : isChosen
                  ? "linear-gradient(135deg,rgba(56,189,248,0.16),rgba(14,116,144,0.06))"
                  : "#0f172a";
              return (
                <div key={opt.id} style={{
                  position:"relative", border:`1px solid ${borderColor}`, borderRadius:12,
                  background, overflow:"hidden",
                  boxShadow:isReveal && isCorrect ? "0 0 28px rgba(34,197,94,0.25)" : "none"
                }}>
                  {isReveal && (
                    <div style={{ position:"absolute", inset:0, width:`${pct}%`,
                      background:isCorrect ? "rgba(34,197,94,0.18)" : "rgba(56,189,248,0.12)",
                      transition:"width 0.5s ease" }} />
                  )}
                  <div style={{ position:"relative", zIndex:1, padding:"14px 16px",
                    display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ width:28, height:28, borderRadius:8, display:"grid", placeItems:"center",
                      background:isReveal && isCorrect ? "#166534" : "#020817",
                      color:isReveal && isCorrect ? "#bbf7d0" : "#38bdf8", fontWeight:800 }}>
                      {opt.id.toUpperCase()}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:12, color:"#e2e8f0", lineHeight:1.6 }}>{opt.text}</div>
                      {isChosen && !isReveal && (
                        <div style={{ fontSize:9, color:"#38bdf8", marginTop:6 }}>
                          {isGM ? "GM monitor view" : `${teamName || "Your team"} locked this answer`}
                        </div>
                      )}
                    </div>
                    {!isReveal && !isGM && (
                      <button onClick={() => onVote(opt.id)} disabled={!!selected}
                        style={{ padding:"10px 16px",
                          background:selected ? "#0b1220" : "linear-gradient(135deg,#00f5c4,#38bdf8)",
                          color:selected ? "#475569" : "#020817", border:"none", borderRadius:8,
                          cursor:selected ? "not-allowed" : "pointer", fontWeight:800,
                          fontFamily:"inherit", fontSize:11 }}>
                        {selected === opt.id ? "LOCKED" : selected ? "VOTED" : "VOTE"}
                      </button>
                    )}
                    {isReveal && (
                      <div style={{ textAlign:"right", minWidth:92 }}>
                        <div style={{ fontSize:18, fontWeight:900, color:isCorrect ? "#22c55e" : "#e2e8f0" }}>
                          {pct}%
                        </div>
                        <div style={{ fontSize:9, color:"#64748b" }}>{votes} vote{votes === 1 ? "" : "s"}</div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop:18, textAlign:"center", fontSize:10, color:"#64748b" }}>
            {isReveal
              ? "Green highlight marks the correct answer. Percentages are based on all submitted team votes."
              : selected
                ? "Your answer is locked. Results reveal automatically when polling ends."
                : "Choose carefully. Each team gets one submission per round."}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CHART ENGINE — Timeframes, Candle Generator, Indicators, Chart
// ═══════════════════════════════════════════════════════════════
// ─── TIMEFRAMES ───────────────────────────────────────────────────────────────
// 1 trading day = 9:30–16:00 = 390 minutes = 78 × 5m bars
const TIMEFRAMES = [
  { key:"5m",  label:"5m",  desc:"1 WEEK · 5-MIN BARS",    bars:390, xEvery:78  },
  { key:"15m", label:"15m", desc:"1 WEEK · 15-MIN BARS",   bars:130, xEvery:26  },
  { key:"1h",  label:"1h",  desc:"1 MONTH · HOURLY BARS",  bars:160, xEvery:24  },
  { key:"4h",  label:"4h",  desc:"3 MONTHS · 4-HR BARS",   bars:180, xEvery:30  },
  { key:"1D",  label:"1D",  desc:"1 YEAR · DAILY BARS",    bars:252, xEvery:21  },
  { key:"1W",  label:"10Y", desc:"10 YEARS · WEEKLY BARS", bars:520, xEvery:52  },
];

// ─── CANDLE GENERATOR ─────────────────────────────────────────────────────────
function generateCandles(basePrice, volatility, tf) {
  const { bars, key } = tf;
  const MS = { "5m":5*60e3, "15m":15*60e3, "1h":3600e3, "4h":14400e3, "1D":86400e3, "1W":7*86400e3 };
  const barMs = MS[key];
  const now   = Date.now();

  // Start price: lower for long-frame charts (growth story), near current for short-frame
  const startMult = key==="1W" ? rnd(0.30,0.52)
                  : key==="1D" ? rnd(0.70,0.88)
                  : key==="4h" ? rnd(0.82,0.95)
                  : key==="1h" ? rnd(0.90,0.98)
                  : rnd(0.94,1.03);
  let price = basePrice * startMult;

  // Annualised drift broken into per-bar
  const barsPerYear = (365*24*3600e3) / barMs;
  const barDrift    = 0.09 / barsPerYear;

  // Structural events (indices into bar array)
  const events = new Map([
    [Math.floor(bars*0.12), rnd(-0.08,-0.03)],  // early dip
    [Math.floor(bars*0.28), rnd(0.04,0.10)],    // bull leg
    [Math.floor(bars*0.45), rnd(-0.12,-0.05)],  // correction
    [Math.floor(bars*0.55), rnd(0.06,0.14)],    // recovery
    [Math.floor(bars*0.68), rnd(-0.04,-0.02)],  // pause
    [Math.floor(bars*0.73), rnd(-0.18,-0.08)],  // major crash
    [Math.floor(bars*0.78), rnd(0.08,0.18)],    // V-shape bounce
    [Math.floor(bars*0.88), rnd(0.03,0.09)],    // late rally
    [Math.floor(bars*0.95), rnd(-0.03,0.05)],   // consolidation
  ]);

  // Intraday volatility multipliers
  function intradayMult(ts) {
    if (key!=="5m" && key!=="15m") return 1;
    const d=new Date(ts), h=d.getHours(), m=d.getMinutes();
    if (h===9  && m<=45)  return 2.8;  // open range
    if (h===15 && m>=30)  return 2.0;  // close rush
    if (h>=12  && h<=13)  return 0.6;  // lunch lull
    return 1.0;
  }

  const candles = [];
  for (let i=0; i<bars; i++) {
    const ts  = now - (bars-i)*barMs;

    // No time filtering — always generate all bars for consistent chart display

    const baseVol = volatility * 0.01 * Math.sqrt(barMs/86400e3);
    const vol     = clamp(baseVol, 0.0005, 0.05);
    const iMult   = intradayMult(ts);
    const shock   = events.get(i) || 0;
    const drift   = barDrift + shock + rnd(-vol,vol)*iMult;

    const open  = price;
    const close = Math.max(0.5, price*(1+drift));
    const span  = Math.abs(close-open);
    const wMult = rnd(0.3,1.4)*iMult;
    const high  = Math.max(open,close) + span*wMult*rnd(0.2,0.9) + price*vol*rnd(0.1,0.4);
    const low   = Math.min(open,close) - span*wMult*rnd(0.2,0.9) - price*vol*rnd(0.1,0.4);
    const volume= Math.round(rnd(400_000,9_000_000)*(1+Math.abs(drift)*25)*iMult);

    candles.push({ ts, open, high:Math.max(open,close,high), low:Math.min(open,close,low), close, volume });
    price = close;
  }
  return candles;
}

// ─── TECHNICAL INDICATORS ─────────────────────────────────────────────────────
function ema(closes, p) {
  const k=2/(p+1); let e=closes[0]; const out=[];
  for (let i=0;i<closes.length;i++) {
    if(i<p-1){out.push(null);continue;}
    e=closes[i]*k+e*(1-k); out.push(e);
  }
  return out;
}
function bollingerBands(closes,p=20,m=2) {
  const mid=[],up=[],lo=[];
  for(let i=0;i<closes.length;i++){
    if(i<p-1){mid.push(null);up.push(null);lo.push(null);continue;}
    const sl=closes.slice(i-p+1,i+1),mn=sl.reduce((a,b)=>a+b,0)/p;
    const sd=Math.sqrt(sl.reduce((a,b)=>a+(b-mn)**2,0)/p);
    mid.push(mn);up.push(mn+m*sd);lo.push(mn-m*sd);
  }
  return {mid,up,lo};
}
function rsi(closes,p=14) {
  const out=[]; let g=0,l=0;
  for(let i=1;i<closes.length;i++){
    const d=closes[i]-closes[i-1];
    if(i<=p){if(d>0)g+=d;else l+=Math.abs(d);if(i===p){g/=p;l/=p;}out.push(null);continue;}
    g=(g*(p-1)+Math.max(0,d))/p; l=(l*(p-1)+Math.abs(Math.min(0,d)))/p;
    out.push(l===0?100:100-100/(1+g/l));
  }
  return out;
}
function macd(closes,f=12,s=26,sig=9) {
  const mf=ema(closes,f),ms=ema(closes,s);
  const line=mf.map((v,i)=>v!=null&&ms[i]!=null?v-ms[i]:null);
  const sigL=ema(line.map(v=>v??0),sig);
  const hist=line.map((v,i)=>v!=null&&sigL[i]!=null?v-sigL[i]:null);
  return {line,sigL,hist};
}
function vwap(candles) {
  let cumTP=0,cumVol=0; const out=[];
  candles.forEach(c=>{ const tp=(c.high+c.low+c.close)/3; cumTP+=tp*c.volume; cumVol+=c.volume; out.push(cumVol?cumTP/cumVol:null); });
  return out;
}

// ─── CANDLE CHART ─────────────────────────────────────────────────────────────
const MIN_VISIBLE = 10; // fewest candles allowed in view

function CandleChart({ candles, color, price, tf }) {
  const mainRef = useRef(null);
  const navRef  = useRef(null);
  const total   = candles?.length || 0;

  // Zoom/pan state: [startIdx, endIdx] inclusive
  const [view,     setView]     = useState([0, total - 1]);
  const [ind,      setInd]      = useState({ ema9:true, ema21:true, bb:false, vwap:false });
  const [showVol,  setShowVol]  = useState(true);
  const [showRSI,  setShowRSI]  = useState(true);
  const [showMACD, setShowMACD] = useState(false);
  const [tip,      setTip]      = useState(null);
  const [cross,    setCross]    = useState(null);
  // Drag-to-zoom brush on navigator
  const [brush,    setBrush]    = useState(null); // {startX, endX} in navigator SVG coords
  const brushRef   = useRef(null);
  // Pan via mouse drag on main chart
  const dragRef    = useRef(null); // {startX, startView}
  // Selection-brush on main chart (ctrl+drag or dedicated mode)
  const [zoomMode, setZoomMode] = useState(false); // when true, drag selects region
  const selRef     = useRef(null); // {startIdx}
  const [selRange, setSelRange] = useState(null); // {a,b} indices while dragging

  // Reset view when candles change (new tf/ticker)
  useEffect(() => { if (total>0) { setView([0, total-1]); setTip(null); setCross(null); } }, [total]);

  if (!candles || total < 5) return (
    <div style={{height:460,display:"flex",alignItems:"center",justifyContent:"center",color:"#1e293b",fontSize:12}}>
      Generating chart…
    </div>
  );

  // ── visible slice ──────────────────────────────────────────────────────────
  const vStart = clamp(view[0], 0, Math.max(0, total-MIN_VISIBLE));
  const vEnd   = clamp(view[1], vStart+MIN_VISIBLE-1, total-1);
  const vis    = candles.slice(vStart, vEnd+1);
  const vLen   = vis.length;
  if (vLen < 2) return (
    <div style={{height:460,display:"flex",alignItems:"center",justifyContent:"center",color:"#1e293b",fontSize:12}}>
      Generating chart…
    </div>
  );

  // ── layout ────────────────────────────────────────────────────────────────
  const W=1040, PAD={top:16,right:82,bot:12,left:14};
  const mainH = 300;
  const volH  = showVol  ? 52  : 0;
  const subH  = (showRSI||showMACD) ? 100 : 0;
  const subGap= subH > 0 ? 12 : 0;
  const navH  = 44; // navigator bar height
  const navGap= 8;
  const H     = PAD.top + mainH + volH + subGap + subH + PAD.bot;
  const CW    = W - PAD.left - PAD.right;

  // ── indicators on ALL candles (for consistency at edges) ──────────────────
  const allCloses = candles.map(c=>c.close);
  const allE9     = ema(allCloses, 9);
  const allE21    = ema(allCloses, 21);
  const allBB     = bollingerBands(allCloses, 20, 2);
  const allRSI    = rsi(allCloses, 14);
  const allMACD   = macd(allCloses, 12, 26, 9);
  const allVWAP   = (tf==="5m"||tf==="15m") ? vwap(candles) : null;

  // Slice indicators to visible window
  const slice = arr => arr.slice(vStart, vEnd+1);
  const visE9  = slice(allE9), visE21=slice(allE21);
  const visBB  = {up:slice(allBB.up),lo:slice(allBB.lo),mid:slice(allBB.mid)};
  const visRSI = slice(allRSI);
  const visMACDl= slice(allMACD.line), visMACDs=slice(allMACD.sigL), visMACDh=slice(allMACD.hist);
  const visVWAP = allVWAP ? slice(allVWAP) : null;

  // ── price range for visible candles ───────────────────────────────────────
  const lo  = vis.length ? Math.min(...vis.map(c=>c.low))  : 0;
  const hi  = vis.length ? Math.max(...vis.map(c=>c.high)) : 1;
  const rng = hi - lo || 1;

  // ── geometry helpers ──────────────────────────────────────────────────────
  const cw  = CW / vLen;
  const bw  = Math.max(1.5, cw * 0.72);
  const hbw = bw / 2;
  const toX = i => PAD.left + (i + 0.5) * cw;
  const toY = p => PAD.top + mainH - ((p - lo) / rng) * mainH;

  const volY = PAD.top + mainH;
  const maxV = vis.length ? Math.max(...vis.map(c=>c.volume), 1) : 1;

  const subTop = PAD.top + mainH + volH + subGap;
  const toRSI  = v => subTop + subH - ((v) / 100) * subH;
  const macdVV = visMACDh.filter(v=>v!=null);
  const mExt   = macdVV.length ? Math.max(0.001, Math.abs(Math.min(...macdVV,0)), Math.abs(Math.max(...macdVV,0))) : 0.001;
  const toMCD  = v => subTop + subH/2 - (v / mExt) * (subH/2);

  const curY   = toY(price);

  // ── price grid ────────────────────────────────────────────────────────────
  const gCount = 6, gStep = rng / gCount;
  const grid   = Array.from({length:gCount+1}, (_,i) => lo + gStep*i);

  // ── x labels on visible slice ─────────────────────────────────────────────
  const tfObj   = TIMEFRAMES.find(t=>t.key===tf)||TIMEFRAMES[0];
  const xEvery  = Math.max(1, Math.floor(tfObj.xEvery * vLen / total));
  const xLbls   = vis.map((c,i)=>{
    if (i % xEvery !== 0 && i !== vLen-1) return null;
    const d=new Date(c.ts);
    const lbl = tf==="5m"||tf==="15m"
      ? (d.getHours()===9&&d.getMinutes()<=35 ? d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"}) : fmtTS(c.ts))
      : tf==="1h"||tf==="4h" ? d.toLocaleDateString([],{month:"short",day:"numeric"})
      : tf==="1D" ? d.toLocaleDateString([],{month:"short",year:"2-digit"})
      : String(d.getFullYear());
    return {i, lbl};
  }).filter(Boolean);

  // ── NAVIGATOR geometry ────────────────────────────────────────────────────
  const NW=1040, NH=navH;
  const NPAD={l:14,r:82};
  const NCW = NW - NPAD.l - NPAD.r;
  const navLo = candles.length ? Math.min(...candles.map(c=>c.low))  : 0;
  const navHi = candles.length ? Math.max(...candles.map(c=>c.high)) : 1;
  const navRng= navHi - navLo || 1;
  const ncw   = NCW / total;
  const nToX  = i => NPAD.l + (i+0.5)*ncw;
  const nToY  = p => NH - ((p-navLo)/navRng)*NH*0.85 - NH*0.05;
  // close-line path for navigator
  const navPts = candles.map((c,i)=>`${nToX(i)},${nToY(c.close)}`).join(" ");
  // navigator window handles
  const wxL = NPAD.l + (vStart/total)*NCW;
  const wxR = NPAD.l + ((vEnd+1)/total)*NCW;

  // ── ZOOM helpers ─────────────────────────────────────────────────────────
  const zoomBy = useCallback((factor, centerFrac=0.5) => {
    setView(([s,e]) => {
      const len = e - s + 1;
      const newLen = clamp(Math.round(len * factor), MIN_VISIBLE, total);
      const center = s + len * centerFrac;
      const ns = clamp(Math.round(center - newLen * centerFrac), 0, total - newLen);
      return [ns, ns + newLen - 1];
    });
  }, [total]);

  const panBy = useCallback(delta => {
    setView(([s,e]) => {
      const len = e - s + 1;
      const ns  = clamp(s + delta, 0, total - len);
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
    return clamp(Math.floor((svgX - PAD.left) / cw), 0, vLen-1);
  }

  function onMainMove(e) {
    const mx = svgCoordX(e, mainRef);

    // Pan drag
    if (dragRef.current && !zoomMode) {
      const dx = mx - dragRef.current.startX;
      const dBars = -Math.round(dx / cw);
      const [s0,e0] = dragRef.current.startView;
      const len = e0-s0+1;
      const ns = clamp(s0+dBars, 0, total-len);
      setView([ns, ns+len-1]);
      setCross(null); setTip(null);
      return;
    }
    // Zoom-mode selection drag
    if (selRef.current && zoomMode) {
      const idx = xToIdx(mx) + vStart;
      setSelRange({ a:Math.min(selRef.current.startIdx, idx), b:Math.max(selRef.current.startIdx, idx) });
      setCross(null); setTip(null);
      return;
    }

    // Normal crosshair + tooltip
    const idx = xToIdx(mx);
    if (idx < 0 || idx >= vLen) return;
    const c = vis[idx];
    const ai = idx + vStart; // absolute index
    setCross({ x:toX(idx), y:toY(c.close) });
    setTip({
      ...c, idx, ai,
      e9:allE9[ai], e21:allE21[ai],
      bbU:allBB.up[ai], bbL:allBB.lo[ai], bbM:allBB.mid[ai],
      rsiV:allRSI[ai], macdV:allMACD.line[ai], histV:allMACD.hist[ai],
      vwapV:allVWAP?allVWAP[ai]:null
    });
  }

  function onMainDown(e) {
    if (zoomMode) {
      const mx  = svgCoordX(e, mainRef);
      const idx = xToIdx(mx) + vStart;
      selRef.current = { startIdx:idx };
      setSelRange(null);
    } else {
      dragRef.current = { startX: svgCoordX(e,mainRef), startView:[vStart,vEnd] };
    }
  }

  function onMainUp(e) {
    if (zoomMode && selRef.current && selRange) {
      const {a,b} = selRange;
      const newLen = b-a+1;
      if (newLen >= MIN_VISIBLE) setView([a, b]);
      selRef.current = null; setSelRange(null);
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
      navDragRef.current = { type:"pan", startNx:nx, startView:[vStart,vEnd] };
    } else {
      // Click outside → jump view centre
      const clickFrac = clamp((nx - NPAD.l) / NCW, 0, 1);
      const len = vEnd - vStart + 1;
      const ns  = clamp(Math.round(clickFrac * total - len/2), 0, total-len);
      setView([ns, ns+len-1]);
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
      const [s0,e0] = navDragRef.current.startView;
      const len = e0-s0+1;
      const ns  = clamp(s0+dBars, 0, total-len);
      setView([ns, ns+len-1]);
    }
  }
  function onNavUp() { navDragRef.current = null; }

  // ── cursor ────────────────────────────────────────────────────────────────
  const mainCursor = zoomMode ? "crosshair" : dragRef.current ? "grabbing" : "grab";

  // ── sel range SVG coords ──────────────────────────────────────────────────
  const selX1 = selRange ? PAD.left + (selRange.a - vStart) * cw : null;
  const selX2 = selRange ? PAD.left + (selRange.b - vStart + 1) * cw : null;

  // ── candle drawn count badge ──────────────────────────────────────────────
  const zoomPct = Math.round((vLen / total) * 100);

  return (
    <div style={{userSelect:"none"}}>
      {/* ── TOP CONTROL BAR ── */}
      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
        {/* Overlays */}
        <span style={{fontSize:9,color:"#1e293b",letterSpacing:"0.12em"}}>OVERLAY</span>
        {[
          {k:"ema9",  l:"EMA 9",  c:"#fbbf24"},
          {k:"ema21", l:"EMA 21", c:"#38bdf8"},
          {k:"bb",    l:"BB(20)", c:"#a78bfa"},
          ...(allVWAP?[{k:"vwap",l:"VWAP",c:"#fb923c"}]:[]),
        ].map(o=>(
          <button key={o.k} onClick={()=>setInd(p=>({...p,[o.k]:!p[o.k]}))} style={{
            padding:"3px 9px",borderRadius:4,cursor:"pointer",
            background:ind[o.k]?`${o.c}22`:"#0a0f1e",
            border:`1px solid ${ind[o.k]?o.c:"#0f172a"}`,
            color:ind[o.k]?o.c:"#334155",fontFamily:"inherit",fontSize:9,fontWeight:700
          }}>{o.l}</button>
        ))}

        <div style={{width:1,height:14,background:"#0f172a"}}/>

        {/* Sub-panels */}
        {[
          {l:"Vol",  s:showVol,  fn:v=>{setShowVol(v);}},
          {l:"RSI",  s:showRSI,  fn:v=>{setShowRSI(v);if(v)setShowMACD(false);}},
          {l:"MACD", s:showMACD, fn:v=>{setShowMACD(v);if(v)setShowRSI(false);}},
        ].map(p=>(
          <button key={p.l} onClick={()=>p.fn(!p.s)} style={{
            padding:"3px 9px",borderRadius:4,cursor:"pointer",
            background:p.s?"#1e293b":"#0a0f1e",
            border:`1px solid ${p.s?"#334155":"#0f172a"}`,
            color:p.s?"#64748b":"#1e293b",fontFamily:"inherit",fontSize:9
          }}>{p.l}</button>
        ))}

        <div style={{width:1,height:14,background:"#0f172a"}}/>

        {/* Zoom controls */}
        <span style={{fontSize:9,color:"#1e293b",letterSpacing:"0.1em"}}>ZOOM</span>
        {[
          {l:"🔍−", title:"Zoom out",  fn:()=>zoomBy(1.3,0.5)},
          {l:"🔍+", title:"Zoom in",   fn:()=>zoomBy(0.72,0.5)},
          {l:"◀",  title:"Pan left",  fn:()=>panBy(-Math.max(1,Math.round((vEnd-vStart)*0.15)))},
          {l:"▶",  title:"Pan right", fn:()=>panBy( Math.max(1,Math.round((vEnd-vStart)*0.15)))},
          {l:"↺",  title:"Reset view",fn:()=>setView([0,total-1])},
        ].map(b=>(
          <button key={b.l} title={b.title} onClick={b.fn} style={{
            padding:"3px 9px",borderRadius:4,cursor:"pointer",
            background:"#0a0f1e",border:"1px solid #0f172a",
            color:"#475569",fontFamily:"inherit",fontSize:10
          }}>{b.l}</button>
        ))}

        {/* Zoom-select toggle */}
        <button
          title="Drag to select zoom region"
          onClick={()=>setZoomMode(z=>!z)}
          style={{
            padding:"3px 10px",borderRadius:4,cursor:"pointer",
            background:zoomMode?"#1e3a5f":"#0a0f1e",
            border:`1px solid ${zoomMode?"#38bdf8":"#0f172a"}`,
            color:zoomMode?"#38bdf8":"#334155",fontFamily:"inherit",fontSize:9,fontWeight:zoomMode?700:400
          }}>
          {zoomMode ? "✕ CANCEL SELECT" : "⬚ SELECT ZOOM"}
        </button>

        {/* Stats */}
        <div style={{marginLeft:"auto",display:"flex",gap:10,fontSize:9,alignItems:"center"}}>
          <span style={{color:"#1e293b"}}>{vLen} bars ({zoomPct}%)</span>
          <span style={{color:"#00f5c4"}}>▮ Bull</span>
          <span style={{color:"#ef4444"}}>▮ Bear</span>
          {ind.ema9  && <span style={{color:"#fbbf24"}}>━ EMA9</span>}
          {ind.ema21 && <span style={{color:"#38bdf8"}}>━ EMA21</span>}
          {ind.bb    && <span style={{color:"#a78bfa"}}>◈ BB</span>}
          {ind.vwap  && allVWAP && <span style={{color:"#fb923c"}}>━ VWAP</span>}
        </div>
      </div>

      {/* ── MAIN CHART SVG ── */}
      <div style={{
        position:"relative",background:"#060c18",borderRadius:"12px 12px 0 0",
        border:"1px solid #0d1420",borderBottom:"none",overflow:"hidden"
      }}>
        <svg
          ref={mainRef} width="100%" viewBox={`0 0 ${W} ${H}`}
          style={{display:"block", cursor:mainCursor, touchAction:"none"}}
          onMouseMove={onMainMove}
          onMouseDown={onMainDown}
          onMouseUp={onMainUp}
          onMouseLeave={()=>{setTip(null);setCross(null);dragRef.current=null;}}
          onWheel={onWheel}
        >
          <defs>
            <linearGradient id={`bg_${color.replace(/\W/g,"")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.05"/>
              <stop offset="100%" stopColor={color} stopOpacity="0"/>
            </linearGradient>
            <clipPath id="mc"><rect x={PAD.left} y={PAD.top} width={CW} height={mainH}/></clipPath>
            <clipPath id="vc"><rect x={PAD.left} y={volY} width={CW} height={volH}/></clipPath>
            <clipPath id="sc"><rect x={PAD.left} y={subTop} width={CW} height={subH}/></clipPath>
          </defs>

          {/* Background */}
          <rect x={PAD.left} y={PAD.top} width={CW} height={mainH} fill={`url(#bg_${color.replace(/\W/g,"")})`}/>

          {/* Price grid */}
          {grid.map((p,i)=>(
            <g key={i}>
              <line x1={PAD.left} y1={toY(p)} x2={W-PAD.right} y2={toY(p)}
                stroke="#0d1420" strokeWidth="1" strokeDasharray="3 7"/>
              <text x={W-PAD.right+5} y={toY(p)+4} fill="#1e293b" fontSize="9"
                fontFamily="JetBrains Mono,monospace">
                {p>=1000?`$${fmt(p/1000,1)}K`:`$${fmt(p,2)}`}
              </text>
            </g>
          ))}

          {/* Bollinger Bands */}
          {ind.bb&&(()=>{
            const uPts=vis.map((c,i)=>visBB.up[i]!=null?`${toX(i)},${toY(visBB.up[i])}`:null).filter(Boolean).join(" ");
            const lPts=vis.map((c,i)=>visBB.lo[i]!=null?`${toX(i)},${toY(visBB.lo[i])}`:null).filter(Boolean).join(" ");
            const mPts=vis.map((c,i)=>visBB.mid[i]!=null?`${toX(i)},${toY(visBB.mid[i])}`:null).filter(Boolean).join(" ");
            const fill=[...uPts.split(" "),...lPts.split(" ").reverse()].join(" ");
            return (
              <g clipPath="url(#mc)">
                <polygon points={fill} fill="#a78bfa10"/>
                <polyline points={uPts} fill="none" stroke="#a78bfa" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.55"/>
                <polyline points={mPts} fill="none" stroke="#a78bfa" strokeWidth="0.6" strokeDasharray="5 4" opacity="0.35"/>
                <polyline points={lPts} fill="none" stroke="#a78bfa" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.55"/>
              </g>
            );
          })()}

          {/* VWAP */}
          {ind.vwap&&visVWAP&&(()=>{
            const pts=vis.map((c,i)=>visVWAP[i]!=null?`${toX(i)},${toY(visVWAP[i])}`:null).filter(Boolean).join(" ");
            return <polyline clipPath="url(#mc)" points={pts} fill="none" stroke="#fb923c" strokeWidth="1.1" strokeDasharray="4 2" opacity="0.8"/>;
          })()}

          {/* Candles */}
          <g clipPath="url(#mc)">
            {vis.map((c,i)=>{
              const up=c.close>=c.open, fc=up?"#00f5c4":"#ef4444";
              const bT=toY(Math.max(c.open,c.close)), bB=toY(Math.min(c.open,c.close));
              const bH=Math.max(0.8,bB-bT), cx=toX(i);
              return (
                <g key={i}>
                  <line x1={cx} y1={toY(c.high)} x2={cx} y2={toY(c.low)}
                    stroke={fc} strokeWidth={Math.max(0.5,cw*0.06)} opacity="0.7"/>
                  <rect x={cx-hbw} y={bT} width={bw} height={bH}
                    fill={up?fc:"none"} stroke={fc}
                    strokeWidth={up?0:Math.max(0.5,cw*0.05)} rx="0.4" opacity="0.92"/>
                </g>
              );
            })}
          </g>

          {/* Selection brush overlay (zoom-mode drag) */}
          {zoomMode && selRange && selX1!=null && selX2!=null && (
            <g clipPath="url(#mc)">
              <rect x={Math.min(selX1,selX2)} y={PAD.top}
                width={Math.abs(selX2-selX1)} height={mainH}
                fill="#38bdf820" stroke="#38bdf8" strokeWidth="1" strokeDasharray="4 2"/>
              <text x={(selX1+selX2)/2} y={PAD.top+14} textAnchor="middle"
                fill="#38bdf8" fontSize="9" fontFamily="JetBrains Mono,monospace">
                {Math.abs(selRange.b-selRange.a)+1} bars selected
              </text>
            </g>
          )}

          {/* EMA9 */}
          {ind.ema9&&(()=>{
            const pts=vis.map((c,i)=>visE9[i]!=null?`${toX(i)},${toY(visE9[i])}`:null).filter(Boolean).join(" ");
            return <polyline clipPath="url(#mc)" points={pts} fill="none" stroke="#fbbf24" strokeWidth="1.1" opacity="0.9"/>;
          })()}
          {/* EMA21 */}
          {ind.ema21&&(()=>{
            const pts=vis.map((c,i)=>visE21[i]!=null?`${toX(i)},${toY(visE21[i])}`:null).filter(Boolean).join(" ");
            return <polyline clipPath="url(#mc)" points={pts} fill="none" stroke="#38bdf8" strokeWidth="1.1" opacity="0.9"/>;
          })()}

          {/* Live price line */}
          {price>=lo&&price<=hi&&(
            <g>
              <line x1={PAD.left} y1={curY} x2={W-PAD.right} y2={curY}
                stroke={color} strokeWidth="0.8" strokeDasharray="5 3" opacity="0.45"/>
              <rect x={W-PAD.right+1} y={curY-9} width={74} height={18} fill={color} rx="3"/>
              <text x={W-PAD.right+5} y={curY+5} fill="#020817" fontSize="10"
                fontFamily="JetBrains Mono,monospace" fontWeight="bold">
                {price>=1000?`$${fmt(price/1000,2)}K`:`$${fmt(price,2)}`}
              </text>
            </g>
          )}

          {/* Volume */}
          {showVol&&(
            <g clipPath="url(#vc)">
              <line x1={PAD.left} y1={volY} x2={W-PAD.right} y2={volY} stroke="#0d1420" strokeWidth="1"/>
              {vis.map((c,i)=>{
                const up=c.close>=c.open, vh=maxV?(c.volume/maxV)*volH:0;
                return <rect key={i} x={toX(i)-hbw} y={volY+volH-vh} width={bw} height={vh}
                  fill={up?"#00f5c418":"#ef444418"}/>;
              })}
              <text x={W-PAD.right+5} y={volY+10} fill="#1e293b" fontSize="8" fontFamily="JetBrains Mono,monospace">VOL</text>
            </g>
          )}

          {/* RSI */}
          {showRSI&&subH>0&&(()=>{
            const pts=visRSI.map((v,i)=>v!=null?`${toX(i)},${toRSI(v)}`:null).filter(Boolean).join(" ");
            return (
              <g>
                <rect x={PAD.left} y={subTop} width={CW} height={subH} fill="#03070f"/>
                <line x1={PAD.left} y1={subTop} x2={W-PAD.right} y2={subTop} stroke="#0d1420" strokeWidth="1"/>
                <rect x={PAD.left} y={toRSI(70)} width={CW} height={toRSI(30)-toRSI(70)} fill="#fbbf2406"/>
                {[30,50,70].map(v=>(
                  <g key={v}>
                    <line x1={PAD.left} y1={toRSI(v)} x2={W-PAD.right} y2={toRSI(v)}
                      stroke={v===50?"#0f172a":"#fbbf2430"} strokeWidth="0.6"
                      strokeDasharray={v===50?"4 6":"3 4"}/>
                    <text x={W-PAD.right+5} y={toRSI(v)+4} fill="#fbbf2450" fontSize="8"
                      fontFamily="JetBrains Mono,monospace">{v}</text>
                  </g>
                ))}
                <polyline clipPath="url(#sc)" points={pts} fill="none" stroke="#fbbf24" strokeWidth="1.3" opacity="0.9"/>
                <text x={PAD.left+4} y={subTop+12} fill="#1e293b" fontSize="8" fontFamily="JetBrains Mono,monospace">RSI(14)</text>
                {tip?.rsiV!=null&&<text x={PAD.left+48} y={subTop+12} fill="#fbbf24" fontSize="8"
                  fontFamily="JetBrains Mono,monospace" fontWeight="bold">{fmt(tip.rsiV,1)}</text>}
              </g>
            );
          })()}

          {/* MACD */}
          {showMACD&&subH>0&&(()=>{
            const mPts=visMACDl.map((v,i)=>v!=null?`${toX(i)},${toMCD(v)}`:null).filter(Boolean).join(" ");
            const sPts=visMACDs.map((v,i)=>v!=null?`${toX(i)},${toMCD(v)}`:null).filter(Boolean).join(" ");
            return (
              <g>
                <rect x={PAD.left} y={subTop} width={CW} height={subH} fill="#03070f"/>
                <line x1={PAD.left} y1={subTop} x2={W-PAD.right} y2={subTop} stroke="#0d1420" strokeWidth="1"/>
                <line x1={PAD.left} y1={subTop+subH/2} x2={W-PAD.right} y2={subTop+subH/2} stroke="#0f172a" strokeWidth="0.8"/>
                <g clipPath="url(#sc)">
                  {visMACDh.map((h,i)=>h!=null&&(
                    <rect key={i} x={toX(i)-hbw} y={h>=0?toMCD(h):toMCD(0)} width={bw}
                      height={Math.abs(toMCD(0)-toMCD(h))} fill={h>=0?"#00f5c428":"#ef444428"}/>
                  ))}
                </g>
                <polyline clipPath="url(#sc)" points={mPts} fill="none" stroke="#00f5c4" strokeWidth="1.2" opacity="0.9"/>
                <polyline clipPath="url(#sc)" points={sPts} fill="none" stroke="#f472b6" strokeWidth="1.0" opacity="0.9"/>
                <text x={PAD.left+4} y={subTop+12} fill="#1e293b" fontSize="8" fontFamily="JetBrains Mono,monospace">MACD(12,26,9)</text>
              </g>
            );
          })()}

          {/* X labels */}
          {xLbls.map(l=>(
            <text key={l.i} x={toX(l.i)} y={PAD.top+mainH+volH+subGap+subH+11}
              textAnchor="middle" fill="#1e293b" fontSize="8" fontFamily="JetBrains Mono,monospace">
              {l.lbl}
            </text>
          ))}

          {/* Crosshair */}
          {cross&&!selRange&&(
            <g>
              <line x1={cross.x} y1={PAD.top} x2={cross.x} y2={PAD.top+mainH+volH+subGap+subH}
                stroke="#1e293b" strokeWidth="0.7" strokeDasharray="2 5" opacity="0.9"/>
              <line x1={PAD.left} y1={cross.y} x2={W-PAD.right} y2={cross.y}
                stroke="#1e293b" strokeWidth="0.7" strokeDasharray="2 5" opacity="0.9"/>
              {/* Price label on Y axis */}
              {tip&&(
                <>
                  <rect x={W-PAD.right+1} y={cross.y-8} width={74} height={16} fill="#1e293b" rx="2"/>
                  <text x={W-PAD.right+5} y={cross.y+4} fill="#64748b" fontSize="9"
                    fontFamily="JetBrains Mono,monospace">{`$${fmt(tip.close,2)}`}</text>
                </>
              )}
            </g>
          )}

          {/* Axis borders */}
          <line x1={W-PAD.right} y1={PAD.top} x2={W-PAD.right} y2={PAD.top+mainH+volH+subGap+subH} stroke="#0d1420" strokeWidth="1"/>
          <line x1={PAD.left}    y1={PAD.top} x2={PAD.left}    y2={PAD.top+mainH} stroke="#0d1420" strokeWidth="1"/>
        </svg>

        {/* Tooltip */}
        {tip&&!selRange&&(
          <div style={{
            position:"absolute",top:6,left:20,
            background:"rgba(3,7,14,0.96)",border:"1px solid #0f172a",
            borderRadius:10,padding:"10px 15px",
            fontFamily:"'JetBrains Mono',monospace",pointerEvents:"none",
            backdropFilter:"blur(8px)",display:"flex",gap:16,alignItems:"flex-start"
          }}>
            <div>
              <div style={{fontSize:9,color:"#334155",marginBottom:5,letterSpacing:"0.1em"}}>{fmtDT(tip.ts,tf)}</div>
              <div style={{display:"grid",gridTemplateColumns:"auto auto",columnGap:10,rowGap:2,fontSize:11}}>
                {[["O",tip.open],["H",tip.high],["L",tip.low],["C",tip.close]].map(([l,v])=>(
                  <div key={l} style={{display:"contents"}}>
                    <span style={{color:"#334155"}}>{l}</span>
                    <span style={{color:tip.close>=tip.open?"#00f5c4":"#ef4444",fontWeight:800}}>{`$${fmt(v,2)}`}</span>
                  </div>
                ))}
                <div style={{display:"contents"}}>
                  <span style={{color:"#334155"}}>Vol</span>
                  <span style={{color:"#475569"}}>{(tip.volume/1e6).toFixed(2)}M</span>
                </div>
              </div>
            </div>
            <div>
              <div style={{fontSize:9,color:"#334155",marginBottom:5,letterSpacing:"0.1em"}}>CHANGE</div>
              <div style={{fontWeight:800,fontSize:16,color:tip.close>=tip.open?"#00f5c4":"#ef4444"}}>
                {tip.close>=tip.open?"+":""}{fmt(((tip.close-tip.open)/tip.open)*100)}%
              </div>
              <div style={{fontSize:10,color:"#475569",marginTop:2}}>
                {tip.close>=tip.open?"+":""}{`$${fmt(tip.close-tip.open,2)}`}
              </div>
            </div>
            <div style={{fontSize:10}}>
              <div style={{fontSize:9,color:"#334155",marginBottom:5,letterSpacing:"0.1em"}}>INDICATORS</div>
              {ind.ema9  && tip.e9  !=null && <div style={{color:"#fbbf24",marginBottom:2}}>EMA9  {`$${fmt(tip.e9,2)}`}</div>}
              {ind.ema21 && tip.e21 !=null && <div style={{color:"#38bdf8",marginBottom:2}}>EMA21 {`$${fmt(tip.e21,2)}`}</div>}
              {ind.bb    && tip.bbU !=null && <div style={{color:"#a78bfa",marginBottom:2}}>BB  {`$${fmt(tip.bbL,2)}`}–{`$${fmt(tip.bbU,2)}`}</div>}
              {ind.vwap  && tip.vwapV!=null&& <div style={{color:"#fb923c",marginBottom:2}}>VWAP {`$${fmt(tip.vwapV,2)}`}</div>}
              {showRSI   && tip.rsiV !=null && <div style={{color:"#fbbf24",marginBottom:2}}>RSI  {fmt(tip.rsiV,1)}</div>}
              {showMACD  && tip.macdV!=null && <div style={{color:"#00f5c4"}}>MACD {fmt(tip.macdV,3)}</div>}
            </div>
          </div>
        )}

        {/* Zoom mode hint */}
        {zoomMode&&(
          <div style={{position:"absolute",bottom:6,right:90,
            background:"rgba(56,189,248,0.12)",border:"1px solid #38bdf840",
            borderRadius:5,padding:"3px 10px",fontSize:9,color:"#38bdf8",
            fontFamily:"JetBrains Mono,monospace"}}>
            Click and drag to select a region to zoom into
          </div>
        )}
      </div>

      {/* ── NAVIGATOR BAR ── */}
      <div style={{
        position:"relative",background:"#040912",
        border:"1px solid #0d1420",borderTop:"none",
        borderRadius:"0 0 12px 12px",overflow:"hidden",
        cursor:"ew-resize"
      }}>
        <svg
          ref={navRef} width="100%" viewBox={`0 0 ${NW} ${NH+6}`}
          style={{display:"block"}}
          onMouseDown={onNavDown}
          onMouseMove={onNavMove}
          onMouseUp={onNavUp}
          onMouseLeave={onNavUp}
        >
          {/* Full-history line */}
          <polyline points={navPts} fill="none" stroke={color} strokeWidth="1" opacity="0.4"/>

          {/* Shaded out-of-view regions */}
          <rect x={NPAD.l} y={0} width={wxL-NPAD.l} height={NH+6} fill="rgba(0,0,0,0.55)"/>
          <rect x={wxR}    y={0} width={NPAD.l+NCW-wxR} height={NH+6} fill="rgba(0,0,0,0.55)"/>

          {/* Viewport window */}
          <rect x={wxL} y={0} width={wxR-wxL} height={NH+6}
            fill="none" stroke={color} strokeWidth="1.2" opacity="0.7"/>
          {/* Window fill */}
          <rect x={wxL} y={0} width={wxR-wxL} height={NH+6} fill={`${color}0a`}/>

          {/* Drag handles */}
          {[wxL, wxR].map((x,i)=>(
            <rect key={i} x={x-(i===0?3:0)} y={0} width={3} height={NH+6}
              fill={color} opacity="0.5" rx="1"/>
          ))}

          {/* Labels */}
          <text x={NPAD.l+4} y={NH-2} fill="#0d1420" fontSize="8" fontFamily="JetBrains Mono,monospace">
            NAVIGATOR · DRAG TO PAN · SCROLL OR BUTTONS TO ZOOM
          </text>
          <text x={NW-NPAD.r+5} y={NH-2} fill="#1e293b" fontSize="8" fontFamily="JetBrains Mono,monospace">
            {vLen}/{total}
          </text>
        </svg>
      </div>
    </div>
  );
}




// ─── STOCK DETAIL MODAL
function StockDetailModal({ stock, sector, price, prevPrice, history, holdings, cash, canTrade, shortCapacity, onBuy, onSell, onShort, onCover, onClose, transactions, aiLog }) {
  const [qty,    setQty]    = useState(1);
  const [detTab, setDetTab] = useState("chart");
  const [tf,     setTF]     = useState("1D");
  const cacheRef = useRef({});

  if (!stock) return null;

  const color    = sector?.color || "#00f5c4";
  const chg      = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;
  const up       = chg >= 0;
  const held     = holdings[stock.ticker];
  const heldQty  = held?.qty || 0;
  const longHeld = longQty(held);
  const shortHeld = shortQty(held);
  const buyTotal = price * qty;
  const canBuy   = canTrade && cash >= buyTotal && qty > 0 && shortHeld === 0;
  const canSell  = canTrade && longHeld >= qty && qty > 0;
  const canShort = canTrade && qty > 0 && longHeld === 0 && buyTotal <= shortCapacity;
  const canCover = canTrade && shortHeld >= qty && qty > 0 && cash >= buyTotal;
  const unrealized = held ? (price - held.avgCost) * held.qty : 0;
  const unrPct     = held ? ((price - held.avgCost) / held.avgCost) * 100 * (held.qty < 0 ? -1 : 1) : 0;

  // ── BUY/SELL RATIO ─────────────────────────────────────────────────────────
  // Combines player's own transactions + AI bot trades for this ticker
  const myBuys  = (transactions||[]).filter(t => (t.type==="BUY" || t.type==="COVER")  && t.ticker===stock.ticker).length;
  const mySells = (transactions||[]).filter(t => (t.type==="SELL" || t.type==="SHORT") && t.ticker===stock.ticker).length;
  const botBuys  = (aiLog||[]).filter(t => t.action==="buy"  && t.ticker===stock.ticker).length;
  const botSells = (aiLog||[]).filter(t => t.action==="sell" && t.ticker===stock.ticker).length;
  const totalBuys  = myBuys  + botBuys;
  const totalSells = mySells + botSells;
  const totalTrades = totalBuys + totalSells;
  const buyPct  = totalTrades > 0 ? Math.round((totalBuys  / totalTrades) * 100) : 50;
  const sellPct = 100 - buyPct;
  const ratioSignal = buyPct >= 65 ? "STRONG BUY" : buyPct >= 55 ? "BUY" : buyPct <= 35 ? "STRONG SELL" : buyPct <= 45 ? "SELL" : "NEUTRAL";
  const ratioColor  = buyPct >= 65 ? "#00f5c4" : buyPct >= 55 ? "#4ade80" : buyPct <= 35 ? "#ef4444" : buyPct <= 45 ? "#fb923c" : "#64748b";

  // Generate/cache candles per ticker+timeframe (pure, no setState)
  const cacheKey = `${stock.ticker}_${tf}`;
  if (!cacheRef.current[cacheKey]) {
    const tfObj = TIMEFRAMES.find(t => t.key === tf) || TIMEFRAMES[0];
    const c = generateCandles(stock.basePrice || 100, stock.volatility || 1, tfObj);
    if (c.length > 0) c[c.length - 1].close = price;
    cacheRef.current = { ...cacheRef.current, [cacheKey]: c };
  }
  const candles = cacheRef.current[cacheKey] || [];
  const tfObj   = TIMEFRAMES.find(t => t.key === tf) || TIMEFRAMES[0];

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:9000, background:"rgba(2,8,23,0.93)",
      display:"flex", alignItems:"center", justifyContent:"center",
      backdropFilter:"blur(6px)", padding:"10px",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width:"min(1120px,99vw)", background:"#060c18",
        border:`1px solid ${color}55`, borderRadius:18,
        boxShadow:`0 0 80px ${color}18`, overflow:"hidden",
        display:"flex", flexDirection:"column", maxHeight:"97vh",
        animation:"fadeup 0.2s ease"
      }}>

        {/* Header */}
        <div style={{
          padding:"13px 22px 11px",
          background:`linear-gradient(135deg,${color}0d,transparent 60%)`,
          borderBottom:`1px solid ${color}22`,
          display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:26, color, lineHeight:1 }}>
              {stock.ticker}
            </span>
            <span style={{ fontSize:9, padding:"3px 8px", borderRadius:4,
              background:`${color}18`, border:`1px solid ${color}35`, color, fontWeight:700 }}>
              {sector?.icon} {sector?.label}
            </span>
            <span style={{ fontSize:12, color:"#64748b" }}>{stock.name}</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:18 }}>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:32, lineHeight:1, color:"#f1f5f9" }}>
                ${Number(price).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
              </div>
              <div style={{ fontSize:12, fontWeight:700, color: up ? "#00f5c4" : "#ef4444" }}>
                {up ? "▲ +" : "▼ "}{Math.abs(chg).toFixed(2)}%
              </div>
            </div>
            <button onClick={onClose} style={{
              width:32, height:32, borderRadius:8, background:"#0f172a",
              border:"1px solid #1e293b", color:"#64748b", fontSize:18,
              cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0
            }}>✕</button>
          </div>
        </div>

        {/* Tab bar + TF selector */}
        <div style={{ display:"flex", alignItems:"center", borderBottom:"1px solid #0f172a",
          flexShrink:0, padding:"0 22px" }}>
          {["chart","about"].map(t => (
            <button key={t} onClick={() => setDetTab(t)} style={{
              padding:"9px 14px", background:"none", border:"none",
              color: detTab===t ? color : "#475569",
              borderBottom: detTab===t ? `2px solid ${color}` : "2px solid transparent",
              cursor:"pointer", fontFamily:"inherit", fontSize:10,
              fontWeight: detTab===t ? 700 : 400, letterSpacing:"0.1em", textTransform:"uppercase"
            }}>{t}</button>
          ))}
          {detTab === "chart" && (
            <>
              <div style={{ width:1, height:16, background:"#0f172a", margin:"0 12px" }}/>
              <div style={{ display:"flex", gap:3, alignItems:"center" }}>
                {TIMEFRAMES.map(t => (
                  <button key={t.key} onClick={() => setTF(t.key)} style={{
                    padding:"3px 9px", borderRadius:4, cursor:"pointer",
                    background: tf===t.key ? `${color}1a` : "#060c18",
                    border:`1px solid ${tf===t.key ? color : "#0d1420"}`,
                    color: tf===t.key ? color : "#334155",
                    fontFamily:"inherit", fontSize:9, fontWeight: tf===t.key ? 700 : 400, transition:"all 0.15s"
                  }}>{t.label}</button>
                ))}
                <span style={{ fontSize:8, color:"#1e293b", marginLeft:8, letterSpacing:"0.08em" }}>{tfObj.desc}</span>
              </div>
            </>
          )}
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto", overflowX:"hidden", padding:"16px 20px" }}>

          {detTab === "chart" && (
            <div style={{ animation:"fadeup 0.2s ease" }}>
              <CandleChart candles={candles} color={color} price={price} tf={tf} />

              {/* Company stats */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginTop:14 }}>
                {[
                  { l:"MKT CAP",    v: stock.mktCap    || "—", c:"#f1f5f9" },
                  { l:"EMPLOYEES",  v: stock.employees || "—", c:"#94a3b8" },
                  { l:"FOUNDED",    v: stock.founded   || "—", c:"#64748b" },
                  { l:"VOLATILITY", v: `${stock.volatility}×`, c: stock.volatility>=1.5?"#ef4444":stock.volatility>=1.2?"#fbbf24":"#00f5c4" },
                ].map(m => (
                  <div key={m.l} style={{ background:"#0a0f1e", border:"1px solid #111827",
                    borderRadius:8, padding:"10px 12px", textAlign:"center" }}>
                    <div style={{ fontSize:8, color:"#334155", letterSpacing:"0.1em", marginBottom:4 }}>{m.l}</div>
                    <div style={{ fontSize:13, fontWeight:800, color:m.c }}>{m.v}</div>
                  </div>
                ))}
              </div>

              {/* Buy/Sell Ratio */}
              <div style={{ background:"#0a0f1e", border:"1px solid #111827", borderRadius:10, padding:"12px 14px", marginTop:12 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                  <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em", fontWeight:700 }}>MARKET SENTIMENT — BUY / SELL RATIO</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:9, color:"#334155" }}>{totalTrades} trades</span>
                    <span style={{ fontSize:10, fontWeight:800, color:ratioColor, padding:"2px 8px",
                      background:`${ratioColor}18`, border:`1px solid ${ratioColor}44`, borderRadius:4,
                      letterSpacing:"0.06em" }}>{ratioSignal}</span>
                  </div>
                </div>
                <div style={{ position:"relative", height:20, borderRadius:10, overflow:"hidden",
                  background:"#0f172a", border:"1px solid #1e293b" }}>
                  <div style={{ position:"absolute", left:0, top:0, bottom:0,
                    width:`${buyPct}%`,
                    background: totalTrades===0 ? "transparent" : "linear-gradient(90deg,#00f5c4bb,#00f5c455)",
                    transition:"width 0.6s ease" }}/>
                  <div style={{ position:"absolute", right:0, top:0, bottom:0,
                    width:`${sellPct}%`,
                    background: totalTrades===0 ? "transparent" : "linear-gradient(270deg,#ef4444bb,#ef444455)",
                    transition:"width 0.6s ease" }}/>
                  <div style={{ position:"absolute", left:"50%", top:3, bottom:3, width:1,
                    background:"#1e293b", transform:"translateX(-50%)" }}/>
                  {totalTrades > 0 && buyPct > 14 && (
                    <div style={{ position:"absolute", left:8, top:0, bottom:0, display:"flex",
                      alignItems:"center", fontSize:9, fontWeight:800, color:"#00f5c4", letterSpacing:"0.04em" }}>
                      {buyPct}% BUY
                    </div>
                  )}
                  {totalTrades > 0 && sellPct > 14 && (
                    <div style={{ position:"absolute", right:8, top:0, bottom:0, display:"flex",
                      alignItems:"center", fontSize:9, fontWeight:800, color:"#ef4444", letterSpacing:"0.04em" }}>
                      SELL {sellPct}%
                    </div>
                  )}
                  {totalTrades === 0 && (
                    <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center",
                      justifyContent:"center", fontSize:9, color:"#334155", letterSpacing:"0.1em" }}>
                      NO TRADES YET — BE FIRST TO MOVE
                    </div>
                  )}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:9 }}>
                  <span style={{ color:"#00f5c4" }}>▲ {totalBuys} buys
                    <span style={{ color:"#334155", marginLeft:5 }}>({myBuys} you · {botBuys} bots)</span>
                  </span>
                  <span style={{ color:"#ef4444" }}>
                    <span style={{ color:"#334155", marginRight:5 }}>({mySells} you · {botSells} bots)</span>
                    {totalSells} sells ▼
                  </span>
                </div>
              </div>

              {/* Position */}
              {held && (
                <div style={{ background:`${color}0a`, border:`1px solid ${color}25`,
                  borderRadius:10, padding:"12px 14px", marginTop:12 }}>
                  <div style={{ fontSize:9, color, letterSpacing:"0.12em", marginBottom:8, fontWeight:700 }}>YOUR POSITION</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, fontSize:11 }}>
                    <div><div style={{ color:"#334155", fontSize:9, marginBottom:2 }}>POSITION</div>
                      <div style={{ color:heldQty < 0 ? "#fca5a5" : "#f1f5f9", fontWeight:700 }}>
                        {heldQty < 0 ? "SHORT" : "LONG"} {Math.abs(heldQty)}
                      </div></div>
                    <div><div style={{ color:"#334155", fontSize:9, marginBottom:2 }}>AVG COST</div>
                      <div style={{ color:"#f1f5f9", fontWeight:700 }}>${held.avgCost.toFixed(2)}</div></div>
                    <div><div style={{ color:"#334155", fontSize:9, marginBottom:2 }}>NET VALUE</div>
                      <div style={{ color:"#f1f5f9", fontWeight:700 }}>${(price*heldQty).toFixed(0)}</div></div>
                    <div><div style={{ color:"#334155", fontSize:9, marginBottom:2 }}>UNREALIZED P&L</div>
                      <div style={{ color:unrealized>=0?"#00f5c4":"#ef4444", fontWeight:700 }}>
                        {unrealized>=0?"+":""}${Math.abs(unrealized).toFixed(0)} ({unrPct>=0?"+":""}{unrPct.toFixed(1)}%)
                      </div></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {detTab === "about" && (
            <div style={{ animation:"fadeup 0.2s ease" }}>
              <p style={{ fontSize:13, color:"#64748b", lineHeight:1.8, marginBottom:20 }}>
                {stock.description || "No description available."}
              </p>
              {/* ETF constituent chips */}
              {stock.constituents && (
                <div style={{ marginBottom:16 }}>
                  <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em", marginBottom:6 }}>
                    TRACKS {stock.constituents.length} STOCKS
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                    {stock.constituents.map(t => {
                      const st = ALL_STOCKS.find(x => x.ticker === t);
                      return (
                        <div key={t} style={{
                          padding:"4px 10px", borderRadius:6, fontSize:10, fontWeight:700,
                          background:`${st?.color || color}15`,
                          border:`1px solid ${st?.color || color}40`,
                          color: st?.color || color
                        }}>
                          {t}
                          <span style={{ fontSize:8, fontWeight:400, marginLeft:4, color:"#64748b" }}>
                            {st?.name?.split(" ")[0]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Buy/Sell Ratio — about tab */}
              <div style={{ background:"#0a0f1e", border:"1px solid #111827", borderRadius:10, padding:"12px 14px", marginBottom:12 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                  <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em", fontWeight:700 }}>BUY / SELL RATIO</div>
                  <span style={{ fontSize:10, fontWeight:800, color:ratioColor, padding:"2px 8px",
                    background:`${ratioColor}18`, border:`1px solid ${ratioColor}44`, borderRadius:4,
                    letterSpacing:"0.06em" }}>{ratioSignal}</span>
                </div>
                <div style={{ position:"relative", height:20, borderRadius:10, overflow:"hidden",
                  background:"#0f172a", border:"1px solid #1e293b" }}>
                  <div style={{ position:"absolute", left:0, top:0, bottom:0, width:`${buyPct}%`,
                    background: totalTrades===0 ? "transparent" : "linear-gradient(90deg,#00f5c4bb,#00f5c455)",
                    transition:"width 0.6s ease" }}/>
                  <div style={{ position:"absolute", right:0, top:0, bottom:0, width:`${sellPct}%`,
                    background: totalTrades===0 ? "transparent" : "linear-gradient(270deg,#ef4444bb,#ef444455)",
                    transition:"width 0.6s ease" }}/>
                  <div style={{ position:"absolute", left:"50%", top:3, bottom:3, width:1,
                    background:"#1e293b", transform:"translateX(-50%)" }}/>
                  {totalTrades > 0 && buyPct > 14 && (
                    <div style={{ position:"absolute", left:8, top:0, bottom:0, display:"flex",
                      alignItems:"center", fontSize:9, fontWeight:800, color:"#00f5c4" }}>
                      {buyPct}% BUY
                    </div>
                  )}
                  {totalTrades > 0 && sellPct > 14 && (
                    <div style={{ position:"absolute", right:8, top:0, bottom:0, display:"flex",
                      alignItems:"center", fontSize:9, fontWeight:800, color:"#ef4444" }}>
                      SELL {sellPct}%
                    </div>
                  )}
                  {totalTrades === 0 && (
                    <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center",
                      justifyContent:"center", fontSize:9, color:"#334155", letterSpacing:"0.1em" }}>
                      NO TRADES YET
                    </div>
                  )}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:9 }}>
                  <span style={{ color:"#00f5c4" }}>▲ {totalBuys} buys <span style={{ color:"#334155" }}>({myBuys} you · {botBuys} bots)</span></span>
                  <span style={{ color:"#ef4444" }}><span style={{ color:"#334155" }}>({mySells} you · {botSells} bots)</span> {totalSells} sells ▼</span>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                {[
                  { l:"TICKER",     v: stock.ticker,           c: color    },
                  { l:"MKT CAP",    v: stock.mktCap    || "—", c:"#f1f5f9" },
                  { l:"EMPLOYEES",  v: stock.employees || "—", c:"#94a3b8" },
                  { l:"FOUNDED",    v: stock.founded   || "—", c:"#64748b" },
                  { l:"SECTOR",     v: sector?.label   || "—", c: color    },
                  { l:"VOLATILITY", v: `${stock.volatility}×`, c: stock.volatility>=1.5?"#ef4444":stock.volatility>=1.2?"#fbbf24":"#00f5c4" },
                ].map(m => (
                  <div key={m.l} style={{ background:"#0a0f1e", border:"1px solid #111827",
                    borderRadius:8, padding:"10px 12px" }}>
                    <div style={{ fontSize:8, color:"#334155", letterSpacing:"0.1em", marginBottom:4 }}>{m.l}</div>
                    <div style={{ fontSize:13, fontWeight:800, color:m.c }}>{m.v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Trade Panel */}
        <div style={{ borderTop:`1px solid ${color}22`, background:"#040b17",
          padding:"13px 22px", flexShrink:0 }}>
          {!canTrade && (
            <div style={{ fontSize:11, color:"#ef4444", marginBottom:8, textAlign:"center",
              padding:"6px", background:"rgba(239,68,68,0.08)", borderRadius:6 }}>
              ⚠ Trading currently locked
            </div>
          )}
          <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
            <div>
              <div style={{ fontSize:9, color:"#475569", marginBottom:4, letterSpacing:"0.1em" }}>QUANTITY</div>
              <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                <button onClick={() => setQty(q=>Math.max(1,q-1))} style={{ width:28,height:36,background:"#0f172a",border:"1px solid #1e293b",color:"#94a3b8",borderRadius:5,cursor:"pointer",fontSize:14,fontFamily:"inherit" }}>−</button>
                <input type="number" min={1} value={qty}
                  onChange={e=>setQty(Math.max(1,parseInt(e.target.value)||1))}
                  style={{ width:60,padding:"8px 0",textAlign:"center",background:"#020817",border:"1px solid #1e293b",color:"#f1f5f9",borderRadius:5,fontSize:15,fontFamily:"inherit" }}/>
                <button onClick={() => setQty(q=>q+1)} style={{ width:28,height:36,background:"#0f172a",border:"1px solid #1e293b",color:"#94a3b8",borderRadius:5,cursor:"pointer",fontSize:14,fontFamily:"inherit" }}>+</button>
              </div>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:9, color:"#475569", marginBottom:4 }}>TOTAL COST</div>
              <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9" }}>
                ${buyTotal.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
              </div>
              <div style={{ fontSize:10, color:"#334155", marginTop:2 }}>
                Cash: ${cash.toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:0})}
                {longHeld>0 && <span style={{ marginLeft:8,color:"#475569" }}>· Long: {longHeld}</span>}
                {shortHeld>0 && <span style={{ marginLeft:8,color:"#fca5a5" }}>· Short: {shortHeld}</span>}
              </div>
            </div>
            <div style={{ display:"flex", gap:4 }}>
              {[1,5,10,25].map(n=>(
                <button key={n} onClick={()=>setQty(n)} style={{
                  padding:"5px 9px",background:qty===n?`${color}22`:"#0f172a",
                  border:`1px solid ${qty===n?color:"#1e293b"}`,color:qty===n?color:"#475569",
                  borderRadius:5,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700
                }}>{n}</button>
              ))}
              <button onClick={()=>{const m=Math.floor(cash/price);if(m>0)setQty(m);}} style={{
                padding:"5px 9px",background:"#0f172a",border:"1px solid #1e293b",
                color:"#fbbf24",borderRadius:5,cursor:"pointer",fontFamily:"inherit",fontSize:9,fontWeight:700
              }}>MAX</button>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>{onBuy(stock.ticker,qty);onClose();}} disabled={!canBuy} style={{
                padding:"12px 28px",
                background:canBuy?"linear-gradient(135deg,#00f5c4,#00d4aa)":"#1e293b",
                color:canBuy?"#020817":"#334155",border:"none",borderRadius:8,fontWeight:800,
                cursor:canBuy?"pointer":"not-allowed",fontFamily:"inherit",fontSize:14
              }}>▲ BUY</button>
              <button onClick={()=>{onSell(stock.ticker,qty);onClose();}} disabled={!canSell} style={{
                padding:"12px 28px",
                background:canSell?"linear-gradient(135deg,#ef4444,#dc2626)":"#1e293b",
                color:canSell?"#fff":"#334155",border:"none",borderRadius:8,fontWeight:800,
                cursor:canSell?"pointer":"not-allowed",fontFamily:"inherit",fontSize:14
              }}>▼ SELL</button>
              <button onClick={()=>{onShort(stock.ticker,qty);onClose();}} disabled={!canShort} style={{
                padding:"12px 24px",
                background:canShort?"linear-gradient(135deg,#f97316,#ea580c)":"#1e293b",
                color:canShort?"#fff":"#334155",border:"none",borderRadius:8,fontWeight:800,
                cursor:canShort?"pointer":"not-allowed",fontFamily:"inherit",fontSize:14
              }}>↘ SHORT</button>
              <button onClick={()=>{onCover(stock.ticker,qty);onClose();}} disabled={!canCover} style={{
                padding:"12px 24px",
                background:canCover?"linear-gradient(135deg,#22c55e,#16a34a)":"#1e293b",
                color:canCover?"#04130a":"#334155",border:"none",borderRadius:8,fontWeight:800,
                cursor:canCover?"pointer":"not-allowed",fontFamily:"inherit",fontSize:14
              }}>↗ COVER</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── DISRUPTION BLAST OVERLAY ─────────────────────────────────────────────────
// Full-screen blurred overlay shown on ALL screens when GM fires a disruption
function DisruptionBlast({ events, roundNum, onDismiss, isGM }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setStep(s => Math.min(s + 1, events.length)), 600);
    return () => clearTimeout(t);
  }, [step, events.length]);

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:10000,
      background:"rgba(2,4,12,0.97)",
      backdropFilter:"blur(18px)", WebkitBackdropFilter:"blur(18px)",
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      fontFamily:"'JetBrains Mono','Courier New',monospace",
      backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(239,68,68,0.03) 3px,rgba(239,68,68,0.03) 4px)",
      animation:"fadein 0.4s ease"
    }}>
      {/* Red pulse border */}
      <div style={{ position:"absolute", inset:0, border:"3px solid #ef444440",
        boxShadow:"inset 0 0 120px rgba(239,68,68,0.15)", pointerEvents:"none" }}/>

      <div style={{ width:"min(760px,95vw)", textAlign:"center" }}>
        {/* Header */}
        <div style={{ fontSize:9, color:"#ef4444", letterSpacing:"0.5em", marginBottom:16,
          animation:"pulse 1s infinite" }}>
          ● LIVE ALERT · ROUND {roundNum}
        </div>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:"clamp(42px,7vw,80px)",
          lineHeight:1, color:"#ef4444",
          textShadow:"0 0 60px rgba(239,68,68,0.8), 0 0 120px rgba(239,68,68,0.4)",
          marginBottom:8, animation:"pulse 2s infinite" }}>
          MARKET DISRUPTION
        </div>
        <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900,
          fontSize:"clamp(14px,2.5vw,22px)", color:"#fca5a5",
          letterSpacing:"0.2em", marginBottom:36 }}>
          TAKING EFFECT THIS ROUND — TRADE ACCORDINGLY
        </div>

        {/* Events */}
        <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:32 }}>
          {events.map((evt, i) => {
            const stock = ALL_STOCKS.find(s => s.ticker === evt.ticker);
            const up = evt.impact > 0;
            const visible = i < step;
            return (
              <div key={i} style={{
                opacity: visible ? 1 : 0,
                transform: visible ? "none" : "translateY(20px)",
                transition:"all 0.5s ease",
                background: up ? "rgba(0,245,196,0.06)" : "rgba(239,68,68,0.06)",
                border:`1px solid ${up?"#00f5c430":"#ef444430"}`,
                borderLeft:`4px solid ${up?"#00f5c4":"#ef4444"}`,
                borderRadius:12, padding:"16px 20px",
                display:"flex", alignItems:"center", gap:16, textAlign:"left"
              }}>
                <div style={{ flexShrink:0 }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:32,
                    color: stock?.color || "#94a3b8", letterSpacing:"0.05em" }}>
                    {evt.ticker}
                  </div>
                  <div style={{ fontSize:10, color:"#475569" }}>{stock?.name}</div>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:"clamp(12px,1.8vw,16px)", fontWeight:700,
                    color:"#f1f5f9", lineHeight:1.5, marginBottom:4 }}>
                    {evt.headline}
                  </div>
                  {evt.detail && <div style={{ fontSize:11, color:"#64748b", fontStyle:"italic" }}>
                    {evt.detail}
                  </div>}
                </div>
                <div style={{ flexShrink:0, textAlign:"center" }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:40,
                    color: up?"#00f5c4":"#ef4444", lineHeight:1 }}>
                    {up?"▲":""}{evt.impact > 0 ? "+" : ""}{evt.impact}%
                  </div>
                  <div style={{ fontSize:10, fontWeight:700,
                    color: up?"#00f5c4":"#ef4444", letterSpacing:"0.1em" }}>
                    {up?"SURGE":"CRASH"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* GM-only dismiss button */}
        {isGM && step >= events.length && (
          <button onClick={onDismiss} style={{
            padding:"14px 40px",
            background:"linear-gradient(135deg,#7f1d1d,#dc2626)",
            border:"none", borderRadius:10, color:"#fff",
            fontFamily:"inherit", fontSize:13, fontWeight:800,
            cursor:"pointer", letterSpacing:"0.1em",
            boxShadow:"0 0 30px rgba(220,38,38,0.5)",
            animation:"pulse 1.5s infinite"
          }}>
            ⚡ LAUNCH ROUND {roundNum} →
          </button>
        )}
        {!isGM && (
          <div style={{ fontSize:11, color:"#334155", letterSpacing:"0.2em" }}>
            AWAITING GAME MASTER TO LAUNCH ROUND…
          </div>
        )}
      </div>
    </div>
  );
}


// ─── WINNER CEREMONY ──────────────────────────────────────────────────────────
function WinnerCeremony({ ranked, teams }) {
  const top3 = ranked.slice(0, 3);
  const medals = [
    { icon:"🥇", label:"CHAMPION",      bg:"linear-gradient(135deg,#78350f,#d97706)", border:"#f59e0b", glow:"rgba(245,158,11,0.5)",  size:32 },
    { icon:"🥈", label:"RUNNER-UP",     bg:"linear-gradient(135deg,#1e293b,#475569)", border:"#94a3b8", glow:"rgba(148,163,184,0.3)", size:26 },
    { icon:"🥉", label:"3RD PLACE",     bg:"linear-gradient(135deg,#431407,#92400e)", border:"#b45309", glow:"rgba(180,83,9,0.3)",    size:22 },
  ];

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:9500,
      background:"radial-gradient(ellipse at center, #0a0518 0%, #020817 70%)",
      display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", gap:32,
      fontFamily:"'JetBrains Mono','Courier New',monospace",
      animation:"fadeup 0.6s ease"
    }}>
      {/* Title */}
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:8 }}>🏆</div>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:64, lineHeight:1,
          background:"linear-gradient(135deg,#fbbf24,#f59e0b,#fbbf24)",
          WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
          letterSpacing:"0.05em" }}>
          BULL PIT CHAMPIONS
        </div>
        <div style={{ fontSize:11, color:"#475569", letterSpacing:"0.3em", marginTop:8 }}>
          FINAL RESULTS — ALL 7 ROUNDS COMPLETE
        </div>
      </div>

      {/* Podium */}
      <div style={{ display:"flex", alignItems:"flex-end", gap:16 }}>
        {/* Reorder: 2nd, 1st, 3rd for podium look */}
        {[1, 0, 2].map(idx => {
          const entry = top3[idx];
          if (!entry) return null;
          const m = medals[idx];
          const team = teams?.find(t => t.name === entry.name);
          const color = team?.color || entry.color || "#64748b";
          const pnl = (entry.total || 0) - (entry.initCash || 100000);
          const heights = [160, 220, 130]; // 2nd, 1st, 3rd podium heights
          return (
            <div key={entry.name} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
              {/* Medal + name card */}
              <div style={{
                background:"#0a0f1e", border:`2px solid ${m.border}`,
                borderRadius:16, padding:"20px 28px", textAlign:"center",
                boxShadow:`0 0 40px ${m.glow}`,
                minWidth: idx === 0 ? 240 : 200,
                animation: idx === 0 ? "glowPulse 2s infinite" : "none"
              }}>
                <div style={{ fontSize: idx === 0 ? 52 : 40, marginBottom:8 }}>{m.icon}</div>
                <div style={{ fontSize:9, color:m.border, fontWeight:800,
                  letterSpacing:"0.2em", marginBottom:6 }}>{m.label}</div>
                <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900,
                  fontSize: idx === 0 ? 22 : 18, color, marginBottom:8,
                  lineHeight:1.2 }}>{entry.name}</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif",
                  fontSize: idx === 0 ? 36 : 28, color:"#f1f5f9", lineHeight:1 }}>
                  ${(entry.total||0).toLocaleString(undefined,{maximumFractionDigits:0})}
                </div>
                <div style={{ fontSize:12, fontWeight:800, marginTop:4,
                  color: pnl >= 0 ? "#00f5c4" : "#ef4444" }}>
                  {pnl >= 0 ? "▲ +" : "▼ "}${Math.abs(pnl).toLocaleString(undefined,{maximumFractionDigits:0})}
                </div>
                <div style={{ fontSize:10, color:"#475569", marginTop:4 }}>
                  Score: <span style={{ color:m.border, fontWeight:800 }}>{(entry.score||0).toFixed(1)} pts</span>
                </div>
              </div>
              {/* Podium block */}
              <div style={{
                width: idx === 0 ? 200 : 160,
                height: heights[idx === 0 ? 1 : idx === 1 ? 0 : 2],
                background: m.bg,
                border:`1px solid ${m.border}44`,
                borderRadius:"8px 8px 0 0",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize: idx === 0 ? 36 : 28, fontWeight:900,
                color: m.border,
                fontFamily:"'Bebas Neue',sans-serif",
                letterSpacing:"0.05em"
              }}>
                {idx === 0 ? "1ST" : idx === 1 ? "2ND" : "3RD"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rest of leaderboard */}
      {ranked.length > 3 && (
        <div style={{ display:"flex", flexDirection:"column", gap:6, width:480 }}>
          <div style={{ fontSize:9, color:"#334155", letterSpacing:"0.15em", textAlign:"center", marginBottom:4 }}>
            FULL LEADERBOARD
          </div>
          {ranked.slice(3).map((entry, i) => {
            const team = teams?.find(t => t.name === entry.name);
            const color = team?.color || entry.color || "#64748b";
            const pnl = (entry.total||0) - 100000;
            return (
              <div key={entry.name} style={{
                display:"flex", alignItems:"center", gap:12,
                background:"#0a0f1e", border:"1px solid #111827",
                borderLeft:`3px solid ${color}`, borderRadius:8,
                padding:"10px 14px"
              }}>
                <div style={{ fontSize:12, color:"#334155", fontWeight:800, minWidth:24 }}>#{i+4}</div>
                <div style={{ flex:1, fontWeight:700, color, fontSize:13 }}>{entry.name}</div>
                {entry.isBot && <span style={{ fontSize:9, color:"#334155", padding:"1px 5px",
                  border:"1px solid #1e293b", borderRadius:3 }}>BOT</span>}
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:13, fontWeight:800, color:"#f1f5f9" }}>
                    ${(entry.total||0).toLocaleString(undefined,{maximumFractionDigits:0})}
                  </div>
                  <div style={{ fontSize:10, color: pnl>=0?"#00f5c4":"#ef4444" }}>
                    {pnl>=0?"+":""}{((pnl/100000)*100).toFixed(1)}%
                  </div>
                </div>
                <div style={{ fontSize:10, color:"#fbbf24", fontWeight:800, minWidth:48, textAlign:"right" }}>
                  {(entry.score||0).toFixed(1)}pt
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize:10, color:"#1e293b", letterSpacing:"0.2em" }}>
        BULL PIT · GAME COMPLETE
      </div>
    </div>
  );
}

// ─── TEAM EDITOR ──────────────────────────────────────────────────────────────
function TeamEditor({ teams, onSave }) {
  const [draft, setDraft] = useState(teams.map(t => ({ ...t })));
  const [saved, setSaved]  = useState(false);
  const [colorPicker, setColorPicker] = useState(null); // index of team whose picker is open

  const COLORS = [
    "#00f5c4","#38bdf8","#fbbf24","#f472b6","#a78bfa","#fb923c",
    "#4ade80","#f87171","#c084fc","#67e8f9","#fde68a","#86efac",
    "#e879f9","#f97316","#84cc16","#06b6d4","#ec4899","#8b5cf6",
    "#14b8a6","#f59e0b","#10b981","#3b82f6","#ef4444","#6366f1",
    "#d946ef","#0ea5e9","#22c55e","#eab308","#64748b","#94a3b8",
  ];

  const DEFAULT_NAMES = [
    "Alpha Squad","Bull Runners","Bear Force","Quantum Traders","Solar Surge","Dark Pool",
    "Iron Hawks","Neon Tigers","Ghost Traders","Storm Capital","Red Wolves","Blue Chip",
    "Apex Fund","Zenith Crew","Volt Trade","Lunar Assets","Shadow Bulls","Delta Force",
    "Nova Traders","Titan Group","Cyber Fund","Blaze Squad","Arctic Bears","Steel Wolves",
    "Jade Capital","Echo Markets","Fusion Pit","Prime Assets","Vortex Fund","Omega Trade",
    "Cobalt Fund","Phantom Bulls","Nexus Capital","Pulse Traders","Crimson Bears",
    "Orbit Fund","Forge Capital","Dusk Traders","Rift Squad","Ember Fund",
    "Pinnacle Trade","Specter Group","Onyx Capital","Drift Fund","Cipher Traders",
    "Vault Squad","Prism Capital","Blitz Fund","Rogue Traders","Helix Group",
    "Surge Capital","Nano Fund","Vector Trade","Proxy Squad","Zenith Bears",
    "Apex Wolves","Flux Capital","Binary Fund","Storm Hawks","Eclipse Trade",
  ];

  function upd(i, field, val) {
    setDraft(d => d.map((t, j) => j === i ? { ...t, [field]: val } : t));
    setColorPicker(null);
  }

  function addTeam() {
    if (draft.length >= MAX_TEAMS) return;
    const idx = draft.length;
    const id  = `t${Date.now()}`;
    const name = DEFAULT_NAMES[idx] || `Team ${idx + 1}`;
    const pw   = name.toLowerCase().replace(/\s/g,"") + Math.floor(100+Math.random()*900);
    const color = COLORS[idx % COLORS.length];
    setDraft(d => [...d, { id, name, password: pw, color }]);
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
    width:"100%", padding:"6px 8px", background:"#020817",
    border:"1px solid #1e293b", color:"#f1f5f9", borderRadius:5,
    fontFamily:"inherit", fontSize:11, outline:"none",
  };

  const atMax = draft.length >= MAX_TEAMS;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>

      {/* Header row */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em" }}>
          TEAM EDITOR
          <span style={{ marginLeft:8, color: atMax ? "#ef4444" : "#00f5c4", fontWeight:700 }}>
            {draft.length} / {MAX_TEAMS}
          </span>
        </div>
        <button onClick={addTeam} disabled={atMax}
          style={{ padding:"5px 12px", background: atMax ? "#0f172a" : "#0a2a1a",
            border:`1px solid ${atMax ? "#1e293b" : "#00f5c4"}`,
            color: atMax ? "#334155" : "#00f5c4", borderRadius:6,
            cursor: atMax ? "not-allowed" : "pointer", fontFamily:"inherit",
            fontSize:10, fontWeight:700, opacity: atMax ? 0.5 : 1 }}>
          + ADD TEAM {atMax ? `(MAX ${MAX_TEAMS})` : ""}
        </button>
      </div>

      {/* Team list */}
      <div style={{ maxHeight:460, overflowY:"auto", display:"flex", flexDirection:"column", gap:5,
        paddingRight:2 }}>
        {draft.map((t, i) => (
          <div key={t.id} style={{ background:"#0a0f1e", border:`1px solid ${t.color}33`,
            borderLeft:`3px solid ${t.color}`, borderRadius:8, padding:"8px 10px",
            position:"relative" }}>

            <div style={{ display:"grid", gridTemplateColumns:"26px 1fr 1fr auto auto", gap:6, alignItems:"center" }}>

              {/* Team # badge */}
              <div style={{ fontSize:9, color:"#475569", fontWeight:700, textAlign:"center" }}>
                #{i+1}
              </div>

              {/* Name */}
              <div>
                <div style={{ fontSize:8, color:"#475569", marginBottom:2 }}>NAME</div>
                <input value={t.name} onChange={e => upd(i,"name",e.target.value)} style={inp} />
              </div>

              {/* Password */}
              <div>
                <div style={{ fontSize:8, color:"#475569", marginBottom:2 }}>PASSWORD</div>
                <input value={t.password} onChange={e => upd(i,"password",e.target.value)} style={inp} />
              </div>

              {/* Color swatch / picker toggle */}
              <div style={{ position:"relative" }}>
                <div style={{ fontSize:8, color:"#475569", marginBottom:2 }}>COLOR</div>
                <button onClick={() => setColorPicker(colorPicker === i ? null : i)}
                  style={{ width:32, height:28, background:t.color, border:"2px solid #1e293b",
                    borderRadius:5, cursor:"pointer", display:"block" }} />
                {colorPicker === i && (
                  <div style={{ position:"absolute", right:0, top:48, zIndex:100,
                    background:"#0f172a", border:"1px solid #334155", borderRadius:8,
                    padding:8, display:"grid", gridTemplateColumns:"repeat(6,22px)", gap:4,
                    boxShadow:"0 8px 32px #000a" }}>
                    {COLORS.map(c => (
                      <button key={c} onClick={() => { upd(i,"color",c); setColorPicker(null); }}
                        title={c}
                        style={{ width:22, height:22, background:c, border: t.color===c ? "2px solid #fff" : "2px solid transparent",
                          borderRadius:4, cursor:"pointer", padding:0 }} />
                    ))}
                  </div>
                )}
              </div>

              {/* Remove */}
              <div>
                <div style={{ fontSize:8, color:"transparent", marginBottom:2 }}>DEL</div>
                <button onClick={() => removeTeam(i)} disabled={draft.length <= 1}
                  style={{ width:28, height:28, background:"#7f1d1d",
                    border:"1px solid #ef444455", borderRadius:5,
                    color:"#fca5a5", cursor: draft.length <= 1 ? "not-allowed" : "pointer",
                    fontSize:12, fontFamily:"inherit",
                    opacity: draft.length <= 1 ? 0.3 : 1 }}>✕</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display:"flex", gap:6, marginTop:2 }}>
        <button onClick={addTeam} disabled={atMax}
          style={{ flex:1, padding:"8px", background: atMax ? "#0f172a" : "#0a1a2a",
            border:`1px solid ${atMax ? "#1e293b" : "#38bdf855"}`,
            color: atMax ? "#334155" : "#38bdf8", borderRadius:6,
            cursor: atMax ? "not-allowed" : "pointer", fontFamily:"inherit",
            fontSize:10, fontWeight:700, opacity: atMax ? 0.4 : 1 }}>
          + ADD TEAM
        </button>
        <button onClick={handleSave}
          style={{ flex:2, padding:"8px", fontWeight:800, fontSize:11, letterSpacing:"0.06em",
            background: saved
              ? "linear-gradient(135deg,#166534,#15803d)"
              : "linear-gradient(135deg,#1e3a5f,#1d4ed8)",
            border:"none", borderRadius:6, color:"#fff",
            cursor:"pointer", fontFamily:"inherit", transition:"all 0.3s" }}>
          {saved ? "✓ TEAMS SAVED!" : "💾 SAVE TEAMS"}
        </button>
      </div>

      {atMax && (
        <div style={{ fontSize:9, color:"#ef4444", textAlign:"center", marginTop:-4 }}>
          Maximum {MAX_TEAMS} teams reached
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
function App() {
  const [screen,       setScreen]       = useState("login");
  const [loginTab,     setLoginTab]     = useState("player");
  const [nameInput,    setNameInput]    = useState("");
  const [passInput,    setPassInput]    = useState("");
  const [gmPass,       setGmPass]       = useState("");
  const [loginErr,     setLoginErr]     = useState("");
  const [currentTeam,  setCurrentTeam]  = useState(null);
  const [teams,        setTeams]        = useState(DEFAULT_TEAMS);

  // Market
  const [prices,       setPrices]       = useState(initPrices);
  const [history,      setHistory]      = useState(() => initHistory(initPrices()));
  const [prevPrices,   setPrevPrices]   = useState(initPrices);
  const [bots,         setBots]         = useState(initBots);
  const [aiLog,        setAiLog]        = useState([]);
  const [news,         setNews]         = useState([]);
  const [tick,         setTick]         = useState(0);
  const [sentiment,    setSentiment]    = useState("neutral");
  const [activeSector, setActiveSector] = useState("all");
  // Per-sector biases: override global sentiment for each sector
  const [sectorBiases,         setSectorBiases]         = useState(() => Object.fromEntries(SECTORS.map(s=>[s.id,"neutral"])));
  // Live sector disruption news (AI-generated, applied continuously when automation is on)
  const [sectorDisruptions,    setSectorDisruptions]    = useState({});
  const [generatingSector,     setGeneratingSector]     = useState(null);
  const [activeDisruptSectors, setActiveDisruptSectors] = useState(new Set());
  const [selectedSectors,      setSelectedSectors]      = useState(new Set());

  // Player portfolio — holdings store signed qty (long > 0, short < 0)
  const [cash,         setCash]         = useState(INITIAL_CASH);
  const [holdings,     setHoldings]     = useState({});
  const [transactions, setTransactions] = useState([]);
  const [tab,          setTab]          = useState("market");
  const [selTicker,    setSelTicker]    = useState(null);
  const [orderQty,     setOrderQty]     = useState(1);
  const [marketSearch, setMarketSearch] = useState("");

  // Player stat tracking
  const [peakValue,    setPeakValue]    = useState(INITIAL_CASH);
  const [maxDrawdown,  setMaxDrawdown]  = useState(0);

  // Game flow
  const [gamePhase,    setGamePhase]    = useState("idle");
  const [roundNum,     setRoundNum]     = useState(1);
  const [roundDurations, setRoundDurations] = useState([...DEFAULT_ROUND_DURATIONS]); // per-round seconds
  const roundDur = roundDurations[Math.min(roundNum - 1, TOTAL_ROUNDS - 1)]; // current round's duration
  const [startTime,    setStartTime]    = useState(null);
  const [timeLeft,     setTimeLeft]     = useState(null);
  const [bufferLeft,   setBufferLeft]   = useState(null);
  const [bufferStart,  setBufferStart]  = useState(null);
  const [initCash,     setInitCash]     = useState(INITIAL_CASH);
  const [gmTab,        setGmTab]        = useState("control");
  // Round identity + special mechanics
  const [roundRules,   setRoundRules]   = useState(ROUND_RULES[0]);
  const [volMultiplier,setVolMultiplier]= useState(1.0);
  const [leaderHidden, setLeaderHidden] = useState(false);
  const [taxPending,   setTaxPending]   = useState(false);
  const [taxAmount,    setTaxAmount]    = useState(0);
  const [liquidatePending, setLiquidatePending] = useState(false);
  // Power-up cards
  const [usedCards,    setUsedCards]    = useState(new Set());
  const usedCardsRef = useRef(new Set()); // mirror for stale-closure-free reads in gmCmd
  const [frozenUntil,  setFrozenUntil]  = useState(null);
  const [haltedUntil,  setHaltedUntil]  = useState(null);
  const [activePowerup,setActivePowerup]= useState(null);
  // Prediction market
  const [predictionOpen,  setPredictionOpen]  = useState(false);
  const [predictionSession, setPredictionSession] = useState(null);
  const [playerPrediction,setPlayerPrediction]= useState(null);
  const [playerPredictionRound, setPlayerPredictionRound] = useState(null);
  const [playerPredictionSessionId, setPlayerPredictionSessionId] = useState(null);
  const [predResult,      setPredResult]      = useState(null);
  // Achievements
  const [achievements, setAchievements] = useState([]);
  // GM rulebook panel
  const [showRulebook, setShowRulebook] = useState(false);
  // 60-team score throttle
  const lastScoreWrite = useRef(0);
  const predCorrectCount = useRef({ total: 0, correct: 0 });
  const [detailStock,  setDetailStock]  = useState(null);
  const [shockTicker,  setShockTicker]  = useState(ALL_STOCKS[0].ticker);
  const [polEventIdx,  setPolEventIdx]  = useState(0);
  const [generatingPol, setGeneratingPol] = useState(false);
  const [shockPct,     setShockPct]     = useState(15);

  // Inter-round
  const [disruptions,   setDisruptions]   = useState([]);
  const [showCeremony,  setShowCeremony]  = useState(false);
  const [showBlast,     setShowBlast]     = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [generating,    setGenerating]    = useState(false);
  const [winnerRanked,  setWinnerRanked]  = useState([]);

  // Shared
  const [sharedLB,   setSharedLB]   = useState([]);
  const [broadcast,  setBroadcast]  = useState(null);

  const pricesRef      = useRef(prices);
  const historyRef     = useRef(history);
  const phaseRef       = useRef(gamePhase);
  const tickRef        = useRef(0);
  const aiRef          = useRef(false);
  const sentimentRef   = useRef(sentiment);
  const sectorBiasRef  = useRef(sectorBiases);
  const lastBcRef      = useRef(null);
  const volMultiplierRef= useRef(1.0);
  const frozenRef       = useRef(null);
  const haltedRef       = useRef(null);
  const predictionSessionRef = useRef(predictionSession);
  const gameStartedRef  = useRef(false);
  const currentBufferDurationRef = useRef(BUFFER_SECS);
  const scheduleInRoundDisruptionsRef = useRef(null);
  const screenRef       = useRef(screen); // always current screen, safe to read in closures
  const archivedDisruptionKeyRef = useRef(null);
  pricesRef.current     = prices;
  historyRef.current    = history;
  phaseRef.current      = gamePhase;
  tickRef.current       = tick;
  sentimentRef.current  = sentiment;
  sectorBiasRef.current  = sectorBiases;
  volMultiplierRef.current = volMultiplier;
  frozenRef.current      = frozenUntil;
  haltedRef.current      = haltedUntil;
  predictionSessionRef.current = predictionSession;
  screenRef.current      = screen;

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
    const uniqueSectors = new Set(Object.keys(holdings_).map(t => ALL_STOCKS.find(s=>s.ticker===t)?.sectorId).filter(Boolean)).size;
    const closedTrades  = transactions_.filter(t => t.type === "SELL" || t.type === "COVER");
    const wins_         = closedTrades.filter(t => (t.gain || 0) > 0).length;
    const lastTrade     = closedTrades.length > 0 ? closedTrades[0].id : Date.now(); // id = timestamp

    // Compute per-round returns from transactions snapshots
    // Approximation: use ratio of current total vs initCash per round
    const ic = initC || INITIAL_CASH;
    const absoluteReturn = ((total - ic) / ic) * 100;

    const beta = calcPortfolioBeta(holdings_, pricesRef.current, historyRef.current);
    const ballReturn = calcBallReturn(pricesRef.current);

    try {
      await window.storage.set(`lb:${name}`, JSON.stringify({
        name, color, total, cash: cash_,
        uniqueSectors, closedTrades: closedTrades.length, wins: wins_,
        maxDrawdown: maxDD || 1, isBot: false,
        beta,
        ballReturn,
        lastTradeTs: lastTrade,
        predTotal:   predCorrectCount.current.total,
        predCorrect: predCorrectCount.current.correct,
        updatedAt: nowShort()
      }), true);
    } catch {}
  }, []);

  const loadLB = useCallback(async () => {
    try {
      const res  = await window.storage.list("lb:", true);
      const keys = res?.keys || [];
      const rows = (await Promise.all(keys.map(async k => {
        try { const r = await window.storage.get(k, true); return r ? JSON.parse(r.value) : null; }
        catch { return null; }
      }))).filter(Boolean);
      const scored = rows.map(e => ({ ...e, ...calcScore(e, INITIAL_CASH, rows) }));
      const ranked  = sortLeaderboard(scored);
      setSharedLB(ranked);
      return ranked;
    } catch { return []; }
  }, []);

  const pushGMState  = useCallback(async (o={}) => {
    try { await window.storage.set("gm:state", JSON.stringify({
      phase:phaseRef.current,
      round:roundNum,
      roundLeft:timeLeft,
      bufferLeft,
      initCash,
      sentiment,
      volMultiplier,
      leaderHidden,
      frozenUntil,
      haltedUntil,
      predictionOpen,
      roundRulesIdx:roundNum-1,
      ...o
    }), true); } catch {}
  }, [roundNum, timeLeft, bufferLeft, initCash, sentiment, volMultiplier, leaderHidden, frozenUntil, haltedUntil, predictionOpen]);

  const pushPrices   = useCallback(async (p, h) => {
    try { await window.storage.set("gm:prices", JSON.stringify({ prices:p, history:h }), true); } catch {}
  }, []);

  const pushTeams    = useCallback(async t => {
    try { await window.storage.set("gm:teams", JSON.stringify(t), true); } catch {}
  }, []);

  const pushDisrupts = useCallback(async evts => {
    try { await window.storage.set("gm:disruptions", JSON.stringify({ events:evts }), true); } catch {}
  }, []);

  const pushNews = useCallback(async items => {
    try { await window.storage.set("gm:news", JSON.stringify({ items }), true); } catch {}
  }, []);

  const pushPrediction = useCallback(async session => {
    try { await window.storage.set("gm:prediction", JSON.stringify(session || { phase:"closed" }), true); } catch {}
  }, []);

  const pushTrade    = useCallback(async trade => {
    try { await window.storage.set("cd:trades", JSON.stringify({ ...trade, id:Date.now() }), true); } catch {}
  }, []);

  const sendBcast    = useCallback(async text => {
    const m = { text, id:Date.now() };
    setBroadcast(m); setTimeout(() => setBroadcast(null), 7000);
    try { await window.storage.set("gm:broadcast", JSON.stringify(m), true); } catch {}
  }, []);

  const updateNewsFeed = useCallback((updater) => {
    setNews(prev => {
      const next = updater(prev).slice(0, 25);
      if (screenRef.current === "gm") pushNews(next);
      return next;
    });
  }, [pushNews]);

  const archiveDisruptionsToNews = useCallback((events, sourceLabel="DISRUPTION") => {
    if (!events?.length) return;
    const time = nowShort();
    updateNewsFeed(prev => [
      ...events.map(evt => ({
        ticker: evt.ticker,
        sectorId: evt.sectorId,
        headline: evt.eventName
          ? `${evt.eventIcon ? `${evt.eventIcon} ` : ""}${evt.eventName} — ${evt.headline}`
          : evt.headline,
        detail: evt.detail,
        sentiment: evt.impact > 0 ? "bull" : "bear",
        tag: evt.political ? "POLITICAL EVENT" : sourceLabel,
        time
      })),
      ...prev
    ]);
  }, [updateNewsFeed]);

  // ─── POLLING ──────────────────────────────────────────────────────────────────
  const prevRoundRef     = useRef(1);

  useEffect(() => {
    loadLB();
    const id = setInterval(() => { loadLB(); }, 4000);
    return () => clearInterval(id);
  }, [loadLB]);

  useEffect(() => {
    loadLB();
    (async () => { try { const r = await window.storage.get("gm:teams",true); if(r) setTeams(JSON.parse(r.value)); } catch {} })();
    const id = setInterval(async () => {
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
          if (parsed.round !== undefined) setRoundNum(parsed.round);
          if (parsed.roundLeft !== undefined) setTimeLeft(parsed.roundLeft);
          if (parsed.bufferLeft !== undefined) setBufferLeft(parsed.bufferLeft);
          if (parsed.initCash !== undefined) setInitCash(parsed.initCash);
          if (parsed.sentiment) setSentiment(parsed.sentiment);
          if (parsed.volMultiplier !== undefined) setVolMultiplier(parsed.volMultiplier);
          if (parsed.leaderHidden !== undefined) setLeaderHidden(parsed.leaderHidden);
          if (parsed.frozenUntil !== undefined) setFrozenUntil(parsed.frozenUntil);
          if (parsed.haltedUntil !== undefined) setHaltedUntil(parsed.haltedUntil);
          if (parsed.roundRulesIdx !== undefined) setRoundRules(ROUND_RULES[parsed.roundRulesIdx] || ROUND_RULES[0]);
          if (parsed.predictionOpen !== undefined && screenRef.current === "player") setPredictionOpen(parsed.predictionOpen);
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
        if (di) { const d = JSON.parse(di.value); if (d.events) setDisruptions(d.events); }
        const gn = await window.storage.get("gm:news", true);
        if (gn) {
          const data = JSON.parse(gn.value);
          if (Array.isArray(data.items)) setNews(data.items);
        }
        const gp = await window.storage.get("gm:prediction", true);
        if (gp) {
          const session = JSON.parse(gp.value);
          setPredictionSession(session);
          if (session?.phase === "closed") setPredictionOpen(false);
        }
        if (screenRef.current !== "gm") {
          const gp2 = await window.storage.get("gm:prices", true);
          if (gp2) {
            const data = JSON.parse(gp2.value);
            if (data.prices) {
              setPrevPrices(pricesRef.current);
              setPrices(data.prices);
            }
            if (data.history) setHistory(data.history);
          }
        }
      } catch {}
    }, 1000);
    return () => clearInterval(id);
  }, [loadLB]);

  // ─── SAVE SCORE periodically ──────────────────────────────────────────────────
  // Use refs for peakValue/maxDrawdown to avoid them in deps causing infinite loop
  const peakValueRef  = useRef(peakValue);
  const maxDrawdownRef = useRef(maxDrawdown);
  peakValueRef.current  = peakValue;
  maxDrawdownRef.current = maxDrawdown;

  useEffect(() => {
    if (!currentTeam || screen !== "player") return;
    const hv    = Object.entries(holdings).reduce((s,[t,p]) => s+(prices[t]||0)*p.qty, 0);
    const total = cash + hv;
    // drawdown tracking — read from refs, write to state without adding to deps
    if (total > peakValueRef.current) setPeakValue(total);
    const dd = peakValueRef.current > 0 ? ((peakValueRef.current - total) / peakValueRef.current) * 100 : 0;
    if (dd > maxDrawdownRef.current) setMaxDrawdown(dd);
    // Throttle score writes: max once per SCORE_WRITE_INTERVAL for 60-team scale
    if (Date.now() - lastScoreWrite.current >= SCORE_WRITE_INTERVAL) {
      saveScore(currentTeam.name, currentTeam.color, total, cash, holdings, transactions, initCash, maxDrawdownRef.current);
      lastScoreWrite.current = Date.now();
    }
  }, [tick, cash, holdings, prices, currentTeam, screen, initCash, transactions, saveScore]);

  // push prices every tick when GM
  useEffect(() => {
    if (screen === "gm") pushPrices(prices, history);
  }, [tick, prices, history, screen, pushPrices]);

  const submitPredictionVote = useCallback(async (optionId) => {
    const session = predictionSessionRef.current;
    if (screenRef.current !== "player" || !currentTeam || !session || session.phase !== "polling") return;
    if (playerPredictionSessionId === session.id) return;
    setPlayerPrediction(optionId);
    setPlayerPredictionRound(session.round);
    setPlayerPredictionSessionId(session.id);
    try {
      await window.storage.set(`predvote:${session.id}:${currentTeam.name}`, JSON.stringify({
        team: currentTeam.name,
        round: session.round,
        option: optionId,
        ts: Date.now()
      }), true);
    } catch {}
  }, [currentTeam, playerPredictionSessionId]);

  const finalizePredictionPolling = useCallback(async (sessionArg) => {
    const session = sessionArg || predictionSessionRef.current;
    if (screenRef.current !== "gm" || !session || session.phase !== "polling") return;
    let votes = [];
    try {
      const res = await window.storage.list(`predvote:${session.id}:`, true);
      const keys = res?.keys || [];
      votes = (await Promise.all(keys.map(async key => {
        try {
          const row = await window.storage.get(key, true);
          return row ? JSON.parse(row.value) : null;
        } catch {
          return null;
        }
      }))).filter(Boolean);
    } catch {}

    const totalVotes = votes.length;
    const results = Object.fromEntries((session.question?.options || []).map(opt => {
      const voteCount = votes.filter(v => v.option === opt.id).length;
      return [opt.id, {
        votes: voteCount,
        pct: totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0
      }];
    }));

    const revealSession = {
      ...session,
      phase:"revealing",
      results,
      totalVotes,
      revealStartedAt: Date.now(),
      revealEndsAt: Date.now() + PREDICTION_REVEAL_SECS * 1000
    };
    setPredictionSession(revealSession);
    setPredictionOpen(true);
    await pushPrediction(revealSession);
    await pushGMState({ predictionOpen:true });
    sendBcast("🎯 Prediction Market locked. Revealing the correct answer and team polling split now.");
  }, [pushGMState, pushPrediction, sendBcast]);

  useEffect(() => {
    if (screen !== "gm" || !predictionSession || predictionSession.phase === "closed") return undefined;
    const targetTime = predictionSession.phase === "polling"
      ? predictionSession.endsAt
      : predictionSession.revealEndsAt;
    const waitMs = Math.max(0, (targetTime || Date.now()) - Date.now());
    const id = setTimeout(async () => {
      const active = predictionSessionRef.current;
      if (!active || active.id !== predictionSession.id) return;
      if (active.phase === "polling") {
        await finalizePredictionPolling(active);
        return;
      }
      if (active.phase === "revealing") {
        const closedAt = Date.now();
        const pauseMs = active.startedAt ? Math.max(0, closedAt - active.startedAt) : 0;
        if (pauseMs > 0) setStartTime(prev => prev ? prev + pauseMs : prev);
        const closedSession = { ...active, phase:"closed", closedAt };
        setPredictionSession(closedSession);
        setPredictionOpen(false);
        await pushPrediction(closedSession);
        await pushGMState({ predictionOpen:false });
        sendBcast("▶ Prediction Market complete. Trading resumes immediately.");
      }
    }, waitMs + 50);
    return () => clearTimeout(id);
  }, [finalizePredictionPolling, predictionSession, pushGMState, pushPrediction, screen, sendBcast]);

  // ─── TIMERS ───────────────────────────────────────────────────────────────────
  const triggerRoundEndRef = useRef(null);

  useEffect(() => {
    if (phaseRef.current !== "running" || !startTime) { setTimeLeft(null); return; }
    const id = setInterval(() => {
      if (phaseRef.current !== "running") { clearInterval(id); return; }
      if (["polling","revealing"].includes(predictionSessionRef.current?.phase)) return;
      const left = Math.max(0, roundDur - Math.floor((Date.now()-startTime)/1000));
      setTimeLeft(left);
      pushGMState({ roundLeft:left });
      if (left <= 0) { clearInterval(id); triggerRoundEndRef.current?.(); }
    }, 1000);
    return () => clearInterval(id);
  }, [startTime, roundDur, pushGMState]);

  useEffect(() => {
    if (phaseRef.current !== "buffer" || !bufferStart) {
      setBufferLeft(null);
      return;
    }
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((bufferStart + (currentBufferDurationRef.current || BUFFER_SECS) * 1000 - Date.now()) / 1000));
      setBufferLeft(left);
      pushGMState({ phase:"buffer", bufferLeft:left });
      if (left <= 0 && phaseRef.current === "buffer") {
        clearInterval(id);
        // Auto-apply disruption then start next round — no GM permission needed
        setGamePhase("disruption");
        pushGMState({ phase:"disruption" });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [bufferStart, pushGMState]);

  // When buffer expires and phase becomes "disruption", auto-apply disruption and start next round
  // Uses a ref to avoid temporal dead zone — startNextRound is defined later via useCallback
  const autoDisruptAppliedRef = useRef(false);
  const startNextRoundRef = useRef(null);
  useEffect(() => {
    if (screen !== "gm") return;
    if (gamePhase !== "disruption") {
      autoDisruptAppliedRef.current = false;
      return;
    }
    if (autoDisruptAppliedRef.current) return;
    autoDisruptAppliedRef.current = true;
    const cur = pricesRef.current;
    const next = { ...cur };
    disruptions.forEach(evt => {
      if (next[evt.ticker]) next[evt.ticker] = Math.max(0.5, next[evt.ticker] * (1 + evt.impact / 100));
    });
    if (disruptions.length > 0) {
      setPrices(next);
      setHistory(prevH => {
        const newH = { ...prevH };
        disruptions.forEach(evt => {
          if (newH[evt.ticker]) newH[evt.ticker] = [...newH[evt.ticker].slice(1), next[evt.ticker]];
        });
        pushPrices(next, newH); return newH;
      });
      const archiveKey = `${gamePhase}:${disruptions.map(evt => `${evt.ticker}:${evt.impact}`).join("|")}`;
      if (archivedDisruptionKeyRef.current !== archiveKey) {
        archivedDisruptionKeyRef.current = archiveKey;
        archiveDisruptionsToNews(disruptions, "BUFFER EVENT");
      }
    }
    setTimeout(() => { startNextRoundRef.current?.(); }, 600);
  }, [archiveDisruptionsToNews, gamePhase, disruptions, pushPrices, screen]);

  // ─── PRICE ENGINE ─────────────────────────────────────────────────────────────
  const advancePrices = useCallback((cur, hist, sent, secBiases) => {
    const globalBias = sent==="bull"?0.005:sent==="bear"?-0.005:0;
    const globalVm   = sent==="volatile"?3:1;
    const newP = {}, newH = { ...hist };
    // First pass: price all non-ETF stocks normally
    ALL_STOCKS.forEach(s => {
      if (ETF_CONSTITUENTS[s.ticker]) return; // ETFs handled in second pass
      const secB = secBiases?.[s.sectorId] || "neutral";
      const sectorBias = secB==="bull"?0.009:secB==="bear"?-0.009:globalBias;
      const sectorVm   = secB==="volatile"?3.5:secB==="neutral"?globalVm:1;
      const vol   = rnd(0.004, 0.018) * s.volatility * sectorVm;
      const drift = sectorBias + rnd(-vol, vol);
      const shock = Math.random() < 0.03 ? rnd(-0.08, 0.1) : 0;
      newP[s.ticker] = Math.max(0.5, cur[s.ticker] * (1 + drift + shock));
      newH[s.ticker] = [...hist[s.ticker].slice(1), newP[s.ticker]];
    });
    // Helper: price an ETF from its constituents using prices already in newP
    const priceEtf = (etfStock) => {
      const tickers = ETF_CONSTITUENTS[etfStock.ticker];
      const avgChg = tickers.reduce((sum, t) => {
        const prev = cur[t] || 1;
        const next = newP[t] || prev;  // newP has constituent prices by now
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
    return { newP, newH };
  }, []);

  // ─── AI BOT TRADES ────────────────────────────────────────────────────────────
  const runBotTrades = useCallback(async (curP, curBots) => {
    if (aiRef.current) return curBots;
    aiRef.current = true;
    const updated = curBots.map(b => ({ ...b, holdings:{...b.holdings} }));
    const tickerList = ALL_STOCKS.map(s=>`${s.ticker}(${s.sectorLabel})`).join(",");
    for (let i = 0; i < updated.length; i++) {
      const b = updated[i];
      const held  = Object.entries(b.holdings).map(([t,d])=>`${t}:${d?.qty||d}@$${fmt(curP[t])}`).join(",") || "none";
      const prStr = ALL_STOCKS.slice(0,10).map(s=>`${s.ticker}=$${fmt(curP[s.ticker])}`).join(",");
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method:"POST", headers:{"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"},
          body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:130,
            system:`You are ${b.name}, a ${b.personality}. 35 stocks across 7 sectors available.
Respond ONLY JSON no markdown: {"action":"buy"|"sell"|"hold","ticker":"TICKER","qty":NUMBER,"reason":"max 8 words"}
qty 1-15. Use REAL tickers from: ${tickerList.slice(0,200)}`,
            messages:[{role:"user",content:`Sample prices:${prStr}... Cash:$${fmt(b.cash)}. Holdings:${held}. Pick a trade.`}]
          })
        });
        const data = await res.json();
        const raw  = data.content?.[0]?.text || "{}";
        const dec  = JSON.parse(raw.replace(/```[\w]*|```/g,"").trim());
        const stk  = ALL_STOCKS.find(s=>s.ticker===dec.ticker);
        if (!stk) continue;
        if (dec.action==="buy" && dec.qty>0) {
          const cost = curP[dec.ticker]*dec.qty;
          if (b.cash>=cost) {
            b.cash -= cost;
            const ex = b.holdings[dec.ticker];
            if (ex) { const tc=ex.totalCost+cost; b.holdings[dec.ticker]={qty:ex.qty+dec.qty,avgCost:tc/(ex.qty+dec.qty),totalCost:tc}; }
            else b.holdings[dec.ticker]={qty:dec.qty,avgCost:curP[dec.ticker],totalCost:cost};
            b.trades++;
            pushTrade({team:b.name,teamColor:b.color,action:"BUY",ticker:dec.ticker,qty:dec.qty,price:curP[dec.ticker],time:nowShort()});
          }
        } else if (dec.action==="sell" && (b.holdings[dec.ticker]?.qty||0)>=dec.qty) {
          const pos = b.holdings[dec.ticker];
          const gain = (curP[dec.ticker]-pos.avgCost)*dec.qty;
          b.cash += curP[dec.ticker]*dec.qty;
          b.holdings[dec.ticker].qty -= dec.qty;
          b.holdings[dec.ticker].totalCost -= pos.avgCost*dec.qty;
          if (b.holdings[dec.ticker].qty<=0) delete b.holdings[dec.ticker];
          b.trades++; b.closedTrades++;
          if (gain>0) b.wins++;
          pushTrade({team:b.name,teamColor:b.color,action:"SELL",ticker:dec.ticker,qty:dec.qty,price:curP[dec.ticker],time:nowShort()});
        }
        const hv = Object.values(b.holdings).reduce((s,p)=>s+(curP[p.ticker]||0)*(p?.qty||0),0) +
          Object.keys(b.holdings).reduce((s,t)=>s+(curP[t]||0)*(b.holdings[t]?.qty||0),0);
        const totalHv = Object.entries(b.holdings).reduce((s,[t,p])=>s+(curP[t]||0)*(p?.qty||0),0);
        b.pnl = b.cash + totalHv - INITIAL_CASH;
        if (b.cash+totalHv > b.peakValue) b.peakValue=b.cash+totalHv;
        b.uniqueSectors = new Set(Object.keys(b.holdings).map(t=>ALL_STOCKS.find(s=>s.ticker===t)?.sectorId).filter(Boolean)).size;
        // save bot score
        const botTotal = b.cash + totalHv;
        try { await window.storage.set(`lb:${b.name}`, JSON.stringify({
          name:b.name, color:b.color, total:botTotal, cash:b.cash,
          uniqueSectors:b.uniqueSectors, closedTrades:b.closedTrades, wins:b.wins,
          maxDrawdown:1, isBot:true, updatedAt:nowShort() }), true); } catch {}
        setAiLog(p=>[{time:nowShort(),trader:b.name,action:dec.action,ticker:dec.ticker,qty:dec.qty,reason:dec.reason,color:b.color},...p.slice(0,39)]);
      } catch {}
    }
    aiRef.current = false;
    return updated;
  }, [pushTrade]);

  // ─── TICK NEWS ────────────────────────────────────────────────────────────────
  const genNews = useCallback(async (newP, prevP) => {
    if (screenRef.current !== "gm") return;
    const movers = ALL_STOCKS.map(s=>({...s,chg:((newP[s.ticker]-prevP[s.ticker])/(prevP[s.ticker]||1))*100}))
      .filter(s=>Math.abs(s.chg)>2).sort((a,b)=>Math.abs(b.chg)-Math.abs(a.chg));
    if (!movers.length) return;
    const top = movers[0];
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:70,
          system:"Write a fake financial news headline. Max 14 words. No quotes. Headline only.",
          messages:[{role:"user",content:`${top.name} (${top.ticker}, ${top.sectorLabel}) ${top.chg>0?"surged":"dropped"} ${fmt(Math.abs(top.chg))}%. One-line headline:`}]
        })
      });
      const data = await res.json();
      const h    = data.content?.[0]?.text?.trim() || "";
      if (h) updateNewsFeed(prev => [{ticker:top.ticker,sectorId:top.sectorId,headline:h,
        sentiment:top.chg>0?"bull":"bear",time:nowShort()},...prev]);
    } catch {}
  }, [updateNewsFeed]);


    // ─── GAME TICK ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== "gm" || gamePhase !== "running") return;
    const id = setInterval(() => {
      if (haltedRef.current && Date.now() < haltedRef.current) return;
      if (["polling","revealing"].includes(predictionSessionRef.current?.phase)) return;
      const curP = pricesRef.current;
      const curH = historyRef.current;
      const { newP, newH } = advancePrices(curP, curH, sentimentRef.current, sectorBiasRef.current);
      setPrevPrices(curP);
      setPrices(newP);
      setHistory(newH);
      setTick(t => t + 1);
      genNews(newP, curP);
      pushPrices(newP, newH);
      if (tickRef.current % 2 === 0) {
        setBots(prevB => { runBotTrades(newP, prevB).then(u => setBots(u)); return prevB; });
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [screen, gamePhase, advancePrices, genNews, pushPrices, runBotTrades]);

  // ─── ROUND END ────────────────────────────────────────────────────────────────
  const generateDisruptionRef = useRef(null); // wired after generateDisruption is defined below
  const triggerRoundEnd = useCallback(async () => {
    if (["buffer","disruption","ceremony","ended"].includes(phaseRef.current)) return;
    const isFinalRound = roundNum >= TOTAL_ROUNDS;
    setGamePhase(isFinalRound ? "ceremony" : "idle");
    pushGMState({ phase: isFinalRound ? "ceremony" : "idle" });
    const lb = await loadLB();
    const botEntries = bots.map(b => {
      const hv = Object.entries(b.holdings).reduce((s,[t,p])=>s+(pricesRef.current[t]||0)*(p?.qty||0),0);
      return { name:b.name,color:b.color,total:b.cash+hv,cash:b.cash,
        uniqueSectors:b.uniqueSectors||0,closedTrades:b.closedTrades||0,
        wins:b.wins||0,maxDrawdown:1,isBot:true };
    });
    const all = [...lb.filter(e=>!e.isBot),...botEntries];
    const rules = ROUND_RULES[roundNum-1] || ROUND_RULES[0];
    // Calculate tax for this round
    if (rules.tax) {
      const hv = Object.entries(holdings).reduce((s,[t,p])=>s+(pricesRef.current[t]||0)*p.qty,0);
      const total = cash + hv;
      const profit = total - INITIAL_CASH;
      const tax = profit > 0 ? Math.round(profit * TAX_RATE) : 0;
      setTaxAmount(tax);
      setTaxPending(true);
      sendBcast(`💸 TAX TIME: 20% profit tax = $${tax.toLocaleString()} deducted from your gains!`);
    }
    if (rules.liquidate) {
      setLiquidatePending(true);
      sendBcast(`🔴 FORCED LIQUIDATION: All positions will be cleared at round end!`);
    }
    // Achievements check
    const newAch = [];
    const hv2 = Object.entries(holdings).reduce((s2,[t,p])=>s2+(pricesRef.current[t]||0)*p.qty,0);
    const roundProfit = (cash + hv2) - INITIAL_CASH;
    if (sentiment === "bear" && roundProfit > 0) newAch.push({ id:"bull_whisperer", icon:"🐂", name:"Bull Whisperer", desc:"Profited in a BEAR round — against the trend" });
    // Prediction market result
    const pq = PREDICTION_QUESTIONS.find(q => q.round === roundNum);
    if (pq && playerPrediction && playerPredictionRound === roundNum) {
      if (playerPrediction === pq.correct) {
        newAch.push({ id:`pred_correct_r${roundNum}`, icon:"🎯", name:"Market Oracle", desc:`Correct prediction: ${pq.concept}` });
        const bonus = Math.round((cash + hv2) * pq.bonus);
        setCash(c => c + bonus);
        predCorrectCount.current.correct += 1;
        sendBcast(`🎯 ${currentTeam?.name} predicted correctly! +${Math.round(pq.bonus*100)}% capital bonus applied.`);
        setPredResult({ correct:true, answer:pq.options.find(o=>o.id===pq.correct)?.text, explanation:pq.explanation, bonus });
      } else {
        setPredResult({ correct:false, answer:pq.options.find(o=>o.id===pq.correct)?.text, explanation:pq.explanation, bonus:0 });
      }
      predCorrectCount.current.total += 1;
    }
    setAchievements(prev => {
      const ids = prev.map(a=>a.id);
      return [...prev, ...newAch.filter(a=>!ids.includes(a.id))];
    });
    const allScored = all.map(e => ({ ...e, ...calcScore(e, initCash, all) }));
    setWinnerRanked(sortLeaderboard(allScored));
    // Only show ceremony after the final round
    if (isFinalRound) {
      setShowCeremony(true);
      sendBcast(`🏆 GAME OVER! Final results are in — check the leaderboard!`);
    } else {
      // Automatically generate disruption for next round — no GM needed
      sendBcast(`⏱ ROUND ${roundNum} ENDED — Preparing next round automatically…`);
      // generateDisruption will be called via the ref below after state settles
      setTimeout(() => { generateDisruptionRef.current?.(); }, 800);
    }
    setPlayerPrediction(null);
    setPlayerPredictionRound(null);
    setPlayerPredictionSessionId(null);
  }, [bots, currentTeam?.name, initCash, loadLB, pushGMState, roundNum, cash, holdings, playerPrediction, playerPredictionRound, sentiment, sendBcast]);
  triggerRoundEndRef.current = triggerRoundEnd;

  // ─── ROUND-SPECIFIC ECONOMIC EVENT MAP ───────────────────────────────────────
  // Maps each round to a curated POLITICAL_EVENTS id that teaches its economic concept
  const ROUND_ECONOMIC_EVENTS = {
    1: "rate_hike_emergency",      // R1 Orientation   → Interest rates & discount rates
    2: "quantitative_easing",      // R2 Bull Run       → QE / cheap money / asset bubbles
    3: "recession_declaration",    // R3 The Crash      → Negative demand shock / defensives
    4: "trade_war_escalation",     // R4 Sector Wars    → Comparative advantage / sector rotation
    5: "market_failure_fraud",     // R5 Dark Pool      → Information asymmetry
    6: "inflation_cpi_shock",      // R6 Volatility Storm → Stagflation / policy dilemma
    7: "oil_supply_shock",         // R7 Grand Final    → Supply shock / full market cycle
  };

  // ─── GENERATE DISRUPTION ──────────────────────────────────────────────────────
  const generateDisruption = useCallback(async () => {
    setGenerating(true);

    // Which round are we launching next?
    const targetRound = gameStartedRef.current ? roundNum + 1 : 1;

    // Pick the round-specific political event
    const eventId = ROUND_ECONOMIC_EVENTS[targetRound];
    const polEvt  = POLITICAL_EVENTS.find(e => e.id === eventId) || POLITICAL_EVENTS[0];

    // Build affected stocks from the event's sector impacts
    const affectedStocks = [];
    for (const [sectorId, sectorImpact] of Object.entries(polEvt.sectors)) {
      if (Math.abs(sectorImpact) < 8) continue;
      const sector = SECTORS.find(s => s.id === sectorId);
      if (!sector) continue;
      for (const st of sector.stocks.slice(0, 2)) {
        const stockImpact = Math.round(clamp(sectorImpact + rnd(-6, 6), -60, 60));
        affectedStocks.push({ ...st, sectorId, sectorLabel: sector.label, impact: stockImpact });
      }
    }

    // Generate AI headlines anchored to the economic concept of this round
    const events = [];
    for (const st of affectedStocks.slice(0, 6)) {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method:"POST",
          headers:{"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"},
          body: JSON.stringify({
            model:"claude-sonnet-4-20250514", max_tokens:150,
            system:`Respond ONLY with valid JSON no markdown: {"headline":"max 12 words","detail":"max 18 words"}`,
            messages:[{ role:"user", content:
              `Macro event: "${polEvt.headline}". ` +
              `Economic concept: "${polEvt.concept}". ` +
              `Write a realistic consequence headline for ${st.name} (${st.sectorLabel} sector). ` +
              `Do NOT mention % moves or reveal whether impact is positive/negative. ` +
              `Players must infer direction from economic reasoning.`
            }]
          })
        });
        const data   = await res.json();
        const raw    = (data.content?.[0]?.text || "{}").replace(/```[\w]*|```/g,"").trim();
        const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");
        events.push({
          ticker: st.ticker, sectorId: st.sectorId,
          headline: parsed.headline || `${polEvt.headline.slice(0,50)} — ${st.name} responds`,
          detail:   parsed.detail   || polEvt.subheadline,
          impact: st.impact, political: true,
          eventName: polEvt.headline, eventIcon: polEvt.icon, concept: polEvt.concept,
        });
      } catch {
        events.push({
          ticker: st.ticker, sectorId: st.sectorId,
          headline: `${polEvt.headline.slice(0,55)} — ${st.name}`,
          detail: polEvt.subheadline,
          impact: st.impact, political: true,
          eventName: polEvt.headline, eventIcon: polEvt.icon, concept: polEvt.concept,
        });
      }
    }

    setDisruptions(events);
    await pushDisrupts(events);
    setGenerating(false);
    setShowCeremony(false);
    const now = Date.now();
    currentBufferDurationRef.current = BUFFER_SECS; // standard 90s buffer
    setBufferStart(now); setBufferLeft(BUFFER_SECS);
    setGamePhase("buffer"); pushGMState({ phase:"buffer", bufferLeft:BUFFER_SECS });
    setShowEmergency(true);
  }, [roundNum, pushDisrupts, pushGMState]);
  generateDisruptionRef.current = generateDisruption;

  const generatePoliticalDisruption = useCallback(async (eventIdxOrEvent) => {
    const evt = typeof eventIdxOrEvent === "object" && eventIdxOrEvent
      ? eventIdxOrEvent
      : POLITICAL_EVENTS[eventIdxOrEvent ?? polEventIdx];
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
        affectedStocks.push({ ...st, sectorId, sectorLabel: sector.label, impact: stockImpact });
      }
    }

    // Generate AI narrative for the political event
    const events = [];
    for (const st of affectedStocks) {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method:"POST",
          headers:{"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"},
          body: JSON.stringify({
            model:"claude-sonnet-4-20250514", max_tokens:150,
            system:`Respond ONLY with valid JSON: {"headline":"max 12 words","detail":"max 15 words"}`,
            messages:[{ role:"user", content:
              `Macro-economic event: "${evt.headline}". ` +
              `Write a realistic follow-up consequence headline (under 12 words) for ${st.name}. ` +
              `Do NOT mention stock prices, % moves, or signal direction. ` +
              `Be factual — players must infer implications from economic reasoning. ` +
              `Underlying direction: ${st.impact > 0 ? "positive" : "negative"} — do not reveal.`
            }]
          })
        });
        const data = await res.json();
        const raw = (data.content?.[0]?.text || "{}").replace(/```[\w]*|```/g,"").trim();
        const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");
        events.push({
          ticker: st.ticker,
          sectorId: st.sectorId,
          headline: parsed.headline || `${evt.headline.slice(0,50)} — consequences emerge`,
          detail: parsed.detail || evt.subheadline,
          impact: st.impact,
          political: true,
          eventName: evt.headline,
          eventIcon: evt.icon,
          concept: evt.concept, // GM-only, not shown to players
        });
      } catch {
        events.push({
          ticker: st.ticker,
          sectorId: st.sectorId,
          headline: `${evt.headline.slice(0,50)} — ${st.name}`,
          detail: evt.subheadline,
          impact: st.impact,
          political: true,
          eventName: evt.name,
          eventIcon: evt.icon,
        });
      }
    }

    setDisruptions(events);
    await pushDisrupts(events);
    setGeneratingPol(false);
    setShowCeremony(false);
    const now = Date.now();
    currentBufferDurationRef.current = POLITICAL_BUFFER_SECS; // 30s buffer for GM political shock
    setBufferStart(now); setBufferLeft(POLITICAL_BUFFER_SECS);
    setGamePhase("buffer");
    pushGMState({ phase:"buffer", bufferLeft:POLITICAL_BUFFER_SECS });
    setShowEmergency(true);
    sendBcast(`📊 MACRO EVENT: ${evt.icon} ${evt.headline}`);
  }, [polEventIdx, pushDisrupts, pushGMState, sendBcast]);

    const applyDisruption = useCallback(() => {
    const cur  = pricesRef.current;
    const next = { ...cur };
    disruptions.forEach(evt => {
      if (next[evt.ticker]) next[evt.ticker] = Math.max(0.5, next[evt.ticker] * (1 + evt.impact / 100));
    });
    setPrices(next);
    setHistory(prevH => {
      const newH = { ...prevH };
      disruptions.forEach(evt => {
        if (newH[evt.ticker]) newH[evt.ticker] = [...newH[evt.ticker].slice(1), next[evt.ticker]];
      });
      pushPrices(next, newH); return newH;
    });
    const summary = disruptions.map(e=>`${e.ticker} ${e.impact>0?"+":""}${e.impact}%`).join(" · ");
    sendBcast(`🚨 DISRUPTION APPLIED: ${summary} — Round ${roundNum+1} begins!`);
  }, [disruptions, pushPrices, sendBcast, roundNum]);

  const startNextRound = useCallback(() => {
    const next = gameStartedRef.current ? roundNum + 1 : 1;
    if (next > TOTAL_ROUNDS) {
      setGamePhase("ended"); pushGMState({ phase:"ended", allEnded:true });
      setShowEmergency(false); return;
    }
    const rules = ROUND_RULES[next-1] || ROUND_RULES[ROUND_RULES.length-1];
    setRoundRules(rules);

    // Apply tax if pending (deduct from player cash)
    if (taxPending && taxAmount > 0) {
      setCash(c => Math.max(0, c - taxAmount));
      setTaxPending(false); setTaxAmount(0);
    }

    // Apply liquidation if pending
    if (liquidatePending) {
      const curP = pricesRef.current;
      setHoldings(prevH => {
        const totalHV = Object.entries(prevH).reduce((s,[t,p])=>s+(curP[t]||0)*p.qty, 0);
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
    gameStartedRef.current = true;  // mark game as started so subsequent rounds increment correctly
    setShowEmergency(false); setDisruptions([]); setRoundNum(next);
    pushDisrupts([]);
    const st = Date.now(); setStartTime(st); setGamePhase("running");
    const thisDur = roundDurations[next-1] || roundDur;
    setTimeLeft(thisDur); setBufferLeft(null);
    // Close prediction market
    archivedDisruptionKeyRef.current = null;
    setFrozenUntil(null); setHaltedUntil(null);
    setPredictionOpen(false); setPredictionSession({ phase:"closed" }); setPredResult(null);
    pushPrediction({ phase:"closed" });
    pushGMState({ phase:"running", round:next, roundLeft:thisDur,
      bufferLeft:0, volMultiplier:rules.volMult||1.0, leaderHidden:rules.leaderHidden||false,
      frozenUntil:null, haltedUntil:null, predictionOpen:false });
    // Schedule automated in-round AI disruptions via ref (defined after this callback)
    scheduleInRoundDisruptionsRef.current?.(next - 1, thisDur, st);
  }, [taxPending, taxAmount, liquidatePending, roundNum, roundDurations, roundDur,
      sendBcast, pushDisrupts, pushGMState, pushPrediction]);
  startNextRoundRef.current = startNextRound;

  // ─── AUTOMATED IN-ROUND DISRUPTION SCHEDULER ─────────────────────────────────
  // Fires AI disruptions automatically based on ROUND_RULES[].disruptionPlan timings.
  // atStart  → fires ~3s after round begins
  // midRound → fires at 50% of round duration
  // late     → fires at 80% of round duration
  // at5min   → fires at 5-minute mark
  // No GM permission needed — fully automated.
  const autoDisruptionTimers = useRef([]);

  const scheduleInRoundDisruptions = useCallback((roundIndex, roundDuration, roundStartTime) => {
    // Clear any previous timers
    autoDisruptionTimers.current.forEach(t => clearTimeout(t));
    autoDisruptionTimers.current = [];

    const plan = ROUND_RULES[roundIndex]?.disruptionPlan || {};
    if (!plan || Object.keys(plan).length === 0) return;

    const fireAiDisruption = async (count = 1) => {
      for (let i = 0; i < count; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 4000));
        // Use generateDisruption logic but for mid-round (AI type)
        // We'll fire a sector-based AI disruption on a random sector
        const sectorId = SECTORS[Math.floor(Math.random() * SECTORS.length)].id;
        const bias = ["bull","bear","volatile"][Math.floor(Math.random() * 3)];
        // We call the sector news generator directly (no buffer — it's mid-round)
        const sector = SECTORS.find(s => s.id === sectorId);
        if (!sector) continue;
        const events = [];
        for (const st of sector.stocks.slice(0, 2)) {
          const isBull = bias === "bull" || (bias === "volatile" && Math.random() > 0.5);
          const impact = Math.round(isBull ? rnd(8, 25) : -rnd(8, 25));
          let headline = `${isBull ? "Surge" : "Crash"} hits ${st.name} amid sector upheaval`;
          let detail = "Analysts rapidly reassessing sector valuations.";
          try {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
              method:"POST",
              headers:{"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"},
              body: JSON.stringify({
                model:"claude-sonnet-4-20250514", max_tokens:140,
                system:`Respond ONLY valid JSON no markdown: {"headline":"max 12 words","detail":"max 15 words"}`,
                messages:[{ role:"user", content:
                  `Write a ${isBull?"BULLISH":"BEARISH"} breaking news event for ${st.name} (${st.ticker}) in the ${sector.label} sector. Be dramatic and company-specific.`
                }]
              })
            });
            const data = await res.json();
            const raw = (data.content?.[0]?.text||"{}").replace(/```[\w]*|```/g,"").trim();
            const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]||"{}");
            if (parsed.headline) headline = parsed.headline;
            if (parsed.detail) detail = parsed.detail;
          } catch {}
          events.push({ ticker:st.ticker, sectorId, headline, detail, impact });
        }
        if (events.length === 0) continue;
        // Apply price shocks directly (no buffer — round keeps running)
        const cur = pricesRef.current;
        const next = { ...cur };
        events.forEach(e => { if (next[e.ticker]) next[e.ticker] = Math.max(0.5, next[e.ticker]*(1+e.impact/100)); });
        setPrices(next);
        setHistory(prev => {
          const newH = { ...prev };
          events.forEach(e => { if (newH[e.ticker]) newH[e.ticker] = [...newH[e.ticker].slice(1), next[e.ticker]]; });
          return newH;
        });
        const summary = events.map(e=>`${e.ticker} ${e.impact>0?"+":""}${e.impact}%`).join(" · ");
        sendBcast(`⚡ AUTO DISRUPTION: ${sector.icon} ${sector.label} — ${summary}`);
        updateNewsFeed(prev => [...events.map(e=>({
          ticker:e.ticker, sectorId, headline:e.headline, detail:e.detail,
          sentiment:e.impact>0?"bull":"bear", tag:"AUTO DISRUPTION", time:nowShort()
        })), ...prev]);
      }
    };

    Object.entries(plan).forEach(([timing, planItems]) => {
      planItems.forEach(item => {
        if (item.type !== "ai") return; // only schedule AI disruptions automatically; political shocks need GM
        const count = item.count || 1;
        let delayMs;
        if (timing === "atStart")  delayMs = 3000;
        else if (timing === "midRound") delayMs = Math.floor(roundDuration * 0.5) * 1000;
        else if (timing === "late")     delayMs = Math.floor(roundDuration * 0.8) * 1000;
        else if (timing === "at5min")   delayMs = 5 * 60 * 1000;
        else return;

        // Only schedule if delay is within round duration
        if (delayMs >= roundDuration * 1000) return;
        const t = setTimeout(() => {
          if (phaseRef.current !== "running") return;
          fireAiDisruption(count);
        }, delayMs);
        autoDisruptionTimers.current.push(t);
      });
    });
  }, [sendBcast, updateNewsFeed]);
  scheduleInRoundDisruptionsRef.current = scheduleInRoundDisruptions;

  // ─── SECTOR AUTOMATION ────────────────────────────────────────────────────────
  const generateSectorNews = useCallback(async (sectorId, bias) => {
    const sector = SECTORS.find(s => s.id === sectorId);
    if (!sector) return;
    setGeneratingSector(sectorId);
    const events = [];

    for (const st of sector.stocks.slice(0, 3)) {
      const isBull = bias === "bull" || (bias === "volatile" && Math.random() > 0.45);
      const impact = isBull ? rnd(8, 28) : -rnd(8, 28);
      let headline = `${isBull ? "Surge" : "Crash"} hits ${st.name} amid sector upheaval`;
      let detail   = "Analysts rapidly reassessing sector valuations.";

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
        const match   = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.headline) headline = parsed.headline;
          if (parsed.detail)   detail   = parsed.detail;
        }
      } catch (err) {
        // Fallback headlines so the game never breaks
        const bullHeadlines = [
          `${st.name} reports record-breaking quarterly results`,
          `Major institutional investors flood into ${st.ticker}`,
          `${sector.label} sector surges on regulatory approval`,
        ];
        const bearHeadlines = [
          `${st.name} faces unexpected regulatory investigation`,
          `${st.ticker} misses earnings amid sector headwinds`,
          `Analysts downgrade ${sector.label} sector outlook sharply`,
        ];
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
    setSectorDisruptions(prev => ({ ...prev, [sectorId]: events }));

    // Apply price shocks — use functional updates separately to avoid nesting
    const priceUpdates = {};
    events.forEach(evt => { priceUpdates[evt.ticker] = evt.impact; });

    const curPForSector = pricesRef.current;
    const nextPForSector = { ...curPForSector };
    Object.entries(priceUpdates).forEach(([ticker, impactPct]) => {
      if (nextPForSector[ticker] != null)
        nextPForSector[ticker] = Math.max(0.5, nextPForSector[ticker] * (1 + impactPct / 100));
    });
    setPrices(nextPForSector);
    setHistory(prev => {
      const newH = { ...prev };
      events.forEach(evt => {
        if (newH[evt.ticker])
          newH[evt.ticker] = [...newH[evt.ticker].slice(1), nextPForSector[evt.ticker] || Math.max(0.5, (curPForSector[evt.ticker] || 1) * (1 + evt.impact / 100))];
      });
      return newH;
    });

    // Push updated prices to central display
    setTimeout(() => pushPrices(pricesRef.current, undefined), 100);

    // Add to news feed
    const timeStr = nowShort();
    updateNewsFeed(prev => [
      ...events.map(evt => ({
        ticker: evt.ticker,
        sectorId,
        headline: evt.headline,
        detail: evt.detail,
        sentiment: evt.impact > 0 ? "bull" : "bear",
        tag: "SECTOR NEWS",
        time: timeStr
      })),
      ...prev
    ]);

    // Broadcast to all players
    const modeLabel = bias === "bull" ? "BULLISH SURGE" : bias === "bear" ? "BEARISH CRASH" : "VOLATILE SWING";
    const summary   = events.map(e => `${e.ticker} ${e.impact > 0 ? "+" : ""}${e.impact}%`).join(" · ");
    sendBcast(`${sector.icon} ${sector.label} ${modeLabel}: ${summary}`);

    setGeneratingSector(null);
  }, [pushPrices, sendBcast, updateNewsFeed]);

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
  const gmCmd = useCallback((cmd, payload={}) => {
    if (cmd==="start")     { const st=Date.now();setStartTime(st);setGamePhase("running");setTimeLeft(roundDur);pushGMState({phase:"running",round:roundNum,roundLeft:roundDur}); }
    else if(cmd==="pause") { setGamePhase("paused"); pushGMState({phase:"paused"}); }
    else if(cmd==="resume"){ setGamePhase("running"); pushGMState({phase:"running"}); }
    else if(cmd==="stop")  { setGamePhase("idle"); pushGMState({phase:"idle"}); }
    else if(cmd==="forceEnd") { triggerRoundEnd(); }
    else if(cmd==="shock") {
      const cur  = pricesRef.current;
      const next = { ...cur, [payload.ticker]: Math.max(0.5, cur[payload.ticker] * (1 + payload.pct / 100)) };
      setPrices(next);
      setHistory(prevH => {
        const h = { ...prevH, [payload.ticker]: [...prevH[payload.ticker].slice(1), next[payload.ticker]] };
        pushPrices(next, h); return h;
      });
    }
    else if(cmd==="sentiment") { setSentiment(payload.s); pushGMState({sentiment:payload.s}); }
    else if(cmd==="reset") {
      const newP = initPrices(), newH = initHistory(newP);
      const resetCash = payload.cash || initCash;
      // Reset all game state
      setPrices(newP); setHistory(newH); setPrevPrices(newP);
      setBots(initBots()); setAiLog([]); setNews([]);
      setCash(resetCash); setHoldings({}); setTransactions([]);
      setTick(0); setRoundNum(1); setStartTime(null); setTimeLeft(null);
      gameStartedRef.current = false;
      setRoundDurations([...DEFAULT_ROUND_DURATIONS]);
      setBufferLeft(null); setBufferStart(null); setGamePhase("idle");
      // Clear all overlay modals
      setShowCeremony(false); setShowEmergency(false); setShowBlast(false);
      setDisruptions([]); setWinnerRanked([]);
      setPeakValue(resetCash); setMaxDrawdown(0);
      setFrozenUntil(null); setHaltedUntil(null);
      setPredictionOpen(false); setPredictionSession({ phase:"closed" });
      setPlayerPrediction(null); setPlayerPredictionRound(null); setPlayerPredictionSessionId(null);
      setPredResult(null); setNews([]);
      // Reset sector state
      setSectorBiases(Object.fromEntries(SECTORS.map(s=>[s.id,"neutral"])));
      setActiveDisruptSectors(new Set());
      setSectorDisruptions({});
      setSelectedSectors(new Set());
      setSentiment("neutral");
      // Reset player-side round tracking ref so carry logic works on next game
      prevRoundRef.current = 0;
      usedCardsRef.current = new Set();
      setUsedCards(new Set());
      // Clear leaderboard scores from shared storage
      (async () => {
        try {
          const res = await window.storage.list("lb:", true);
          const keys = res?.keys || [];
          await Promise.all(keys.map(k => window.storage.delete(k, true)));
        } catch {}
      })();
      pushPrices(newP, newH);
      pushDisrupts([]);
      pushNews([]);
      pushPrediction({ phase:"closed" });
      pushGMState({ phase:"idle", round:1, roundLeft:null, bufferLeft:null, allEnded:false, sentiment:"neutral",
        frozenUntil:null, haltedUntil:null, predictionOpen:false });
    }
    else if(cmd==="broadcast") { sendBcast(payload.text); }
    else if(cmd==="powerup") {
      const card = POWERUP_CARDS.find(c=>c.id===payload.id);
      if (!card || usedCardsRef.current.has(card.id)) return;
      usedCardsRef.current = new Set([...usedCardsRef.current, card.id]);
      setUsedCards(new Set(usedCardsRef.current));
      setActivePowerup(card);
      setTimeout(() => setActivePowerup(null), 4000);
      if (card.effect.type === "market") {
        // Tsunami: crash everything
        const cur = pricesRef.current;
        const next2 = {};
        ALL_STOCKS.forEach(s => { next2[s.ticker] = Math.max(0.5, cur[s.ticker]*(1+card.effect.pct/100)); });
        setPrices(next2);
        setHistory(prevH => {
          const newH = {...prevH};
          ALL_STOCKS.forEach(s => { newH[s.ticker]=[...newH[s.ticker].slice(1), next2[s.ticker]]; });
          pushPrices(next2, newH); return newH;
        });
        sendBcast(`🌊 TSUNAMI CARD! Entire market ${card.effect.pct}% — chaos reigns!`);
      } else if (card.effect.type === "spike") {
        // Moon Shot: random stock +40% then corrects
        const target = ALL_STOCKS.filter(s=>!s.constituents)[Math.floor(Math.random()*35)];
        const cur = pricesRef.current;
        const spiked = Math.max(0.5, cur[target.ticker]*(1+card.effect.pct/100));
        setPrices(p => ({...p, [target.ticker]:spiked}));
        sendBcast(`🚀 MOON SHOT! ${target.ticker} surges ${card.effect.pct}% for 60 seconds!`);
        setTimeout(() => {
          setPrices(p => ({...p, [target.ticker]: Math.max(0.5, spiked*0.75)}));
          sendBcast(`📉 Moon Shot correction — ${target.ticker} pulling back.`);
        }, card.effect.duration * 1000);
      } else if (card.effect.type === "circuit") {
        const until = Date.now() + card.effect.duration*1000;
        setFrozenUntil(until);
        setHaltedUntil(until);
        pushGMState({ frozenUntil: until, haltedUntil: until });
        sendBcast(`⛔ CIRCUIT BREAKER! Trading and price movement halted for ${card.effect.duration} seconds.`);
        setTimeout(() => {
          setFrozenUntil(null);
          setHaltedUntil(null);
          pushGMState({ frozenUntil:null, haltedUntil:null });
          sendBcast("🔓 Circuit breaker lifted — the market is moving again.");
        }, card.effect.duration*1000);
      } else if (card.effect.type === "rotation") {
        const shuffled = [...SECTORS].sort(() => Math.random() - 0.5);
        const winner = shuffled[0];
        const loser = shuffled.find(sec => sec.id !== winner?.id);
        if (!winner || !loser) return;
        const cur = pricesRef.current;
        const next = { ...cur };
        const rotationEvents = [];
        winner.stocks.forEach(st => {
          next[st.ticker] = Math.max(0.5, cur[st.ticker] * (1 + card.effect.pct / 100));
          rotationEvents.push({
            ticker: st.ticker,
            sectorId: winner.id,
            headline: `${winner.label} attracts fresh capital rotation`,
            detail: `${winner.label} stocks catch a strong macro tailwind.`,
            impact: card.effect.pct
          });
        });
        loser.stocks.forEach(st => {
          next[st.ticker] = Math.max(0.5, cur[st.ticker] * (1 - card.effect.pct / 100));
          rotationEvents.push({
            ticker: st.ticker,
            sectorId: loser.id,
            headline: `${loser.label} sees money rotate out`,
            detail: `${loser.label} loses favor as capital rotates elsewhere.`,
            impact: -card.effect.pct
          });
        });
        setPrices(next);
        setHistory(prevH => {
          const newH = { ...prevH };
          rotationEvents.forEach(evt => {
            if (newH[evt.ticker]) newH[evt.ticker] = [...newH[evt.ticker].slice(1), next[evt.ticker]];
          });
          pushPrices(next, newH); return newH;
        });
        updateNewsFeed(prev => [
          ...rotationEvents.slice(0, 6).map(evt => ({
            ticker: evt.ticker,
            sectorId: evt.sectorId,
            headline: evt.headline,
            detail: evt.detail,
            sentiment: evt.impact > 0 ? "bull" : "bear",
            tag: "SECTOR ROTATION",
            time: nowShort()
          })),
          ...prev
        ]);
        sendBcast(`🔄 SECTOR ROTATION! ${winner.icon} ${winner.label} rallies while ${loser.icon} ${loser.label} sells off.`);
      } else if (card.effect.type === "political") {
        // Pick a random political event not already used this game
        const usedEvtIds = usedCardsRef.current._polEventIds || [];
        const available  = POLITICAL_EVENTS.filter(e => !usedEvtIds.includes(e.id));
        const evt        = available.length > 0
          ? available[Math.floor(Math.random() * available.length)]
          : POLITICAL_EVENTS[Math.floor(Math.random() * POLITICAL_EVENTS.length)];
        // Track used event ids on the ref
        usedCardsRef.current._polEventIds = [...usedEvtIds, evt.id];
        generatePoliticalDisruption(evt);
      }
    }
    else if(cmd==="openPrediction") {
      const question = PREDICTION_QUESTIONS.find(q => q.round === roundNum) || PREDICTION_QUESTIONS[0];
      if (!question || ["polling","revealing"].includes(predictionSessionRef.current?.phase)) return;
      const now = Date.now();
      const session = {
        id: now,
        round: roundNum,
        phase: "polling",
        startedAt: now,
        endsAt: now + PREDICTION_POLL_SECS * 1000,
        question,
        results: null
      };
      setPredictionOpen(true);
      setPredictionSession(session);
      pushPrediction(session);
      pushGMState({ predictionOpen:true, predictionRound:roundNum });
      sendBcast(`🎯 PREDICTION MARKET OPEN! ${PREDICTION_POLL_SECS}s polling buffer started for Round ${roundNum}.`);
    }
    else if(cmd==="closePrediction") {
      if (predictionSessionRef.current?.phase === "polling") finalizePredictionPolling(predictionSessionRef.current);
      else {
        setPredictionOpen(false);
        setPredictionSession({ phase:"closed" });
        pushPrediction({ phase:"closed" });
        pushGMState({ predictionOpen:false });
      }
    }
    else if(cmd==="setInitCash") { setInitCash(payload.cash);setCash(payload.cash);setHoldings({});setTransactions([]); }
  }, [finalizePredictionPolling, generatePoliticalDisruption, initCash, pushDisrupts, pushGMState, pushNews, pushPrediction, pushPrices, roundDur, roundNum, sendBcast, triggerRoundEnd, updateNewsFeed]);

  // ─── DERIVED ──────────────────────────────────────────────────────────────────
  const analytics = PortfolioAnalytics({ holdings, transactions, prices, cash, initCash });
  const totalVal  = analytics.totalVal;
  const myRank    = sharedLB.findIndex(e => e.name === currentTeam?.name) + 1;
  const selStock  = ALL_STOCKS.find(s => s.ticker === selTicker);
  const selPrice  = selTicker ? prices[selTicker] : null;
  const buyTotal  = selTicker ? selPrice * orderQty : 0;
  const selPosition = selTicker ? holdings[selTicker] : null;
  const activePredictionPhase = ["polling","revealing"].includes(predictionSession?.phase);
  const currentPredictionVote = predictionSession?.id === playerPredictionSessionId ? playerPrediction : null;
  const isFrozen  = frozenUntil && Date.now() < frozenUntil;
  const isHalted  = haltedUntil && Date.now() < haltedUntil;
  const shortCapacity = Math.max(0, totalVal - analytics.shortExposure);
  const canTrade  = gamePhase === "running" && !isFrozen && !isHalted && !activePredictionPhase;
  const canBuy    = canTrade && cash >= buyTotal && orderQty > 0 && selTicker && shortQty(selPosition) === 0;
  const canSell   = canTrade && selTicker && longQty(selPosition) >= orderQty && orderQty > 0;
  const canShort  = canTrade && selTicker && orderQty > 0 && longQty(selPosition) === 0 && buyTotal <= shortCapacity;
  const canCover  = canTrade && selTicker && shortQty(selPosition) >= orderQty && cash >= buyTotal;
  const timerMins = timeLeft != null ? Math.floor(timeLeft/60) : null;
  const timerSecs = timeLeft != null ? timeLeft % 60 : null;
  const bufMins   = bufferLeft != null ? Math.floor(bufferLeft/60) : null;
  const bufSecs   = bufferLeft != null ? bufferLeft % 60 : null;

  // Filtered stocks for market tab
  const filteredStocks = ALL_STOCKS.filter(s => {
    const inSector = activeSector === "all" || s.sectorId === activeSector;
    const inSearch = !marketSearch || s.ticker.includes(marketSearch.toUpperCase()) || s.name.toLowerCase().includes(marketSearch.toLowerCase());
    return inSector && inSearch;
  });

  function execBuy(ticker, qty) {
    const stk   = ALL_STOCKS.find(s => s.ticker === ticker);
    const p     = prices[ticker];
    const total = p * qty;
    const ex = holdings[ticker];
    if (!stk || !p || cash < total || qty <= 0 || shortQty(ex) > 0) return;
    const existingQty = longQty(ex);
    const nextQty = existingQty + qty;
    const nextAvgCost = existingQty > 0
      ? ((ex.avgCost * existingQty) + total) / nextQty
      : p;
    setCash(c => c - total);
    setHoldings(h => ({ ...h, [ticker]:{ qty:nextQty, avgCost:nextAvgCost } }));
    const tx = { id:Date.now(), type:"BUY", ticker, sectorId:stk.sectorId,
      qty, price:p, avgCostAtBuy:p, total,
      time:nowFull(), date:new Date().toLocaleDateString() };
    setTransactions(prev => [tx, ...prev]);
    pushTrade({ team:currentTeam?.name, teamColor:currentTeam?.color, action:"BUY",
      ticker, qty, price:p, time:nowShort() });
  }

  function execSell(ticker, qty) {
    const stk = ALL_STOCKS.find(s => s.ticker === ticker);
    const p   = prices[ticker];
    const pos = holdings[ticker];
    const heldQty = longQty(pos);
    if (!stk || !p || !pos || heldQty < qty || qty <= 0) return;
    const proceeds = p * qty;
    const gain     = (p - pos.avgCost) * qty;
    const newQty   = heldQty - qty;
    setCash(c => c + proceeds);
    setHoldings(h => {
      const n = { ...h };
      if (newQty <= 0) delete n[ticker];
      else n[ticker] = { qty:newQty, avgCost:pos.avgCost };
      return n;
    });
    const tx = { id:Date.now(), type:"SELL", ticker, sectorId:stk.sectorId,
      qty, price:p, avgCostAtSell:pos.avgCost, proceeds,
      gain, gainPct:((p-pos.avgCost)/pos.avgCost)*100,
      time:nowFull(), date:new Date().toLocaleDateString() };
    setTransactions(prev => [tx, ...prev]);
    pushTrade({ team:currentTeam?.name, teamColor:currentTeam?.color, action:"SELL",
      ticker, qty, price:p, time:nowShort() });
  }

  function execShort(ticker, qty) {
    const stk = ALL_STOCKS.find(s => s.ticker === ticker);
    const p   = prices[ticker];
    const pos = holdings[ticker];
    const orderValue = p * qty;
    const existingShortQty = shortQty(pos);
    if (!stk || !p || qty <= 0 || longQty(pos) > 0 || orderValue > Math.max(0, totalVal - analytics.shortExposure)) return;
    const nextAbsQty = existingShortQty + qty;
    const nextAvgCost = existingShortQty > 0
      ? ((pos.avgCost * existingShortQty) + orderValue) / nextAbsQty
      : p;
    setCash(c => c + orderValue);
    setHoldings(h => ({ ...h, [ticker]:{ qty:-nextAbsQty, avgCost:nextAvgCost } }));
    const tx = { id:Date.now(), type:"SHORT", ticker, sectorId:stk.sectorId,
      qty, price:p, avgCostAtShort:p, proceeds:orderValue,
      time:nowFull(), date:new Date().toLocaleDateString() };
    setTransactions(prev => [tx, ...prev]);
    pushTrade({ team:currentTeam?.name, teamColor:currentTeam?.color, action:"SHORT",
      ticker, qty, price:p, time:nowShort() });
  }

  function execCover(ticker, qty) {
    const stk = ALL_STOCKS.find(s => s.ticker === ticker);
    const p   = prices[ticker];
    const pos = holdings[ticker];
    const coverCost = p * qty;
    const currentShortQty = shortQty(pos);
    if (!stk || !p || !pos || currentShortQty < qty || qty <= 0 || cash < coverCost) return;
    const gain = (pos.avgCost - p) * qty;
    const remainingShort = currentShortQty - qty;
    setCash(c => c - coverCost);
    setHoldings(h => {
      const n = { ...h };
      if (remainingShort <= 0) delete n[ticker];
      else n[ticker] = { qty:-remainingShort, avgCost:pos.avgCost };
      return n;
    });
    const tx = { id:Date.now(), type:"COVER", ticker, sectorId:stk.sectorId,
      qty, price:p, avgCostAtCover:pos.avgCost, cost:coverCost,
      gain, gainPct:((pos.avgCost-p)/pos.avgCost)*100,
      time:nowFull(), date:new Date().toLocaleDateString() };
    setTransactions(prev => [tx, ...prev]);
    pushTrade({ team:currentTeam?.name, teamColor:currentTeam?.color, action:"COVER",
      ticker, qty, price:p, time:nowShort() });
  }

  function doBuy()  { execBuy(selTicker, orderQty); }
  function doSell() { execSell(selTicker, orderQty); }
  function doShort(){ execShort(selTicker, orderQty); }
  function doCover(){ execCover(selTicker, orderQty); }

  // ─── GM RULEBOOK MODAL ────────────────────────────────────────────────────────
  if (showRulebook) return (
    <div style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(2,8,23,0.97)",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"'JetBrains Mono','Courier New',monospace", padding:20 }}>
      <div style={{ width:"min(900px,98vw)", maxHeight:"96vh", background:"#0a0f1e",
        border:"1px solid #a78bfa", borderRadius:16, overflow:"hidden",
        display:"flex", flexDirection:"column" }}>
        {/* Header */}
        <div style={{ padding:"16px 24px", borderBottom:"1px solid #1e293b",
          background:"linear-gradient(135deg,#1a0a2e,#0a0f1e)",
          display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:24 }}>📖</span>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:18, color:"#a78bfa" }}>
              BULL PIT — GM RULEBOOK
            </div>
            <div style={{ fontSize:10, color:"#475569" }}>Complete Game Master Reference — 30 Teams</div>
          </div>
          <button onClick={() => setShowRulebook(false)}
            style={{ background:"none", border:"1px solid #334155", color:"#94a3b8",
              padding:"6px 14px", borderRadius:6, cursor:"pointer", fontFamily:"inherit", fontSize:11 }}>
            CLOSE
          </button>
        </div>
        <div style={{ overflowY:"auto", padding:"20px 24px" }}>

          {/* Overview */}
          <div style={{ background:"#060c18", border:"1px solid #1e293b", borderRadius:10,
            padding:"14px 18px", marginBottom:16 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:13,
              color:"#00f5c4", marginBottom:10 }}>COMPETITION OVERVIEW</div>
            {[
              ["Teams",        "Up to 60 teams, each with $100,000 starting capital"],
              ["Rounds",       "7 rounds, each with a unique identity and special rules"],
              ["Duration",     "~90 minutes total (60 min play + 30 min buffers + breaks)"],
              ["Tax",          "20% profit tax applied at end of Rounds 2, 4, and 6"],
              ["Liquidation",  "Forced at Round 3 (partial reset) and Round 7 (full equal reset)"],
              ["Winner",       "Highest composite score after Round 7 — 5 scoring pillars"],
              ["Power-Ups",    "GM has 5 one-time-use cards: Tsunami, Moon Shot, Circuit Breaker, Sector Rotation, Political Shock"],
            ].map(([k,v]) => (
              <div key={k} style={{ display:"flex", gap:12, marginBottom:6, fontSize:11 }}>
                <div style={{ width:110, color:"#fbbf24", fontWeight:700, flexShrink:0 }}>{k}</div>
                <div style={{ color:"#94a3b8" }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Round-by-round guide */}
          <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:13,
            color:"#f1f5f9", marginBottom:10 }}>ROUND-BY-ROUND GM GUIDE</div>
          {ROUND_RULES.map((rules, i) => (
            <div key={i} style={{ background:"#060c18",
              border:`1px solid ${rules.color}44`, borderRadius:10,
              padding:"14px 18px", marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <span style={{ fontSize:20 }}>{rules.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800,
                    fontSize:13, color:rules.color }}>
                    Round {rules.round}: {rules.name}
                  </div>
                  <div style={{ display:"flex", gap:6, marginTop:4, flexWrap:"wrap" }}>
                    <span style={{ fontSize:8, padding:"1px 6px", borderRadius:3,
                      background:`${rules.color}20`, color:rules.color, fontWeight:700 }}>
                      {rules.volMult}× VOLATILITY
                    </span>
                    {rules.sentLock && <span style={{ fontSize:8, padding:"1px 6px", borderRadius:3,
                      background:"#fbbf2420", color:"#fbbf24", fontWeight:700 }}>
                      SENTIMENT LOCKED: {rules.sentLock.toUpperCase()}
                    </span>}
                    {rules.tax && <span style={{ fontSize:8, padding:"1px 6px", borderRadius:3,
                      background:"#ef444420", color:"#ef4444", fontWeight:700 }}>20% TAX</span>}
                    {rules.liquidate && <span style={{ fontSize:8, padding:"1px 6px", borderRadius:3,
                      background:"#ef444420", color:"#ef4444", fontWeight:700 }}>FORCED LIQUIDATION</span>}
                    {rules.leaderHidden && <span style={{ fontSize:8, padding:"1px 6px", borderRadius:3,
                      background:"#a78bfa20", color:"#a78bfa", fontWeight:700 }}>LEADERBOARD HIDDEN</span>}
                  </div>
                </div>
              </div>
              <div style={{ fontSize:11, color:"#64748b", marginBottom:8 }}>{rules.briefing}</div>
              <div style={{ background:"#0a0f1e", border:"1px solid #1e293b",
                borderRadius:6, padding:"10px 14px" }}>
                <div style={{ fontSize:9, color:"#fbbf24", fontWeight:700, marginBottom:6 }}>
                  GM ACTION CHECKLIST
                </div>
                <div style={{ fontSize:10, color:"#94a3b8", lineHeight:1.8 }}>{rules.gmNote}</div>
              </div>
              {/* Disruption plan */}
              <div style={{ marginTop:8, fontSize:9, color:"#334155" }}>
                DISRUPTION PLAN:{" "}
                {Object.entries(rules.disruptionPlan).map(([timing, plan]) =>
                  plan.map(p => `${timing}: ${p.count||1}× ${p.type}${p.eventHint?` (${p.eventHint})`:""}`)
                ).flat().join(" | ")}
              </div>
            </div>
          ))}

          {/* Power-up reference */}
          <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:13,
            color:"#f1f5f9", marginBottom:10, marginTop:4 }}>POWER-UP CARD REFERENCE</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
            {POWERUP_CARDS.map(card => (
              <div key={card.id} style={{ background:"#060c18",
                border:`1px solid ${card.color}44`, borderRadius:8, padding:"12px 14px" }}>
                <div style={{ fontSize:20, marginBottom:4 }}>{card.icon}</div>
                <div style={{ fontSize:12, color:card.color, fontWeight:800, marginBottom:4 }}>{card.name}</div>
                <div style={{ fontSize:11, color:"#64748b", lineHeight:1.6 }}>{card.desc}</div>
                <div style={{ fontSize:9, color:"#334155", marginTop:6 }}>
                  One-time use. Click in GM Control tab during a live round.
                </div>
              </div>
            ))}
          </div>

          {/* Scoring system */}
          <div style={{ background:"#060c18", border:"1px solid #1e293b",
            borderRadius:10, padding:"14px 18px", marginBottom:16 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:13,
              color:"#fbbf24", marginBottom:4 }}>9-INDICATOR SCORING SYSTEM (100 pts total)</div>
            <div style={{ fontSize:9, color:"#475569", marginBottom:12 }}>
              Three tiers. Every team sees their full scorecard with formulas. Tiebreaker chain resolves dead heats.
            </div>

            {/* Tier 1 */}
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:"#38bdf8", fontWeight:800, marginBottom:6 }}>
                TIER 1 — PERFORMANCE (50 pts)
              </div>
              {[
                ["15pts", "Absolute Return",       "(Portfolio − Start) ÷ Start × 100", "Raw P&L. The baseline. Everyone understands it."],
                ["15pts", "Risk-Adj Return (Sharpe)","Return ÷ Max Drawdown",              "Penalises volatile gains. Rewards consistent outperformance."],
                ["12pts", "Alpha vs Market",        "Your Return − BALL Index Return",    "Did you beat the market or just ride the wave?"],
                ["8pts",  "Round Consistency",      "Geometric mean of per-round returns","Penalises one-lucky-round players. Rewards sustained skill."],
              ].map(([pts,name,formula,why]) => (
                <div key={name} style={{ display:"flex", gap:10, marginBottom:6, fontSize:10 }}>
                  <div style={{ width:34, color:"#38bdf8", fontWeight:800, flexShrink:0 }}>{pts}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ color:"#f1f5f9", fontWeight:700 }}>{name}</div>
                    <div style={{ color:"#475569", fontSize:9 }}>Formula: {formula}</div>
                    <div style={{ color:"#334155", fontSize:9 }}>{why}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Tier 2 */}
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:"#a78bfa", fontWeight:800, marginBottom:6 }}>
                TIER 2 — RISK MANAGEMENT (30 pts)
              </div>
              {[
                ["10pts", "Max Drawdown Control", "Inversely scaled — 0% DD = 10pts, 50%+ DD = 0pts", "Measures capital preservation discipline."],
                ["10pts", "Calmar Ratio",         "Return ÷ Max Drawdown (primary tiebreaker)",        "Better than Sharpe for fat-tail events. Primary tiebreaker."],
                ["10pts", "Portfolio Beta",        "cov(asset, BALL) / var(BALL)",                     "Low absolute beta = less dependence on the market benchmark."],
              ].map(([pts,name,formula,why]) => (
                <div key={name} style={{ display:"flex", gap:10, marginBottom:6, fontSize:10 }}>
                  <div style={{ width:34, color:"#a78bfa", fontWeight:800, flexShrink:0 }}>{pts}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ color:"#f1f5f9", fontWeight:700 }}>{name}</div>
                    <div style={{ color:"#475569", fontSize:9 }}>Formula: {formula}</div>
                    <div style={{ color:"#334155", fontSize:9 }}>{why}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Tier 3 */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:"#00f5c4", fontWeight:800, marginBottom:6 }}>
                TIER 3 — TRADING QUALITY (20 pts)
              </div>
              {[
                ["8pts", "Win Rate",              "Profitable closes ÷ Total closes × 100", "% of closed long and short trades that made money."],
                ["7pts", "Sector Diversification","Unique sectors held (9 max)",              "Rewards sustained diversification across industries."],
                ["5pts", "Prediction Accuracy",   "Correct economic predictions ÷ Total",    "Tests if teams understood the macro events — not just got lucky."],
              ].map(([pts,name,formula,why]) => (
                <div key={name} style={{ display:"flex", gap:10, marginBottom:6, fontSize:10 }}>
                  <div style={{ width:34, color:"#00f5c4", fontWeight:800, flexShrink:0 }}>{pts}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ color:"#f1f5f9", fontWeight:700 }}>{name}</div>
                    <div style={{ color:"#475569", fontSize:9 }}>Formula: {formula}</div>
                    <div style={{ color:"#334155", fontSize:9 }}>{why}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Tiebreaker chain */}
            <div style={{ background:"#0a0f1e", border:"1px solid #fbbf2430",
              borderRadius:6, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"#fbbf24", fontWeight:800, marginBottom:6 }}>
                TIEBREAKER CHAIN (sequential — applied only when scores are equal)
              </div>
              {[
                ["TB1", "Calmar Ratio",     "Higher Calmar wins — better risk-adjusted efficiency"],
                ["TB2", "Max Drawdown",     "Lower drawdown wins — more capital-preserving"],
                ["TB3", "Alpha vs Market",  "Higher alpha wins — beat the benchmark more"],
                ["TB4", "Sectors Traded",   "More unique sectors wins — more diversified"],
                ["TB5", "Last Trade Time",  "Earlier timestamp wins — more decisive"],
              ].map(([tb,name,desc]) => (
                <div key={tb} style={{ display:"flex", gap:8, marginBottom:4, fontSize:9 }}>
                  <span style={{ color:"#fbbf24", fontWeight:800, width:28, flexShrink:0 }}>{tb}</span>
                  <span style={{ color:"#f1f5f9", width:110, flexShrink:0 }}>{name}</span>
                  <span style={{ color:"#475569" }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tax + liquidation rules */}
          <div style={{ background:"#060c18", border:"1px solid #ef444444",
            borderRadius:10, padding:"14px 18px", marginBottom:16 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:13,
              color:"#ef4444", marginBottom:10 }}>TAX & LIQUIDATION RULES</div>
            {[
              ["20% Tax", "Rounds 2, 4, 6", "20% of profit above starting $100K is deducted at round end"],
              ["Tax on profit only", "Not on capital", "If a team lost money, no tax is applied"],
              ["Liquidation R3", "Forced clear", "All positions sold at market price — proceeds kept as cash"],
              ["Liquidation R7", "Full equal reset", "All teams reset to exactly $100,000 — true skill final"],
              ["Initial capital", "Never destroyed", "Teams always keep at least their starting $100K as floor"],
            ].map(([k,w,v]) => (
              <div key={k} style={{ marginBottom:8, fontSize:11 }}>
                <span style={{ color:"#ef4444", fontWeight:700 }}>{k}</span>
                <span style={{ color:"#fbbf24", marginLeft:8 }}>({w})</span>
                <div style={{ color:"#64748b", marginTop:2 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* 30-team tips */}
          <div style={{ background:"#060c18", border:"1px solid #38bdf844",
            borderRadius:10, padding:"14px 18px" }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:13,
              color:"#38bdf8", marginBottom:10 }}>30-TEAM OPERATION TIPS</div>
            {[
              "Assign 1 co-facilitator to monitor leaderboard and announce top 3 every 2 minutes",
              "Disable bot AI trades before the event to reduce API load (GM Panel → Market Tab)",
              "Use the Prediction Market at the start of each buffer to keep teams engaged during breaks",
              "Fire disruptions every 3-4 minutes to maintain excitement — don't let the market go flat",
              "Announce the round identity and special rules on a speaker before each round starts",
              "Keep the Central Display on a projector visible to all teams at all times",
              "Use the Circuit Breaker card when you need a clean halt and regroup moment",
              "In Round 5 (Dark Pool), do NOT show the leaderboard on the projector either",
            ].map((tip, i) => (
              <div key={i} style={{ display:"flex", gap:8, marginBottom:8, fontSize:11 }}>
                <span style={{ color:"#38bdf8", flexShrink:0 }}>{i+1}.</span>
                <span style={{ color:"#64748b" }}>{tip}</span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // LOGIN
  // ════════════════════════════════════════════════════════════════════════════
  if (screen === "login") return (
    <div style={{ minHeight:"100vh", background:"#020817", display:"flex", alignItems:"center",
      justifyContent:"center", fontFamily:"'JetBrains Mono','Courier New',monospace" }}>
      <style>{CSS}</style>
      <div style={{ width:440, padding:44, animation:"fadeup 0.5s ease" }}>
        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ fontSize:9, letterSpacing:"0.4em", color:"#334155", marginBottom:12 }}>
            7 ROUNDS · 58 STOCKS · 9 SECTORS
          </div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:68, lineHeight:1,
            background:"linear-gradient(135deg,#00f5c4,#38bdf8)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", marginBottom:6 }}>
            BULL PIT
          </div>
          <div style={{ fontSize:11, color:"#475569" }}>Where fortunes are forged in seconds</div>
          <div style={{ display:"flex", justifyContent:"center", gap:6, marginTop:12, flexWrap:"wrap" }}>
            {SECTORS.map(s => (
              <span key={s.id} style={{ fontSize:9, padding:"2px 7px", borderRadius:4,
                background:`${s.color}18`, border:`1px solid ${s.color}44`, color:s.color }}>
                {s.icon} {s.label}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display:"flex", background:"#0f172a", borderRadius:10, padding:4, marginBottom:24 }}>
          {["player","gm"].map(t => (
            <button key={t} onClick={() => setLoginTab(t)} style={{
              flex:1, padding:"10px", background:loginTab===t?"#1e293b":"none",
              border:"none", borderRadius:7, color:loginTab===t?"#f1f5f9":"#475569",
              cursor:"pointer", fontFamily:"inherit", fontSize:11,
              fontWeight:loginTab===t?700:400, letterSpacing:"0.08em", textTransform:"uppercase"
            }}>{t==="gm"?"⚡ Game Master":"👤 Team Login"}</button>
          ))}
        </div>

        {loginTab === "player" ? (
          <div style={{ animation:"fadein 0.3s ease" }}>
            <div style={{ fontSize:10, color:"#475569", marginBottom:6 }}>SELECT YOUR TEAM</div>
            <div style={{ position:"relative", marginBottom:12 }}>
              {nameInput && (() => {
                const t = teams.find(x => x.name === nameInput);
                return t ? (
                  <div style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)",
                    width:10, height:10, borderRadius:"50%", background:t.color,
                    pointerEvents:"none", zIndex:1 }}/>
                ) : null;
              })()}
              <select value={nameInput} onChange={e => { setNameInput(e.target.value); setLoginErr(""); }}
                style={{ width:"100%", padding:`12px 14px 12px ${nameInput ? "32px" : "14px"}`,
                  background:"#0f172a",
                  border:`1px solid ${nameInput ? (teams.find(x=>x.name===nameInput)?.color || "#1e293b") : "#1e293b"}`,
                  color: nameInput ? (teams.find(x=>x.name===nameInput)?.color || "#f1f5f9") : "#475569",
                  borderRadius:8, fontSize:13, fontFamily:"inherit",
                  cursor:"pointer", appearance:"none", WebkitAppearance:"none", outline:"none" }}>
                <option value="" disabled style={{ color:"#475569", background:"#0f172a" }}>
                  Choose your team...
                </option>
                {teams.map(t => (
                  <option key={t.id} value={t.name}
                    style={{ color:t.color, background:"#0f172a", fontWeight:700 }}>
                    {t.name}
                  </option>
                ))}
              </select>
              <div style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)",
                pointerEvents:"none", color:"#475569", fontSize:12 }}>v</div>
            </div>
            <div style={{ fontSize:10, color:"#475569", marginBottom:6 }}>TEAM PASSWORD</div>
            <input type="password" value={passInput}
              onChange={e => { setPassInput(e.target.value); setLoginErr(""); }}
              placeholder="Enter password…"
              style={{ width:"100%", padding:"12px 14px", background:"#0f172a",
                border:`1px solid ${loginErr?"#ef4444":"#1e293b"}`,
                color:"#f1f5f9", borderRadius:8, fontSize:13, fontFamily:"inherit", marginBottom:8 }} />
            {loginErr && <div style={{ color:"#ef4444", fontSize:11, marginBottom:8 }}>{loginErr}</div>}
            <button onClick={() => {
              const team = teams.find(t => t.name===nameInput && t.password===passInput);
              if (team) { setCurrentTeam(team); setScreen("player"); }
              else setLoginErr("Invalid team or password.");
            }} style={{ width:"100%", padding:"13px",
              background:"linear-gradient(135deg,#00f5c4,#38bdf8)", border:"none",
              borderRadius:9, color:"#020817", fontSize:13, fontWeight:800,
              cursor:"pointer", fontFamily:"inherit", letterSpacing:"0.08em" }}>
              ENTER MARKET →
            </button>
          </div>
        ) : loginTab === "gm" ? (
          <div style={{ animation:"fadein 0.3s ease" }}>
            <div style={{ fontSize:10, color:"#475569", marginBottom:8 }}>GM ACCESS</div>
            <input type="password" value={gmPass}
              onChange={e => { setGmPass(e.target.value); setLoginErr(""); }}
              placeholder="GM password…"
              style={{ width:"100%", padding:"12px 14px", background:"#0f172a",
                border:`1px solid ${loginErr?"#ef4444":"#1e293b"}`,
                color:"#f1f5f9", borderRadius:8, fontSize:13, fontFamily:"inherit", marginBottom:8 }} />
            {loginErr && <div style={{ color:"#ef4444", fontSize:11, marginBottom:8 }}>{loginErr}</div>}
            <button onClick={() => {
              if (gmPass === GM_PASSWORD) setScreen("gm");
              else setLoginErr("Incorrect GM password.");
            }} style={{ width:"100%", padding:"13px",
              background:"linear-gradient(135deg,#7c2d12,#dc2626)", border:"none",
              borderRadius:9, color:"#fff", fontSize:13, fontWeight:800,
              cursor:"pointer", fontFamily:"inherit", letterSpacing:"0.08em" }}>
              ⚡ ENTER GM PANEL →
            </button>
          </div>
        ) : (
          <div style={{ animation:"fadein 0.3s ease" }}>
            <div style={{ background:"#0a0f1e", border:"1px solid #1e293b",
              borderRadius:10, padding:"16px 18px", marginBottom:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <span style={{ fontSize:18 }}>📺</span>
                <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:800,
                  fontSize:14, color:"#38bdf8" }}>CENTRAL DISPLAY</span>
              </div>
              <div style={{ fontSize:11, color:"#475569", lineHeight:1.7, marginBottom:12 }}>
                The Central Display is a separate screen for projectors or main screens.
                Open it in a new tab and enter the password below to launch.
              </div>
              <div style={{ background:"#020817", borderRadius:8, padding:"12px 14px",
                border:"1px solid #38bdf830" }}>
                <div style={{ fontSize:9, color:"#334155", letterSpacing:"0.15em", marginBottom:6 }}>
                  DISPLAY PASSWORD
                </div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28,
                  color:"#38bdf8", letterSpacing:"0.1em" }}>
                  BULLPIT2025
                </div>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:12 }}>
              {[
                { icon:"🏆", label:"Live Leaderboard", desc:"2-col, auto-updating" },
                { icon:"📡", label:"Trade Stream",     desc:"Real-time buy/sell feed" },
                { icon:"🚨", label:"Disruption News",  desc:"AI-generated events" },
                { icon:"⏳", label:"Round Timer",      desc:"Countdown + phase status" },
              ].map(f => (
                <div key={f.label} style={{ background:"#0a0f1e", border:"1px solid #1e293b",
                  borderRadius:7, padding:"8px 10px" }}>
                  <div style={{ fontSize:12, marginBottom:3 }}>
                    {f.icon}{" "}<span style={{ fontSize:10, color:"#64748b", fontWeight:700 }}>{f.label}</span>
                  </div>
                  <div style={{ fontSize:9, color:"#334155" }}>{f.desc}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize:10, color:"#334155", textAlign:"center",
              padding:"8px", background:"#0a0f1e", borderRadius:6, border:"1px solid #1e293b" }}>
              Open central-display.jsx in a separate browser tab
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ─── GM BUTTON STYLE HELPER ───────────────────────────────────────────────
  const gmBtn = (bg, col, enabled = true) => ({
    padding: "9px 10px", background: enabled ? bg : "#0f172a",
    border: `1px solid ${enabled ? col + "55" : "#1e293b"}`,
    color: enabled ? col : "#334155", borderRadius: 6,
    cursor: enabled ? "pointer" : "not-allowed", fontFamily: "inherit",
    fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
    opacity: enabled ? 1 : 0.45, transition: "opacity 0.2s",
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GM SCREEN
  // ════════════════════════════════════════════════════════════════════════════
  if (screen === "gm") return (
    <div style={{ minHeight:"100vh", background:"#020817",
      fontFamily:"'JetBrains Mono','Courier New',monospace", color:"#f1f5f9",
      display:"flex", flexDirection:"column" }}>
      <style>{CSS}</style>
      {showCeremony && <WinnerCeremony ranked={winnerRanked} teams={teams} />}
      {showEmergency && <EmergencyModal events={disruptions} bufferLeft={bufferLeft}
        onApply={applyDisruption} onClose={startNextRound} isFirstRound={!gameStartedRef.current && roundNum === 1} />}
      {predictionSession && predictionSession.phase !== "closed" && (
        <PredictionMarketOverlay
          session={predictionSession}
          playerPrediction={null}
          onVote={() => {}}
          isGM
          teamName="GM"
        />
      )}

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 20px",
        borderBottom:"1px solid #1e293b", background:"linear-gradient(90deg,#0a0518,#020817)" }}>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28,
          background:"linear-gradient(135deg,#f59e0b,#ef4444)",
          WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>BULL PIT</div>
        <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.12em" }}>GAME MASTER</div>
        <div style={{ display:"flex", gap:4 }}>
          {Array.from({length:TOTAL_ROUNDS},(_,i) => {
            const rn=i+1,done=rn<roundNum,active=rn===roundNum;
            return <div key={i} style={{ width:active?20:12,height:12,borderRadius:6,
              background:done?"#00f5c4":active?"#fbbf24":"#1e293b",
              border:active?"2px solid #fbbf24":"2px solid transparent",transition:"all 0.3s" }}/>;
          })}
        </div>
        <span style={{ fontSize:10, color:"#fbbf24", fontWeight:700 }}>
          R{roundNum}/{TOTAL_ROUNDS} · {gamePhase.toUpperCase()}
        </span>
        {timerMins!=null && gamePhase==="running" && (
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:timerMins<3?"#ef4444":"#f1f5f9" }}>
            {String(timerMins).padStart(2,"0")}:{String(timerSecs).padStart(2,"0")}
          </div>
        )}
        {bufMins!=null && gamePhase==="buffer" && (
          <div style={{ fontSize:14, fontWeight:700, color:"#38bdf8" }}>
            BUFFER {String(bufMins).padStart(2,"0")}:{String(bufSecs).padStart(2,"0")}
          </div>
        )}
        <div style={{ marginLeft:"auto" }}>
          <button onClick={() => setScreen("login")} style={{ padding:"6px 14px", background:"#1e293b",
            border:"1px solid #334155", color:"#94a3b8", borderRadius:6,
            cursor:"pointer", fontFamily:"inherit", fontSize:11 }}>← EXIT</button>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"290px 1fr", flex:1, overflow:"hidden" }}>
        {/* Left Panel */}
        <div style={{ borderRight:"1px solid #1e293b", display:"flex", flexDirection:"column", overflowY:"auto" }}>
          <div style={{ display:"flex", borderBottom:"1px solid #1e293b" }}>
            {["control","market","teams","broadcast"].map(t => (
              <button key={t} onClick={() => setGmTab(t)} style={{
                flex:1, padding:"8px 2px", background:"none", border:"none",
                color:gmTab===t?"#f59e0b":"#475569", cursor:"pointer",
                borderBottom:gmTab===t?"2px solid #f59e0b":"2px solid transparent",
                fontSize:9, letterSpacing:"0.08em", textTransform:"uppercase",
                fontFamily:"inherit", fontWeight:gmTab===t?700:400 }}>{t}</button>
            ))}
          </div>
          <div style={{ padding:14, flex:1 }}>
            {gmTab==="control" && (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

                {/* ── ROUND IDENTITY BANNER ── */}
                {gamePhase === "running" && (() => {
                  const rules = ROUND_RULES[roundNum-1] || ROUND_RULES[0];
                  return (
                    <div style={{ background:`linear-gradient(135deg,${rules.color}22,${rules.color}08)`,
                      border:`1px solid ${rules.color}55`, borderRadius:10, padding:"10px 14px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                        <span style={{ fontSize:20 }}>{rules.icon}</span>
                        <div>
                          <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800,
                            fontSize:14, color:rules.color }}>{rules.name}</div>
                          <div style={{ fontSize:9, color:"#64748b" }}>Round {roundNum} of {TOTAL_ROUNDS}</div>
                        </div>
                        <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
                          {rules.tax && <span style={{ fontSize:9, padding:"2px 6px", borderRadius:4,
                            background:"#fbbf2422", border:"1px solid #fbbf2440", color:"#fbbf24", fontWeight:700 }}>TAX ROUND</span>}
                          {rules.liquidate && <span style={{ fontSize:9, padding:"2px 6px", borderRadius:4,
                            background:"#ef444422", border:"1px solid #ef444440", color:"#ef4444", fontWeight:700 }}>LIQUIDATION</span>}
                          {rules.leaderHidden && <span style={{ fontSize:9, padding:"2px 6px", borderRadius:4,
                            background:"#a78bfa22", border:"1px solid #a78bfa40", color:"#a78bfa", fontWeight:700 }}>HIDDEN LB</span>}
                          <span style={{ fontSize:9, padding:"2px 6px", borderRadius:4,
                            background:"#38bdf822", border:"1px solid #38bdf840", color:"#38bdf8", fontWeight:700 }}>
                            {rules.volMult}× VOL
                          </span>
                        </div>
                      </div>
                      <div style={{ fontSize:10, color:"#64748b", lineHeight:1.5 }}>{rules.briefing}</div>
                    </div>
                  );
                })()}

                {/* ── POWER-UP CARDS ── */}
                <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:8, padding:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em" }}>POWER-UP CARDS</div>
                    <div style={{ fontSize:8, color:"#334155" }}>{5 - usedCards.size} remaining</div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
                    {POWERUP_CARDS.map(card => {
                      const used = usedCards.has(card.id);
                      const isPol = card.id === "polshock";
                      return (
                        <button key={card.id} onClick={() => gmCmd("powerup",{id:card.id})}
                          disabled={used || gamePhase !== "running"}
                          style={{ padding:"8px 6px", background: used?"#0a0f1e":`${card.color}15`,
                            border:`1px solid ${used?"#1e293b":card.color+"55"}`,
                            borderRadius:7, cursor:used?"not-allowed":"pointer",
                            fontFamily:"inherit", opacity:used?0.35:1, textAlign:"left",
                            gridColumn: isPol ? "1/-1" : undefined,
                            display: isPol ? "flex" : undefined,
                            alignItems: isPol ? "center" : undefined,
                            gap: isPol ? 10 : undefined,
                          }}>
                          <div style={{ fontSize:14, marginBottom: isPol?0:2 }}>{card.icon}</div>
                          <div style={{ flex: isPol?1:undefined }}>
                            <div style={{ fontSize:9, color:used?"#334155":card.color, fontWeight:700 }}>{card.name}</div>
                            <div style={{ fontSize:8, color:"#475569", lineHeight:1.4, marginTop:2 }}>{card.desc}</div>
                          </div>
                          {used && <div style={{ fontSize:8, color:"#ef4444", marginTop: isPol?0:2 }}>USED</div>}
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={() => gmCmd("openPrediction")} disabled={predictionOpen || gamePhase!=="running"}
                    style={{ width:"100%", marginTop:6, padding:"7px", fontSize:9, fontWeight:700,
                      background: predictionOpen?"#0f172a":"rgba(0,245,196,0.1)",
                      border:`1px solid ${predictionOpen?"#1e293b":"#00f5c4"}`,
                      color:predictionOpen?"#334155":"#00f5c4", borderRadius:6,
                      cursor:predictionOpen?"not-allowed":"pointer", fontFamily:"inherit" }}>
                    {predictionOpen ? "🎯 Prediction Buffer LIVE" : `🎯 Start ${PREDICTION_POLL_SECS}s Prediction Buffer`}
                  </button>
                </div>

                {/* ── RULEBOOK BUTTON ── */}
                <button onClick={() => setShowRulebook(true)}
                  style={{ width:"100%", padding:"8px", background:"rgba(168,139,250,0.1)",
                    border:"1px solid #a78bfa44", borderRadius:8, color:"#a78bfa",
                    cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:700 }}>
                  📖 GM RULEBOOK
                </button>

                {/* Competition timeline summary */}
                <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:8, padding:10 }}>
                  <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em", marginBottom:8 }}>
                    COMPETITION SCHEDULE
                  </div>
                  {roundDurations.map((dur, i) => {
                    const rn = i + 1;
                    const done   = rn < roundNum;
                    const active = rn === roundNum && gamePhase === "running";
                    const mins   = Math.floor(dur / 60);
                    const label  = ROUND_LABELS[i];
                    return (
                      <div key={i} style={{
                        display:"flex", alignItems:"center", gap:6,
                        padding:"4px 0",
                        borderBottom: i < 6 ? "1px solid #0f172a" : "none",
                        opacity: done ? 0.4 : 1
                      }}>
                        {/* Pip */}
                        <div style={{
                          width:10, height:10, borderRadius:"50%", flexShrink:0,
                          background: done?"#00f5c4" : active?"#fbbf24" : "#1e293b",
                          border: active?"2px solid #fbbf24":"none",
                          boxShadow: active?"0 0 6px #fbbf24":"none"
                        }}/>
                        {/* Label */}
                        <span style={{ flex:1, fontSize:9,
                          color: active?"#fbbf24" : done?"#334155" : "#64748b" }}>
                          {label}
                        </span>
                        {/* Editable duration */}
                        <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                          <input
                            type="number" min={1} max={30} value={mins}
                            onChange={e => {
                              const v = Math.max(1, Math.min(30, +e.target.value || 1));
                              setRoundDurations(prev => {
                                const next = [...prev];
                                next[i] = v * 60;
                                return next;
                              });
                            }}
                            style={{
                              width:34, padding:"2px 4px", textAlign:"center",
                              background:"#020817", border:`1px solid ${active?"#fbbf24":"#1e293b"}`,
                              color: active?"#fbbf24":"#f1f5f9",
                              borderRadius:4, fontFamily:"inherit", fontSize:11,
                              opacity: done ? 0.4 : 1
                            }}
                          />
                          <span style={{ fontSize:9, color:"#334155" }}>m</span>
                        </div>
                        {done && <span style={{ fontSize:9, color:"#00f5c4" }}>✓</span>}
                      </div>
                    );
                  })}
                  {/* Total + buffer summary */}
                    <div style={{ marginTop:8, paddingTop:8, borderTop:"1px solid #1e293b",
                    fontSize:9, color:"#334155" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                      <span>Play time</span>
                      <span style={{ color:"#64748b" }}>
                        {Math.floor(roundDurations.reduce((a,b)=>a+b,0)/60)}m
                      </span>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                      <span>Buffer between rounds (×6)</span>
                      <span style={{ color:"#64748b" }}>{Math.round(BUFFER_SECS/60*6)}m</span>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                      <span>Political shock buffer</span>
                      <span style={{ color:"#a78bfa" }}>{POLITICAL_BUFFER_SECS}s</span>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontWeight:700 }}>
                      <span style={{ color:"#94a3b8" }}>Total</span>
                      <span style={{ color:"#fbbf24" }}>
                        ~{Math.ceil((roundDurations.reduce((a,b)=>a+b,0) + BUFFER_SECS*6) / 60)}m
                      </span>
                    </div>
                  </div>
                </div>

                {/* Current round info */}
                <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:8, padding:"8px 10px",
                  display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em" }}>CURRENT ROUND</div>
                    <div style={{ fontSize:13, color:"#f1f5f9", fontWeight:700, marginTop:2 }}>
                      {ROUND_LABELS[roundNum-1] || `Round ${roundNum}`}
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em" }}>DURATION</div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22,
                      color: roundNum <= 1 ? "#00f5c4" : roundNum <= 4 ? "#38bdf8" : "#f472b6" }}>
                      {Math.floor(roundDur/60)}:00
                    </div>
                  </div>
                </div>

                {/* ── POLITICAL SHOCK ── */}
                <div style={{ background:"#0f172a", border:"1px solid #7c3aed44", borderRadius:8, padding:10 }}>
                  <div style={{ fontSize:9, color:"#a78bfa", letterSpacing:"0.1em", marginBottom:8, fontWeight:700 }}>
                    🏛 POLITICAL SHOCK — MULTI-SECTOR EVENT
                  </div>
                  <select
                    value={polEventIdx}
                    onChange={e => setPolEventIdx(+e.target.value)}
                    style={{ width:"100%", padding:"8px 10px", background:"#060c18",
                      border:"1px solid #7c3aed55", color:"#e9d5ff",
                      borderRadius:6, fontFamily:"inherit", fontSize:10, marginBottom:8,
                      cursor:"pointer", outline:"none" }}>
                    {POLITICAL_EVENTS.map((ev, i) => (
                      <option key={ev.id} value={i} style={{ background:"#0f172a" }}>
                        {ev.icon} {ev.name}
                      </option>
                    ))}
                  </select>
                  {/* Sector impact preview */}
                  {/* GM-ONLY: sector impacts and economic concept — never shown to players */}
                  <div style={{ background:"#020817", borderRadius:6, padding:"8px 10px", marginBottom:8,
                    border:"1px solid #7c3aed33" }}>
                    <div style={{ fontSize:8, color:"#7c3aed", fontWeight:700, marginBottom:4 }}>
                      GM ONLY — ECONOMIC CONCEPT
                    </div>
                    <div style={{ fontSize:9, color:"#64748b", lineHeight:1.6, marginBottom:6 }}>
                      {POLITICAL_EVENTS[polEventIdx]?.concept}
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                      {Object.entries(POLITICAL_EVENTS[polEventIdx]?.sectors || {}).map(([sid, impact]) => {
                        const sec = SECTORS.find(s => s.id === sid);
                        if (!sec) return null;
                        const col = impact > 0 ? "#00f5c4" : "#ef4444";
                        return (
                          <span key={sid} style={{ fontSize:8, padding:"1px 5px", borderRadius:3,
                            fontWeight:700, background:`${col}15`, border:`1px solid ${col}40`, color:col }}>
                            {sec.icon} {impact > 0 ? "+" : ""}{impact}%
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ background:"#0a0f1e", borderRadius:6, padding:"8px 10px",
                    marginBottom:8, border:"1px solid #1e293b" }}>
                    <div style={{ fontSize:9, color:"#475569", marginBottom:4 }}>WHAT TEAMS WILL SEE</div>
                    <div style={{ fontSize:11, color:"#f1f5f9", fontWeight:700, lineHeight:1.5 }}>
                      {POLITICAL_EVENTS[polEventIdx]?.headline}
                    </div>
                    <div style={{ fontSize:10, color:"#64748b", marginTop:3, lineHeight:1.4 }}>
                      {POLITICAL_EVENTS[polEventIdx]?.subheadline}
                    </div>
                  </div>
                  <button
                    onClick={() => generatePoliticalDisruption(polEventIdx)}
                    disabled={generatingPol || !["idle","ceremony","running"].includes(gamePhase)}
                    style={{
                      width:"100%", padding:"9px 6px",
                      background: generatingPol ? "#0f172a" : "linear-gradient(135deg,#3b0764,#1e1b4b)",
                      border:`1px solid ${generatingPol ? "#1e293b" : "#7c3aed"}`,
                      color: generatingPol ? "#334155" : "#c4b5fd",
                      borderRadius:6, cursor: generatingPol ? "wait" : "pointer",
                      fontFamily:"inherit", fontSize:10, fontWeight:800, letterSpacing:"0.06em"
                    }}>
                    {generatingPol ? "🔄 GENERATING POLITICAL SHOCK…" : "🏛 FIRE POLITICAL SHOCK"}
                  </button>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                  {/* Generate Disruption — before every round */}
                  <button
                    onClick={generateDisruption}
                    disabled={generating || gamePhase !== "idle"}
                    style={{ ...gmBtn("#450a0a","#ef4444", gamePhase==="idle" && !generating),
                      gridColumn:"1/-1", fontSize:11, letterSpacing:"0.06em" }}>
                    {generating ? "🔄 GENERATING…" : `🚨 GENERATE DISRUPTION → LAUNCH R${gameStartedRef.current ? roundNum + 1 : 1}`}
                  </button>
                  {[
                    {l:"⏸ PAUSE",    c:"pause",    col:"#fbbf24",bg:"#713f12",en:gamePhase==="running"},
                    {l:"▶ RESUME",   c:"resume",   col:"#38bdf8",bg:"#0c4a6e",en:gamePhase==="paused"},
                    {l:"■ STOP",     c:"stop",     col:"#ef4444",bg:"#7f1d1d",en:!["idle","ended","predisruption"].includes(gamePhase)},
                    {l:"⏭ END ROUND",c:"forceEnd", col:"#a78bfa",bg:"#3b0764",en:gamePhase==="running"},
                    {l:"🔄 RESET",   c:"reset",    col:"#64748b",bg:"#1e293b",en:true},
                    {l:"⚡ RELAUNCH",  c:"relaunch", col:"#00f5c4",bg:"#064e3b",en:gamePhase==="predisruption"},
                  ].map(b => (
                    <button key={b.c}
                      onClick={b.c==="relaunch" ? () => { setShowBlast(true); } : ()=>gmCmd(b.c)}
                      disabled={!b.en} style={gmBtn(b.bg,b.col,b.en)}>{b.l}</button>
                  ))}
                </div>


                <div style={{ borderTop:"1px solid #1e293b", paddingTop:10 }}>
                  <div style={{ fontSize:9, color:"#475569", marginBottom:6 }}>STARTING CASH (per team)</div>
                  <div style={{ display:"flex", gap:6 }}>
                    <input type="number" value={initCash} onChange={e=>setInitCash(+e.target.value)}
                      style={{ flex:1, padding:"7px 9px", background:"#0f172a", border:"1px solid #1e293b",
                        color:"#f1f5f9", borderRadius:5, fontFamily:"inherit", fontSize:13 }} />
                    <button onClick={()=>gmCmd("setInitCash",{cash:initCash})}
                      style={{ padding:"7px 10px", background:"#1e293b", border:"1px solid #334155",
                        color:"#94a3b8", borderRadius:5, cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:700 }}>SET</button>
                  </div>
                </div>
                <div style={{ background:"#0f172a", borderRadius:8, padding:10, fontSize:10, color:"#64748b", lineHeight:1.9 }}>
                  <div style={{ color:"#fbbf24", fontWeight:700, marginBottom:4 }}>9-INDICATOR SCORING</div>
                  <div>35% – Total Return %</div>
                  <div>25% – Sharpe (Return/Drawdown)</div>
                  <div>20% – Sector Diversification (7 max)</div>
                  <div>10% – Win Rate on closed trades</div>
                  <div>10% – Capital Efficiency</div>
                  <div style={{ marginTop:6, borderTop:"1px solid #1e293b", paddingTop:6, color:"#334155" }}>
                    Buffer: {BUFFER_SECS}s between rounds · {POLITICAL_BUFFER_SECS}s after political shock
                  </div>
                </div>
              </div>
            )}
            {gmTab==="market" && (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

                {/* ── GLOBAL MARKET SENTIMENT ── */}
                <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:8, padding:10 }}>
                  <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em", marginBottom:7 }}>GLOBAL SENTIMENT</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
                    {[["bull","📈 BULL","#00f5c4"],["bear","📉 BEAR","#ef4444"],
                      ["volatile","⚡ VOLATILE","#fbbf24"],["neutral","〰 NEUTRAL","#64748b"]].map(([s,l,c]) => (
                      <button key={s} onClick={()=>gmCmd("sentiment",{s})}
                        style={{ ...gmBtn(sentiment===s?"#1e293b":"#0f172a",c,true),
                          border:`1px solid ${sentiment===s?c:"#1e293b"}` }}>{l}</button>
                    ))}
                  </div>
                </div>

                {/* ── SECTOR COMMAND CENTER ── */}
                <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:8, padding:10 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:9 }}>
                    <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em" }}>SECTOR COMMAND</div>
                    <div style={{ display:"flex", gap:5 }}>
                      <button onClick={() => setSelectedSectors(new Set(SECTORS.map(s=>s.id)))}
                        style={{ padding:"2px 8px", background:"#1e293b", border:"1px solid #334155",
                          color:"#94a3b8", borderRadius:4, cursor:"pointer", fontFamily:"inherit", fontSize:9 }}>
                        ALL
                      </button>
                      <button onClick={() => setSelectedSectors(new Set())}
                        style={{ padding:"2px 8px", background:"#1e293b", border:"1px solid #334155",
                          color:"#64748b", borderRadius:4, cursor:"pointer", fontFamily:"inherit", fontSize:9 }}>
                        NONE
                      </button>
                    </div>
                  </div>

                  {/* Sector selector chips */}
                  <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:9 }}>
                    {SECTORS.map(sec => {
                      const isSel = selectedSectors.has(sec.id);
                      const bias  = sectorBiases[sec.id];
                      const biasColor = bias==="bull"?"#00f5c4":bias==="bear"?"#ef4444":bias==="volatile"?"#fbbf24":"#334155";
                      const isAutoOn  = activeDisruptSectors.has(sec.id);
                      return (
                        <div key={sec.id} style={{
                          display:"flex", alignItems:"center", gap:6,
                          background: isSel ? `${sec.color}12` : "#060c18",
                          border: `1px solid ${isSel ? sec.color+"60" : "#111827"}`,
                          borderRadius:7, padding:"5px 8px", cursor:"pointer",
                          transition:"all 0.15s"
                        }} onClick={() => setSelectedSectors(prev => {
                          const n = new Set(prev);
                          n.has(sec.id) ? n.delete(sec.id) : n.add(sec.id);
                          return n;
                        })}>
                          <div style={{ width:14, height:14, borderRadius:3,
                            background: isSel ? sec.color : "#1e293b",
                            border:`1px solid ${isSel?sec.color:"#334155"}`,
                            display:"flex", alignItems:"center", justifyContent:"center",
                            fontSize:9, color:"#020817", flexShrink:0 }}>
                            {isSel && "✓"}
                          </div>
                          <span style={{ fontSize:9 }}>{sec.icon}</span>
                          <span style={{ fontSize:10, color:isSel?sec.color:"#475569",
                            fontWeight:isSel?700:400, flex:1 }}>{sec.label}</span>
                          {bias !== "neutral" && (
                            <span style={{ fontSize:8, padding:"1px 5px", borderRadius:3,
                              background:`${biasColor}18`, color:biasColor, fontWeight:700 }}>
                              {bias.toUpperCase()}
                            </span>
                          )}
                          {isAutoOn && (
                            <span style={{ fontSize:8, color:"#a78bfa",
                              animation:"pulse 1s infinite" }}>⚡AUTO</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Apply bias to selected sectors */}
                  {selectedSectors.size > 0 && (
                    <div>
                      <div style={{ fontSize:8, color:"#334155", marginBottom:5, letterSpacing:"0.08em" }}>
                        APPLY TO {selectedSectors.size} SELECTED SECTOR{selectedSectors.size>1?"S":""}
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:8 }}>
                        {[
                          {k:"bull",     l:"📈 BULLISH",  c:"#00f5c4", bg:"#064e3b"},
                          {k:"bear",     l:"📉 BEARISH",  c:"#ef4444", bg:"#7f1d1d"},
                          {k:"volatile", l:"⚡ VOLATILE", c:"#fbbf24", bg:"#713f12"},
                          {k:"neutral",  l:"〰 NEUTRAL",  c:"#64748b", bg:"#1e293b"},
                        ].map(b => (
                          <button key={b.k} onClick={() => {
                            const updates = {};
                            selectedSectors.forEach(id => { updates[id] = b.k; });
                            setSectorBiases(prev => ({ ...prev, ...updates }));
                          }} style={{
                            padding:"7px 4px", background:b.bg,
                            border:`1px solid ${b.c}44`, color:b.c,
                            borderRadius:5, cursor:"pointer", fontFamily:"inherit",
                            fontSize:9, fontWeight:700, letterSpacing:"0.04em"
                          }}>{b.l}</button>
                        ))}
                      </div>

                      {/* Generate AI disruption news for selected sectors */}
                      <button
                        disabled={!!generatingSector}
                        onClick={async () => {
                          for (const sectorId of selectedSectors) {
                            const bias = sectorBiases[sectorId];
                            await generateSectorNews(sectorId, bias==="neutral"?"volatile":bias);
                          }
                        }}
                        style={{
                          width:"100%", padding:"9px 6px",
                          background: generatingSector ? "#0f172a" : "linear-gradient(135deg,#1e3a5f,#0f172a)",
                          border:`1px solid ${generatingSector?"#1e293b":"#38bdf8"}`,
                          color: generatingSector ? "#334155" : "#38bdf8",
                          borderRadius:6, cursor:generatingSector?"wait":"pointer",
                          fontFamily:"inherit", fontSize:10, fontWeight:700, marginBottom:5
                        }}>
                        {generatingSector
                          ? `🔄 Generating for ${SECTORS.find(s=>s.id===generatingSector)?.label}…`
                          : `🤖 GENERATE AI NEWS for ${selectedSectors.size} sector${selectedSectors.size>1?"s":""}`}
                      </button>

                      {/* Toggle automation */}
                      <button onClick={() => {
                        setActiveDisruptSectors(prev => {
                          const n = new Set(prev);
                          const allOn = [...selectedSectors].every(id => n.has(id));
                          selectedSectors.forEach(id => allOn ? n.delete(id) : n.add(id));
                          return n;
                        });
                      }} style={{
                        width:"100%", padding:"7px 6px",
                        background:"#1e293b", border:"1px solid #334155",
                        color:"#a78bfa", borderRadius:6, cursor:"pointer",
                        fontFamily:"inherit", fontSize:9, fontWeight:700
                      }}>
                        {[...selectedSectors].every(id=>activeDisruptSectors.has(id))
                          ? "⏹ STOP AUTOMATION" : "⚡ AUTO-REPEAT NEWS"}
                      </button>
                    </div>
                  )}
                </div>

                {/* ── SINGLE-STOCK SHOCK ── */}
                <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:8, padding:10 }}>
                  <div style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em", marginBottom:7 }}>SINGLE STOCK SHOCK</div>
                  <select value={shockTicker} onChange={e=>setShockTicker(e.target.value)}
                    style={{ width:"100%", padding:"7px", background:"#060c18", border:"1px solid #1e293b",
                      color:"#f1f5f9", borderRadius:5, fontFamily:"inherit", fontSize:10, marginBottom:7 }}>
                    {SECTORS.map(sec => (
                      <optgroup key={sec.id} label={`${sec.icon} ${sec.label}`}>
                        {sec.stocks.map(st => <option key={st.ticker} value={st.ticker}>{st.ticker} — {st.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <div style={{ display:"flex", gap:7, alignItems:"center", marginBottom:7 }}>
                    <input type="range" min={-60} max={60} value={shockPct}
                      onChange={e=>setShockPct(+e.target.value)}
                      style={{ flex:1, accentColor:shockPct>=0?"#00f5c4":"#ef4444" }} />
                    <span style={{ width:46, textAlign:"right", fontWeight:700, fontSize:11,
                      color:shockPct>=0?"#00f5c4":"#ef4444" }}>{shockPct>=0?"+":""}{shockPct}%</span>
                  </div>
                  <button onClick={()=>gmCmd("shock",{ticker:shockTicker,pct:shockPct})}
                    style={{ ...gmBtn(shockPct>=0?"#064e3b":"#7f1d1d",shockPct>=0?"#00f5c4":"#ef4444"), padding:"8px" }}>
                    ⚡ SHOCK {shockTicker}
                  </button>
                </div>

              </div>
            )}
            {gmTab==="teams" && <TeamEditor teams={teams} onSave={t=>{setTeams(t);pushTeams(t);}} />}
            {gmTab==="broadcast" && (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {/* ── Broadcast message ── */}
                <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.1em" }}>BROADCAST TO ALL</div>
                <BroadcastInline onSend={text=>gmCmd("broadcast",{text})} />

                {/* ── Manual Disruption News ── */}
                <div style={{ marginTop:6, borderTop:"1px solid #1e293b", paddingTop:10 }}>
                  <div style={{ fontSize:10, color:"#ef4444", letterSpacing:"0.1em", marginBottom:8 }}>
                    🚨 DISRUPTION NEWS UPDATE
                  </div>
                  <ManualDisruption
                    stocks={ALL_STOCKS}
                    prices={prices}
                    onPublish={async (events) => {
                      setDisruptions(events);
                      await pushDisrupts(events);
                      setShowEmergency(true);
                      sendBcast("🚨 BREAKING: New market disruption bulletin released!");
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right */}
        <div style={{ overflowY:"auto", padding:18 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 360px", gap:18 }}>
            <div>
              <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.1em", marginBottom:12 }}>
                MARKET OVERVIEW · {ALL_STOCKS.length} STOCKS
              </div>
              {SECTORS.map(sec => {
                const bias = sectorBiases[sec.id];
                const biasColor = bias==="bull"?"#00f5c4":bias==="bear"?"#ef4444":bias==="volatile"?"#fbbf24":"#334155";
                const isAuto = activeDisruptSectors.has(sec.id);
                const isSelected = selectedSectors.has(sec.id);
                const secNews = sectorDisruptions[sec.id] || [];
                return (
                  <div key={sec.id} style={{ marginBottom:14 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:7,
                      padding:"6px 8px", borderRadius:7,
                      background: isSelected ? `${sec.color}10` : "transparent",
                      border: `1px solid ${isSelected ? sec.color+"40" : "transparent"}`,
                      cursor:"pointer" }}
                      onClick={() => setSelectedSectors(prev => {
                        const n=new Set(prev); n.has(sec.id)?n.delete(sec.id):n.add(sec.id); return n;
                      })}>
                      <span style={{ fontSize:13 }}>{sec.icon}</span>
                      <span style={{ fontWeight:700, color:isSelected?sec.color:sec.color+"99", fontSize:11 }}>{sec.label}</span>
                      {bias !== "neutral" && (
                        <span style={{ fontSize:8, padding:"1px 6px", borderRadius:3, fontWeight:800,
                          background:`${biasColor}18`, border:`1px solid ${biasColor}40`, color:biasColor }}>
                          {bias.toUpperCase()}
                        </span>
                      )}
                      {isAuto && <span style={{ fontSize:9, color:"#a78bfa", animation:"pulse 1s infinite" }}>⚡AUTO</span>}
                      {generatingSector===sec.id && <span style={{ fontSize:9, color:"#38bdf8", animation:"pulse 0.5s infinite" }}>🔄</span>}
                      <div style={{ flex:1, height:1, background:"#111827" }} />
                      {isSelected && <span style={{ fontSize:9, color:sec.color, fontWeight:700 }}>✓ SELECTED</span>}
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:5 }}>
                      {sec.stocks.map(st => {
                        const p=prices[st.ticker]||0, prev=prevPrices[st.ticker]||p;
                        const chg=((p-prev)/(prev||1))*100;
                        const hasNews = secNews.find(e=>e.ticker===st.ticker);
                        return (
                          <div key={st.ticker} style={{ background:"#0a0f1e",
                            border:`1px solid ${hasNews?(hasNews.impact>0?"#00f5c440":"#ef444440"):"#111827"}`,
                            borderRadius:8, padding:"7px 9px",
                            boxShadow: hasNews ? `0 0 8px ${hasNews.impact>0?"#00f5c420":"#ef444420"}` : "none" }}>
                            <div style={{ fontWeight:700, color:sec.color, fontSize:10 }}>{st.ticker}</div>
                            <div style={{ fontSize:8, color:"#1e293b", marginBottom:3, whiteSpace:"nowrap",
                              overflow:"hidden", textOverflow:"ellipsis" }}>{st.name}</div>
                            <div style={{ fontWeight:700, fontSize:11 }}>{fmtUSD(p)}</div>
                            <div style={{ fontSize:9, color:chg>=0?"#00f5c4":"#ef4444" }}>
                              {chg>=0?"▲":"▼"}{fmt(Math.abs(chg))}%
                            </div>
                            {hasNews && (
                              <div style={{ fontSize:7, color:hasNews.impact>0?"#00f5c4":"#ef4444",
                                marginTop:3, lineHeight:1.3, overflow:"hidden",
                                textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                {hasNews.impact>0?"+":""}{hasNews.impact}% · {hasNews.headline?.slice(0,30)}…
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Sector news strip */}
                    {secNews.length > 0 && (
                      <div style={{ marginTop:5, padding:"5px 8px", background:"#060c18",
                        borderRadius:6, borderLeft:`3px solid ${biasColor}` }}>
                        <div style={{ fontSize:9, color:biasColor, fontWeight:700, marginBottom:3 }}>
                          {sec.icon} ACTIVE DISRUPTION
                        </div>
                        {secNews.slice(0,2).map((n,i) => (
                          <div key={i} style={{ fontSize:9, color:"#64748b", lineHeight:1.4 }}>
                            <span style={{ color:n.impact>0?"#00f5c4":"#ef4444" }}>{n.ticker} {n.impact>0?"+":""}{n.impact}%</span>
                            {" — "}{n.headline}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div>
              <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.1em", marginBottom:12 }}>LEADERBOARD</div>
              <LeaderboardPanel entries={sharedLB} teams={teams} initCash={initCash} highlight="" showDetail />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // PLAYER SCREEN
  // ════════════════════════════════════════════════════════════════════════════
  const roundEndActive = ["ceremony","buffer","disruption","ended"].includes(gamePhase);
  const pnlColor = analytics.totalPnL >= 0 ? "#00f5c4" : "#ef4444";
  const showTeamDisruptionBuffer = gamePhase === "buffer" && disruptions.length > 0;

  return (
    <div style={{ minHeight:"100vh", background:"#020817", color:"#f1f5f9",
      fontFamily:"'JetBrains Mono','Courier New',monospace", fontSize:13 }}>
      <style>{CSS}</style>

      {showTeamDisruptionBuffer && (
        <EmergencyModal
          events={disruptions}
          bufferLeft={bufferLeft}
          onApply={() => {}}
          onClose={() => {}}
          isFirstRound={false}
          passive
          showConcept={false}
        />
      )}

      {predictionSession && predictionSession.phase !== "closed" && (
        <PredictionMarketOverlay
          session={predictionSession}
          playerPrediction={currentPredictionVote}
          onVote={submitPredictionVote}
          isGM={false}
          teamName={currentTeam?.name}
        />
      )}

      {/* ── CIRCUIT BREAKER BANNER ── */}
      {isFrozen && (
        <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:8900,
          background:"linear-gradient(90deg,#0c4a6e,#020817)",
          border:"2px solid #38bdf8", padding:"10px 20px",
          display:"flex", alignItems:"center", gap:12, fontFamily:"'JetBrains Mono',monospace" }}>
          <span style={{ fontSize:22 }}>⛔</span>
          <div style={{ flex:1 }}>
            <div style={{ color:"#38bdf8", fontWeight:800, fontSize:13 }}>CIRCUIT BREAKER ACTIVE</div>
            <div style={{ color:"#64748b", fontSize:10 }}>Trading and live price movement are paused until the halt expires.</div>
          </div>
          <span style={{ color:"#38bdf8", fontWeight:800 }}>⏳ {frozenUntil ? Math.max(0,Math.ceil((frozenUntil-Date.now())/1000)) : 0}s</span>
        </div>
      )}

      {/* ── POWER-UP FLASH ── */}
      {activePowerup && (
        <div style={{ position:"fixed", inset:0, zIndex:9500, pointerEvents:"none",
          display:"flex", alignItems:"center", justifyContent:"center",
          background:"rgba(2,8,23,0.88)", animation:"fadein 0.2s" }}>
          <div style={{ textAlign:"center", animation:"fadeup 0.3s" }}>
            <div style={{ fontSize:80, marginBottom:12 }}>{activePowerup.icon}</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:52,
              color:activePowerup.color, letterSpacing:"0.05em" }}>{activePowerup.name}</div>
            <div style={{ fontSize:14, color:"#94a3b8", marginTop:8 }}>{activePowerup.desc}</div>
          </div>
        </div>
      )}

      {/* ── TAX NOTIFICATION ── */}
      {taxPending && taxAmount > 0 && screen === "player" && (
        <div style={{ position:"fixed", bottom:80, right:20, zIndex:8500,
          background:"linear-gradient(135deg,#7f1d1d,#450a0a)",
          border:"2px solid #ef4444", borderRadius:12, padding:"14px 18px",
          fontFamily:"'JetBrains Mono',monospace", maxWidth:280, animation:"fadeup 0.4s",
          boxShadow:"0 0 30px rgba(239,68,68,0.4)" }}>
          <div style={{ color:"#ef4444", fontWeight:800, fontSize:13, marginBottom:4 }}>💸 ROUND TAX INCOMING</div>
          <div style={{ color:"#94a3b8", fontSize:11, lineHeight:1.6 }}>20% profit tax at round end:</div>
          <div style={{ color:"#fbbf24", fontWeight:800, fontSize:20, marginTop:4 }}>−${taxAmount.toLocaleString()}</div>
          <div style={{ fontSize:9, color:"#64748b", marginTop:4 }}>Applied when next round begins</div>
        </div>
      )}

      {/* ── ACHIEVEMENT TOAST ── */}
      {achievements.length > 0 && achievements.slice(-1).map(ach => (
        <div key={ach.id} style={{ position:"fixed", bottom:20, left:"50%",
          transform:"translateX(-50%)", zIndex:8600,
          background:"linear-gradient(135deg,#14532d,#064e3b)",
          border:"2px solid #00f5c4", borderRadius:10, padding:"10px 18px",
          display:"flex", alignItems:"center", gap:10,
          fontFamily:"'JetBrains Mono',monospace", animation:"fadeup 0.4s",
          boxShadow:"0 0 30px rgba(0,245,196,0.3)" }}>
          <span style={{ fontSize:24 }}>{ach.icon}</span>
          <div>
            <div style={{ color:"#00f5c4", fontWeight:800, fontSize:12 }}>ACHIEVEMENT UNLOCKED: {ach.name}</div>
            <div style={{ color:"#64748b", fontSize:10 }}>{ach.desc}</div>
          </div>
        </div>
      ))}

      {/* ── PREDICTION RESULT ── */}
      {predResult && (
        <div style={{ position:"fixed", inset:0, zIndex:8700, background:"rgba(2,8,23,0.95)",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontFamily:"'JetBrains Mono',monospace" }}
          onClick={() => setPredResult(null)}>
          <div style={{ width:"min(520px,95vw)", background:"#0a0f1e",
            border:`2px solid ${predResult.correct?"#00f5c4":"#ef4444"}`,
            borderRadius:14, padding:"28px", animation:"fadeup 0.4s" }}>
            <div style={{ textAlign:"center", marginBottom:20 }}>
              <div style={{ fontSize:48, marginBottom:8 }}>{predResult.correct?"🎯":"❌"}</div>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:20,
                color:predResult.correct?"#00f5c4":"#ef4444", marginBottom:4 }}>
                {predResult.correct?"CORRECT!":"INCORRECT"}
              </div>
              {predResult.correct && (
                <div style={{ fontSize:14, color:"#fbbf24", fontWeight:700 }}>
                  +${predResult.bonus.toLocaleString()} bonus applied!
                </div>
              )}
            </div>
            <div style={{ background:"#060c18", borderRadius:8, padding:"14px",
              marginBottom:14, border:"1px solid #1e293b" }}>
              <div style={{ fontSize:9, color:"#475569", marginBottom:6 }}>CORRECT ANSWER</div>
              <div style={{ fontSize:12, color:"#f1f5f9", lineHeight:1.6 }}>{predResult.answer}</div>
            </div>
            <div style={{ background:"#060c18", borderRadius:8, padding:"14px",
              border:"1px solid #7c3aed44" }}>
              <div style={{ fontSize:9, color:"#7c3aed", fontWeight:700, marginBottom:6 }}>
                ECONOMIC EXPLANATION
              </div>
              <div style={{ fontSize:11, color:"#94a3b8", lineHeight:1.7 }}>
                {predResult.explanation}
              </div>
            </div>
            <div style={{ textAlign:"center", marginTop:14, fontSize:9, color:"#334155" }}>
              Tap anywhere to continue
            </div>
          </div>
        </div>
      )}

      {/* ── ROUND IDENTITY BANNER (player view) ── */}
      {gamePhase === "running" && (() => {
        const rules = ROUND_RULES[roundNum-1] || ROUND_RULES[0];
        return (
          <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:7000,
            background:`${rules.color}18`, borderTop:`2px solid ${rules.color}55`,
            padding:"6px 16px", display:"flex", alignItems:"center", gap:10,
            fontFamily:"'JetBrains Mono',monospace" }}>
            <span>{rules.icon}</span>
            <span style={{ color:rules.color, fontWeight:800, fontSize:11 }}>{rules.name}</span>
            <span style={{ color:"#475569", fontSize:9 }}>{rules.briefing}</span>
            {rules.tax && <span style={{ marginLeft:"auto", fontSize:9, padding:"2px 6px",
              background:"#ef444420", border:"1px solid #ef444440", color:"#ef4444",
              borderRadius:4, fontWeight:700 }}>TAX ROUND</span>}
            {rules.liquidate && <span style={{ fontSize:9, padding:"2px 6px",
              background:"#ef444420", border:"1px solid #ef444440", color:"#ef4444",
              borderRadius:4, fontWeight:700 }}>LIQUIDATION</span>}
            {playerPrediction && playerPredictionRound === roundNum && (() => {
              const pq = PREDICTION_QUESTIONS.find(q => q.round === roundNum);
              const opt = pq?.options?.find(o => o.id === playerPrediction);
              return (
                <span style={{ fontSize:9, padding:"2px 6px",
                  background:"#00f5c420", border:"1px solid #00f5c440", color:"#00f5c4",
                  borderRadius:4 }}>
                  Prediction locked: {opt ? `${opt.id.toUpperCase()}. ${opt.text.slice(0, 24)}${opt.text.length > 24 ? "…" : ""}` : playerPrediction}
                </span>
              );
            })()}
          </div>
        );
      })()}

      {broadcast && (
        <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:9999,
          background:"linear-gradient(135deg,#0c4a6e,#0f172a)",
          borderBottom:"2px solid #38bdf8", padding:"12px 20px",
          animation:"slidedown 0.4s ease", display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:18 }}>📢</span>
          <span style={{ color:"#e0f2fe", fontWeight:600, fontSize:12 }}>{broadcast.text}</span>
          <button onClick={()=>setBroadcast(null)}
            style={{ marginLeft:"auto", background:"none", border:"none", color:"#94a3b8", cursor:"pointer", fontSize:16 }}>×</button>
        </div>
      )}

      {roundEndActive && (
        <div style={{ position:"fixed", inset:0, zIndex:400, background:"rgba(2,8,23,0.9)",
          display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16 }}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:36, fontWeight:900,
            color:gamePhase==="buffer"?"#38bdf8":"#fbbf24" }}>
            {gamePhase==="ended"?"🏆 COMPETITION OVER":gamePhase==="buffer"?"⏳ BUFFER PERIOD":"ROUND COMPLETE"}
          </div>
          {gamePhase==="buffer" && bufMins!=null && (
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:48, color:"#38bdf8" }}>
              {String(bufMins).padStart(2,"0")}:{String(bufSecs).padStart(2,"0")}
            </div>
          )}
          <div style={{ width:400 }}>
            <LeaderboardPanel entries={sharedLB} teams={teams} initCash={initCash}
              highlight={currentTeam?.name} showDetail />
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"10px 18px", borderBottom:"1px solid #1e293b",
        background:"#020817", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24,
            background:"linear-gradient(135deg,#00f5c4,#38bdf8)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>BULL PIT</div>
          <div style={{ width:7, height:7, borderRadius:"50%", flexShrink:0,
            background:gamePhase==="running"?"#00f5c4":gamePhase==="paused"?"#fbbf24":gamePhase==="buffer"?"#38bdf8":"#64748b",
            animation:gamePhase==="running"?"pulse 2s infinite":"none" }} />
          <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
            <span style={{ fontSize:9, color:"#475569", letterSpacing:"0.1em" }}>
              {ROUND_LABELS[roundNum-1] || `Round ${roundNum}`} · {gamePhase.toUpperCase()}
            </span>
            <span style={{ fontSize:8, color:"#334155" }}>
              R{roundNum}/{TOTAL_ROUNDS} · {Math.floor(roundDur/60)}min round · {BUFFER_SECS}s buffer
            </span>
          </div>
          {timerMins!=null && gamePhase==="running" && (
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, lineHeight:1,
              color: timerMins<1?"#ef4444":timerMins<3?"#fbbf24":"#94a3b8",
              animation: timerMins<1?"pulse 0.5s infinite":timerMins<3?"pulse 2s infinite":"none" }}>
              {String(timerMins).padStart(2,"0")}:{String(timerSecs).padStart(2,"0")}
            </div>
          )}
          {bufMins!=null && gamePhase==="buffer" && (
            <div style={{ fontSize:11, fontWeight:700, color:"#38bdf8" }}>
              ⏳ {String(bufMins).padStart(2,"0")}:{String(bufSecs).padStart(2,"0")}
            </div>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {myRank>0 && <span style={{ fontSize:10, padding:"3px 8px", borderRadius:4,
            background:"#0f172a", border:"1px solid #1e293b", color:"#64748b" }}>
            RANK #{myRank}/{sharedLB.length}
          </span>}
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:10, color:currentTeam?.color, fontWeight:700 }}>{currentTeam?.name}</div>
            <div style={{ fontWeight:700, fontSize:13, color:analytics.totalPnL>=0?"#00f5c4":"#ef4444" }}>
              {fmtUSD(totalVal)} {analytics.totalPnL>=0?"▲":"▼"}{fmtUSD(Math.abs(analytics.totalPnL))}
            </div>
          </div>
          <button onClick={()=>setScreen("login")} style={{ padding:"5px 10px", background:"#0f172a",
            border:"1px solid #1e293b", color:"#475569", borderRadius:5,
            cursor:"pointer", fontFamily:"inherit", fontSize:10 }}>← EXIT</button>
        </div>
      </div>

      {/* Ticker strip */}
      <div style={{ background:"#040d1a", borderBottom:"1px solid #0f172a",
        padding:"5px 0", overflow:"hidden", whiteSpace:"nowrap" }}>
        <div style={{ display:"inline-flex", gap:20, animation:"ticker 60s linear infinite" }}>
          {[...ALL_STOCKS,...ALL_STOCKS].map((s,i) => {
            const p=prices[s.ticker]||0, prev=prevPrices[s.ticker]||p;
            const chg=((p-prev)/(prev||1))*100;
            return (
              <span key={i} style={{ fontSize:11, display:"inline-flex", gap:5 }}>
                <span style={{ color:s.color, fontWeight:700 }}>{s.ticker}</span>
                <span style={{ color:"#64748b" }}>{fmtUSD(p)}</span>
                <span style={{ color:chg>=0?"#00f5c4":"#ef4444" }}>{chg>=0?"▲":"▼"}{fmt(Math.abs(chg))}%</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Nav */}
      <div style={{ display:"flex", borderBottom:"1px solid #1e293b", padding:"0 18px", overflowX:"auto" }}>
        {["market","portfolio","leaderboard","news"].map(t => (
          <button key={t} onClick={()=>setTab(t)} style={{
            padding:"10px 14px", background:"none", border:"none",
            color:tab===t?"#00f5c4":"#475569", cursor:"pointer",
            borderBottom:tab===t?"2px solid #00f5c4":"2px solid transparent",
            fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase",
            fontFamily:"inherit", fontWeight:tab===t?700:400, whiteSpace:"nowrap" }}>{t}</button>
        ))}
      </div>

      <div style={{ padding:"18px", maxWidth:1200, margin:"0 auto" }}>

        {/* ── MARKET TAB ── */}
        {tab === "market" && (
          <>
            {/* Sector filter + Search */}
            <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
              <input value={marketSearch} onChange={e=>setMarketSearch(e.target.value)}
                placeholder="Search stocks…"
                style={{ padding:"7px 12px", background:"#0f172a", border:"1px solid #1e293b",
                  color:"#f1f5f9", borderRadius:7, fontFamily:"inherit", fontSize:12, width:160 }} />
              <button onClick={()=>setActiveSector("all")}
                style={{ padding:"6px 12px", background:activeSector==="all"?"#1e293b":"#0a0f1e",
                  border:`1px solid ${activeSector==="all"?"#64748b":"#1e293b"}`,
                  color:activeSector==="all"?"#f1f5f9":"#475569", borderRadius:6,
                  cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:700 }}>ALL</button>
              {SECTORS.map(sec => (
                <button key={sec.id} onClick={()=>setActiveSector(sec.id)}
                  style={{ padding:"6px 10px", background:activeSector===sec.id?`${sec.color}20`:"#0a0f1e",
                    border:`1px solid ${activeSector===sec.id?sec.color:"#1e293b"}`,
                    color:activeSector===sec.id?sec.color:"#475569", borderRadius:6,
                    cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:700 }}>
                  {sec.icon} {sec.label.split(" ")[0]}
                </button>
              ))}
            </div>

            {/* ── TOP GAINERS & LOSERS ── */}
            {(()=>{
              const ranked = ALL_STOCKS.map(st => {
                const p=prices[st.ticker]||0, h=history[st.ticker]||[], open=h[0]||p;
                const chg=open?((p-open)/open)*100:0;
                return {...st,p,chg};
              }).filter(st=>st.p>0);
              const gainers=[...ranked].sort((a,b)=>b.chg-a.chg).slice(0,5);
              const losers=[...ranked].sort((a,b)=>a.chg-b.chg).slice(0,5);
              // renderMover is a plain function (not a React component) — no hooks, no remount issue
              const renderMover=(st,isGainer)=>{
                const pos=holdings[st.ticker];
                const heldLong=longQty(pos);
                const heldShort=shortQty(pos);
                const qBuy=canTrade&&cash>=st.p&&heldShort===0;
                const qSell=canTrade&&heldLong>0;
                const qAlt=heldShort>0 ? (canTrade&&cash>=st.p) : (canTrade&&heldLong===0&&st.p<=shortCapacity);
                const accentColor=isGainer?"#00f5c4":"#ef4444";
                return (
                  <div key={st.ticker} style={{
                    background:"#0a0f1e",
                    border:`1px solid ${isGainer?"#00f5c420":"#ef444420"}`,
                    borderLeft:`3px solid ${accentColor}`,
                    borderRadius:10,padding:"10px 12px",
                    display:"flex",alignItems:"center",gap:10,cursor:"pointer"
                  }} onClick={()=>setDetailStock(st.ticker)}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:800,color:st.color,fontSize:13}}>{st.ticker}</div>
                      <div style={{fontSize:9,color:"#334155",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:90}}>{st.name}</div>
                    </div>
                    <Spark data={(history[st.ticker]||[]).slice(-20)} color={accentColor} w={50} h={22}/>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:12,fontWeight:700,color:"#f1f5f9"}}>{fmtUSD(st.p)}</div>
                      <div style={{fontSize:11,fontWeight:800,color:accentColor}}>{isGainer?"▲ +":"▼ "}{fmt(Math.abs(st.chg))}%</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:3,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>execBuy(st.ticker,1)} disabled={!qBuy} style={{padding:"3px 8px",fontSize:9,fontWeight:800,background:qBuy?"#00f5c422":"#0f172a",border:`1px solid ${qBuy?"#00f5c4":"#1e293b"}`,color:qBuy?"#00f5c4":"#334155",borderRadius:4,cursor:qBuy?"pointer":"not-allowed",fontFamily:"inherit"}}>▲ BUY</button>
                      <button onClick={()=>execSell(st.ticker,1)} disabled={!qSell} style={{padding:"3px 8px",fontSize:9,fontWeight:800,background:qSell?"#ef444422":"#0f172a",border:`1px solid ${qSell?"#ef4444":"#1e293b"}`,color:qSell?"#ef4444":"#334155",borderRadius:4,cursor:qSell?"pointer":"not-allowed",fontFamily:"inherit"}}>▼ SELL</button>
                      <button onClick={()=>heldShort>0?execCover(st.ticker,1):execShort(st.ticker,1)} disabled={!qAlt} style={{padding:"3px 8px",fontSize:9,fontWeight:800,background:qAlt?(heldShort>0?"#22c55e22":"#f9731622"):"#0f172a",border:`1px solid ${qAlt?(heldShort>0?"#22c55e":"#f97316"):"#1e293b"}`,color:qAlt?(heldShort>0?"#22c55e":"#f97316"):"#334155",borderRadius:4,cursor:qAlt?"pointer":"not-allowed",fontFamily:"inherit"}}>{heldShort>0?"↗ COVER":"↘ SHORT"}</button>
                    </div>
                  </div>
                );
              };
              return (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
                  <div style={{background:"#030810",border:"1px solid #0d1f10",borderRadius:12,overflow:"hidden"}}>
                    <div style={{padding:"10px 14px",borderBottom:"1px solid #0d1f10",display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:14}}>🚀</span>
                      <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:13,color:"#00f5c4"}}>TOP GAINERS</span>
                      <span style={{marginLeft:"auto",fontSize:9,color:"#334155"}}>SESSION %</span>
                    </div>
                    <div style={{padding:"8px 10px",display:"flex",flexDirection:"column",gap:6}}>
                      {gainers.map(st=>renderMover(st,true))}
                    </div>
                  </div>
                  <div style={{background:"#030810",border:"1px solid #1f0d0d",borderRadius:12,overflow:"hidden"}}>
                    <div style={{padding:"10px 14px",borderBottom:"1px solid #1f0d0d",display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:14}}>📉</span>
                      <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:13,color:"#ef4444"}}>TOP LOSERS</span>
                      <span style={{marginLeft:"auto",fontSize:9,color:"#334155"}}>SESSION %</span>
                    </div>
                    <div style={{padding:"8px 10px",display:"flex",flexDirection:"column",gap:6}}>
                      {losers.map(st=>renderMover(st,false))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Stock detail modal */}
            {detailStock && (() => {
              const ds = ALL_STOCKS.find(x => x.ticker === detailStock);
              const dsec = SECTORS.find(x => x.id === ds?.sectorId);
              return (
                <StockDetailModal
                  stock={ds}
                  sector={dsec}
                  price={prices[detailStock]||0}
                  prevPrice={prevPrices[detailStock]||0}
                  history={history[detailStock]||[]}
                  holdings={holdings}
                  cash={cash}
                  canTrade={canTrade}
                  shortCapacity={shortCapacity}
                  onBuy={execBuy}
                  onSell={execSell}
                  onShort={execShort}
                  onCover={execCover}
                  onClose={() => setDetailStock(null)}
                  transactions={transactions}
                  aiLog={aiLog}
                />
              );
            })()}

            {/* Stock grid */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:8, marginBottom:14 }}>
              {filteredStocks.map(s => {
                const p=prices[s.ticker]||0, h=history[s.ticker]||[], prev=prevPrices[s.ticker]||p;
                const sessionChg=h[0]?((p-h[0])/h[0])*100:0;
                const tickChg=((p-prev)/(prev||1))*100;
                const isSel=selTicker===s.ticker;
                const pos = holdings[s.ticker];
                const heldLong = longQty(pos);
                const heldShort = shortQty(pos);
                const canQuickBuy  = canTrade && cash >= p && heldShort === 0;
                const canQuickSell = canTrade && heldLong > 0;
                const canQuickAlt  = heldShort > 0
                  ? canTrade && cash >= p
                  : canTrade && heldLong === 0 && p <= shortCapacity;
                return (
                  <div key={s.ticker} style={{
                    background:"#0a0f1e", border:`1px solid ${isSel?s.color:"#111827"}`,
                    borderRadius:10, padding:"12px 14px", cursor:"pointer",
                    boxShadow:isSel?`0 0 20px ${s.color}18`:"none", transition:"all 0.2s",
                    position:"relative" }}
                    onClick={()=>setSelTicker(isSel?null:s.ticker)}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <div>
                        <div style={{ fontWeight:800, color:s.color, fontSize:13 }}>{s.ticker}</div>
                        <div style={{ fontSize:9, color:"#334155", maxWidth:90,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.name}</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontWeight:700, fontSize:13 }}>{fmtUSD(p)}</div>
                        <div style={{ fontSize:10, color:tickChg>=0?"#00f5c4":"#ef4444" }}>
                          {tickChg>=0?"▲":"▼"}{fmt(Math.abs(tickChg))}%
                        </div>
                      </div>
                    </div>
                    <Spark data={h.slice(-30)} color={s.color} h={24} />
                    <div style={{ display:"flex", justifyContent:"space-between", marginTop:5, fontSize:9 }}>
                      {s.totalMarket ? (
                        <span style={{ fontSize:8, padding:"1px 5px", borderRadius:3,
                          background:"#e879f920", border:"1px solid #e879f960",
                          color:"#e879f9", fontWeight:800 }}>ALL MARKET</span>
                      ) : s.crossSector ? (
                        <span style={{ fontSize:8, padding:"1px 5px", borderRadius:3,
                          background:"#e879f915", border:"1px solid #e879f940",
                          color:"#e879f9", fontWeight:700 }}>CROSS-SECTOR</span>
                      ) : (
                        <SectorBadge sectorId={s.sectorId} small />
                      )}
                      {heldLong>0 && <span style={{ color:s.color }}>L ×{heldLong}</span>}
                      {heldShort>0 && <span style={{ color:"#fca5a5" }}>S ×{heldShort}</span>}
                    </div>

                    {/* ── Card action row ── */}
                    <div style={{ display:"flex", gap:5, marginTop:8 }}
                      onClick={e => e.stopPropagation()}>
                      {/* Detail button */}
                      <button
                        onClick={() => setDetailStock(s.ticker)}
                        style={{
                          flex:1, padding:"5px 0", fontSize:9, fontWeight:700,
                          background:"#0f172a", border:`1px solid ${s.color}44`,
                          color:s.color, borderRadius:5, cursor:"pointer", fontFamily:"inherit",
                          letterSpacing:"0.06em"
                        }}>
                        ⬡ DETAILS
                      </button>
                      {/* Quick BUY */}
                      <button
                        onClick={() => execBuy(s.ticker, 1)}
                        disabled={!canQuickBuy}
                        style={{
                          flex:1, padding:"5px 0", fontSize:9, fontWeight:800,
                          background: canQuickBuy ? "#00f5c422" : "#0f172a",
                          border:`1px solid ${canQuickBuy ? "#00f5c4" : "#1e293b"}`,
                          color: canQuickBuy ? "#00f5c4" : "#334155",
                          borderRadius:5, cursor: canQuickBuy ? "pointer" : "not-allowed",
                          fontFamily:"inherit"
                        }}>
                        ▲ BUY
                      </button>
                      {/* Quick SELL */}
                      <button
                        onClick={() => execSell(s.ticker, 1)}
                        disabled={!canQuickSell}
                        style={{
                          flex:1, padding:"5px 0", fontSize:9, fontWeight:800,
                          background: canQuickSell ? "#ef444422" : "#0f172a",
                          border:`1px solid ${canQuickSell ? "#ef4444" : "#1e293b"}`,
                          color: canQuickSell ? "#ef4444" : "#334155",
                          borderRadius:5, cursor: canQuickSell ? "pointer" : "not-allowed",
                          fontFamily:"inherit"
                        }}>
                        ▼ SELL
                      </button>
                      <button
                        onClick={() => heldShort > 0 ? execCover(s.ticker, 1) : execShort(s.ticker, 1)}
                        disabled={!canQuickAlt}
                        style={{
                          flex:1, padding:"5px 0", fontSize:9, fontWeight:800,
                          background: canQuickAlt ? (heldShort > 0 ? "#22c55e22" : "#f9731622") : "#0f172a",
                          border:`1px solid ${canQuickAlt ? (heldShort > 0 ? "#22c55e" : "#f97316") : "#1e293b"}`,
                          color: canQuickAlt ? (heldShort > 0 ? "#22c55e" : "#f97316") : "#334155",
                          borderRadius:5, cursor: canQuickAlt ? "pointer" : "not-allowed",
                          fontFamily:"inherit"
                        }}>
                        {heldShort > 0 ? "↗ COVER" : "↘ SHORT"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Trade Panel */}
            {selTicker && selStock && (
              <div style={{ background:"#0a0f1e", border:`1px solid ${selStock.color}55`,
                borderRadius:12, padding:20, marginBottom:12,
                boxShadow:`0 0 30px ${selStock.color}0d` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                  <div>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
                      <span style={{ color:selStock.color, fontWeight:900, fontSize:22 }}>{selTicker}</span>
                      <SectorBadge sectorId={selStock.sectorId} />
                    </div>
                    <div style={{ color:"#64748b", fontSize:12 }}>{selStock.name}</div>
                    {holdings[selTicker] && (
                      <div style={{ marginTop:6, fontSize:11, color:"#475569" }}>
                        Avg cost: {fmtUSD(holdings[selTicker].avgCost)} · {positionSide(holdings[selTicker]) === "short" ? "Short" : "Long"}: {Math.abs(holdings[selTicker].qty)} shares
                        · Unrealized: {' '}
                        <span style={{ color:((prices[selTicker]-holdings[selTicker].avgCost)*holdings[selTicker].qty)>=0?"#00f5c4":"#ef4444", fontWeight:700 }}>
                          {fmtUSD((prices[selTicker]-holdings[selTicker].avgCost)*holdings[selTicker].qty)}
                          {' '}({(((prices[selTicker]-holdings[selTicker].avgCost)/holdings[selTicker].avgCost)*holdings[selTicker].qty) >= 0 ? "+" : ""}{fmt(Math.abs(((prices[selTicker]-holdings[selTicker].avgCost)/holdings[selTicker].avgCost)*100))}%)
                        </span>
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:900, fontSize:26 }}>{fmtUSD(selPrice)}</div>
                    <div style={{ fontSize:11, color:"#64748b" }}>
                      Session: {(() => { const h=history[selTicker]||[],open=h[0]||selPrice,chg=((selPrice-open)/open)*100; return (<span style={{color:chg>=0?"#00f5c4":"#ef4444"}}>{chg>=0?"+":""}{fmt(chg)}%</span>); })()}
                    </div>
                  </div>
                </div>
                <div style={{ marginBottom:14 }}>
                  <Spark data={(history[selTicker]||[]).slice(-50)} color={selStock.color} w={undefined} h={50} />
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                  <div>
                    <div style={{ fontSize:9, color:"#475569", marginBottom:4 }}>QUANTITY</div>
                    <input type="number" min={1} value={orderQty}
                      onChange={e => setOrderQty(Math.max(1,parseInt(e.target.value)||1))}
                      style={{ width:80, padding:"10px 12px", background:"#020817",
                        border:"1px solid #1e293b", color:"#f1f5f9",
                        borderRadius:6, fontSize:15, fontFamily:"inherit" }} />
                  </div>
                  <div style={{ fontSize:12, color:"#475569", alignSelf:"flex-end", paddingBottom:8 }}>
                    = <strong style={{ color:"#f1f5f9" }}>{fmtUSD(buyTotal)}</strong>
                  </div>
                  <div style={{ marginLeft:"auto", display:"flex", gap:8, alignSelf:"flex-end" }}>
                    <button onClick={doBuy} disabled={!canBuy} style={{
                      padding:"11px 32px", background:canBuy?"#00f5c4":"#1e293b",
                      color:canBuy?"#020817":"#334155", border:"none", borderRadius:7,
                      fontWeight:800, cursor:canBuy?"pointer":"not-allowed",
                      fontFamily:"inherit", fontSize:13 }}>BUY</button>
                    <button onClick={doSell} disabled={!canSell} style={{
                      padding:"11px 32px", background:canSell?"#ef4444":"#1e293b",
                      color:canSell?"#fff":"#334155", border:"none", borderRadius:7,
                      fontWeight:800, cursor:canSell?"pointer":"not-allowed",
                      fontFamily:"inherit", fontSize:13 }}>SELL</button>
                    <button onClick={doShort} disabled={!canShort} style={{
                      padding:"11px 24px", background:canShort?"#f97316":"#1e293b",
                      color:canShort?"#fff":"#334155", border:"none", borderRadius:7,
                      fontWeight:800, cursor:canShort?"pointer":"not-allowed",
                      fontFamily:"inherit", fontSize:13 }}>SHORT</button>
                    <button onClick={doCover} disabled={!canCover} style={{
                      padding:"11px 24px", background:canCover?"#22c55e":"#1e293b",
                      color:canCover?"#04130a":"#334155", border:"none", borderRadius:7,
                      fontWeight:800, cursor:canCover?"pointer":"not-allowed",
                      fontFamily:"inherit", fontSize:13 }}>COVER</button>
                  </div>
                </div>
                <div style={{ marginTop:8, fontSize:10, color:"#475569" }}>
                  Cash available: {fmtUSD(cash)}
                  <span style={{ marginLeft:10, color:"#64748b" }}>· Short capacity: {fmtUSD(shortCapacity)}</span>
                  {!canTrade && <span style={{ color:"#ef4444", marginLeft:10 }}>⚠ Trading currently locked</span>}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── PORTFOLIO TAB ── */}
        {tab === "portfolio" && (
          <div>
            {/* Stock detail modal accessible from portfolio too */}
            {detailStock && (() => {
              const ds = ALL_STOCKS.find(x => x.ticker === detailStock);
              const dsec = SECTORS.find(x => x.id === ds?.sectorId);
              return (
                <StockDetailModal
                  stock={ds} sector={dsec}
                  price={prices[detailStock]||0}
                  prevPrice={prevPrices[detailStock]||0}
                  history={history[detailStock]||[]}
                  holdings={holdings} cash={cash} canTrade={canTrade}
                  shortCapacity={shortCapacity}
                  onBuy={execBuy} onSell={execSell}
                  onShort={execShort} onCover={execCover}
                  onClose={() => setDetailStock(null)}
                  transactions={transactions}
                  aiLog={aiLog}
                />
              );
            })()}
            {/* Summary cards */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:20 }}>
              {[
                { l:"TOTAL VALUE",    v:fmtUSD(totalVal),              c:"#f1f5f9" },
                { l:"CASH",          v:fmtUSD(cash),                   c:"#38bdf8" },
                { l:"UNREALIZED P&L",v:(analytics.totalUnrealized>=0?"+":"")+fmtUSD(analytics.totalUnrealized), c:analytics.totalUnrealized>=0?"#00f5c4":"#ef4444" },
                { l:"REALIZED P&L",  v:(analytics.totalRealized>=0?"+":"")+fmtUSD(analytics.totalRealized), c:analytics.totalRealized>=0?"#00f5c4":"#ef4444" },
              ].map(c => (
                <div key={c.l} style={{ background:"#0a0f1e", border:"1px solid #111827", borderRadius:10, padding:"14px 16px" }}>
                  <div style={{ fontSize:9, color:"#334155", letterSpacing:"0.12em", marginBottom:6 }}>{c.l}</div>
                  <div style={{ fontWeight:800, fontSize:18, color:c.c }}>{c.v}</div>
                </div>
              ))}
            </div>

            {/* Score breakdown */}
            {(() => {
              const uniqueSectors = new Set(Object.keys(holdings).map(t=>ALL_STOCKS.find(s=>s.ticker===t)?.sectorId).filter(Boolean)).size;
              const closedTrades  = transactions.filter(t=>t.type==="SELL" || t.type==="COVER").length;
              const entry = {
                total: totalVal, cash,
                uniqueSectors,
                closedTrades,
                wins:        analytics.wins,
                maxDrawdown: Math.max(1, maxDrawdown),
                predTotal:   predCorrectCount.current.total,
                predCorrect: predCorrectCount.current.correct,
                beta:        calcPortfolioBeta(holdings, prices, history),
                ballReturn:  calcBallReturn(prices),
                roundReturns:[],
              };
              const sc = calcScore(entry, initCash);

              const TierHeader = ({ label, color, pts, max }) => (
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                  marginBottom:8, paddingBottom:6, borderBottom:`1px solid ${color}22` }}>
                  <span style={{ fontSize:9, fontWeight:800, color, letterSpacing:"0.12em" }}>{label}</span>
                  <span style={{ fontSize:12, fontWeight:800, color }}>
                    {fmt(pts, 1)} <span style={{ fontSize:9, color:"#475569" }}>/ {max} pts</span>
                  </span>
                </div>
              );

              const Row = ({ label, formula, value, pts, max, color }) => {
                const pct = Math.min(100, (pts / max) * 100);
                return (
                  <div style={{ marginBottom:8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                      <div>
                        <span style={{ fontSize:10, color:"#94a3b8", fontWeight:700 }}>{label}</span>
                        <span style={{ fontSize:9, color:"#334155", marginLeft:6 }}>{formula}</span>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <span style={{ fontSize:11, fontWeight:800, color }}>{value}</span>
                        <span style={{ fontSize:9, color:"#475569", marginLeft:6 }}>{fmt(pts,1)}/{max}pt</span>
                      </div>
                    </div>
                    <div style={{ height:4, background:"#0f172a", borderRadius:2 }}>
                      <div style={{ width:`${pct}%`, height:"100%", background:color,
                        borderRadius:2, transition:"width 0.6s",
                        boxShadow:`0 0 6px ${color}88` }} />
                    </div>
                  </div>
                );
              };

              return (
                <div style={{ background:"linear-gradient(135deg,#0a0f1e,#060c18)",
                  border:"1px solid #111827", borderRadius:12, padding:16, marginBottom:20 }}>

                  {/* Title + total */}
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                    <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.12em" }}>YOUR SCORE BREAKDOWN</div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                      <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:28, color:"#fbbf24" }}>
                        {fmt(sc.score, 1)}
                      </span>
                      <span style={{ fontSize:10, color:"#475569" }}>/ 100 pts</span>
                    </div>
                  </div>

                  {/* Tier bars at top */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6, marginBottom:16 }}>
                    {[
                      { l:"PERFORMANCE",     pts:sc.tier1, max:50, c:"#00f5c4" },
                      { l:"RISK MGMT",       pts:sc.tier2, max:30, c:"#a78bfa" },
                      { l:"TRADING QUALITY", pts:sc.tier3, max:20, c:"#fbbf24" },
                    ].map(t => (
                      <div key={t.l} style={{ background:"#020817", borderRadius:8, padding:"10px 12px", textAlign:"center" }}>
                        <div style={{ fontSize:8, color:"#475569", letterSpacing:"0.1em", marginBottom:4 }}>{t.l}</div>
                        <div style={{ fontSize:20, fontWeight:800, color:t.c }}>{fmt(t.pts,1)}</div>
                        <div style={{ fontSize:9, color:"#334155" }}>/ {t.max} pts</div>
                        <div style={{ height:3, background:"#0f172a", borderRadius:2, marginTop:6 }}>
                          <div style={{ width:`${(t.pts/t.max)*100}%`, height:"100%",
                            background:t.c, borderRadius:2, transition:"width 0.6s" }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Tier 1 — Performance */}
                  <div style={{ background:"#020817", borderRadius:10, padding:"12px 14px", marginBottom:8 }}>
                    <TierHeader label="TIER 1 — PERFORMANCE" color="#00f5c4" pts={sc.tier1} max={50} />
                    <Row label="Absolute Return"   formula="(total − start) / start"  value={`${sc.absoluteReturn >= 0 ? "+" : ""}${fmt(sc.absoluteReturn)}%`} pts={sc.t1a} max={15} color="#00f5c4" />
                    <Row label="Sharpe Proxy"      formula="return / max drawdown"     value={fmt(sc.sharpe, 2)}                                                pts={sc.t1b} max={15} color="#34d399" />
                    <Row label="Alpha vs Market"   formula="return − BALL index"       value={`${sc.alpha >= 0 ? "+" : ""}${fmt(sc.alpha)}%`}                   pts={sc.t1c} max={12} color="#6ee7b7" />
                    <Row label="Round Consistency" formula="geometric mean of rounds"  value={`${sc.consistency >= 0 ? "+" : ""}${fmt(sc.consistency)}%`}        pts={sc.t1d} max={8}  color="#a7f3d0" />
                  </div>

                  {/* Tier 2 — Risk */}
                  <div style={{ background:"#020817", borderRadius:10, padding:"12px 14px", marginBottom:8 }}>
                    <TierHeader label="TIER 2 — RISK MANAGEMENT" color="#a78bfa" pts={sc.tier2} max={30} />
                    <Row label="Max Drawdown"   formula="inverse: lower DD = more pts"  value={`${fmt(sc.maxDrawdown, 1)}% DD`}  pts={sc.t2a} max={10} color="#a78bfa" />
                    <Row label="Calmar Ratio"   formula="return / max drawdown"         value={fmt(sc.calmar, 2)}                pts={sc.t2b} max={10} color="#c4b5fd" />
                    <Row label="Portfolio Beta" formula="cov(asset, BALL) / var(BALL)"  value={fmt(sc.beta, 2)}                  pts={sc.t2c} max={10} color="#ddd6fe" />
                  </div>

                  {/* Tier 3 — Trading Quality */}
                  <div style={{ background:"#020817", borderRadius:10, padding:"12px 14px" }}>
                    <TierHeader label="TIER 3 — TRADING QUALITY" color="#fbbf24" pts={sc.tier3} max={20} />
                    <Row label="Win Rate"         formula="wins / closed trades"    value={`${fmt(sc.winRate, 0)}%`}              pts={sc.t3a} max={8} color="#fbbf24" />
                    <Row label="Diversification"  formula="unique sectors held / 9"  value={`${sc.sectors} / 9 sectors`}          pts={sc.t3b} max={7} color="#fcd34d" />
                    <Row label="Prediction Acc."  formula="correct econ. questions"  value={`${entry.predCorrect}/${entry.predTotal || "—"}`} pts={sc.t3c} max={5} color="#fde68a" />
                  </div>

                </div>
              );
            })()}

            {/* Open Positions by sector */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.12em", marginBottom:12 }}>OPEN POSITIONS</div>
              {Object.keys(holdings).length === 0 ? (
                <div style={{ color:"#334155", fontSize:12, padding:"12px 0" }}>No open positions. Go to Market tab to start trading.</div>
              ) : (
                SECTORS.map(sec => {
                  const secHoldings = Object.entries(analytics.openPnL).filter(([t]) => ALL_STOCKS.find(s=>s.ticker===t)?.sectorId===sec.id);
                  if (!secHoldings.length) return null;
                  return (
                    <div key={sec.id} style={{ marginBottom:12 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                        <span style={{ fontSize:12 }}>{sec.icon}</span>
                        <span style={{ fontSize:11, color:sec.color, fontWeight:700 }}>{sec.label}</span>
                        <div style={{ flex:1, height:1, background:"#111827" }} />
                      </div>
                      {secHoldings.map(([ticker, pos]) => {
                        const stk = ALL_STOCKS.find(s=>s.ticker===ticker);
                        const pct = analytics.grossExposure>0 ? clamp((Math.abs(pos.value)/analytics.grossExposure)*100,0,100):0;
                        return (
                          <div key={ticker} style={{ background:"#0a0f1e", border:"1px solid #111827",
                            borderRadius:10, padding:"12px 14px", marginBottom:6 }}>
                            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:8 }}>
                              <div>
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <span style={{ color:sec.color, fontWeight:800, fontSize:14 }}>{ticker}</span>
                                  <span style={{ fontSize:10, color:pos.side==="short"?"#fca5a5":"#475569" }}>
                                    {pos.side === "short" ? "Short" : "Long"} {Math.abs(pos.qty)} shares
                                  </span>
                                </div>
                                <div style={{ fontSize:10, color:"#334155" }}>{stk?.name}</div>
                              </div>
                              <div style={{ textAlign:"right" }}>
                                <div style={{ fontWeight:700, fontSize:15 }}>{fmtUSD(pos.value)}</div>
                                <div style={{ fontSize:11, fontWeight:700,
                                  color:pos.unrealized>=0?"#00f5c4":"#ef4444" }}>
                                  {pos.unrealized>=0?"▲ +":"▼ "}{fmtUSD(Math.abs(pos.unrealized))}
                                  {' '}({pos.pct>=0?"+":""}{fmt(pos.pct)}%)
                                </div>
                              </div>
                            </div>
                            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6, marginBottom:6, fontSize:10 }}>
                              <div style={{ color:"#64748b" }}>Avg Cost: <span style={{ color:"#94a3b8" }}>{fmtUSD(pos.avgCost)}</span></div>
                              <div style={{ color:"#64748b" }}>Cur Price: <span style={{ color:"#94a3b8" }}>{fmtUSD(pos.curPrice)}</span></div>
                              <div style={{ color:"#64748b" }}>Weight: <span style={{ color:"#94a3b8" }}>{fmt(pct)}%</span></div>
                            </div>
                            <div style={{ height:3, background:"#1e293b", borderRadius:2 }}>
                              <div style={{ width:`${pct}%`, height:"100%",
                                background:pos.unrealized>=0?sec.color:"#ef4444",
                                borderRadius:2, transition:"width 0.6s" }} />
                            </div>
                            {/* Position actions */}
                            <div style={{ display:"flex", gap:6, marginTop:10 }}>
                              <button onClick={() => { setDetailStock(ticker); setTab("market"); }}
                                style={{ flex:1, padding:"6px 0", fontSize:9, fontWeight:700,
                                  background:"#0f172a", border:`1px solid ${sec.color}44`,
                                  color:sec.color, borderRadius:5, cursor:"pointer", fontFamily:"inherit" }}>
                                ⬡ VIEW DETAILS
                              </button>
                              {pos.side === "short" ? (
                                <>
                                  <button onClick={() => execCover(ticker, 1)} disabled={!canTrade || cash < (prices[ticker]||0)}
                                    style={{ flex:1, padding:"6px 0", fontSize:9, fontWeight:800,
                                      background: canTrade && cash>=(prices[ticker]||0) ? "#22c55e22":"#0f172a",
                                      border:`1px solid ${canTrade && cash>=(prices[ticker]||0) ? "#22c55e":"#1e293b"}`,
                                      color: canTrade && cash>=(prices[ticker]||0) ? "#22c55e":"#334155",
                                      borderRadius:5, cursor: canTrade && cash>=(prices[ticker]||0) ? "pointer":"not-allowed",
                                      fontFamily:"inherit" }}>↗ COVER 1</button>
                                  <button onClick={() => execCover(ticker, Math.abs(pos.qty))} disabled={!canTrade || cash < ((prices[ticker]||0) * Math.abs(pos.qty))}
                                    style={{ flex:1, padding:"6px 0", fontSize:9, fontWeight:800,
                                      background: canTrade ? "#14532d33":"#0f172a",
                                      border:`1px solid ${canTrade ? "#22c55e":"#1e293b"}`,
                                      color: canTrade ? "#bbf7d0":"#334155",
                                      borderRadius:5, cursor: canTrade ? "pointer":"not-allowed",
                                      fontFamily:"inherit" }}>✕ COVER ALL</button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => execBuy(ticker, 1)} disabled={!canTrade || cash < (prices[ticker]||0)}
                                    style={{ flex:1, padding:"6px 0", fontSize:9, fontWeight:800,
                                      background: canTrade && cash>=(prices[ticker]||0) ? "#00f5c422":"#0f172a",
                                      border:`1px solid ${canTrade && cash>=(prices[ticker]||0) ? "#00f5c4":"#1e293b"}`,
                                      color: canTrade && cash>=(prices[ticker]||0) ? "#00f5c4":"#334155",
                                      borderRadius:5, cursor: canTrade && cash>=(prices[ticker]||0) ? "pointer":"not-allowed",
                                      fontFamily:"inherit" }}>▲ BUY 1</button>
                                  <button onClick={() => execSell(ticker, 1)} disabled={!canTrade}
                                    style={{ flex:1, padding:"6px 0", fontSize:9, fontWeight:800,
                                      background: canTrade ? "#ef444422":"#0f172a",
                                      border:`1px solid ${canTrade ? "#ef4444":"#1e293b"}`,
                                      color: canTrade ? "#ef4444":"#334155",
                                      borderRadius:5, cursor: canTrade ? "pointer":"not-allowed",
                                      fontFamily:"inherit" }}>▼ SELL 1</button>
                                  <button onClick={() => execSell(ticker, pos.qty)} disabled={!canTrade}
                                    style={{ flex:1, padding:"6px 0", fontSize:9, fontWeight:800,
                                      background: canTrade ? "#7f1d1d33":"#0f172a",
                                      border:`1px solid ${canTrade ? "#ef4444":"#1e293b"}`,
                                      color: canTrade ? "#fca5a5":"#334155",
                                      borderRadius:5, cursor: canTrade ? "pointer":"not-allowed",
                                      fontFamily:"inherit" }}>✕ SELL ALL</button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>

            {/* Transaction History */}
            <div>
              <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.12em", marginBottom:12 }}>
                TRANSACTION HISTORY ({transactions.length} trades)
              </div>
              {transactions.length === 0 ? (
                <div style={{ color:"#334155", fontSize:12 }}>No transactions yet.</div>
              ) : (
                <div style={{ background:"#0a0f1e", border:"1px solid #111827", borderRadius:12, overflow:"hidden" }}>
                  {/* Table header */}
                  <div style={{ display:"grid",
                    gridTemplateColumns:"80px 70px 90px 80px 80px 80px 80px 100px",
                    gap:0, padding:"10px 14px", background:"#060c18",
                    fontSize:9, color:"#334155", letterSpacing:"0.1em", borderBottom:"1px solid #111827" }}>
                    {["TIME","TYPE","TICKER","QTY","PRICE","AVG COST","P&L","P&L %"].map(h => (
                      <div key={h}>{h}</div>
                    ))}
                  </div>
                  <div style={{ maxHeight:400, overflowY:"auto" }}>
                    {transactions.map((tx, i) => {
                      const stk = ALL_STOCKS.find(s => s.ticker===tx.ticker);
                      const isClosed = tx.type==="SELL" || tx.type==="COVER";
                      const isBearish = tx.type==="SELL" || tx.type==="SHORT";
                      return (
                        <div key={tx.id||i} style={{
                          display:"grid",
                          gridTemplateColumns:"80px 70px 90px 80px 80px 80px 80px 100px",
                          gap:0, padding:"10px 14px",
                          borderBottom:"1px solid #060c18",
                          background:i%2===0?"#0a0f1e":"#080d18",
                          fontSize:11, alignItems:"center"
                        }}>
                          <div style={{ color:"#475569", fontSize:9 }}>{tx.time}</div>
                          <div style={{ fontWeight:700,
                            color:isBearish?"#ef4444":"#00f5c4" }}>
                            {tx.type}
                          </div>
                          <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                            <span style={{ color:stk?.color||"#94a3b8", fontWeight:700 }}>{tx.ticker}</span>
                            <SectorBadge sectorId={tx.sectorId} small />
                          </div>
                          <div style={{ color:"#94a3b8" }}>{tx.qty}</div>
                          <div style={{ color:"#f1f5f9", fontWeight:600 }}>{fmtUSD(tx.price)}</div>
                          <div style={{ color:"#64748b" }}>
                            {tx.type==="SELL" ? fmtUSD(tx.avgCostAtSell||0)
                              : tx.type==="COVER" ? fmtUSD(tx.avgCostAtCover||0)
                              : tx.type==="SHORT" ? fmtUSD(tx.avgCostAtShort||tx.price)
                              : fmtUSD(tx.avgCostAtBuy||tx.price)}
                          </div>
                          <div style={{ color:isClosed?(tx.gain>=0?"#00f5c4":"#ef4444"):"#475569", fontWeight:700 }}>
                            {isClosed ? (tx.gain>=0?"+":"")+fmtUSD(tx.gain||0) : "—"}
                          </div>
                          <div style={{ color:isClosed?(tx.gainPct>=0?"#00f5c4":"#ef4444"):"#475569", fontWeight:700 }}>
                            {isClosed ? (tx.gainPct>=0?"+":"")+fmt(tx.gainPct||0)+"%" : "—"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Realized P&L summary */}
                  {analytics.totalRealized !== 0 && (
                    <div style={{ padding:"10px 14px", borderTop:"1px solid #111827",
                      display:"flex", justifyContent:"space-between", alignItems:"center",
                      background:"#060c18" }}>
                      <span style={{ fontSize:10, color:"#475569" }}>
                        {analytics.wins}W / {analytics.losses}L on {transactions.filter(t=>t.type==="SELL" || t.type==="COVER").length} closed trades
                      </span>
                      <span style={{ fontSize:12, fontWeight:800,
                        color:analytics.totalRealized>=0?"#00f5c4":"#ef4444" }}>
                        Realized P&L: {analytics.totalRealized>=0?"+":""}{fmtUSD(analytics.totalRealized)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── LEADERBOARD TAB ── */}
        {tab === "leaderboard" && (
          <div style={{ maxWidth:700 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.1em" }}>
                COMPETITION LEADERBOARD · R{roundNum}/{TOTAL_ROUNDS}
              </div>
              <div style={{ fontSize:9, color:"#334155" }}>
                9-indicator composite score
              </div>
            </div>
            <LeaderboardPanel entries={sharedLB} teams={teams} initCash={initCash}
              highlight={currentTeam?.name} showDetail />
          </div>
        )}

        {/* ── NEWS TAB ── */}
        {tab === "news" && (
          <div style={{ maxWidth:640 }}>
            <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.12em", marginBottom:14 }}>
              AI MARKET NEWS FEED
            </div>
            {news.length === 0 ? (
              <div style={{ color:"#334155", fontSize:12 }}>News will appear as stocks move…</div>
            ) : news.map((n, i) => {
              const stk = ALL_STOCKS.find(s=>s.ticker===n.ticker);
              return (
                <div key={i} style={{ borderLeft:`3px solid ${n.sentiment==="bull"?"#00f5c4":"#ef4444"}`,
                  paddingLeft:12, marginBottom:16, paddingBottom:16, borderBottom:"1px solid #0f172a" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                    <span style={{ color:stk?.color||"#94a3b8", fontWeight:800 }}>{n.ticker}</span>
                    <SectorBadge sectorId={n.sectorId} small />
                    {n.tag && (
                      <span style={{ fontSize:8, padding:"1px 6px", borderRadius:4,
                        background:"#0f172a", border:"1px solid #1e293b", color:"#94a3b8",
                        letterSpacing:"0.08em" }}>
                        {n.tag}
                      </span>
                    )}
                    <span style={{ color:"#475569", fontSize:10 }}>{n.time}</span>
                  </div>
                  <div style={{ fontSize:13, color:"#e2e8f0", lineHeight:1.5, fontWeight:500 }}>{n.headline}</div>
                  {n.detail && <div style={{ fontSize:11, color:"#64748b", marginTop:6, lineHeight:1.5 }}>{n.detail}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}




// ─── BROADCAST INLINE (avoiding hook-in-callback issue) ───────────────────────
function ManualDisruption({ stocks, prices, onPublish }) {
  const empty = () => ({ ticker: stocks[0]?.ticker || "", impact: 15, headline: "", detail: "" });
  const [entries, setEntries] = useState([empty()]);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  const upd = (i, field, val) =>
    setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));

  const add    = () => setEntries(prev => [...prev, empty()]);
  const remove = i  => setEntries(prev => prev.filter((_, idx) => idx !== i));

  async function handlePublish() {
    const valid = entries.filter(e => e.ticker && e.headline.trim());
    if (!valid.length) return;
    setPublishing(true);
    const events = valid.map(e => ({
      ticker:   e.ticker,
      headline: e.headline.trim(),
      detail:   e.detail.trim(),
      impact:   Number(e.impact) || 0,
    }));
    await onPublish(events);
    setPublishing(false);
    setPublished(true);
    setTimeout(() => setPublished(false), 3000);
  }

  const inputStyle = {
    width:"100%", padding:"7px 9px", background:"#020817",
    border:"1px solid #1e293b", color:"#f1f5f9",
    borderRadius:5, fontFamily:"inherit", fontSize:11, outline:"none"
  };
  const labelStyle = { fontSize:8, color:"#475569", letterSpacing:"0.1em", marginBottom:3 };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {entries.map((entry, i) => {
        const stk = stocks.find(s => s.ticker === entry.ticker);
        const isPos = Number(entry.impact) >= 0;
        return (
          <div key={i} style={{
            background:"#0a0f1e",
            border:`1px solid ${isPos ? "#00f5c430" : "#ef444430"}`,
            borderLeft:`3px solid ${isPos ? "#00f5c4" : "#ef4444"}`,
            borderRadius:8, padding:"10px 12px"
          }}>
            {/* Row 1: Ticker + Impact */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:6, marginBottom:8 }}>
              <div>
                <div style={labelStyle}>TICKER</div>
                <select value={entry.ticker}
                  onChange={e => upd(i, "ticker", e.target.value)}
                  style={{ ...inputStyle, cursor:"pointer" }}>
                  {stocks.map(s => (
                    <option key={s.ticker} value={s.ticker}
                      style={{ background:"#0f172a" }}>
                      {s.ticker} — {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={labelStyle}>IMPACT %</div>
                <div style={{ display:"flex", gap:4 }}>
                  {[-30,-15,-10,10,15,30].map(v => (
                    <button key={v} onClick={() => upd(i,"impact",v)}
                      style={{
                        flex:1, padding:"5px 0", fontSize:9, fontWeight:800,
                        background: entry.impact===v ? (v>0?"#00f5c422":"#ef444422") : "#0f172a",
                        border:`1px solid ${entry.impact===v ? (v>0?"#00f5c4":"#ef4444") : "#1e293b"}`,
                        color: v>0?"#00f5c4":"#ef4444",
                        borderRadius:4, cursor:"pointer", fontFamily:"inherit"
                      }}>
                      {v>0?"+":""}{v}%
                    </button>
                  ))}
                </div>
                <input type="number" value={entry.impact}
                  onChange={e => upd(i,"impact",e.target.value)}
                  style={{ ...inputStyle, marginTop:4 }}
                  placeholder="Custom %…"/>
              </div>
              <div style={{ display:"flex", alignItems:"flex-end", paddingBottom:2 }}>
                {entries.length > 1 && (
                  <button onClick={() => remove(i)}
                    style={{ width:28, height:28, background:"#7f1d1d", border:"none",
                      borderRadius:5, color:"#fca5a5", cursor:"pointer",
                      fontSize:13, fontFamily:"inherit" }}>✕</button>
                )}
              </div>
            </div>
            {/* Row 2: Headline */}
            <div style={{ marginBottom:6 }}>
              <div style={labelStyle}>HEADLINE <span style={{ color:"#334155" }}>(max 15 words)</span></div>
              <input value={entry.headline}
                onChange={e => upd(i,"headline",e.target.value)}
                placeholder={isPos
                  ? `${stk?.name || entry.ticker} surges on major breakthrough…`
                  : `${stk?.name || entry.ticker} crashes amid crisis…`}
                style={{ ...inputStyle, border:`1px solid ${entry.headline ? "#334155" : "#1e293b"}` }}
              />
            </div>
            {/* Row 3: Detail */}
            <div>
              <div style={labelStyle}>DETAIL <span style={{ color:"#334155" }}>(optional context)</span></div>
              <input value={entry.detail}
                onChange={e => upd(i,"detail",e.target.value)}
                placeholder="One sentence of context for players…"
                style={inputStyle}
              />
            </div>
          </div>
        );
      })}

      {/* Add entry */}
      <button onClick={add}
        style={{ padding:"7px", background:"#0f172a",
          border:"1px solid #1e293b", borderRadius:6,
          color:"#475569", cursor:"pointer", fontFamily:"inherit",
          fontSize:10, fontWeight:700 }}>
        + ADD ANOTHER STOCK
      </button>

      {/* Publish */}
      <button onClick={handlePublish} disabled={publishing || !entries.some(e=>e.headline.trim())}
        style={{
          padding:"10px", fontWeight:800, fontSize:11, letterSpacing:"0.06em",
          background: published
            ? "linear-gradient(135deg,#166534,#15803d)"
            : "linear-gradient(135deg,#7f1d1d,#dc2626)",
          border:"none", borderRadius:7, color:"#fff",
          cursor: publishing ? "wait" : "pointer", fontFamily:"inherit",
          opacity: !entries.some(e=>e.headline.trim()) ? 0.4 : 1,
          transition:"all 0.3s"
        }}>
        {published ? "✓ DISRUPTION PUBLISHED!" : publishing ? "⏳ PUBLISHING…" : "🚨 PUBLISH DISRUPTION NEWS"}
      </button>
    </div>
  );
}


function BroadcastInline({ onSend }) {
  const [msg, setMsg] = useState("");
  const QUICK = [
    "⚠️ Market volatility ahead — trade carefully!",
    "🏆 Final 3 minutes! Lock in your positions.",
    "📊 Leaderboard updated — check your rank!",
    "🔔 Disruption news incoming — watch for shocks!",
    "🚨 Round ending soon — review your portfolio!",
  ];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
      <textarea value={msg} onChange={e=>setMsg(e.target.value)} placeholder="Custom message…" rows={3}
        style={{ width:"100%", padding:"9px 11px", background:"#0f172a", border:"1px solid #1e293b",
          color:"#f1f5f9", borderRadius:7, fontFamily:"inherit", fontSize:12, resize:"vertical" }} />
      <button onClick={()=>{if(msg.trim()){onSend(msg.trim());setMsg("");}}}
        style={{ padding:"9px", background:"#0c4a6e", border:"1px solid #38bdf8", borderRadius:6,
          color:"#38bdf8", cursor:"pointer", fontFamily:"inherit", fontSize:11, fontWeight:700 }}>
        📢 SEND BROADCAST
      </button>
      <div style={{ fontSize:9, color:"#334155", marginTop:2, marginBottom:2 }}>QUICK ALERTS</div>
      {QUICK.map(q => (
        <button key={q} onClick={()=>onSend(q)}
          style={{ padding:"7px 10px", background:"#0f172a", border:"1px solid #1e293b",
            borderRadius:5, color:"#94a3b8", cursor:"pointer",
            textAlign:"left", fontFamily:"inherit", fontSize:10 }}>{q}</button>
      ))}
    </div>
  );
}
