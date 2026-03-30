const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE_FILE = path.join(__dirname, "stock-market-sim-v6.jsx");

function extractConstExpression(source, name) {
  const marker = new RegExp(`const\\s+${name}\\s*=`);
  const match = marker.exec(source);
  if (!match) {
    throw new Error(`Unable to find constant ${name} in source.`);
  }

  let index = match.index + match[0].length;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  const opener = source[index];

  if (opener === "[" || opener === "{") {
    const closer = opener === "[" ? "]" : "}";
    let depth = 0;
    let inString = null;
    let inBlockComment = false;
    let inLineComment = false;
    let escape = false;

    for (let cursor = index; cursor < source.length; cursor += 1) {
      const char = source[cursor];
      const next = source[cursor + 1];

      if (inLineComment) {
        if (char === "\n") inLineComment = false;
        continue;
      }

      if (inBlockComment) {
        if (char === "*" && next === "/") {
          inBlockComment = false;
          cursor += 1;
        }
        continue;
      }

      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (char === "\\") {
          escape = true;
          continue;
        }
        if (char === inString) {
          inString = null;
        }
        continue;
      }

      if ((char === "'" || char === "\"" || char === "`")) {
        inString = char;
        continue;
      }

      if (char === "/" && next === "/") {
        inLineComment = true;
        cursor += 1;
        continue;
      }

      if (char === "/" && next === "*") {
        inBlockComment = true;
        cursor += 1;
        continue;
      }

      if (char === opener) depth += 1;
      if (char === closer) {
        depth -= 1;
        if (depth === 0) {
          return source.slice(index, cursor + 1);
        }
      }
    }

    throw new Error(`Unable to extract bracketed constant ${name}.`);
  }

  const end = source.indexOf(";", index);
  if (end < 0) {
    throw new Error(`Unable to find terminator for constant ${name}.`);
  }
  return source.slice(index, end).trim();
}

function evaluateExpression(expression) {
  return vm.runInNewContext(expression, {}, { timeout: 1000 });
}

const SOURCE = fs.readFileSync(SOURCE_FILE, "utf8");

const INITIAL_CASH = Number(evaluateExpression(extractConstExpression(SOURCE, "INITIAL_CASH")));
const TICK_MS = Number(evaluateExpression(extractConstExpression(SOURCE, "TICK_MS")));
const HISTORY_LEN = Number(evaluateExpression(extractConstExpression(SOURCE, "HISTORY_LEN")));
const CRISIS_ROUNDS = evaluateExpression(extractConstExpression(SOURCE, "CRISIS_ROUNDS"));
const DEFAULT_ROUND_DURATIONS = evaluateExpression(extractConstExpression(SOURCE, "DEFAULT_ROUND_DURATIONS"));
const ROUND_RULES = evaluateExpression(extractConstExpression(SOURCE, "ROUND_RULES"));
const BASE_SPREAD_RATE = Number(evaluateExpression(extractConstExpression(SOURCE, "BASE_SPREAD_RATE")));
const MARGIN_CALL_GRACE_SECS = Number(evaluateExpression(extractConstExpression(SOURCE, "MARGIN_CALL_GRACE_SECS")));
const DERIVATIVE_FUTURE_WEIGHT = Number(evaluateExpression(extractConstExpression(SOURCE, "DERIVATIVE_FUTURE_WEIGHT")));
const DERIVATIVE_DEFAULT_MULTIPLIER = Number(evaluateExpression(extractConstExpression(SOURCE, "DERIVATIVE_DEFAULT_MULTIPLIER")));
const DERIVATIVE_OPTION_SPREAD_MULT = Number(evaluateExpression(extractConstExpression(SOURCE, "DERIVATIVE_OPTION_SPREAD_MULT")));
const DERIVATIVE_FUTURE_SPREAD_MULT = Number(evaluateExpression(extractConstExpression(SOURCE, "DERIVATIVE_FUTURE_SPREAD_MULT")));
const DERIVATIVE_OPTION_STRIKE_STEPS = evaluateExpression(extractConstExpression(SOURCE, "DERIVATIVE_OPTION_STRIKE_STEPS"));
const DERIVATIVE_STRATEGY_PRESETS = evaluateExpression(extractConstExpression(SOURCE, "DERIVATIVE_STRATEGY_PRESETS"));
const DERIVATIVE_SHORT_OPTION_WEIGHT = Number(evaluateExpression(extractConstExpression(SOURCE, "DERIVATIVE_SHORT_OPTION_WEIGHT")));
const DERIVATIVE_SHORT_OPTION_PREMIUM_MULT = Number(evaluateExpression(extractConstExpression(SOURCE, "DERIVATIVE_SHORT_OPTION_PREMIUM_MULT")));
const DERIVATIVE_SHORT_OPTION_OTM_CREDIT = Number(evaluateExpression(extractConstExpression(SOURCE, "DERIVATIVE_SHORT_OPTION_OTM_CREDIT")));
const SECTORS = evaluateExpression(extractConstExpression(SOURCE, "SECTORS"));

const ALL_STOCKS = SECTORS.flatMap(sector =>
  (sector.stocks || []).map(stock => ({
    ...stock,
    sectorId: sector.id,
    sectorLabel: sector.label,
    color: sector.color,
    sectorIcon: sector.icon,
  }))
);

const BALL_BASE = ALL_STOCKS.find(stock => stock.ticker === "BALL")?.basePrice || 155;
const TOTAL_ROUNDS = ROUND_RULES.length;
const TEAM_STATE_PREFIX = "secure:teamState:";

