import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import DashboardLayout from "./layout/DashboardLayout";
import Loading from "./components/Loading";
import AppErrorBoundary from "./components/AppErrorBoundary";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const PortfolioPage = lazy(() => import("./pages/PortfolioPage"));
const PositionsPage = lazy(() => import("./pages/PositionsPage"));
const OrdersPage = lazy(() => import("./pages/OrdersPage"));
const StrategiesPage = lazy(() => import("./pages/StrategiesPage"));
const WatchlistPage = lazy(() => import("./pages/WatchlistPage"));
const RiskPage = lazy(() => import("./pages/RiskPage"));
const PerformancePage = lazy(() => import("./pages/PerformancePage"));
const AIInsightsPage = lazy(() => import("./pages/AIInsightsPage"));
const MobileControlPage = lazy(() => import("./pages/MobileControlPage"));
const MarketWatchPage = lazy(() => import("./pages/MarketWatchPage"));
const BrokerManagementPage = lazy(
  () => import("./pages/BrokerManagementPage")
);
const HoldingsPage = lazy(() => import("./pages/HoldingsPage"));
const FundsPage = lazy(() => import("./pages/FundsPage"));
const OrderBookPage = lazy(() => import("./pages/OrderBookPage"));
const TradeBookPage = lazy(() => import("./pages/TradeBookPage"));
const OptionChainPage = lazy(() => import("./pages/OptionChainPage"));
const AdvancedScannerPage = lazy(() => import("./pages/AdvancedScannerPage"));
const StrategyBuilderPage = lazy(() => import("./pages/StrategyBuilderPage"));
const MultiChartDashboardPage = lazy(
  () => import("./pages/MultiChartDashboardPage")
);
const TradeJournalWorkspacePage = lazy(
  () => import("./pages/TradeJournalWorkspacePage")
);
const ExecutionAnalyticsPage = lazy(
  () => import("./pages/ExecutionAnalyticsPage")
);
const PortfolioAnalyticsPage = lazy(
  () => import("./pages/PortfolioAnalyticsPage")
);
const DailyPnLMonitorPage = lazy(
  () => import("./pages/DailyPnLMonitorPage")
);
const HeatmapPage = lazy(() => import("./pages/HeatmapPage"));
const AIStrategyGeneratorPage = lazy(
  () => import("./pages/AIStrategyGeneratorPage")
);
const BacktestingLabPage = lazy(() => import("./pages/BacktestingLabPage"));
const MultiStrategyEnginePage = lazy(
  () => import("./pages/MultiStrategyEnginePage")
);
const AutoTradingPage = lazy(() => import("./pages/AutoTradingPage"));
const RiskEnginePage = lazy(() => import("./pages/RiskEnginePage"));
const PortfolioHedgingPage = lazy(
  () => import("./pages/PortfolioHedgingPage")
);
const BrokerFailoverPage = lazy(
  () => import("./pages/BrokerFailoverPage")
);
const StrategyGeneratorDashboardPage = lazy(
  () => import("./pages/StrategyGeneratorDashboardPage")
);
const TradeCopierPage = lazy(() => import("./pages/TradeCopierPage"));
const PaperSimulatorPage = lazy(() => import("./pages/PaperSimulatorPage"));

export default function App() {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<Loading label="Loading dashboard" />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/market-watch" element={<MarketWatchPage />} />
            <Route path="/option-chain" element={<OptionChainPage />} />
            <Route path="/scanner" element={<AdvancedScannerPage />} />
            <Route path="/heatmap" element={<HeatmapPage />} />
            <Route path="/brokers" element={<BrokerManagementPage />} />
            <Route path="/broker-failover" element={<BrokerFailoverPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/holdings" element={<HoldingsPage />} />
            <Route path="/funds" element={<FundsPage />} />
            <Route path="/positions" element={<PositionsPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/order-book" element={<OrderBookPage />} />
            <Route path="/trade-book" element={<TradeBookPage />} />
            <Route path="/trade-journal" element={<TradeJournalWorkspacePage />} />
            <Route path="/strategies" element={<StrategiesPage />} />
            <Route path="/strategy-builder" element={<StrategyBuilderPage />} />
            <Route path="/strategy-generator" element={<StrategyGeneratorDashboardPage />} />
            <Route path="/ai-strategy" element={<AIStrategyGeneratorPage />} />
            <Route path="/backtesting-lab" element={<BacktestingLabPage />} />
            <Route path="/multi-strategy" element={<MultiStrategyEnginePage />} />
            <Route path="/auto-trading" element={<AutoTradingPage />} />
            <Route path="/trade-copier" element={<TradeCopierPage />} />
            <Route path="/paper-simulator" element={<PaperSimulatorPage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/risk" element={<RiskPage />} />
            <Route path="/risk-engine" element={<RiskEnginePage />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/multi-chart" element={<MultiChartDashboardPage />} />
            <Route path="/execution-analytics" element={<ExecutionAnalyticsPage />} />
            <Route path="/portfolio-analytics" element={<PortfolioAnalyticsPage />} />
            <Route path="/portfolio-hedging" element={<PortfolioHedgingPage />} />
            <Route path="/daily-pnl" element={<DailyPnLMonitorPage />} />
            <Route path="/ai-insights" element={<AIInsightsPage />} />
            <Route path="/mobile" element={<MobileControlPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  );
}
