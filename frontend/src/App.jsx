import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import DashboardLayout from "./layout/DashboardLayout";
import Loading from "./components/Loading";

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

export default function App() {
  return (
    <Suspense fallback={<Loading label="Loading dashboard" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/market-watch" element={<MarketWatchPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/positions" element={<PositionsPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/strategies" element={<StrategiesPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/risk" element={<RiskPage />} />
          <Route path="/performance" element={<PerformancePage />} />
          <Route path="/ai-insights" element={<AIInsightsPage />} />
          <Route path="/mobile" element={<MobileControlPage />} />
        </Route>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
