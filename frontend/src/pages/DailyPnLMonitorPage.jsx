import { Grid } from "@mui/material";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import DataTable from "../components/DataTable";
import { money, pnlTone } from "../utils/format";

export default function DailyPnLMonitorPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [daily, risk, performance] = await Promise.all([
      getDataSafe("/api/performance/daily", []),
      getDataSafe("/api/risk/dashboard", {}),
      getDataSafe("/api/performance/summary", {}),
    ]);
    return {
      daily: daily.data,
      risk: risk.data,
      performance: performance.data,
      unavailable: daily.unavailable || risk.unavailable || performance.unavailable,
      partialError: visibleError(daily, risk, performance),
    };
  }, []);
  if (loading) return <Loading label="Loading daily P&L" />;
  const daily = data?.daily || [];
  const today = daily[daily.length - 1] || { pnl: data?.risk?.todayPnL || 0, totalTrades: 0 };
  const best = daily.reduce((value, item) => item.pnl > (value?.pnl ?? -Infinity) ? item : value, null);
  const worst = daily.reduce((value, item) => item.pnl < (value?.pnl ?? Infinity) ? item : value, null);

  return (
    <>
      <PageHeader eyebrow="Intraday control" title="Daily P&L monitor" description="Track daily profitability against capital-protection limits." />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Daily P&L data unavailable" />}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Latest daily P&L" value={money(today.pnl)} tone={pnlTone(today.pnl)} /></Grid>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Trades today" value={today.totalTrades ?? 0} /></Grid>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Daily loss limit" value={money(data?.risk?.maxDailyLoss)} tone="error" /></Grid>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Current daily loss" value={money(data?.risk?.currentDailyLoss)} tone="warning" /></Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Daily performance">
            <ResponsiveContainer width="100%" height={330}><BarChart data={daily}><CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} /><XAxis dataKey="date" /><YAxis /><Tooltip contentStyle={{ background: "#101d2e", border: "1px solid #26364c" }} /><Bar dataKey="pnl" fill="#4de8c2" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}><StatCard label="Best day" value={best ? money(best.pnl) : money(0)} tone="success" detail={best?.date ? new Date(best.date).toLocaleDateString("en-IN") : "No data"} /></Grid>
        <Grid size={{ xs: 12, md: 6 }}><StatCard label="Worst day" value={worst ? money(worst.pnl) : money(0)} tone="error" detail={worst?.date ? new Date(worst.date).toLocaleDateString("en-IN") : "No data"} /></Grid>
        <Grid size={{ xs: 12 }}>
          <DataTable columns={[{ key: "date", label: "Date", render: (row) => new Date(row.date).toLocaleDateString("en-IN") }, { key: "totalTrades", label: "Trades", align: "right" }, { key: "winningTrades", label: "Wins", align: "right" }, { key: "losingTrades", label: "Losses", align: "right" }, { key: "pnl", label: "P&L", align: "right", render: (row) => money(row.pnl) }]} rows={[...daily].reverse()} />
        </Grid>
      </Grid>
    </>
  );
}
