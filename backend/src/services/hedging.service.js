const { getPositions } = require("./position.service");
const { createPaperTrade } = require("./paperTrade.service");
const {
  getLiveQuote,
  getMarketStreamStatus,
} = require("./angelWebSocket.service");

const SAMPLE_PORTFOLIO = [
  {
    symbol: "RELIANCE",
    exchange: "NSE",
    side: "BUY",
    quantity: 10,
    averagePrice: 2800,
    currentPrice: 2850,
    sector: "ENERGY",
  },
  {
    symbol: "HDFCBANK",
    exchange: "NSE",
    side: "BUY",
    quantity: 12,
    averagePrice: 1650,
    currentPrice: 1680,
    sector: "BANKING",
  },
];
const DEFAULT_ASSUMPTIONS = {
  hedgeThreshold: 10000,
  targetCoveragePercent: 75,
  niftyLotSize: 75,
  bankNiftyLotSize: 30,
  premiumPercent: 1,
};

let lastAnalysis = null;
let lastAppliedHedge = null;

class HedgingError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "HedgingError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function normalizePosition(position, index) {
  const symbol =
    typeof position?.symbol === "string"
      ? position.symbol.trim().toUpperCase()
      : "";
  const side =
    typeof position?.side === "string"
      ? position.side.trim().toUpperCase()
      : "";
  const quantity = Number(position?.quantity);
  const currentPrice = Number(
    position?.currentPrice ?? position?.averagePrice
  );

  if (!symbol || !/^[A-Z0-9&.-]+$/.test(symbol)) {
    throw new HedgingError(
      `Portfolio position ${index + 1} has an invalid symbol`,
      400
    );
  }
  if (!["BUY", "SELL"].includes(side)) {
    throw new HedgingError(
      `Portfolio position ${index + 1} side must be BUY or SELL`,
      400
    );
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new HedgingError(
      `Portfolio position ${index + 1} quantity must be positive`,
      400
    );
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new HedgingError(
      `Portfolio position ${index + 1} currentPrice must be positive`,
      400
    );
  }

  return {
    symbol,
    exchange: position.exchange || "NSE",
    side,
    quantity,
    currentPrice,
    sector:
      typeof position.sector === "string" && position.sector.trim()
        ? position.sector.trim().toUpperCase()
        : "UNCLASSIFIED",
  };
}

async function loadPortfolio(input = {}) {
  if (Array.isArray(input.portfolio) && input.portfolio.length > 0) {
    return {
      source: "REQUEST_PORTFOLIO",
      positions: input.portfolio.map(normalizePosition),
    };
  }

  try {
    const openPositions = await getPositions("OPEN");
    if (openPositions.length > 0) {
      return {
        source: "LIVE_PAPER_PORTFOLIO",
        positions: openPositions.map(normalizePosition),
      };
    }
  } catch (error) {
    console.error("Hedging portfolio load failed", {
      message: error.message,
    });
  }

  return {
    source: "SAMPLE_FALLBACK",
    positions: SAMPLE_PORTFOLIO.map(normalizePosition),
  };
}

function calculateExposure(positions) {
  const symbols = new Map();
  const sectors = new Map();
  let longExposure = 0;
  let shortExposure = 0;

  for (const position of positions) {
    const value = position.quantity * position.currentPrice;
    const signedExposure = position.side === "BUY" ? value : -value;
    longExposure += Math.max(signedExposure, 0);
    shortExposure += Math.abs(Math.min(signedExposure, 0));

    const symbolEntry = symbols.get(position.symbol) || {
      symbol: position.symbol,
      exchange: position.exchange,
      netExposure: 0,
      longExposure: 0,
      shortExposure: 0,
    };
    symbolEntry.netExposure += signedExposure;
    symbolEntry.longExposure += Math.max(signedExposure, 0);
    symbolEntry.shortExposure += Math.abs(Math.min(signedExposure, 0));
    symbols.set(position.symbol, symbolEntry);

    const sectorEntry = sectors.get(position.sector) || {
      sector: position.sector,
      netExposure: 0,
      grossExposure: 0,
    };
    sectorEntry.netExposure += signedExposure;
    sectorEntry.grossExposure += Math.abs(signedExposure);
    sectors.set(position.sector, sectorEntry);
  }

  return {
    grossExposure: round(longExposure + shortExposure),
    longExposure: round(longExposure),
    shortExposure: round(shortExposure),
    netExposure: round(longExposure - shortExposure),
    symbolWiseExposure: Array.from(symbols.values()).map((item) => ({
      ...item,
      netExposure: round(item.netExposure),
      longExposure: round(item.longExposure),
      shortExposure: round(item.shortExposure),
    })),
    sectorWiseExposure: Array.from(sectors.values()).map((item) => ({
      ...item,
      netExposure: round(item.netExposure),
      grossExposure: round(item.grossExposure),
      classification:
        item.sector === "UNCLASSIFIED"
          ? "PLACEHOLDER"
          : "PROVIDED_OR_INFERRED",
    })),
  };
}

function parseAssumption(value, fallback, fieldName) {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new HedgingError(`${fieldName} must be a positive number`, 400);
  }
  return number;
}

function chooseIndex(input, exposure) {
  const requested =
    typeof input.index === "string"
      ? input.index.trim().toUpperCase()
      : "";
  if (requested && !["NIFTY", "BANKNIFTY"].includes(requested)) {
    throw new HedgingError("index must be NIFTY or BANKNIFTY", 400);
  }
  if (requested) {
    return requested;
  }

  const bankExposure = exposure.sectorWiseExposure
    .filter((item) => item.sector === "BANKING")
    .reduce((sum, item) => sum + item.grossExposure, 0);
  return bankExposure > exposure.grossExposure / 2
    ? "BANKNIFTY"
    : "NIFTY";
}

