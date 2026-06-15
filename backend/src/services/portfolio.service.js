const { getPositions } = require("./position.service");
const { getPaperTrades } = require("./paperTrade.service");
const { getOrders } = require("./order.service");
const { getDashboardSummary } = require("./dashboard.service");

class PortfolioError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "PortfolioError";
    this.statusCode = statusCode;
  }
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function mapHolding(position) {
  const investedValue = position.averagePrice * position.quantity;
  const currentValue = position.currentPrice * position.quantity;
  const pnlPercent =
    investedValue === 0
      ? 0
      : (position.unrealizedPnl / investedValue) * 100;

  return {
    symbol: position.symbol,
    exchange: position.exchange,
    quantity: position.quantity,
    averagePrice: position.averagePrice,
    currentPrice: position.currentPrice,
    investedValue: round(investedValue),
    currentValue: round(currentValue),
    unrealizedPnL: round(position.unrealizedPnl),
    pnlPercent: round(pnlPercent),
  };
}

async function loadPortfolioData() {
  try {
    const [allPositions, paperTrades, dashboard, orders] =
      await Promise.all([
        getPositions(),
        getPaperTrades(),
        getDashboardSummary(),
        getOrders(),
      ]);
    const openPositions = allPositions.filter(
      (position) => position.status === "OPEN"
    );
    const holdings = openPositions.map(mapHolding);
    const closedTrades = paperTrades.filter(
      (trade) => trade.status === "CLOSED"
    );

    return {
      openPositions,
      allPositions,
      holdings,
      closedTrades,
      dashboard,
      orders,
    };
  } catch (error) {
    throw new PortfolioError("Unable to load portfolio data");
  }
}

function calculatePnL(data) {
  const realizedPnL = data.closedTrades.reduce(
    (sum, trade) => sum + trade.pnl,
    0
  );
  const unrealizedPnL = data.openPositions.reduce(
    (sum, position) => sum + position.unrealizedPnl,
    0
  );

  return {
    realizedPnL: round(realizedPnL),
    unrealizedPnL: round(unrealizedPnL),
    totalPnL: round(realizedPnL + unrealizedPnL),
    winningPositions: data.allPositions.filter(
      (position) =>
        (position.status === "OPEN"
          ? position.unrealizedPnl
          : position.realizedPnl) > 0
    ).length,
    losingPositions: data.allPositions.filter(
      (position) =>
        (position.status === "OPEN"
          ? position.unrealizedPnl
          : position.realizedPnl) < 0
    ).length,
  };
}

async function getPortfolioSummary() {
  const data = await loadPortfolioData();
  const pnl = calculatePnL(data);
  const usedCapital = data.holdings.reduce(
    (sum, holding) => sum + holding.investedValue,
    0
  );
  const totalCapital = data.dashboard.capital;

  return {
    totalCapital,
    usedCapital: round(usedCapital),
    availableCapital: round(totalCapital - usedCapital),
    totalHoldings: new Set(
      data.holdings.map(
        (holding) => `${holding.exchange}:${holding.symbol}`
      )
    ).size,
    openPositions: data.openPositions.length,
    realizedPnL: pnl.realizedPnL,
    unrealizedPnL: pnl.unrealizedPnL,
    totalPnL: pnl.totalPnL,
  };
}

async function getPortfolioHoldings() {
  const data = await loadPortfolioData();
  return data.holdings;
}

async function getPortfolioPnL() {
  return calculatePnL(await loadPortfolioData());
}

async function getPortfolioAllocation() {
  const data = await loadPortfolioData();
  const allocation = new Map();
  const usedCapital = data.holdings.reduce(
    (sum, holding) => sum + holding.investedValue,
    0
  );

  for (const holding of data.holdings) {
    const key = `${holding.exchange}:${holding.symbol}`;
    const existing = allocation.get(key) || {
      symbol: holding.symbol,
      exchange: holding.exchange,
      investedValue: 0,
    };
    existing.investedValue += holding.investedValue;
    allocation.set(key, existing);
  }

  return Array.from(allocation.values()).map((item) => ({
    symbol: item.symbol,
    exchange: item.exchange,
    investedValue: round(item.investedValue),
    percentageOfCapitalUsed:
      data.dashboard.capital === 0
        ? 0
        : round((item.investedValue / data.dashboard.capital) * 100),
    allocationPercent:
      usedCapital === 0
        ? 0
        : round((item.investedValue / usedCapital) * 100),
  }));
}

async function getPortfolioAnalytics() {
  const data = await loadPortfolioData();
  const ranked = [...data.holdings].sort(
    (left, right) => right.pnlPercent - left.pnlPercent
  );
  const totalExposure = data.holdings.reduce(
    (sum, holding) => sum + holding.currentValue,
    0
  );
  const averagePnLPercent =
    data.holdings.length === 0
      ? 0
      : data.holdings.reduce(
          (sum, holding) => sum + holding.pnlPercent,
          0
        ) / data.holdings.length;

  return {
    bestHolding: ranked[0] || null,
    worstHolding: ranked[ranked.length - 1] || null,
    totalExposure: round(totalExposure),
    averagePnLPercent: round(averagePnLPercent),
  };
}

module.exports = {
  PortfolioError,
  getPortfolioSummary,
  getPortfolioHoldings,
  getPortfolioPnL,
  getPortfolioAllocation,
  getPortfolioAnalytics,
};