function createEmptyScoreLedger() {
  return {
    version: 2,
    completedRounds: [],
    maxDrawdownOverall: 0,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fmtNumber(value, digits = 2) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function nowShort() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function nowFull() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function positionSide(position) {
  return (position?.qty || 0) < 0 ? "short" : "long";
}

function longQty(position) {
  return Math.max(0, position?.qty || 0);
}

function shortQty(position) {
  return Math.max(0, -(position?.qty || 0));
}

function grossPositionValue(price, position) {
  return Math.abs((price || position?.avgCost || 0) * (position?.qty || 0));
}

function normalizeLedgerRoundSnapshot(snapshot = {}) {
  return {
    round: Number.isFinite(snapshot.round) ? snapshot.round : null,
    startingCapital: Number.isFinite(snapshot.startingCapital) ? snapshot.startingCapital : null,
    endingValue: Number.isFinite(snapshot.endingValue) ? snapshot.endingValue : null,
    returnPct: Number.isFinite(snapshot.returnPct) ? snapshot.returnPct : 0,
    ballReturn: Number.isFinite(snapshot.ballReturn) ? snapshot.ballReturn : 0,
    assetBeta: Number.isFinite(snapshot.assetBeta) ? snapshot.assetBeta : null,
    portfolioBeta: Number.isFinite(snapshot.portfolioBeta) ? snapshot.portfolioBeta : null,
    borrowCost: Number.isFinite(snapshot.borrowCost) ? snapshot.borrowCost : 0,
    fundingCost: Number.isFinite(snapshot.fundingCost) ? snapshot.fundingCost : 0,
    avgMarginBufferPct: Number.isFinite(snapshot.avgMarginBufferPct) ? snapshot.avgMarginBufferPct : 0,
    marginBreaches: Number.isFinite(snapshot.marginBreaches) ? snapshot.marginBreaches : 0,
    closedTrades: Number.isFinite(snapshot.closedTrades) ? snapshot.closedTrades : 0,
    wins: Number.isFinite(snapshot.wins) ? snapshot.wins : 0,
    sectors: Array.isArray(snapshot.sectors) ? snapshot.sectors.filter(Boolean) : [],
    predShown: snapshot.predShown ? 1 : 0,
    predAnswered: snapshot.predAnswered ? 1 : 0,
    predCorrect: snapshot.predCorrect ? 1 : 0,
    lastTradeTs: Number.isFinite(snapshot.lastTradeTs) ? snapshot.lastTradeTs : 0,
  };
}

function sanitizeScoreLedger(rawLedger) {
  if (!rawLedger || typeof rawLedger !== "object") return createEmptyScoreLedger();
  return {
    version: rawLedger.version || 2,
    completedRounds: Array.isArray(rawLedger.completedRounds)
      ? rawLedger.completedRounds.map(normalizeLedgerRoundSnapshot)
      : [],
    maxDrawdownOverall: Number.isFinite(rawLedger.maxDrawdownOverall)
      ? rawLedger.maxDrawdownOverall
      : 0,
  };
}

function finiteValues(values = []) {
  return (values || []).filter(value => Number.isFinite(value));
}

function averageFinite(values = []) {
  const nums = finiteValues(values);
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function compoundPercentSeries(values = []) {
  const nums = finiteValues(values);
  if (!nums.length) return null;
  const compounded = nums.reduce((prod, value) => prod * (1 + value / 100), 1);
  return (compounded - 1) * 100;
}

function geometricMeanPercent(values = []) {
  const nums = finiteValues(values);
  if (!nums.length) return 0;
  const compounded = nums.reduce((prod, value) => prod * (1 + value / 100), 1);
  if (compounded <= 0) return -100;
  return (Math.pow(compounded, 1 / nums.length) - 1) * 100;
}

function uniqueTruthy(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

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
  for (let index = 1; index < series.length; index += 1) {
    const prev = series[index - 1];
    const next = series[index];
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

function calcTickerAssetBeta(ticker, history = {}) {
  if (!ticker) return null;
  if (ticker === "BALL") return 1;
  return calcAssetBetaFromSeries(history?.[ticker] || [], history?.BALL || []);
}

function calcHoldingAssetBetas(holdings = {}, history = {}) {
  return Object.fromEntries(
    Object.entries(holdings)
      .filter(([, position]) => (position?.qty || 0) !== 0)
      .map(([ticker]) => [ticker, calcTickerAssetBeta(ticker, history)])
  );
}

function calcAverageAssetBeta(holdings = {}, prices = {}, history = {}, assetBetas = null) {
  const entries = Object.entries(holdings).filter(([, position]) => (position?.qty || 0) !== 0);
  if (!entries.length) return 0.5;
  const betaMap = assetBetas || calcHoldingAssetBetas(holdings, history);
  const grossExposure = entries.reduce((sum, [ticker, position]) => (
    sum + grossPositionValue(prices[ticker], position)
  ), 0);
  if (grossExposure <= 0) return 0.5;
  let beta = 0;
  let weightedCoverage = 0;
  entries.forEach(([ticker, position]) => {
    const assetBeta = betaMap[ticker];
    if (!Number.isFinite(assetBeta)) return;
    const weight = grossPositionValue(prices[ticker], position) / grossExposure;
    beta += weight * assetBeta;
    weightedCoverage += weight;
  });
  if (weightedCoverage <= 0) return 0.5;
  return beta / weightedCoverage;
}

function calcPortfolioBeta(holdings = {}, prices = {}, history = {}, assetBetas = null) {
  const entries = Object.entries(holdings).filter(([, position]) => (position?.qty || 0) !== 0);
  if (!entries.length) return 0.5;
  const betaMap = assetBetas || calcHoldingAssetBetas(holdings, history);
  const grossExposure = entries.reduce((sum, [ticker, position]) => (
    sum + grossPositionValue(prices[ticker], position)
  ), 0);
  if (grossExposure <= 0) return 0.5;
  let beta = 0;
  let weightedCoverage = 0;
  entries.forEach(([ticker, position]) => {
    const assetBeta = betaMap[ticker];
    if (!Number.isFinite(assetBeta)) return;
    const weight = grossPositionValue(prices[ticker], position) / grossExposure;
    beta += weight * assetBeta * (positionSide(position) === "short" ? -1 : 1);
    weightedCoverage += weight;
  });
  if (weightedCoverage <= 0) return 0.5;
  return beta / weightedCoverage;
}

function calcBallReturn(prices = {}) {
  const ballPrice = prices?.BALL || BALL_BASE;
  return ((ballPrice - BALL_BASE) / BALL_BASE) * 100;
}

function getDerivativeUnderlyings() {
  return ALL_STOCKS;
}

function buildRoundDerivativeBases(prices = {}) {
  return Object.fromEntries(
    getDerivativeUnderlyings().map(stock => [
      stock.ticker,
      prices[stock.ticker] || stock.basePrice || 100,
    ])
  );
}

function calcRoundTimeFraction(timeLeft, roundDur, gamePhase) {
  if (gamePhase !== "running" || !Number.isFinite(timeLeft) || !Number.isFinite(roundDur) || roundDur <= 0) {
    return 0;
  }
  return clamp(timeLeft / roundDur, 0, 1);
}

function getDerivativeContractMultiplier(ticker) {
  return ticker === "BALL" ? 12 : DERIVATIVE_DEFAULT_MULTIPLIER;
}

function normalizeDerivativeStrike(strike) {
  return Math.round(Math.max(0.25, Number(strike) || 0.25) * 100) / 100;
}

function getDerivativeStrikeIncrement(baseStrike) {
  if (baseStrike < 40) return 1;
  if (baseStrike < 90) return 2.5;
  if (baseStrike < 180) return 5;
  if (baseStrike < 350) return 10;
  return 20;
}

function buildDerivativeStrikeLadder(baseStrike) {
  const normalizedBase = normalizeDerivativeStrike(baseStrike);
  const increment = getDerivativeStrikeIncrement(normalizedBase);
  const seen = new Set();
  return DERIVATIVE_OPTION_STRIKE_STEPS.reduce((ladder, step) => {
    const rawStrike = step === 0
      ? normalizedBase
      : Math.max(increment, Math.round((normalizedBase * (1 + step)) / increment) * increment);
    const strike = normalizeDerivativeStrike(rawStrike);
    const key = strike.toFixed(2);
    if (seen.has(key)) return ladder;
    seen.add(key);
    ladder.push({ strike, strikeStep: step });
    return ladder;
  }, []);
}

function formatDerivativeStrikeCode(strike) {
  return Math.round(normalizeDerivativeStrike(strike) * 100);
}

function formatDerivativeStrikeLabel(strike) {
  return normalizeDerivativeStrike(strike).toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(normalizeDerivativeStrike(strike)) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function getDerivativeRiskEquivalent(quote, side = "long") {
  if (!quote) return 0;
  return side === "short"
    ? (quote.shortRiskEquivalent ?? quote.riskEquivalent ?? 0)
    : (quote.longRiskEquivalent ?? quote.riskEquivalent ?? 0);
}

function getDerivativeTradeFlowDirection(kind, side = "long", action = "open") {
  const normalizedAction = action === "close" ? "close" : "open";
  if (kind === "future") {
    const direction = side === "short" ? -1 : 1;
    return normalizedAction === "close" ? -direction : direction;
  }
  const optionDirection = kind === "put" ? -1 : 1;
  const direction = side === "short" ? -optionDirection : optionDirection;
  return normalizedAction === "close" ? -direction : direction;
}

function getDerivativeOpenActionLabel(kind, side = "long") {
  if (kind === "future") return side === "short" ? "FUT SHORT" : "FUT LONG";
  return `${kind.toUpperCase()} ${side === "short" ? "SELL" : "BUY"}`;
}

function makeDerivativeInstrument({ round, kind, stock, strike, strikeStep = null }) {
  const normalizedStrike = normalizeDerivativeStrike(strike);
  const isAtmOption = kind !== "future" && Math.abs(Number(strikeStep || 0)) < 1e-9;
  const labelBase = kind === "future"
    ? `${stock.ticker} Round Future`
    : kind === "call"
      ? `${stock.ticker} Round Call ${formatDerivativeStrikeLabel(normalizedStrike)}`
      : `${stock.ticker} Round Put ${formatDerivativeStrikeLabel(normalizedStrike)}`;
  return {
    id: kind === "future" || isAtmOption
      ? `${kind.toUpperCase()}:${stock.ticker}:R${round}`
      : `${kind.toUpperCase()}:${stock.ticker}:R${round}:K${formatDerivativeStrikeCode(normalizedStrike)}`,
    round,
    kind,
    underlyingTicker: stock.ticker,
    underlyingName: stock.name,
    sectorId: stock.sectorId,
    multiplier: getDerivativeContractMultiplier(stock.ticker),
    strike: normalizedStrike,
    strikeStep: kind === "future" ? null : strikeStep,
    isAtm: kind === "future" ? false : isAtmOption,
    label: labelBase,
  };
}

function calcDerivativeQuote(instrument, {
  prices = {},
  roundRule = null,
  timeLeft = 0,
  roundDur = 1,
  gamePhase = "idle",
} = {}) {
  if (!instrument?.underlyingTicker) return null;
  const underlying = ALL_STOCKS.find(stock => stock.ticker === instrument.underlyingTicker);
  const spot = prices[instrument.underlyingTicker] || instrument.strike || underlying?.basePrice || 100;
  const multiplier = instrument.multiplier || getDerivativeContractMultiplier(instrument.underlyingTicker);
  const timeFrac = calcRoundTimeFraction(timeLeft, roundDur, gamePhase);
  const vol = Math.max(0.65, (underlying?.volatility || 1) * (roundRule?.volMult || 1));
  const baseSpread = BASE_SPREAD_RATE * (roundRule?.spreadMult || 1);

  if (instrument.kind === "future") {
    const carryBasis = spot * (0.0025 * timeFrac * (1 + (vol * 0.6)));
    const mark = Math.max(0.25, spot + carryBasis);
    const bid = Math.max(0.01, mark * (1 - (baseSpread * DERIVATIVE_FUTURE_SPREAD_MULT)));
    const ask = mark * (1 + (baseSpread * DERIVATIVE_FUTURE_SPREAD_MULT));
    const notional = spot * multiplier;
    return {
      mark,
      bid,
      ask,
      spot,
      multiplier,
      notional,
      riskEquivalent: notional * DERIVATIVE_FUTURE_WEIGHT,
      intrinsic: 0,
      timeValue: carryBasis,
    };
  }

  const strike = instrument.strike || spot;
  const intrinsic = instrument.kind === "call"
    ? Math.max(0, spot - strike)
    : Math.max(0, strike - spot);
  const moneyness = Math.exp(-Math.abs(spot - strike) / Math.max(strike, 1));
  const timeValue = spot * (0.014 + (vol * 0.006)) * timeFrac * (0.55 + (moneyness * 0.45));
  const mark = Math.max(0.05, intrinsic + timeValue);
  const bid = Math.max(0.01, mark * (1 - (baseSpread * DERIVATIVE_OPTION_SPREAD_MULT)));
  const ask = mark * (1 + (baseSpread * DERIVATIVE_OPTION_SPREAD_MULT));
  const longRiskEquivalent = ask * multiplier;
  const outOfTheMoney = instrument.kind === "call"
    ? Math.max(0, strike - spot)
    : Math.max(0, spot - strike);
  const shortMarginPerShare = Math.max(
    ask * DERIVATIVE_SHORT_OPTION_PREMIUM_MULT,
    (spot * DERIVATIVE_SHORT_OPTION_WEIGHT) + intrinsic - (outOfTheMoney * DERIVATIVE_SHORT_OPTION_OTM_CREDIT),
    ask * 1.15
  );
  const shortRiskEquivalent = Math.max(
    longRiskEquivalent * DERIVATIVE_SHORT_OPTION_PREMIUM_MULT,
    shortMarginPerShare * multiplier
  );
  return {
    mark,
    bid,
    ask,
    spot,
    strike,
    multiplier,
    notional: spot * multiplier,
    riskEquivalent: longRiskEquivalent,
    longRiskEquivalent,
    shortRiskEquivalent,
    intrinsic,
    timeValue,
  };
}

function buildDerivativeCatalog({
  round,
  prices = {},
  roundRule = null,
  timeLeft = 0,
  roundDur = 1,
  gamePhase = "idle",
  roundBases = {},
} = {}) {
  return getDerivativeUnderlyings().flatMap(stock => {
    const baseStrike = roundBases?.[stock.ticker] || prices[stock.ticker] || stock.basePrice || 100;
    const optionStrikes = buildDerivativeStrikeLadder(baseStrike);
    const instruments = [
      makeDerivativeInstrument({ round, kind: "future", stock, strike: baseStrike }),
      ...optionStrikes.flatMap(({ strike, strikeStep }) => [
        makeDerivativeInstrument({ round, kind: "call", stock, strike, strikeStep }),
        makeDerivativeInstrument({ round, kind: "put", stock, strike, strikeStep }),
      ]),
    ];
    return instruments.map(instrument => ({
      ...instrument,
      quote: calcDerivativeQuote(instrument, { prices, roundRule, timeLeft, roundDur, gamePhase }),
    }));
  });
}

function getDerivativeQuoteMap(catalog = []) {
  return Object.fromEntries((catalog || []).map(instrument => [instrument.id, instrument.quote]));
}

function buildDerivativeQuoteMapForRound({
  round,
  prices = {},
  roundRule = null,
  timeLeft = 0,
  roundDur = 1,
  gamePhase = "idle",
  roundBases = {},
} = {}) {
  return getDerivativeQuoteMap(buildDerivativeCatalog({
    round,
    prices,
    roundRule,
    timeLeft,
    roundDur,
    gamePhase,
    roundBases,
  }));
}

function calcDerivativePositionValue(position, quote) {
  if (!position || !quote) return 0;
  const qty = position.qty || 0;
  const multiplier = position.multiplier || quote.multiplier || 1;
  if (!qty) return 0;
  if (position.kind === "future") {
    const direction = position.side === "short" ? -1 : 1;
    return (quote.mark - (position.avgCost || 0)) * qty * multiplier * direction;
  }
  return quote.mark * qty * multiplier * (position.side === "short" ? -1 : 1);
}

function calcDerivativeCloseValue(position, quote) {
  if (!position || !quote) return 0;
  const qty = position.qty || 0;
  const multiplier = position.multiplier || quote.multiplier || 1;
  if (!qty) return 0;
  if (position.kind === "future") {
    const closePrice = position.side === "short" ? quote.ask : quote.bid;
    const direction = position.side === "short" ? -1 : 1;
    return (closePrice - (position.avgCost || 0)) * qty * multiplier * direction;
  }
  const closePrice = position.side === "short" ? quote.ask : quote.bid;
  return closePrice * qty * multiplier * (position.side === "short" ? -1 : 1);
}

function calcDerivativeExposure(position, quote) {
  if (!position || !quote) return 0;
  const qty = Math.abs(position.qty || 0);
  if (!qty) return 0;
  return getDerivativeRiskEquivalent(quote, position.side) * qty;
}

function calcDerivativePortfolioMetrics(derivativePositions = {}, derivativeQuoteMap = {}) {
  const entries = Object.entries(derivativePositions || {})
    .filter(([, position]) => (position?.qty || 0) > 0);
  const openPnL = {};
  let totalValue = 0;
  let totalUnrealized = 0;
  let futuresExposure = 0;
  let optionExposure = 0;

  entries.forEach(([id, position]) => {
    const quote = derivativeQuoteMap[id];
    if (!quote) return;
    const currentValue = calcDerivativePositionValue(position, quote);
    const direction = position.side === "short" ? -1 : 1;
    const unrealized = position.kind === "future"
      ? currentValue
      : ((quote.mark - (position.avgCost || 0)) * (position.qty || 0) * (position.multiplier || quote.multiplier || 1) * direction);
    const exposure = calcDerivativeExposure(position, quote);
    totalValue += currentValue;
    totalUnrealized += unrealized;
    if (position.kind === "future") futuresExposure += exposure;
    else optionExposure += exposure;
    openPnL[id] = {
      ...position,
      currentValue,
      unrealized,
      closeValue: calcDerivativeCloseValue(position, quote),
      exposure,
      mark: quote.mark,
      bid: quote.bid,
      ask: quote.ask,
      intrinsic: quote.intrinsic || 0,
      timeValue: quote.timeValue || 0,
      spot: quote.spot,
    };
  });

  return {
    openPnL,
    totalValue,
    totalUnrealized,
    futuresExposure,
    optionExposure,
    grossExposure: futuresExposure + optionExposure,
  };
}

function calcHoldingsValue(holdings = {}, prices = {}) {
  return Object.entries(holdings).reduce((sum, [ticker, position]) => (
    sum + ((prices[ticker] || position?.avgCost || 0) * (position?.qty || 0))
  ), 0);
}

function calcNetEquityFromState({
  cash = 0,
  restrictedCash = 0,
  holdings = {},
  prices = {},
  derivativePositions = {},
  derivativeQuoteMap = {},
  accruedBorrowCost = 0,
  accruedFundingCost = 0,
}) {
  const derivativeMetrics = calcDerivativePortfolioMetrics(derivativePositions, derivativeQuoteMap);
  return (
    (cash || 0)
    + (restrictedCash || 0)
    + calcHoldingsValue(holdings, prices)
    + (derivativeMetrics.totalValue || 0)
    - (accruedBorrowCost || 0)
    - (accruedFundingCost || 0)
  );
}

function calcClosedTradeGain(trade = {}) {
  if (trade.gain != null && Number.isFinite(trade.gain)) return trade.gain;
  if (trade.type === "DERIV_CLOSE" || trade.type === "DERIV_EXPIRE") {
    if (Number.isFinite(trade.realizedValue) && Number.isFinite(trade.entryValue)) {
      return trade.realizedValue - trade.entryValue;
    }
    return 0;
  }
  if (trade.type === "COVER") {
    return ((trade.avgCostAtCover || 0) - (trade.price || 0)) * (trade.qty || 0);
  }
  if (trade.type === "SELL") {
    return ((trade.price || 0) - (trade.avgCostAtSell || 0)) * (trade.qty || 0);
  }
  return 0;
}

function PortfolioAnalytics({
  holdings,
  transactions,
  prices,
  cash,
  restrictedCash = 0,
  derivativePositions = {},
  derivativeQuoteMap = {},
  accruedBorrowCost = 0,
  accruedFundingCost = 0,
  initCash,
  history,
  roundRule = null,
}) {
  const assetBetas = calcHoldingAssetBetas(holdings, history);
  const derivativeMetrics = calcDerivativePortfolioMetrics(derivativePositions, derivativeQuoteMap);
  const openPnL = {};
  Object.entries(holdings).forEach(([ticker, position]) => {
    const currentPrice = prices[ticker] || position.avgCost;
    const direction = position.qty < 0 ? -1 : 1;
    openPnL[ticker] = {
      unrealized: (currentPrice - position.avgCost) * position.qty,
      pct: ((currentPrice - position.avgCost) / position.avgCost) * 100 * direction,
      qty: position.qty,
      avgCost: position.avgCost,
      curPrice: currentPrice,
      value: currentPrice * position.qty,
      side: positionSide(position),
      assetBeta: assetBetas[ticker] ?? null,
    };
  });

  const totalHoldingsValue = Object.values(openPnL).reduce((sum, position) => sum + position.value, 0);
  const longExposure = Object.values(openPnL).reduce((sum, position) => sum + (position.side === "long" ? Math.abs(position.value) : 0), 0);
  const shortExposure = Object.values(openPnL).reduce((sum, position) => sum + (position.side === "short" ? Math.abs(position.value) : 0), 0);
  const grossExposure = longExposure + shortExposure + (derivativeMetrics.grossExposure || 0);
  const totalUnrealized = Object.values(openPnL).reduce((sum, position) => sum + position.unrealized, 0) + (derivativeMetrics.totalUnrealized || 0);

  const realizedByTicker = {};
  let totalRealized = 0;
  let wins = 0;
  let losses = 0;
  (transactions || [])
    .filter(trade => trade.type === "SELL" || trade.type === "COVER" || trade.type === "DERIV_CLOSE" || trade.type === "DERIV_EXPIRE")
    .forEach(trade => {
      const gain = calcClosedTradeGain(trade);
      const realizedKey = trade.ticker || trade.underlyingTicker || trade.instrumentId || "DERIV";
      if (!realizedByTicker[realizedKey]) realizedByTicker[realizedKey] = 0;
      realizedByTicker[realizedKey] += gain;
      totalRealized += gain;
      if (gain > 0) wins += 1;
      else losses += 1;
    });

  const totalCarryCost = (accruedBorrowCost || 0) + (accruedFundingCost || 0);
  const markedToMarketEquity = (cash || 0) + (restrictedCash || 0) + totalHoldingsValue + (derivativeMetrics.totalValue || 0);
  const netEquity = markedToMarketEquity - totalCarryCost;
  const leverageUsed = Math.max(0, grossExposure - netEquity);
  const initialMarginRate = roundRule?.initialMargin || 0.40;
  const maintenanceMarginRate = roundRule?.maintenanceMargin || 0.35;
  const initialRequirement = grossExposure * initialMarginRate;
  const maintenanceRequirement = grossExposure * maintenanceMarginRate;
  const marginBuffer = netEquity - maintenanceRequirement;
  const marginBufferPct = grossExposure > 0 ? (marginBuffer / grossExposure) * 100 : 100;
  const buyingPower = netEquity > 0 ? Math.max(0, (netEquity / initialMarginRate) - grossExposure) : 0;
  const totalPnL = totalUnrealized + totalRealized - totalCarryCost;
  const totalVal = netEquity;
  const roi = initCash > 0 ? ((netEquity - initCash) / initCash) * 100 : 0;
  const averageAssetBeta = calcAverageAssetBeta(holdings, prices, history, assetBetas);
  const portfolioBeta = calcPortfolioBeta(holdings, prices, history, assetBetas);

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
    realizedByTicker,
    grossExposure,
    longExposure,
    shortExposure,
    restrictedCash,
    markedToMarketEquity,
    netEquity,
    totalCarryCost,
    accruedBorrowCost,
    accruedFundingCost,
    leverageUsed,
    initialRequirement,
    maintenanceRequirement,
    marginBuffer,
    marginBufferPct,
    buyingPower,
    assetBetas,
    averageAssetBeta,
    portfolioBeta,
    derivativeOpenPnL: derivativeMetrics.openPnL,
    derivativeValue: derivativeMetrics.totalValue || 0,
    derivativeUnrealized: derivativeMetrics.totalUnrealized || 0,
    futuresExposure: derivativeMetrics.futuresExposure || 0,
    optionExposure: derivativeMetrics.optionExposure || 0,
  };
}

function buildRoundScoreSnapshot({
  round,
  startingCapital,
  cash,
  restrictedCash,
  holdings,
  derivativePositions,
  derivativeQuoteMap,
  prices,
  history,
  transactions,
  ballStartPrice,
  prediction,
  accruedBorrowCost = 0,
  accruedFundingCost = 0,
  roundBorrowCost = 0,
  roundFundingCost = 0,
  avgMarginBufferPct = 0,
  marginBreaches = 0,
}) {
  const roundRule = ROUND_RULES[Math.max(0, (round || 1) - 1)] || ROUND_RULES[0];
  const analytics = PortfolioAnalytics({
    holdings,
    transactions: transactions || [],
    prices,
    cash,
    restrictedCash,
    derivativePositions,
    derivativeQuoteMap,
    accruedBorrowCost,
    accruedFundingCost,
    initCash: startingCapital,
    history,
    roundRule,
  });
  const closingValue = analytics.netEquity;
  const baseline = Number.isFinite(startingCapital) && startingCapital > 0
    ? startingCapital
    : (closingValue || INITIAL_CASH);
  const currentBallPrice = prices?.BALL || BALL_BASE;
  const ballBase = Number.isFinite(ballStartPrice) && ballStartPrice > 0 ? ballStartPrice : BALL_BASE;
  const closedTrades = (transactions || []).filter(trade =>
    trade.type === "SELL" || trade.type === "COVER" || trade.type === "DERIV_CLOSE" || trade.type === "DERIV_EXPIRE"
  );
  const sectors = uniqueTruthy((transactions || []).map(trade => {
    const refTicker = trade.ticker || trade.underlyingTicker;
    return ALL_STOCKS.find(stock => stock.ticker === refTicker)?.sectorId;
  }));

  return normalizeLedgerRoundSnapshot({
    round,
    startingCapital: baseline,
    endingValue: closingValue,
    returnPct: baseline > 0 ? ((closingValue - baseline) / baseline) * 100 : 0,
    ballReturn: ballBase > 0 ? ((currentBallPrice - ballBase) / ballBase) * 100 : 0,
    assetBeta: analytics.averageAssetBeta,
    portfolioBeta: analytics.portfolioBeta,
    borrowCost: roundBorrowCost,
    fundingCost: roundFundingCost,
    avgMarginBufferPct,
    marginBreaches,
    closedTrades: closedTrades.length,
    wins: closedTrades.filter(trade => calcClosedTradeGain(trade) > 0).length,
    sectors,
    predShown: !!prediction?.shown,
    predAnswered: !!prediction?.answered,
    predCorrect: !!prediction?.correct,
    lastTradeTs: closedTrades.reduce((maxTs, trade) => Math.max(maxTs, Number(trade.id) || 0), 0),
  });
}

function summarizeScoreSnapshots(snapshots = []) {
  const rounds = (snapshots || []).map(normalizeLedgerRoundSnapshot);
  return {
    closedTrades: rounds.reduce((sum, round) => sum + (round.closedTrades || 0), 0),
    wins: rounds.reduce((sum, round) => sum + (round.wins || 0), 0),
    uniqueSectors: uniqueTruthy(rounds.flatMap(round => round.sectors || [])).length,
    predShown: rounds.reduce((sum, round) => sum + (round.predShown || 0), 0),
    predAnswered: rounds.reduce((sum, round) => sum + (round.predAnswered || 0), 0),
    predCorrect: rounds.reduce((sum, round) => sum + (round.predCorrect || 0), 0),
    totalBorrowCost: rounds.reduce((sum, round) => sum + (round.borrowCost || 0), 0),
    totalFundingCost: rounds.reduce((sum, round) => sum + (round.fundingCost || 0), 0),
    avgMarginBufferPct: averageFinite(rounds.map(round => round.avgMarginBufferPct)) ?? 0,
    marginBreaches: rounds.reduce((sum, round) => sum + (round.marginBreaches || 0), 0),
    assetBeta: averageFinite(rounds.map(round => round.assetBeta)),
    portfolioBeta: averageFinite(rounds.map(round => round.portfolioBeta)),
    lastTradeTs: rounds.reduce((maxTs, round) => Math.max(maxTs, round.lastTradeTs || 0), 0),
    roundReturns: rounds.map(round => round.returnPct),
  };
}

function calcScore(entry, initCash) {
  const initialCash = initCash || INITIAL_CASH;
  const total = entry.total || initialCash;
  const cash = entry.cash || initialCash;
  const ledger = sanitizeScoreLedger(entry.scoreLedger);
  const liveRound = entry.liveRound ? normalizeLedgerRoundSnapshot(entry.liveRound) : null;
  const roundSnapshots = [...ledger.completedRounds, ...(liveRound ? [liveRound] : [])];
  const roundReturns = roundSnapshots.map(round => round.returnPct);
  const legacyRoundReturns = Array.isArray(entry.roundReturns) ? entry.roundReturns : [];
  const effectiveRoundReturns = roundReturns.length > 0 ? roundReturns : legacyRoundReturns;
  const compoundedReturn = compoundPercentSeries(roundReturns);
  const compoundedBallReturn = compoundPercentSeries(roundSnapshots.map(round => round.ballReturn));
  const closedTradesTotal = roundSnapshots.reduce((sum, round) => sum + (round.closedTrades || 0), 0);
  const winsTotal = roundSnapshots.reduce((sum, round) => sum + (round.wins || 0), 0);
  const sectorsTotal = uniqueTruthy(roundSnapshots.flatMap(round => round.sectors || [])).length;
  const predShownTotal = roundSnapshots.reduce((sum, round) => sum + (round.predShown || 0), 0);
  const predAnsweredTotal = roundSnapshots.reduce((sum, round) => sum + (round.predAnswered || 0), 0);
  const predCorrectTotal = roundSnapshots.reduce((sum, round) => sum + (round.predCorrect || 0), 0);
  const lastTradeFromLedger = roundSnapshots.reduce((maxTs, round) => Math.max(maxTs, round.lastTradeTs || 0), 0);
  const totalBorrowCost = roundSnapshots.reduce((sum, round) => sum + (round.borrowCost || 0), 0);
  const totalFundingCost = roundSnapshots.reduce((sum, round) => sum + (round.fundingCost || 0), 0);
  const totalCarryCost = totalBorrowCost + totalFundingCost;
  const avgMarginBufferPct = averageFinite(roundSnapshots.map(round => round.avgMarginBufferPct));
  const marginBreaches = roundSnapshots.reduce((sum, round) => sum + (round.marginBreaches || 0), 0);
  const netEquity = entry.netEquity != null
    ? entry.netEquity
    : (roundSnapshots[roundSnapshots.length - 1]?.endingValue ?? total);

  const absoluteReturn = compoundedReturn != null
    ? compoundedReturn
    : ((netEquity - initialCash) / initialCash) * 100;
  const ballReturn = compoundedBallReturn != null ? compoundedBallReturn : (entry.ballReturn || 0);
  const alpha = absoluteReturn - ballReturn;
  const consistency = effectiveRoundReturns.length > 0 ? geometricMeanPercent(effectiveRoundReturns) : 0;
  const maxDrawdown = Math.max(0.5, ledger.maxDrawdownOverall || entry.maxDrawdown || 0.5);
  const sharpe = absoluteReturn / maxDrawdown;
  const calmar = maxDrawdown > 0 ? absoluteReturn / maxDrawdown : 0;

  const t1a = clamp(((absoluteReturn + 20) / 120) * 20, 0, 20);
  const t1b = clamp(((alpha + 15) / 45) * 15, 0, 15);
  const tier1 = t1a + t1b;

  const marginBufferPct = avgMarginBufferPct != null
    ? avgMarginBufferPct
    : (entry.marginBufferPct != null ? entry.marginBufferPct : 0);
  const capitalBase = Math.max(1, roundSnapshots[0]?.startingCapital || initialCash || INITIAL_CASH);
  const carryDragPct = (totalCarryCost / capitalBase) * 100;
  const marginDisciplineRaw = clamp(((marginBufferPct + 5) / 25) * 15, 0, 15) - Math.min(12, marginBreaches * 3);
  const fundingEfficiency = clamp(((8 - carryDragPct) / 8) * 10, 0, 10);

  const t2a = clamp((1 - maxDrawdown / 40) * 15, 0, 15);
  const t2b = clamp(marginDisciplineRaw, 0, 15);
  const t2c = fundingEfficiency;
  const tier2 = t2a + t2b + t2c;

  const crisisSnapshots = roundSnapshots.filter(round => CRISIS_ROUNDS.includes(round.round));
  const crisisAlpha = averageFinite(crisisSnapshots.map(round => (round.returnPct || 0) - (round.ballReturn || 0))) ?? alpha;
  const effectiveClosedTrades = closedTradesTotal > 0 ? closedTradesTotal : (entry.closedTrades || 0);
  const effectiveWins = winsTotal > 0 ? winsTotal : (entry.wins || 0);
  const winRate = effectiveClosedTrades > 0 ? (effectiveWins / effectiveClosedTrades) * 100 : 50;
  const sectors = Math.min(9, sectorsTotal || entry.uniqueSectors || 0);
  const predAnswered = predAnsweredTotal > 0 ? predAnsweredTotal : (entry.predTotal || 0);
  const predCorrect = predCorrectTotal > 0 ? predCorrectTotal : (entry.predCorrect || 0);
  const predRate = predAnswered > 0 ? predCorrect / predAnswered : 0;
  const predShown = predShownTotal > 0
    ? predShownTotal
    : (entry.predAsked != null ? entry.predAsked : (entry.currentRound || 0));
  const roundsReached = clamp(
    Math.max(entry.currentRound || 0, roundSnapshots.length || 0, predShown || predAnswered || 1),
    1,
    TOTAL_ROUNDS
  );
  const predParticipation = predShown > 0
    ? clamp(predAnswered / predShown, 0, 1)
    : (predAnswered > 0 ? clamp(predAnswered / roundsReached, 0, 1) : 0);

  const t3a = clamp(((crisisAlpha + 10) / 30) * 10, 0, 10);
  const t3b = clamp((winRate / 100) * 5, 0, 5);
  const t3c = clamp((sectors / 9) * 5, 0, 5);
  const t3d = predRate * 5;
  const t3e = predParticipation * 5;
  const tier3 = t3a + t3b + t3c + t3d + t3e;

  const score = tier1 + tier2 + tier3;
  const tb1 = +(netEquity || 0).toFixed(2);
  const tb2 = +crisisAlpha.toFixed(4);
  const tb3 = -(marginBreaches || 0);
  const tb4 = -maxDrawdown;
  const tb5 = -((lastTradeFromLedger || entry.lastTradeTs || Date.now()));

  let assetBetaRaw = averageFinite(roundSnapshots.map(round => round.assetBeta));
  if (assetBetaRaw == null) {
    assetBetaRaw = entry.assetBeta != null ? entry.assetBeta : (entry.beta != null ? entry.beta : 0.5);
  }
  let portfolioBetaRaw = averageFinite(roundSnapshots.map(round => round.portfolioBeta));
  if (portfolioBetaRaw == null) {
    portfolioBetaRaw = entry.portfolioBeta != null ? entry.portfolioBeta : (entry.beta != null ? entry.beta : 0.5);
  }

  return {
    score: +score.toFixed(3),
    tier1,
    tier2,
    tier3,
    netEquity: +netEquity.toFixed(2),
    absoluteReturn: +absoluteReturn.toFixed(2),
    sharpe: +sharpe.toFixed(3),
    alpha: +alpha.toFixed(2),
    consistency: +consistency.toFixed(2),
    maxDrawdown: +maxDrawdown.toFixed(2),
    calmar: +calmar.toFixed(3),
    carryDragPct: +carryDragPct.toFixed(2),
    fundingEfficiency: +fundingEfficiency.toFixed(2),
    marginBufferPct: +(marginBufferPct || 0).toFixed(2),
    marginBreaches: marginBreaches || 0,
    crisisAlpha: +crisisAlpha.toFixed(2),
    totalBorrowCost: +totalBorrowCost.toFixed(2),
    totalFundingCost: +totalFundingCost.toFixed(2),
    totalCarryCost: +totalCarryCost.toFixed(2),
    assetBeta: +assetBetaRaw.toFixed(3),
    portfolioBeta: +portfolioBetaRaw.toFixed(3),
    beta: +portfolioBetaRaw.toFixed(3),
    winRate: +winRate.toFixed(1),
    sectors,
    predRate: +(predRate * 100).toFixed(1),
    predParticipation: +(predParticipation * 100).toFixed(1),
    predShownTotal: predShown,
    predAnsweredTotal: predAnswered,
    predCorrectTotal: predCorrect,
    roundsCount: roundSnapshots.length,
    t1a: +t1a.toFixed(2),
    t1b: +t1b.toFixed(2),
    t1c: 0,
    t1d: 0,
    t2a: +t2a.toFixed(2),
    t2b: +t2b.toFixed(2),
    t2c: +t2c.toFixed(2),
    t3a: +t3a.toFixed(2),
    t3b: +t3b.toFixed(2),
    t3c: +t3c.toFixed(2),
    t3d: +t3d.toFixed(2),
    t3e: +t3e.toFixed(2),
    tb1,
    tb2,
    tb3,
    tb4,
    tb5,
    totalReturn: +absoluteReturn.toFixed(2),
    deployed: netEquity > 0 ? +((Math.min(1, (netEquity - cash) / netEquity)) * 100).toFixed(1) : 0,
    roundReturns: effectiveRoundReturns,
  };
}

function inferTradeFlowDirection(trade = {}) {
  if (Number.isFinite(trade.flowDirection)) return clamp(trade.flowDirection, -1, 1);
  const action = String(trade.action || trade.type || "").toUpperCase();
  if (trade.assetType === "derivative" && trade.derivativeKind) {
    if (action.includes("CLOSE") || trade.type === "DERIV_CLOSE" || trade.type === "DERIV_EXPIRE") {
      return getDerivativeTradeFlowDirection(trade.derivativeKind, trade.derivativeSide || "long", "close");
    }
    return getDerivativeTradeFlowDirection(trade.derivativeKind, trade.derivativeSide || "long", "open");
  }
  if (action === "BUY" || action === "COVER" || action === "FUT LONG" || action === "CALL BUY") return 1;
  if (action === "SELL" || action === "SHORT" || action === "FUT SHORT" || action === "PUT BUY" || action === "CALL SELL") return -1;
  if (action === "PUT SELL") return 1;
  if (action === "FUT CLOSE") return trade.derivativeSide === "short" ? 1 : -1;
  if (action === "OPT CLOSE") return trade.derivativeKind === "put" ? 1 : -1;
  return 0;
}

function inferTradeFlowWeight(trade = {}) {
  if (Number.isFinite(trade.flowWeight)) return Math.abs(trade.flowWeight);
  const qty = Math.max(1, Math.abs(trade.qty || 1));
  const price = Math.max(1, Math.abs(trade.price || 0));
  const multiplier = Math.max(1, Math.abs(trade.multiplier || 1));
  const notional = qty * price * multiplier;
  return trade.assetType === "derivative" ? notional * 1.25 : notional;
}

function normalizeTradeFeedItem(item = {}) {
  const underlyingTicker = item.underlyingTicker || item.ticker;
  if (!underlyingTicker) return null;
  const ts = Number.isFinite(item.ts) ? item.ts : (Number.isFinite(item.id) ? item.id : Date.now());
  return {
    ...item,
    ticker: underlyingTicker,
    underlyingTicker,
    ts,
    flowDirection: inferTradeFlowDirection(item),
    flowWeight: inferTradeFlowWeight(item),
  };
}

function buildTeamStateKey(teamId) {
  return `${TEAM_STATE_PREFIX}${teamId}`;
}

function normalizePredictionSessionId(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function normalizePredictionSession(session = { phase: "closed" }) {
  if (!session || typeof session !== "object") return { phase: "closed", id: null };
  return {
    ...session,
    id: normalizePredictionSessionId(session.id),
  };
}

function getRoundDuration(round) {
  return DEFAULT_ROUND_DURATIONS[Math.max(0, (round || 1) - 1)] || DEFAULT_ROUND_DURATIONS[0];
}

function getRoundRule(round) {
  return ROUND_RULES[Math.min(Math.max((round || 1) - 1, 0), TOTAL_ROUNDS - 1)] || ROUND_RULES[0];
}

function seedHistory(prices = {}) {
  return Object.fromEntries(
    ALL_STOCKS.map(stock => {
      const value = prices[stock.ticker] || stock.basePrice || 100;
      return [stock.ticker, Array(HISTORY_LEN).fill(value)];
    })
  );
}

function buildGameContext({
  gmState = {},
  pricesPayload = {},
  predictionSession = { phase: "closed" },
} = {}) {
  const round = Math.min(Math.max(Number(gmState?.round) || 1, 1), TOTAL_ROUNDS);
  const phase = gmState?.phase || "idle";
  const rawPrices = pricesPayload?.prices && typeof pricesPayload.prices === "object" ? pricesPayload.prices : {};
  const prices = Object.fromEntries(
    ALL_STOCKS.map(stock => [
      stock.ticker,
      Number.isFinite(rawPrices[stock.ticker]) ? rawPrices[stock.ticker] : (stock.basePrice || 100),
    ])
  );
  const rawHistory = pricesPayload?.history && typeof pricesPayload.history === "object" ? pricesPayload.history : {};
  const history = Object.fromEntries(
    ALL_STOCKS.map(stock => [
      stock.ticker,
      Array.isArray(rawHistory[stock.ticker]) && rawHistory[stock.ticker].length
        ? rawHistory[stock.ticker]
        : Array(HISTORY_LEN).fill(prices[stock.ticker]),
      ])
  );
  const normalizedPredictionSession = normalizePredictionSession(predictionSession || { phase: "closed" });
  return {
    gmState,
    prices,
    history,
    predictionSession: normalizedPredictionSession,
    round,
    gamePhase: phase,
    timeLeft: Number.isFinite(gmState?.roundLeft) ? gmState.roundLeft : 0,
    roundDur: getRoundDuration(round),
    roundRule: getRoundRule(round),
    initCash: Number.isFinite(gmState?.initCash) ? gmState.initCash : INITIAL_CASH,
    frozenUntil: gmState?.frozenUntil,
    haltedUntil: gmState?.haltedUntil,
  };
}

function createTeamState(team, initCash = INITIAL_CASH) {
  const startingCash = Number.isFinite(initCash) && initCash > 0 ? initCash : INITIAL_CASH;
  return {
    teamId: team.id,
    teamName: team.name,
    color: team.color,
    cash: startingCash,
    restrictedCash: 0,
    accruedBorrowCost: 0,
    accruedFundingCost: 0,
    holdings: {},
    transactions: [],
    derivativePositions: {},
    derivativeTransactions: [],
    peakValue: startingCash,
    maxDrawdown: 0,
    scoreLedger: createEmptyScoreLedger(),
    activeLedgerRound: null,
    lastFinalizedRound: null,
    roundStartValue: startingCash,
    roundBallStartPrice: BALL_BASE,
    roundDerivativeBase: {},
    roundPredictionShown: false,
    roundPredictionAnswered: false,
    roundPredictionCorrect: false,
    roundBorrowCostBase: 0,
    roundFundingCostBase: 0,
    roundMarginBufferSum: 0,
    roundMarginBufferSamples: 0,
    roundMarginBreaches: 0,
    roundMarginBreachActive: false,
    marginGraceEndsAt: null,
    marginStatus: "safe",
    marginAlert: null,
    playerPrediction: null,
    playerPredictionRound: null,
    playerPredictionSessionId: null,
    predictionBonusRounds: [],
    processedPortfolioResetId: null,
    lastCarryAccrualAt: null,
    lastObservedRound: 0,
    lastObservedPhase: "idle",
  };
}

function normalizeTeamState(rawState, team, initCash = INITIAL_CASH) {
  const base = createTeamState(team, initCash);
  if (!rawState || typeof rawState !== "object") return base;
  return {
    ...base,
    ...rawState,
    teamId: team.id,
    teamName: team.name,
    color: team.color,
    cash: Number.isFinite(rawState.cash) ? rawState.cash : base.cash,
    restrictedCash: Number.isFinite(rawState.restrictedCash) ? rawState.restrictedCash : 0,
    accruedBorrowCost: Number.isFinite(rawState.accruedBorrowCost) ? rawState.accruedBorrowCost : 0,
    accruedFundingCost: Number.isFinite(rawState.accruedFundingCost) ? rawState.accruedFundingCost : 0,
    holdings: rawState.holdings && typeof rawState.holdings === "object" ? rawState.holdings : {},
    transactions: Array.isArray(rawState.transactions) ? rawState.transactions : [],
    derivativePositions: rawState.derivativePositions && typeof rawState.derivativePositions === "object" ? rawState.derivativePositions : {},
    derivativeTransactions: Array.isArray(rawState.derivativeTransactions) ? rawState.derivativeTransactions : [],
    peakValue: Number.isFinite(rawState.peakValue) ? rawState.peakValue : base.peakValue,
    maxDrawdown: Number.isFinite(rawState.maxDrawdown) ? rawState.maxDrawdown : 0,
    scoreLedger: sanitizeScoreLedger(rawState.scoreLedger),
    activeLedgerRound: Number.isFinite(rawState.activeLedgerRound) ? rawState.activeLedgerRound : null,
    lastFinalizedRound: Number.isFinite(rawState.lastFinalizedRound) ? rawState.lastFinalizedRound : null,
    roundStartValue: Number.isFinite(rawState.roundStartValue) ? rawState.roundStartValue : base.roundStartValue,
    roundBallStartPrice: Number.isFinite(rawState.roundBallStartPrice) ? rawState.roundBallStartPrice : BALL_BASE,
    roundDerivativeBase: rawState.roundDerivativeBase && typeof rawState.roundDerivativeBase === "object"
      ? rawState.roundDerivativeBase
      : {},
    roundPredictionShown: !!rawState.roundPredictionShown,
    roundPredictionAnswered: !!rawState.roundPredictionAnswered,
    roundPredictionCorrect: !!rawState.roundPredictionCorrect,
    roundBorrowCostBase: Number.isFinite(rawState.roundBorrowCostBase) ? rawState.roundBorrowCostBase : 0,
    roundFundingCostBase: Number.isFinite(rawState.roundFundingCostBase) ? rawState.roundFundingCostBase : 0,
    roundMarginBufferSum: Number.isFinite(rawState.roundMarginBufferSum) ? rawState.roundMarginBufferSum : 0,
    roundMarginBufferSamples: Number.isFinite(rawState.roundMarginBufferSamples) ? rawState.roundMarginBufferSamples : 0,
    roundMarginBreaches: Number.isFinite(rawState.roundMarginBreaches) ? rawState.roundMarginBreaches : 0,
    roundMarginBreachActive: !!rawState.roundMarginBreachActive,
    marginGraceEndsAt: Number.isFinite(rawState.marginGraceEndsAt) ? rawState.marginGraceEndsAt : null,
    marginStatus: typeof rawState.marginStatus === "string" ? rawState.marginStatus : "safe",
    marginAlert: rawState.marginAlert && typeof rawState.marginAlert === "object" ? rawState.marginAlert : null,
    playerPrediction: typeof rawState.playerPrediction === "string" ? rawState.playerPrediction : null,
    playerPredictionRound: Number.isFinite(rawState.playerPredictionRound) ? rawState.playerPredictionRound : null,
    playerPredictionSessionId: normalizePredictionSessionId(rawState.playerPredictionSessionId),
    predictionBonusRounds: Array.isArray(rawState.predictionBonusRounds)
      ? rawState.predictionBonusRounds.filter(value => Number.isFinite(value))
      : [],
    processedPortfolioResetId: rawState.processedPortfolioResetId || null,
    lastCarryAccrualAt: Number.isFinite(rawState.lastCarryAccrualAt) ? rawState.lastCarryAccrualAt : null,
    lastObservedRound: Number.isFinite(rawState.lastObservedRound) ? rawState.lastObservedRound : 0,
    lastObservedPhase: typeof rawState.lastObservedPhase === "string" ? rawState.lastObservedPhase : "idle",
  };
}

function sanitizeTeamStateForClient(state) {
  return {
    teamId: state.teamId,
    teamName: state.teamName,
    color: state.color,
    cash: state.cash,
    restrictedCash: state.restrictedCash,
    accruedBorrowCost: state.accruedBorrowCost,
    accruedFundingCost: state.accruedFundingCost,
    holdings: state.holdings,
    transactions: state.transactions,
    derivativePositions: state.derivativePositions,
    derivativeTransactions: state.derivativeTransactions,
    peakValue: state.peakValue,
    maxDrawdown: state.maxDrawdown,
    scoreLedger: state.scoreLedger,
    activeLedgerRound: state.activeLedgerRound,
    lastFinalizedRound: state.lastFinalizedRound,
    roundStartValue: state.roundStartValue,
    roundBallStartPrice: state.roundBallStartPrice,
    roundPredictionShown: state.roundPredictionShown,
    roundPredictionAnswered: state.roundPredictionAnswered,
    roundPredictionCorrect: state.roundPredictionCorrect,
    marginStatus: state.marginStatus,
    marginAlert: state.marginAlert,
    playerPrediction: state.playerPrediction,
    playerPredictionRound: state.playerPredictionRound,
    playerPredictionSessionId: state.playerPredictionSessionId,
  };
}

function getActiveRoundForState(state, context) {
  return state.activeLedgerRound || context.round || 1;
}

function buildTeamDerivativeQuoteMap(state, context, overrides = {}) {
  const round = overrides.round || getActiveRoundForState(state, context);
  const roundRule = overrides.roundRule || getRoundRule(round);
  const gamePhase = overrides.gamePhase || context.gamePhase;
  const timeLeft = overrides.timeLeft != null ? overrides.timeLeft : context.timeLeft;
  const roundDur = overrides.roundDur || getRoundDuration(round);
  const roundBases = overrides.roundBases || state.roundDerivativeBase || buildRoundDerivativeBases(context.prices);
  return buildDerivativeQuoteMapForRound({
    round,
    prices: context.prices,
    roundRule,
    timeLeft,
    roundDur,
    gamePhase,
    roundBases,
  });
}

function buildAnalyticsForState(state, context, overrides = {}) {
  const round = overrides.round || getActiveRoundForState(state, context);
  const roundRule = overrides.roundRule || getRoundRule(round);
  const derivativeQuoteMap = overrides.derivativeQuoteMap || buildTeamDerivativeQuoteMap(state, context, {
    round,
    roundRule,
    gamePhase: overrides.gamePhase || context.gamePhase,
    timeLeft: overrides.timeLeft != null ? overrides.timeLeft : context.timeLeft,
  });
  const transactions = [...(state.transactions || []), ...(state.derivativeTransactions || [])];
  return {
    derivativeQuoteMap,
    analytics: PortfolioAnalytics({
      holdings: state.holdings,
      transactions,
      prices: context.prices,
      cash: state.cash,
      restrictedCash: state.restrictedCash,
      derivativePositions: state.derivativePositions,
      derivativeQuoteMap,
      accruedBorrowCost: state.accruedBorrowCost,
      accruedFundingCost: state.accruedFundingCost,
      initCash: context.initCash,
      history: context.history,
      roundRule,
    }),
  };
}

function startScoreLedgerRoundForState(state, context, targetRound, options = {}) {
  if (!targetRound) return;
  const derivativeQuoteMap = buildTeamDerivativeQuoteMap(state, context, {
    round: targetRound,
    gamePhase: context.gamePhase,
    timeLeft: context.timeLeft,
  });
  state.activeLedgerRound = targetRound;
  state.roundStartValue = Number.isFinite(options.startingCapital)
    ? options.startingCapital
    : calcNetEquityFromState({
      cash: state.cash,
      restrictedCash: state.restrictedCash,
      holdings: state.holdings,
      prices: context.prices,
      derivativePositions: state.derivativePositions,
      derivativeQuoteMap,
      accruedBorrowCost: state.accruedBorrowCost,
      accruedFundingCost: state.accruedFundingCost,
    });
  state.roundBallStartPrice = Number.isFinite(options.ballStartPrice) ? options.ballStartPrice : (context.prices?.BALL || BALL_BASE);
  state.roundDerivativeBase = buildRoundDerivativeBases(context.prices);
  state.roundPredictionShown = !!options.predShown;
  state.roundPredictionAnswered = !!options.predAnswered;
  state.roundPredictionCorrect = !!options.predCorrect;
  state.roundBorrowCostBase = state.accruedBorrowCost || 0;
  state.roundFundingCostBase = state.accruedFundingCost || 0;
  state.roundMarginBufferSum = 0;
  state.roundMarginBufferSamples = 0;
  state.roundMarginBreaches = 0;
  state.roundMarginBreachActive = false;
  state.marginGraceEndsAt = null;
}

function finalizeScoreLedgerRoundForState(state, context, roundOverride = null) {
  const targetRound = roundOverride || state.activeLedgerRound || state.lastObservedRound || context.round;
  if (!targetRound || state.lastFinalizedRound === targetRound) return state.scoreLedger;
  const derivativeQuoteMap = buildTeamDerivativeQuoteMap(state, context, {
    round: targetRound,
    gamePhase: "idle",
    timeLeft: 0,
  });
  const snapshot = buildRoundScoreSnapshot({
    round: targetRound,
    startingCapital: state.roundStartValue,
    cash: state.cash,
    restrictedCash: state.restrictedCash,
    holdings: state.holdings,
    derivativePositions: state.derivativePositions,
    derivativeQuoteMap,
    prices: context.prices,
    history: context.history,
    transactions: [...(state.transactions || []), ...(state.derivativeTransactions || [])],
    ballStartPrice: state.roundBallStartPrice,
    prediction: {
      shown: state.roundPredictionShown,
      answered: state.roundPredictionAnswered,
      correct: state.roundPredictionCorrect,
    },
    accruedBorrowCost: state.accruedBorrowCost,
    accruedFundingCost: state.accruedFundingCost,
    roundBorrowCost: Math.max(0, (state.accruedBorrowCost || 0) - (state.roundBorrowCostBase || 0)),
    roundFundingCost: Math.max(0, (state.accruedFundingCost || 0) - (state.roundFundingCostBase || 0)),
    avgMarginBufferPct: state.roundMarginBufferSamples > 0 ? state.roundMarginBufferSum / state.roundMarginBufferSamples : 0,
    marginBreaches: state.roundMarginBreaches || 0,
  });
  const ledger = sanitizeScoreLedger(state.scoreLedger);
  const completedRounds = [
    ...ledger.completedRounds.filter(round => round.round !== targetRound),
    snapshot,
  ].sort((left, right) => (left.round || 0) - (right.round || 0));
  state.scoreLedger = {
    ...ledger,
    completedRounds,
    maxDrawdownOverall: Math.max(ledger.maxDrawdownOverall || 0, state.maxDrawdown || 0),
  };
  state.lastFinalizedRound = targetRound;
  state.activeLedgerRound = null;
  state.roundPredictionShown = false;
  state.roundPredictionAnswered = false;
  state.roundPredictionCorrect = false;
  state.roundBorrowCostBase = state.accruedBorrowCost || 0;
  state.roundFundingCostBase = state.accruedFundingCost || 0;
  state.roundMarginBufferSum = 0;
  state.roundMarginBufferSamples = 0;
  state.roundMarginBreaches = 0;
  state.roundMarginBreachActive = false;
  state.marginGraceEndsAt = null;
  return state.scoreLedger;
}

function settleExpiredDerivativesForState(state, context, settlementRound = getActiveRoundForState(state, context)) {
  const positions = state.derivativePositions || {};
  const ids = Object.keys(positions);
  if (!ids.length) return;
  const settlementQuoteMap = buildTeamDerivativeQuoteMap(state, context, {
    round: settlementRound,
    gamePhase: "idle",
    timeLeft: 0,
  });
  let cashDelta = 0;
  const settlements = [];

  ids.forEach((id, index) => {
    const position = positions[id];
    const quote = settlementQuoteMap[id];
    if (!position || !quote) return;
    const qty = position.qty || 0;
    const multiplier = position.multiplier || quote.multiplier || 1;
    const entryValue = (position.avgCost || 0) * qty * multiplier;
    let realizedValue = 0;
    let gain = 0;
    let settlementPrice = quote.mark;

    if (position.kind === "future") {
      gain = (quote.mark - (position.avgCost || 0)) * qty * multiplier * (position.side === "short" ? -1 : 1);
      realizedValue = entryValue + gain;
      cashDelta += gain;
    } else {
      settlementPrice = quote.intrinsic || 0;
      realizedValue = settlementPrice * qty * multiplier * (position.side === "short" ? -1 : 1);
      gain = position.side === "short"
        ? (entryValue + realizedValue)
        : (realizedValue - entryValue);
      cashDelta += realizedValue;
    }

    settlements.push({
      id: Date.now() + index,
      type: "DERIV_EXPIRE",
      instrumentId: id,
      label: position.label,
      kind: position.kind,
      side: position.side,
      underlyingTicker: position.underlyingTicker,
      sectorId: position.sectorId,
      qty,
      price: settlementPrice,
      avgCostAtOpen: position.avgCost,
      entryValue,
      realizedValue,
      cashEffect: position.kind === "future" ? gain : realizedValue,
      gain,
      gainPct: entryValue > 0 ? (gain / entryValue) * 100 : 0,
      settlementRound,
      time: nowFull(),
      date: new Date().toLocaleDateString(),
    });
  });

  if (cashDelta !== 0) state.cash += cashDelta;
  state.derivativePositions = {};
  state.derivativeTransactions = [...settlements, ...(state.derivativeTransactions || [])];
}

function applyPortfolioResetInstruction(state, resetInstruction, context) {
  if (!resetInstruction?.mode) return;
  const prices = context.prices || {};
  const currentHoldings = state.holdings || {};

  if (resetInstruction.mode === "equal_restart") {
    const targetCash = resetInstruction.cashTarget || context.initCash || INITIAL_CASH;
    state.cash = targetCash;
    state.restrictedCash = 0;
    state.accruedBorrowCost = 0;
    state.accruedFundingCost = 0;
    state.holdings = {};
    state.transactions = [];
    state.derivativePositions = {};
    state.derivativeTransactions = [];
    state.peakValue = targetCash;
    state.maxDrawdown = 0;
    state.scoreLedger = createEmptyScoreLedger();
    state.lastFinalizedRound = null;
    state.activeLedgerRound = null;
    state.roundStartValue = targetCash;
    return;
  }

  if (resetInstruction.mode === "liquidate_to_cash") {
    const liquidationValue = Object.entries(currentHoldings).reduce((sum, [ticker, position]) => (
      sum + ((prices[ticker] || position?.avgCost || 0) * (position?.qty || 0))
    ), 0);
    state.cash += liquidationValue;
    state.restrictedCash = 0;
    state.holdings = {};
    state.transactions = [];
    state.derivativePositions = {};
    state.derivativeTransactions = [];
  }
}

function applyPredictionBonusIfEligible(state, context, targetRound) {
  const session = context.predictionSession;
  if (!session || !session.question || session.round !== targetRound) return;
  if (state.playerPredictionRound !== targetRound || state.playerPredictionSessionId !== session.id) return;
  if (state.predictionBonusRounds.includes(targetRound)) return;

  if (state.playerPrediction === session.question.correct) {
    const derivativeQuoteMap = buildTeamDerivativeQuoteMap(state, context, {
      round: targetRound,
      gamePhase: "idle",
      timeLeft: 0,
    });
    const currentEquity = calcNetEquityFromState({
      cash: state.cash,
      restrictedCash: state.restrictedCash,
      holdings: state.holdings,
      prices: context.prices,
      derivativePositions: state.derivativePositions,
      derivativeQuoteMap,
      accruedBorrowCost: state.accruedBorrowCost,
      accruedFundingCost: state.accruedFundingCost,
    });
    const bonus = Math.round(currentEquity * (session.question.bonus || 0));
    state.cash += bonus;
  }

  state.predictionBonusRounds = [...state.predictionBonusRounds, targetRound];
}

function updatePredictionFlags(state, context) {
  const session = context.predictionSession;
  if (!session) return;
  const activeRound = getActiveRoundForState(state, context);
  if (session.round === activeRound && session.question) {
    state.roundPredictionShown = true;
  }
  const answeredCurrentSession = state.playerPredictionSessionId === session.id && state.playerPredictionRound === session.round;
  if (answeredCurrentSession) {
    state.roundPredictionAnswered = true;
  }
  if (answeredCurrentSession && ["revealing", "closed"].includes(session.phase)) {
    state.roundPredictionCorrect = state.playerPrediction === session.question?.correct;
  }
}

function autoDeleveragePortfolio(state, context) {
  const activeRound = getActiveRoundForState(state, context);
  const activeRule = getRoundRule(activeRound);
  const derivativeQuoteMap = buildTeamDerivativeQuoteMap(state, context, {
    round: activeRound,
    roundRule: activeRule,
  });

  let nextCash = state.cash || 0;
  let nextRestrictedCash = state.restrictedCash || 0;
  let nextHoldings = { ...(state.holdings || {}) };
  let nextDerivativePositions = { ...(state.derivativePositions || {}) };
  const prices = context.prices || {};
  const generatedTransactions = [];
  const generatedDerivativeTransactions = [];

  const rankPositions = () => [
    ...Object.entries(nextHoldings).map(([ticker, position]) => {
      const price = prices[ticker] || position?.avgCost || 0;
      const qty = position?.qty || 0;
      const gross = Math.abs(price * qty);
      const unrealized = (price - (position?.avgCost || 0)) * qty;
      return { kind: "equity", ticker, position, price, qty, gross, unrealized };
    }),
    ...Object.entries(nextDerivativePositions).map(([id, position]) => {
      const quote = derivativeQuoteMap[id];
      if (!quote) return null;
      return {
        kind: "derivative",
        id,
        position,
        quote,
        gross: calcDerivativeExposure(position, quote),
        unrealized: position.kind === "future"
          ? calcDerivativePositionValue(position, quote)
          : ((quote.mark - (position.avgCost || 0)) * (position.qty || 0) * (position.multiplier || quote.multiplier || 1) * (position.side === "short" ? -1 : 1)),
      };
    }).filter(Boolean),
  ].sort((left, right) => (right.gross - left.gross) || (left.unrealized - right.unrealized));

  const simulateMarginBuffer = () => {
    const analytics = PortfolioAnalytics({
      holdings: nextHoldings,
      transactions: [
        ...(state.transactions || []),
        ...(state.derivativeTransactions || []),
        ...generatedTransactions,
        ...generatedDerivativeTransactions,
      ],
      prices,
      cash: nextCash,
      restrictedCash: nextRestrictedCash,
      derivativePositions: nextDerivativePositions,
      derivativeQuoteMap,
      accruedBorrowCost: state.accruedBorrowCost,
      accruedFundingCost: state.accruedFundingCost,
      initCash: context.initCash,
      history: context.history,
      roundRule: activeRule,
    });
    return analytics.marginBuffer;
  };

  for (const candidate of rankPositions()) {
    if (simulateMarginBuffer() >= 0) break;
    if (candidate.kind === "equity") {
      const { ticker, position, price, qty } = candidate;
      const stock = ALL_STOCKS.find(item => item.ticker === ticker);
      if (!stock || !qty) continue;
      const absQty = Math.abs(qty);
      if (qty > 0) {
        const proceeds = price * absQty;
        nextCash += proceeds;
        delete nextHoldings[ticker];
        generatedTransactions.push({
          id: Date.now() + generatedTransactions.length,
          type: "SELL",
          auto: true,
          ticker,
          sectorId: stock.sectorId,
          qty: absQty,
          price,
          avgCostAtSell: position.avgCost,
          proceeds,
          gain: (price - position.avgCost) * absQty,
          gainPct: ((price - position.avgCost) / position.avgCost) * 100,
          time: nowFull(),
          date: new Date().toLocaleDateString(),
        });
      } else {
        const releasedCollateral = (position.avgCost || 0) * absQty;
        nextRestrictedCash = Math.max(0, nextRestrictedCash - releasedCollateral);
        nextCash += ((position.avgCost || 0) - price) * absQty;
        delete nextHoldings[ticker];
        generatedTransactions.push({
          id: Date.now() + generatedTransactions.length,
          type: "COVER",
          auto: true,
          ticker,
          sectorId: stock.sectorId,
          qty: absQty,
          price,
          avgCostAtCover: position.avgCost,
          cost: price * absQty,
          gain: ((position.avgCost || 0) - price) * absQty,
          gainPct: (((position.avgCost || 0) - price) / (position.avgCost || 1)) * 100,
          time: nowFull(),
          date: new Date().toLocaleDateString(),
        });
      }
    } else {
      const { id, position, quote } = candidate;
      const qty = position?.qty || 0;
      if (!qty || !quote) continue;
      const closeUnitPrice = position.kind === "future"
        ? (position.side === "short" ? quote.ask : quote.bid)
        : (position.side === "short" ? quote.ask : quote.bid);
      const multiplier = position.multiplier || quote.multiplier || 1;
      const entryValue = (position.avgCost || 0) * qty * multiplier;
      let realizedValue = 0;
      let gain = 0;
      if (position.kind === "future") {
        realizedValue = entryValue + calcDerivativeCloseValue(position, quote);
        gain = calcDerivativeCloseValue(position, quote);
      } else if (position.side === "short") {
        realizedValue = -closeUnitPrice * qty * multiplier;
        gain = entryValue + realizedValue;
      } else {
        realizedValue = closeUnitPrice * qty * multiplier;
        gain = realizedValue - entryValue;
      }
      nextCash += position.kind === "future"
        ? calcDerivativeCloseValue(position, quote)
        : realizedValue;
      delete nextDerivativePositions[id];
      generatedDerivativeTransactions.push({
        id: Date.now() + generatedTransactions.length + generatedDerivativeTransactions.length,
        type: "DERIV_CLOSE",
        auto: true,
        instrumentId: id,
        label: position.label,
        kind: position.kind,
        side: position.side,
        underlyingTicker: position.underlyingTicker,
        sectorId: position.sectorId,
        qty,
        price: closeUnitPrice,
        avgCostAtOpen: position.avgCost,
        entryValue,
        realizedValue,
        gain,
        gainPct: entryValue > 0 ? (gain / entryValue) * 100 : 0,
        time: nowFull(),
        date: new Date().toLocaleDateString(),
      });
    }
  }

  state.cash = nextCash;
  state.restrictedCash = nextRestrictedCash;
  state.holdings = nextHoldings;
  state.derivativePositions = nextDerivativePositions;
  if (generatedTransactions.length) {
    state.transactions = [...generatedTransactions, ...(state.transactions || [])];
  }
  if (generatedDerivativeTransactions.length) {
    state.derivativeTransactions = [...generatedDerivativeTransactions, ...(state.derivativeTransactions || [])];
  }
  state.marginAlert = {
    type: "forced",
    text: (generatedTransactions.length + generatedDerivativeTransactions.length) > 0
      ? `Auto-deleveraging closed ${generatedTransactions.length + generatedDerivativeTransactions.length} position${(generatedTransactions.length + generatedDerivativeTransactions.length) === 1 ? "" : "s"} to restore maintenance margin.`
      : "Maintenance margin breached. Exposure remains elevated.",
  };
  state.marginGraceEndsAt = null;
  state.roundMarginBreachActive = false;
}

function recomputeStatusFromAnalytics(state, analytics) {
  if (analytics.grossExposure <= 0) {
    state.marginStatus = "safe";
    state.roundMarginBreachActive = false;
    state.marginGraceEndsAt = null;
    return;
  }
  state.marginStatus = analytics.marginBuffer < 0
    ? "call"
    : analytics.marginBufferPct < 5
      ? "watch"
      : "safe";
}

function updatePeakAndDrawdown(state, context) {
  const derivativeQuoteMap = buildTeamDerivativeQuoteMap(state, context);
  const total = calcNetEquityFromState({
    cash: state.cash,
    restrictedCash: state.restrictedCash,
    holdings: state.holdings,
    prices: context.prices,
    derivativePositions: state.derivativePositions,
    derivativeQuoteMap,
    accruedBorrowCost: state.accruedBorrowCost,
    accruedFundingCost: state.accruedFundingCost,
  });
  if (total > state.peakValue) state.peakValue = total;
  const drawdown = state.peakValue > 0 ? ((state.peakValue - total) / state.peakValue) * 100 : 0;
  if (drawdown > state.maxDrawdown) state.maxDrawdown = drawdown;
}

function syncCarryAndMargin(state, context, now = Date.now(), accrueCarry = true) {
  const activeRound = getActiveRoundForState(state, context);
  const roundRule = getRoundRule(activeRound);
  const { analytics, derivativeQuoteMap } = buildAnalyticsForState(state, context, { round: activeRound, roundRule });

  if (context.gamePhase !== "running") {
    state.lastCarryAccrualAt = now;
    recomputeStatusFromAnalytics(state, analytics);
    updatePeakAndDrawdown(state, context);
    return;
  }

  if (accrueCarry) {
    const elapsedMs = state.lastCarryAccrualAt ? Math.max(0, now - state.lastCarryAccrualAt) : TICK_MS;
    const tickFraction = (elapsedMs / 1000) / Math.max(1, getRoundDuration(activeRound));
    const borrowDelta = analytics.shortExposure * (roundRule.borrowRate || 0) * tickFraction;
    const fundingDelta = analytics.leverageUsed * (roundRule.fundingRate || 0) * tickFraction;
    if (borrowDelta > 0) state.accruedBorrowCost += borrowDelta;
    if (fundingDelta > 0) state.accruedFundingCost += fundingDelta;
    if (analytics.grossExposure > 0) {
      state.roundMarginBufferSum += analytics.marginBufferPct;
      state.roundMarginBufferSamples += 1;
    }
  }
  state.lastCarryAccrualAt = now;

  const refreshed = PortfolioAnalytics({
    holdings: state.holdings,
    transactions: [...(state.transactions || []), ...(state.derivativeTransactions || [])],
    prices: context.prices,
    cash: state.cash,
    restrictedCash: state.restrictedCash,
    derivativePositions: state.derivativePositions,
    derivativeQuoteMap,
    accruedBorrowCost: state.accruedBorrowCost,
    accruedFundingCost: state.accruedFundingCost,
    initCash: context.initCash,
    history: context.history,
    roundRule,
  });
  recomputeStatusFromAnalytics(state, refreshed);

  if (refreshed.grossExposure <= 0) {
    state.marginAlert = null;
    updatePeakAndDrawdown(state, context);
    return;
  }

  if (refreshed.marginBuffer < 0) {
    if (!state.roundMarginBreachActive) {
      state.roundMarginBreachActive = true;
      state.roundMarginBreaches += 1;
      state.marginGraceEndsAt = now + (MARGIN_CALL_GRACE_SECS * 1000);
      state.marginAlert = {
        type: "warning",
        text: `Margin call active. Restore maintenance margin within ${MARGIN_CALL_GRACE_SECS}s or the game will auto-deleverage.`,
      };
    } else if (state.marginGraceEndsAt && now >= state.marginGraceEndsAt) {
      autoDeleveragePortfolio(state, context);
    }
  } else if (state.roundMarginBreachActive) {
    state.roundMarginBreachActive = false;
    state.marginGraceEndsAt = null;
    state.marginAlert = {
      type: "recovered",
      text: "Maintenance margin restored. Positions remain open.",
    };
  }

  updatePeakAndDrawdown(state, context);
}

function buildLiveRoundSnapshot(state, context) {
  if (context.gamePhase !== "running" || !state.activeLedgerRound || state.lastFinalizedRound === state.activeLedgerRound) {
    return null;
  }
  return buildRoundScoreSnapshot({
    round: state.activeLedgerRound || context.round,
    startingCapital: state.roundStartValue || context.initCash || INITIAL_CASH,
    cash: state.cash,
    restrictedCash: state.restrictedCash,
    holdings: state.holdings,
    derivativePositions: state.derivativePositions,
    derivativeQuoteMap: buildTeamDerivativeQuoteMap(state, context),
    prices: context.prices,
    history: context.history,
    transactions: [...(state.transactions || []), ...(state.derivativeTransactions || [])],
    ballStartPrice: state.roundBallStartPrice || BALL_BASE,
    prediction: {
      shown: state.roundPredictionShown,
      answered: state.roundPredictionAnswered,
      correct: state.roundPredictionCorrect,
    },
    accruedBorrowCost: state.accruedBorrowCost,
    accruedFundingCost: state.accruedFundingCost,
    roundBorrowCost: Math.max(0, (state.accruedBorrowCost || 0) - (state.roundBorrowCostBase || 0)),
    roundFundingCost: Math.max(0, (state.accruedFundingCost || 0) - (state.roundFundingCostBase || 0)),
    avgMarginBufferPct: state.roundMarginBufferSamples > 0 ? state.roundMarginBufferSum / state.roundMarginBufferSamples : 0,
    marginBreaches: state.roundMarginBreaches || 0,
  });
}

function buildLeaderboardEntry(state, context, team) {
  const liveRound = buildLiveRoundSnapshot(state, context);
  const ledger = sanitizeScoreLedger(state.scoreLedger);
  const allSnapshots = [...ledger.completedRounds, ...(liveRound ? [liveRound] : [])];
  const summary = summarizeScoreSnapshots(allSnapshots);
  const derivativeQuoteMap = buildTeamDerivativeQuoteMap(state, context);
  const currentAssetBeta = calcAverageAssetBeta(state.holdings, context.prices, context.history);
  const currentPortfolioBeta = calcPortfolioBeta(state.holdings, context.prices, context.history);
  const assetBeta = summary.assetBeta != null ? summary.assetBeta : currentAssetBeta;
  const portfolioBeta = summary.portfolioBeta != null ? summary.portfolioBeta : currentPortfolioBeta;
  const ballReturn = compoundPercentSeries(allSnapshots.map(round => round.ballReturn)) ?? calcBallReturn(context.prices);
  const netEquity = calcNetEquityFromState({
    cash: state.cash,
    restrictedCash: state.restrictedCash,
    holdings: state.holdings,
    prices: context.prices,
    derivativePositions: state.derivativePositions,
    derivativeQuoteMap,
    accruedBorrowCost: state.accruedBorrowCost,
    accruedFundingCost: state.accruedFundingCost,
  });
  const row = {
    name: team.name,
    color: team.color,
    total: netEquity,
    netEquity,
    cash: state.cash,
    restrictedCash: state.restrictedCash,
    uniqueSectors: summary.uniqueSectors,
    closedTrades: summary.closedTrades,
    wins: summary.wins,
    maxDrawdown: ledger.maxDrawdownOverall || state.maxDrawdown || 1,
    isBot: false,
    assetBeta,
    portfolioBeta,
    beta: portfolioBeta,
    ballReturn,
    lastTradeTs: summary.lastTradeTs || Date.now(),
    predAsked: summary.predShown,
    predTotal: summary.predAnswered,
    predCorrect: summary.predCorrect,
    currentRound: state.activeLedgerRound || context.round,
    roundReturns: summary.roundReturns,
    marginBufferPct: summary.avgMarginBufferPct,
    marginBreaches: summary.marginBreaches,
    totalBorrowCost: summary.totalBorrowCost,
    totalFundingCost: summary.totalFundingCost,
    totalCarryCost: (summary.totalBorrowCost || 0) + (summary.totalFundingCost || 0),
    scoreLedger: ledger,
    liveRound,
    updatedAt: nowShort(),
  };
  return { ...row, ...calcScore(row, context.initCash) };
}

function resetTeamStateForNewGame(team, context) {
  return createTeamState(team, context.initCash || INITIAL_CASH);
}

function syncTeamState(rawState, context, team, options = {}) {
  let state = normalizeTeamState(rawState, team, context.initCash);
  const now = options.now || Date.now();
  const prevRound = state.lastObservedRound || 0;
  const nextRound = context.round;
  const currentPhase = context.gamePhase || "idle";

  if (currentPhase === "idle" && nextRound === 1 && prevRound > 1) {
    state = resetTeamStateForNewGame(team, context);
    state.lastObservedRound = 0;
    state.processedPortfolioResetId = null;
  }

  const portfolioReset = context.gmState?.portfolioReset;
  if (portfolioReset?.id && portfolioReset.id !== state.processedPortfolioResetId) {
    const resetRound = portfolioReset.sourceRound || prevRound || nextRound || 1;
    if (state.activeLedgerRound === resetRound) {
      settleExpiredDerivativesForState(state, context, resetRound);
      applyPredictionBonusIfEligible(state, context, resetRound);
      finalizeScoreLedgerRoundForState(state, context, resetRound);
    }
    applyPortfolioResetInstruction(state, portfolioReset, context);
    state.processedPortfolioResetId = portfolioReset.id;
  } else if (nextRound && nextRound > prevRound && prevRound > 0 && state.activeLedgerRound === prevRound) {
    settleExpiredDerivativesForState(state, context, prevRound);
    applyPredictionBonusIfEligible(state, context, prevRound);
    finalizeScoreLedgerRoundForState(state, context, prevRound);
  }

  if (currentPhase === "running" && state.activeLedgerRound !== nextRound) {
    startScoreLedgerRoundForState(state, context, nextRound, {
      startingCapital: calcNetEquityFromState({
        cash: state.cash,
        restrictedCash: state.restrictedCash,
        holdings: state.holdings,
        prices: context.prices,
        derivativePositions: state.derivativePositions,
        derivativeQuoteMap: buildTeamDerivativeQuoteMap(state, context, { round: nextRound }),
        accruedBorrowCost: state.accruedBorrowCost,
        accruedFundingCost: state.accruedFundingCost,
      }),
      ballStartPrice: context.prices?.BALL || BALL_BASE,
      predShown: context.predictionSession?.round === nextRound && context.predictionSession?.phase !== "closed",
      predAnswered: false,
      predCorrect: false,
    });
  }

  updatePredictionFlags(state, context);

  if (currentPhase !== "running" && Object.keys(state.derivativePositions || {}).length > 0) {
    settleExpiredDerivativesForState(state, context, state.activeLedgerRound || nextRound || 1);
  }

  if (["ceremony", "ended"].includes(currentPhase) && state.activeLedgerRound === (nextRound || prevRound)) {
    applyPredictionBonusIfEligible(state, context, nextRound || prevRound);
    finalizeScoreLedgerRoundForState(state, context, nextRound || prevRound);
  }

  syncCarryAndMargin(state, context, now, options.accrueCarry !== false);

  state.lastObservedRound = nextRound || prevRound;
  state.lastObservedPhase = currentPhase;
  return state;
}

function assertTeamCanTrade(context) {
  const activePredictionPhase = ["polling", "revealing"].includes(context.predictionSession?.phase);
  if (context.gamePhase !== "running") throw new Error("Trading is closed right now.");
  if (context.frozenUntil && Date.now() < context.frozenUntil) throw new Error("Trading is temporarily frozen.");
  if (context.haltedUntil && Date.now() < context.haltedUntil) throw new Error("The market is currently halted.");
  if (activePredictionPhase) throw new Error("Trading is paused during the prediction market.");
}

function getDerivativeStrategyDefinition(strategyId = "protective_put") {
  return DERIVATIVE_STRATEGY_PRESETS.find(entry => entry.id === strategyId) || DERIVATIVE_STRATEGY_PRESETS[0] || {
    id: strategyId,
    label: strategyId,
    needsLongShares: false,
  };
}

function getDerivativeStrategyPackageMetrics({
  strategyId = "protective_put",
  legs = [],
  netCashflow = 0,
  coveredShares = 0,
} = {}) {
  if (!legs.length) {
    return {
      totalRisk: 0,
      maxGain: Math.max(0, netCashflow),
      maxLoss: Math.max(0, -netCashflow),
    };
  }

  if (strategyId === "protective_put" || strategyId === "collar") {
    const maxLoss = Math.max(0, -netCashflow);
    return {
      totalRisk: maxLoss,
      maxGain: Math.max(0, netCashflow),
      maxLoss,
    };
  }

  if (strategyId === "bull_put_spread" || strategyId === "bear_call_spread") {
    const shortLeg = legs.find(leg => leg.side === "short");
    const longLeg = legs.find(leg => leg.side === "long");
    const width = Math.abs((shortLeg?.instrument.strike || 0) - (longLeg?.instrument.strike || 0)) * coveredShares;
    const maxGain = Math.max(0, netCashflow);
    const maxLoss = Math.max(0, width - maxGain);
    return { totalRisk: maxLoss, maxGain, maxLoss, width };
  }

  if (strategyId === "iron_condor" || strategyId === "bull_iron_condor") {
    const shortPut = legs.find(leg => leg.side === "short" && leg.instrument.kind === "put");
    const longPut = legs.find(leg => leg.side === "long" && leg.instrument.kind === "put");
    const shortCall = legs.find(leg => leg.side === "short" && leg.instrument.kind === "call");
    const longCall = legs.find(leg => leg.side === "long" && leg.instrument.kind === "call");
    const putWidth = Math.max(0, ((shortPut?.instrument.strike || 0) - (longPut?.instrument.strike || 0)) * coveredShares);
    const callWidth = Math.max(0, ((longCall?.instrument.strike || 0) - (shortCall?.instrument.strike || 0)) * coveredShares);
    const maxGain = Math.max(0, netCashflow);
    const maxLoss = Math.max(0, Math.max(putWidth, callWidth) - maxGain);
    return { totalRisk: maxLoss, maxGain, maxLoss, putWidth, callWidth };
  }

  const grossRisk = legs.reduce((sum, leg) => sum + Math.max(0, leg.risk || 0), 0);
  return {
    totalRisk: grossRisk,
    maxGain: Math.max(0, netCashflow),
    maxLoss: grossRisk,
  };
}

function applyDerivativeOpenToState(state, team, instrument, quote, qty, side = "long") {
  const existing = state.derivativePositions[instrument.id];
  const isFuture = instrument.kind === "future";
  const multiplier = instrument.multiplier || quote.multiplier || 1;
  const openUnitPrice = side === "short" ? quote.bid : quote.ask;
  const premiumCashflow = isFuture ? 0 : (openUnitPrice * qty * multiplier * (side === "short" ? 1 : -1));
  const nextQty = (existing?.qty || 0) + qty;
  const weightedAvg = existing?.qty
    ? (((existing.avgCost || 0) * existing.qty) + (openUnitPrice * qty)) / nextQty
    : openUnitPrice;

  if (premiumCashflow !== 0) state.cash += premiumCashflow;
  state.derivativePositions = {
    ...state.derivativePositions,
    [instrument.id]: {
      id: instrument.id,
      round: instrument.round,
      label: instrument.label,
      kind: instrument.kind,
      side,
      underlyingTicker: instrument.underlyingTicker,
      underlyingName: instrument.underlyingName,
      sectorId: instrument.sectorId,
      strike: instrument.strike,
      multiplier,
      qty: nextQty,
      avgCost: weightedAvg,
      openedAt: existing?.openedAt || Date.now(),
    },
  };
  const trade = {
    id: Date.now(),
    type: "DERIV_OPEN",
    instrumentId: instrument.id,
    label: instrument.label,
    kind: instrument.kind,
    side,
    underlyingTicker: instrument.underlyingTicker,
    sectorId: instrument.sectorId,
    qty,
    price: openUnitPrice,
    entryValue: openUnitPrice * qty * multiplier,
    time: nowFull(),
    date: new Date().toLocaleDateString(),
  };
  state.derivativeTransactions = [trade, ...(state.derivativeTransactions || [])];
  return {
    event: {
      team: team.name,
      teamColor: team.color,
      action: getDerivativeOpenActionLabel(instrument.kind, side),
      ticker: instrument.underlyingTicker,
      underlyingTicker: instrument.underlyingTicker,
      qty,
      price: openUnitPrice,
      time: nowShort(),
      assetType: "derivative",
      derivativeKind: instrument.kind,
      derivativeSide: side,
      multiplier,
      flowDirection: getDerivativeTradeFlowDirection(instrument.kind, side, "open"),
      flowWeight: (getDerivativeRiskEquivalent(quote, side) || openUnitPrice * multiplier) * qty * (isFuture ? 1 : 0.85),
    },
  };
}

function executeTradeAction(state, context, team, payload = {}) {
  assertTeamCanTrade(context);
  const action = String(payload.action || "").toUpperCase();
  const qty = Math.max(0, Number(payload.qty) || 0);
  if (action !== "DERIV_STRATEGY" && qty <= 0) throw new Error("Quantity must be greater than 0.");

  const activeRound = getActiveRoundForState(state, context);
  const roundRule = getRoundRule(activeRound);
  const tradeSpreadRate = BASE_SPREAD_RATE * (roundRule?.spreadMult || 1);
  const { analytics, derivativeQuoteMap } = buildAnalyticsForState(state, context, { round: activeRound, roundRule });

  if (action === "BUY" || action === "SELL" || action === "SHORT" || action === "COVER") {
    const ticker = String(payload.ticker || "").toUpperCase();
    const stock = ALL_STOCKS.find(item => item.ticker === ticker);
    const price = context.prices[ticker];
    const position = state.holdings[ticker];
    if (!stock || !price) throw new Error("Unknown stock.");

    if (action === "BUY") {
      const fillPrice = price * (1 + tradeSpreadRate);
      const total = fillPrice * qty;
      const existingPosition = state.holdings[ticker];
      if (total > analytics.buyingPower || shortQty(existingPosition) > 0) throw new Error("Buy order rejected.");
      const existingQty = longQty(existingPosition);
      const nextQty = existingQty + qty;
      const nextAvgCost = existingQty > 0
        ? (((existingPosition.avgCost || 0) * existingQty) + total) / nextQty
        : fillPrice;
      state.cash -= total;
      state.holdings = { ...state.holdings, [ticker]: { qty: nextQty, avgCost: nextAvgCost } };
      const trade = {
        id: Date.now(),
        type: "BUY",
        ticker,
        sectorId: stock.sectorId,
        qty,
        price: fillPrice,
        avgCostAtBuy: fillPrice,
        total,
        time: nowFull(),
        date: new Date().toLocaleDateString(),
      };
      state.transactions = [trade, ...(state.transactions || [])];
      return {
        event: {
          team: team.name,
          teamColor: team.color,
          action: "BUY",
          ticker,
          qty,
          price: fillPrice,
          time: nowShort(),
        },
      };
    }

    if (action === "SELL") {
      const fillPrice = price * (1 - tradeSpreadRate);
      const heldQty = longQty(position);
      if (!position || heldQty < qty) throw new Error("Sell order rejected.");
      const proceeds = fillPrice * qty;
      const gain = (fillPrice - position.avgCost) * qty;
      const newQty = heldQty - qty;
      state.cash += proceeds;
      const nextHoldings = { ...(state.holdings || {}) };
      if (newQty <= 0) delete nextHoldings[ticker];
      else nextHoldings[ticker] = { qty: newQty, avgCost: position.avgCost };
      state.holdings = nextHoldings;
      const trade = {
        id: Date.now(),
        type: "SELL",
        ticker,
        sectorId: stock.sectorId,
        qty,
        price: fillPrice,
        avgCostAtSell: position.avgCost,
        proceeds,
        gain,
        gainPct: ((fillPrice - position.avgCost) / position.avgCost) * 100,
        time: nowFull(),
        date: new Date().toLocaleDateString(),
      };
      state.transactions = [trade, ...(state.transactions || [])];
      return {
        event: {
          team: team.name,
          teamColor: team.color,
          action: "SELL",
          ticker,
          qty,
          price: fillPrice,
          time: nowShort(),
        },
      };
    }

    if (action === "SHORT") {
      const fillPrice = price * (1 - tradeSpreadRate);
      const orderValue = fillPrice * qty;
      const existingShortQty = shortQty(position);
      if (longQty(position) > 0 || orderValue > analytics.buyingPower) throw new Error("Short order rejected.");
      const nextAbsQty = existingShortQty + qty;
      const nextAvgCost = existingShortQty > 0
        ? (((position.avgCost || 0) * existingShortQty) + orderValue) / nextAbsQty
        : fillPrice;
      state.restrictedCash += orderValue;
      state.holdings = { ...state.holdings, [ticker]: { qty: -nextAbsQty, avgCost: nextAvgCost } };
      const trade = {
        id: Date.now(),
        type: "SHORT",
        ticker,
        sectorId: stock.sectorId,
        qty,
        price: fillPrice,
        avgCostAtShort: fillPrice,
        proceeds: orderValue,
        time: nowFull(),
        date: new Date().toLocaleDateString(),
      };
      state.transactions = [trade, ...(state.transactions || [])];
      return {
        event: {
          team: team.name,
          teamColor: team.color,
          action: "SHORT",
          ticker,
          qty,
          price: fillPrice,
          time: nowShort(),
        },
      };
    }

    if (action === "COVER") {
      const fillPrice = price * (1 + tradeSpreadRate);
      const currentShortQty = shortQty(position);
      if (!position || currentShortQty < qty) throw new Error("Cover order rejected.");
      const gain = (position.avgCost - fillPrice) * qty;
      const remainingShort = currentShortQty - qty;
      const releasedCollateral = position.avgCost * qty;
      state.restrictedCash = Math.max(0, state.restrictedCash - releasedCollateral);
      state.cash += gain;
      const nextHoldings = { ...(state.holdings || {}) };
      if (remainingShort <= 0) delete nextHoldings[ticker];
      else nextHoldings[ticker] = { qty: -remainingShort, avgCost: position.avgCost };
      state.holdings = nextHoldings;
      const trade = {
        id: Date.now(),
        type: "COVER",
        ticker,
        sectorId: stock.sectorId,
        qty,
        price: fillPrice,
        avgCostAtCover: position.avgCost,
        cost: fillPrice * qty,
        gain,
        gainPct: ((position.avgCost - fillPrice) / position.avgCost) * 100,
        time: nowFull(),
        date: new Date().toLocaleDateString(),
      };
      state.transactions = [trade, ...(state.transactions || [])];
      return {
        event: {
          team: team.name,
          teamColor: team.color,
          action: "COVER",
          ticker,
          qty,
          price: fillPrice,
          time: nowShort(),
        },
      };
    }
  }

  if (action === "DERIV_STRATEGY") {
    const strategyId = String(payload.strategyId || "protective_put");
    const strategyPreset = getDerivativeStrategyDefinition(strategyId);
    const legs = Array.isArray(payload.legs) ? payload.legs : [];
    const derivativeCatalog = buildDerivativeCatalog({
      round: activeRound,
      prices: context.prices,
      roundRule,
      timeLeft: context.timeLeft,
      roundDur: getRoundDuration(activeRound),
      gamePhase: context.gamePhase,
      roundBases: state.roundDerivativeBase || buildRoundDerivativeBases(context.prices),
    });
    if (!legs.length) throw new Error("Strategy has no legs.");
    const strategyLegs = legs.map((leg, index) => {
      const legQty = Math.max(0, Number(leg.qty) || 0);
      const instrumentId = String(leg.instrumentId || "");
      if (legQty <= 0 || !instrumentId) throw new Error(`Strategy leg ${index + 1} is invalid.`);
      const instrument = derivativeCatalog.find(entry => entry.id === instrumentId);
      const quote = derivativeQuoteMap[instrumentId];
      const side = leg.side === "short" ? "short" : "long";
      if (!instrument || !quote) throw new Error("Unknown derivative instrument.");
      const multiplier = instrument.multiplier || quote.multiplier || 1;
      const openUnitPrice = side === "short" ? quote.bid : quote.ask;
      return {
        instrument,
        quote,
        qty: legQty,
        side,
        multiplier,
        cashflow: instrument.kind === "future"
          ? 0
          : (openUnitPrice * legQty * multiplier * (side === "short" ? 1 : -1)),
        risk: getDerivativeRiskEquivalent(quote, side) * legQty,
      };
    });
    const strategyTicker = strategyLegs[0]?.instrument?.underlyingTicker || "";
    const coveredShares = strategyLegs.reduce((maxShares, leg) => (
      Math.max(maxShares, (leg.qty || 0) * (leg.multiplier || 1))
    ), 0);
    const longShares = longQty(state.holdings[strategyTicker]);
    if (strategyPreset.needsLongShares && longShares < coveredShares) {
      throw new Error(`${strategyPreset.label} needs ${coveredShares} long shares of ${strategyTicker}. Current inventory: ${longShares}.`);
    }
    const packageMetrics = getDerivativeStrategyPackageMetrics({
      strategyId,
      legs: strategyLegs,
      netCashflow: strategyLegs.reduce((sum, leg) => sum + leg.cashflow, 0),
      coveredShares,
    });
    if ((packageMetrics.totalRisk || 0) > analytics.buyingPower) {
      throw new Error("Strategy package exceeds buying power.");
    }
    const stagedState = normalizeTeamState(JSON.parse(JSON.stringify(state)), team, context.initCash);
    const events = [];
    strategyLegs.forEach(leg => {
      const existing = stagedState.derivativePositions[leg.instrument.id];
      if (existing && existing.side !== leg.side) {
        throw new Error("Opposite direction is already open on this contract.");
      }
      const result = applyDerivativeOpenToState(stagedState, team, leg.instrument, leg.quote, leg.qty, leg.side);
      if (Array.isArray(result?.event)) events.push(...result.event.filter(Boolean));
      else if (result?.event) events.push(result.event);
    });
    Object.assign(state, stagedState);
    return {
      event: events.map(event => ({
        ...event,
        strategyId,
        strategyName: payload.strategyName || null,
      })),
    };
  }

  if (action === "DERIV_OPEN" || action === "DERIV_CLOSE") {
    const instrumentId = String(payload.instrumentId || "");
    const requestedSide = payload.side === "short" ? "short" : "long";
    const derivativeCatalog = buildDerivativeCatalog({
      round: activeRound,
      prices: context.prices,
      roundRule,
      timeLeft: context.timeLeft,
      roundDur: getRoundDuration(activeRound),
      gamePhase: context.gamePhase,
      roundBases: state.roundDerivativeBase || buildRoundDerivativeBases(context.prices),
    });
    const instrument = derivativeCatalog.find(entry => entry.id === instrumentId);
    const quote = derivativeQuoteMap[instrumentId];
    if (!instrument || !quote) throw new Error("Unknown derivative instrument.");

    if (action === "DERIV_OPEN") {
      const existing = state.derivativePositions[instrument.id];
      const side = requestedSide;
      if (existing && existing.side !== side) {
        throw new Error("Opposite direction is already open on this contract.");
      }
      const orderExposure = getDerivativeRiskEquivalent(quote, side) * qty;
      if (orderExposure > analytics.buyingPower) throw new Error("Derivative order rejected.");
      return applyDerivativeOpenToState(state, team, instrument, quote, qty, side);
    }

    if (action === "DERIV_CLOSE") {
      const position = state.derivativePositions[instrumentId];
      if (!position) throw new Error("No open derivative position.");
      const closeQty = Math.min(qty, position.qty || 0);
      if (closeQty <= 0) throw new Error("Derivative close rejected.");
      const multiplier = position.multiplier || quote.multiplier || 1;
      const entryValue = (position.avgCost || 0) * closeQty * multiplier;
      let realizedValue = 0;
      let gain = 0;
      let closeUnitPrice = 0;

      if (position.kind === "future") {
        closeUnitPrice = position.side === "short" ? quote.ask : quote.bid;
        gain = (closeUnitPrice - (position.avgCost || 0)) * closeQty * multiplier * (position.side === "short" ? -1 : 1);
        realizedValue = entryValue + gain;
        state.cash += gain;
      } else {
        closeUnitPrice = position.side === "short" ? quote.ask : quote.bid;
        realizedValue = closeUnitPrice * closeQty * multiplier * (position.side === "short" ? -1 : 1);
        gain = position.side === "short"
          ? (entryValue + realizedValue)
          : (realizedValue - entryValue);
        state.cash += realizedValue;
      }

      const remaining = (position.qty || 0) - closeQty;
      const nextPositions = { ...(state.derivativePositions || {}) };
      if (remaining <= 0) delete nextPositions[instrumentId];
      else nextPositions[instrumentId] = { ...position, qty: remaining };
      state.derivativePositions = nextPositions;
      const trade = {
        id: Date.now(),
        type: "DERIV_CLOSE",
        instrumentId,
        label: position.label,
        kind: position.kind,
        side: position.side,
        underlyingTicker: position.underlyingTicker,
        sectorId: position.sectorId,
        qty: closeQty,
        price: closeUnitPrice,
        avgCostAtOpen: position.avgCost,
        entryValue,
        realizedValue,
        gain,
        gainPct: entryValue > 0 ? (gain / entryValue) * 100 : 0,
        time: nowFull(),
        date: new Date().toLocaleDateString(),
      };
      state.derivativeTransactions = [trade, ...(state.derivativeTransactions || [])];
      return {
        event: {
          team: team.name,
          teamColor: team.color,
          action: position.kind === "future" ? "FUT CLOSE" : "OPT CLOSE",
          ticker: position.underlyingTicker,
          underlyingTicker: position.underlyingTicker,
          qty: closeQty,
          price: closeUnitPrice,
          time: nowShort(),
          assetType: "derivative",
          derivativeKind: position.kind,
          derivativeSide: position.side,
          multiplier,
          flowDirection: getDerivativeTradeFlowDirection(position.kind, position.side, "close"),
          flowWeight: (getDerivativeRiskEquivalent(quote, position.side) || closeUnitPrice * multiplier) * closeQty * (position.kind === "future" ? 1 : 0.7),
        },
      };
    }
  }

  throw new Error("Unsupported trade action.");
}

module.exports = {
  ALL_STOCKS,
  BALL_BASE,
  CRISIS_ROUNDS,
  DEFAULT_ROUND_DURATIONS,
  INITIAL_CASH,
  ROUND_RULES,
  TEAM_STATE_PREFIX,
  buildGameContext,
  buildLeaderboardEntry,
  buildTeamStateKey,
  createTeamState,
  normalizeTeamState,
  normalizeTradeFeedItem,
  sanitizeTeamStateForClient,
  syncTeamState,
  executeTradeAction,
};
