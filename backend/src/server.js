const express = require("express");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const app = express();
app.use(express.json());

const brokerRoutes = require("./routes/broker.routes");
const healthRoutes = require("./routes/health.routes");
const marketRoutes = require("./routes/market.routes");
const watchlistRoutes = require("./routes/watchlist.routes");
const signalRoutes = require("./routes/signal.routes");
const riskRoutes = require("./routes/risk.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const paperTradeRoutes = require("./routes/paperTrade.routes");
const positionRoutes = require("./routes/position.routes");
const journalRoutes = require("./routes/journal.routes");
const backtestRoutes = require("./routes/backtest.routes");
const strategyRoutes = require("./routes/strategy.routes");
const orderRoutes = require("./routes/order.routes");
const portfolioRoutes = require("./routes/portfolio.routes");
const scannerRoutes = require("./routes/scanner.routes");
const alertsRoutes = require("./routes/alerts.routes");
const riskDashboardRoutes = require("./routes/riskDashboard.routes");
const executionRoutes = require("./routes/execution.routes");
const performanceRoutes = require("./routes/performance.routes");
const aiInsightsRoutes = require("./routes/aiInsights.routes");
const optimizerRoutes = require("./routes/optimizer.routes");
const multiStrategyRoutes = require("./routes/multiStrategy.routes");
const backtestingLabRoutes = require("./routes/backtestingLab.routes");
const aiStrategyGeneratorRoutes = require(
  "./routes/aiStrategyGenerator.routes"
);
const brokerFailoverRoutes = require("./routes/brokerFailover.routes");
const tradeCopierRoutes = require("./routes/tradeCopier.routes");
const mobileControlRoutes = require("./routes/mobileControl.routes");
const autoTradeRoutes = require("./routes/autoTrade.routes");
const riskEngineRoutes = require("./routes/riskEngine.routes");
const hedgingRoutes = require("./routes/hedging.routes");
const strategyGeneratorRoutes = require(
  "./routes/strategyGenerator.routes"
);
const portfolioAnalyticsRoutes = require(
  "./routes/portfolioAnalytics.routes"
);
const paperSimulatorRoutes = require("./routes/paperSimulator.routes");
const {
  analyticsRouter: executionAnalyticsRoutes,
  reconciliationRouter: reconciliationRoutes,
} = require("./routes/executionAnalytics.routes");

app.use("/api/broker", brokerRoutes);
app.use("/api/health", healthRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/watchlist", watchlistRoutes);
app.use("/api/signal", signalRoutes);
app.use("/api/risk", riskRoutes);
app.use("/api/risk", riskDashboardRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/paper-trade", paperTradeRoutes);
app.use("/api/positions", positionRoutes);
app.use("/api/journal", journalRoutes);
app.use("/api/backtest", backtestingLabRoutes);
app.use("/api/backtest", backtestRoutes);
app.use("/api/strategy", strategyRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/scanner", scannerRoutes);
app.use("/api/alerts", alertsRoutes);
app.use("/api/execution", executionRoutes);
app.use("/api/performance", performanceRoutes);
app.use("/api/ai-insights", aiInsightsRoutes);
app.use("/api/optimizer", optimizerRoutes);
app.use("/api/multi-strategy", multiStrategyRoutes);
app.use("/api/ai-strategy", aiStrategyGeneratorRoutes);
app.use("/api/broker-failover", brokerFailoverRoutes);
app.use("/api/trade-copier", tradeCopierRoutes);
app.use("/api/mobile", mobileControlRoutes);
app.use("/api/auto-trade", autoTradeRoutes);
app.use("/api/risk-engine", riskEngineRoutes);
app.use("/api/hedging", hedgingRoutes);
app.use("/api/strategy-generator", strategyGeneratorRoutes);
app.use("/api/portfolio-analytics", portfolioAnalyticsRoutes);
app.use("/api/paper-simulator", paperSimulatorRoutes);
app.use("/api/execution-analytics", executionAnalyticsRoutes);
app.use("/api/reconciliation", reconciliationRoutes);

app.get("/", (req, res) => {
  res.send("Auto Trading Backend running");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Auto Trading Backend running on port ${PORT}`);
  require("./services/angelWebSocket.service")
    .startAngelMarketStream()
    .catch((error) => {
      console.error("Angel One live market stream unavailable", {
        message: error.message,
      });
    });
});
