import { Grid, Typography } from "@mui/material";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import SectionCard from "../components/SectionCard";
import { money, percent, pnlTone } from "../utils/format";
import useMarketStream from "../hooks/useMarketStream";
import LiveMarketStrip from "../components/LiveMarketStrip";
import { applyLivePrice, sumBy } from "../utils/liveMarket";

const colors = ["#4de8c2", "#8b7cff", "#ffbd59", "#58a6ff", "#ff6577"];

export default function PortfolioAnalyticsPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [summary, pnl, allocation, analytics, holdings] = await Promise.all([
      getDataSafe("/api/portfolio/summary", {}),
      getDataSafe("/api/portfolio/pnl", {}),
      getDataSafe("/api/portfolio/allocation", []),
      getDataSafe("/api/portfolio/analytics", {}),
      getDataSafe("/api/portfolio/holdings", []),
    ]);
    return {
      summary: summary.data,
      pnl: pnl.data,
      allocation: allocation.data,
      analytics: analytics.data,
      holdings: holdings.data,
      unavailable: [summary, pnl, allocation, analytics, holdings].some((item) => item.unavailable),
      partialError: visibleError(summary, pnl, allocation, analytics, holdings),
    };
  }, []);
  const holdings = Array.isArray(data?.holdings) ? data.holdings : [];
  const stream = useMarketStream(holdings.map((holding) => holding.symbol));
  const liveHoldings = holdings.map((holding) =>
    applyLivePrice(holding, stream.getQuote(holding.symbol))
  );
  const liveExposure = sumBy(liveHoldings, "currentValue");
  const liveUnrealized = sumBy(liveHoldings, "unrealizedPnL");
  const totalPnl = Number(data?.pnl?.realizedPnL || 0) + liveUnrealized;
  const averageReturn =
    liveHoldings.length === 0
      ? 0
      : sumBy(liveHoldings, "pnlPercent") / liveHoldings.length;
  if (loading) return <Loading label="Loading portfolio analytics" />;
  const columns = [
    { key: "symbol", label: "Symbol" },
    { key: "investedValue", label: "Invested", align: "right", render: (row) => money(row.investedValue) },
    { key: "currentValue", label: "Current", align: "right", render: (row) => money(row.currentValue) },
    { key: "unrealizedPnL", label: "P&L", align: "right", render: (row) => <Typography color={`${pnlTone(row.unrealizedPnL)}.main`}>{money(row.unrealizedPnL)}</Typography> },
    { key: "pnlPercent", label: "Return", align: "right", render: (row) => percent(row.pnlPercent) },
  ];

  return (
    <>
      <PageHeader eyebrow="Allocation" title="Portfolio analytics" description="Exposure, return concentration, winners, losers, and capital distribution." />
      <LiveMarketStrip />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Portfolio analytics unavailable" />}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Live exposure" value={money(liveExposure)} badge={stream.connected ? "LIVE" : "REST"} /></Grid>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Total P&L" value={money(totalPnl)} tone={pnlTone(totalPnl)} /></Grid>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Winning positions" value={liveHoldings.filter((item) => item.unrealizedPnL > 0).length} tone="success" /></Grid>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Average return" value={percent(averageReturn)} tone="secondary" /></Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Capital allocation">
            <ResponsiveContainer width="100%" height={300}><PieChart><Pie data={data?.allocation || []} dataKey="allocationPercent" nameKey="symbol" innerRadius={70} outerRadius={105}>{(data?.allocation || []).map((item, index) => <Cell key={item.symbol} fill={colors[index % colors.length]} />)}</Pie><Tooltip contentStyle={{ background: "#101d2e", border: "1px solid #26364c" }} /></PieChart></ResponsiveContainer>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Holding returns">
            <DataTable columns={columns} rows={liveHoldings} getRowId={(row) => `${row.exchange}-${row.symbol}`} />
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