function getSpot(index, input) {
  const provided = Number(input.spotPrice);
  if (Number.isFinite(provided) && provided > 0) {
    return { spot: provided, priceSource: "REQUEST" };
  }
  const quote = getLiveQuote(index);
  if (quote?.ltp) {
    return { spot: quote.ltp, priceSource: quote.source };
  }
  return { spot: null, priceSource: "UNAVAILABLE" };
}

async function analyzePortfolio(input = {}) {
  const portfolio = await loadPortfolio(input);
  const exposure = calculateExposure(portfolio.positions);
  const threshold = parseAssumption(
    input.hedgeThreshold,
    DEFAULT_ASSUMPTIONS.hedgeThreshold,
    "hedgeThreshold"
  );
  const hedgeRequired = Math.abs(exposure.netExposure) >= threshold;

  lastAnalysis = {
    mode: "PAPER_ONLY",
    portfolioSource: portfolio.source,
    sampleDataUsed: portfolio.source === "SAMPLE_FALLBACK",
    positionCount: portfolio.positions.length,
    positions: portfolio.positions,
    ...exposure,
    hedgeThreshold: threshold,
    hedgeRequired,
    hedgeReason: hedgeRequired
      ? "Net portfolio exposure exceeds the hedge threshold"
      : "Net portfolio exposure is within the configured threshold",
    analyzedAt: new Date().toISOString(),
  };
  return lastAnalysis;
}

async function suggestHedge(input = {}) {
  const analysis = await analyzePortfolio(input);
  const index = chooseIndex(input, analysis);
  const { spot, priceSource } = getSpot(index, input);
  const lotSize = parseAssumption(
    input.lotSize,
    index === "BANKNIFTY"
      ? DEFAULT_ASSUMPTIONS.bankNiftyLotSize
      : DEFAULT_ASSUMPTIONS.niftyLotSize,
    "lotSize"
  );
  const coveragePercent = parseAssumption(
    input.targetCoveragePercent,
    DEFAULT_ASSUMPTIONS.targetCoveragePercent,
    "targetCoveragePercent"
  );
  if (coveragePercent > 100) {
    throw new HedgingError(
      "targetCoveragePercent must not exceed 100",
      400
    );
  }
  const netExposure = Math.abs(analysis.netExposure);
  const hedgeNotional = netExposure * (coveragePercent / 100);
  const lots =
    analysis.hedgeRequired && spot
      ? Math.max(Math.ceil(hedgeNotional / (spot * lotSize)), 1)
      : 0;
  const quantity = lots * lotSize;
  const premiumPercent = parseAssumption(
    input.premiumPercent,
    DEFAULT_ASSUMPTIONS.premiumPercent,
    "premiumPercent"
  );
  const estimatedPremium = spot
    ? parseAssumption(
        input.optionPremium,
        spot * (premiumPercent / 100),
        "optionPremium"
      )
    : null;
  const optionType = analysis.netExposure >= 0 ? "PE" : "CE";
  const riskReductionPercentage =
    netExposure === 0 || !spot
      ? 0
      : Math.min(
          (quantity * spot * 100) / netExposure,
          coveragePercent,
          100
        );

  return {
    ...analysis,
    suggestion: {
      index,
      optionType,
      action: "BUY",
      instrument: `${index}-${optionType}-PAPER-HEDGE`,
      spot,
      priceSource,
      lotSize,
      lots,
      suggestedHedgeQuantity: quantity,
      estimatedOptionPremium:
        estimatedPremium === null ? null : round(estimatedPremium),
      hedgeCostEstimate:
        estimatedPremium === null
          ? null
          : round(estimatedPremium * quantity),
      targetCoveragePercent: coveragePercent,
      riskReductionPercentage: round(riskReductionPercentage),
      executable:
        analysis.hedgeRequired &&
        quantity > 0 &&
        estimatedPremium !== null,
      note:
        "Option premium and risk reduction are estimates for paper hedging, not broker quotes or guaranteed outcomes.",
    },
  };
}

async function applyPaperHedge(input = {}) {
  const result = await suggestHedge(input);
  const suggestion = result.suggestion;

  if (!result.hedgeRequired) {
    throw new HedgingError("Portfolio does not currently require a hedge", 409);
  }
  if (!suggestion.executable) {
    throw new HedgingError(
      "A live index price or explicit spotPrice is required to apply the paper hedge",
      400
    );
  }

  const trade = await createPaperTrade("BUY", {
    symbol: suggestion.instrument,
    exchange: "NFO",
    quantity: suggestion.suggestedHedgeQuantity,
    price: suggestion.estimatedOptionPremium,
  });
  lastAppliedHedge = {
    status: "ACTIVE",
    mode: "PAPER_ONLY",
    trade,
    suggestion,
    appliedAt: new Date().toISOString(),
  };

  return {
    message: "Paper hedge applied",
    ...lastAppliedHedge,
  };
}

async function getHedgeStatus() {
  const analysis = lastAnalysis || (await analyzePortfolio());
  return {
    mode: "PAPER_ONLY",
    marketStream: getMarketStreamStatus(),
    hedgeRequired: analysis.hedgeRequired,
    netExposure: analysis.netExposure,
    grossExposure: analysis.grossExposure,
    portfolioSource: analysis.portfolioSource,
    sampleDataUsed: analysis.sampleDataUsed,
    activePaperHedge: lastAppliedHedge,
    status: lastAppliedHedge ? "HEDGED" : analysis.hedgeRequired ? "HEDGE_RECOMMENDED" : "BALANCED",
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  HedgingError,
  calculateExposure,
  analyzePortfolio,
  suggestHedge,
  applyPaperHedge,
  getHedgeStatus,
};
