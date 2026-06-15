import { Grid } from "@mui/material";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import OfflineNotice from "../components/OfflineNotice";
import { money, number, percent, pnlTone } from "../utils/format";

const axisStyle = { fill: "#70859e", fontSize: 11 };

export default function PerformancePage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [summary, equity, drawdown] = await Promise.all([
      getDataSafe("/api/performance/summary", {
        totalPnL: 0,
        winRate: 0,
        winningTrades: 0,
        profitFactor: null,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
      }),
      getDataSafe("/api/performance/equity-curve", { data: [] }),
      getDataSafe("/api/performance/drawdown", { data: [] }),
    ]);
    return {
      summary: summary.data,
      equity: equity.data,
      drawdown: drawdown.data,
      unavailable: summary.unavailable || equity.unavailable || drawdown.unavailable,
      partialError: visibleError(summary, equity, drawdown),
    };
  }, []);
  if (loading) return <Loading label="Calculating performance" />;
  const summary = data?.summary || {};
  const equity = data?.equity?.data || [];
  const drawdown = data?.drawdown?.data || [];

  return (
    <>
      <PageHeader eyebrow="Analytics" title="Performance" description="Evaluate profitability, consistency, equity growth, and drawdown pressure." />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Performance data unavailable" />}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><StatCard label="Total P&L" value={money(summary.totalPnL)} tone={pnlTone(summary.totalPnL)} /></Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><StatCard label="Win rate" value={percent(summary.winRate)} tone="success" detail={`${summary.winningTrades || 0} winning trades`} /></Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><StatCard label="Profit factor" value={summary.profitFactor == null ? "N/A" : number(summary.profitFactor)} tone="secondary" /></Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><StatCard label="Max drawdown" value={money(summary.maxDrawdown)} tone="error" detail={percent(summary.maxDrawdownPercent)} /></Grid>
        <Grid size={{ xs: 12, xl: 7 }}>
          <SectionCard title="Equity curve" subtitle="Cumulative paper-trading equity">
            <ResponsiveContainer width="100%" height={330}>
              <AreaChart data={equity}>
                <defs>
                  <linearGradient id="equity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4de8c2" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#4de8c2" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} />
                <XAxis dataKey="timestamp" tick={axisStyle} tickFormatter={(value) => new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} />
                <YAxis tick={axisStyle} />
                <Tooltip contentStyle={{ background: "#101d2e", border: "1px solid #26364c", borderRadius: 10 }} />
                <Area type="monotone" dataKey="equity" stroke="#4de8c2" fill="url(#equity)" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, xl: 5 }}>
          <SectionCard title="Drawdown" subtitle="Distance below peak equity">
            <ResponsiveContainer width="100%" height={330}>
              <LineChart data={drawdown}>
                <CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} />
                <XAxis dataKey="timestamp" tick={axisStyle} tickFormatter={(value) => new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} />
                <YAxis tick={axisStyle} />
                <Tooltip contentStyle={{ background: "#101d2e", border: "1px solid #26364c", borderRadius: 10 }} />
                <Line type="monotone" dataKey="drawdown" stroke="#ff6577" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
