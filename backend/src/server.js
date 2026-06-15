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

app.use("/api/broker", brokerRoutes);
app.use("/api/health", healthRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/watchlist", watchlistRoutes);
app.use("/api/signal", signalRoutes);
app.use("/api/risk", riskRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/paper-trade", paperTradeRoutes);
app.use("/api/positions", positionRoutes);
app.use("/api/journal", journalRoutes);
app.use("/api/backtest", backtestRoutes);
app.use("/api/strategy", strategyRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/portfolio", portfolioRoutes);

app.get("/", (req, res) => {
  res.send("Auto Trading Backend running");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Auto Trading Backend running on port ${PORT}`);
});
