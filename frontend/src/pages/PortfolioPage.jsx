import { Grid } from "@mui/material";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import SectionCard from "../components/SectionCard";
import OfflineNotice from "../components/OfflineNotice";
import { money, percent, pnlTone } from "../utils/format";

const colors = ["#4de8c2", "#8b7cff", "#ffbd59", "#58a6ff", "#ff6577"];

export default function PortfolioPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [summary, holdings, pnl, allocation, analytics] = await Promise.all([
      getDataSafe("/api/portfolio/summary", {
        totalCapital: 100000,
        usedCapital: 0,
        availableCapital: 100000,
        totalHoldings: 0,
        openPositions: 0,
        realizedPnL: 0,
        unrealizedPnL: 0,
        totalPnL: 0,
      }),
      getDataSafe("/api/portfolio/holdings", []),
      getDataSafe("/api/portfolio/pnl", {
        realizedPnL: 0,
        unrealizedPnL: 0,
        totalPnL: 0,
      }),
      getDataSafe("/api/portfolio/allocation", []),
      getDataSafe("/api/portfolio/analytics", {}),
    ]);
    const results = [summary, holdings, pnl, allocation, analytics];
    return {
      summary: summary.data,
      holdings: holdings.data,
      pnl: pnl.data,
      allocation: allocation.data,
      analytics: analytics.data,
      unavailable: results.some((result) => result.unavailable),
      partialError: visibleError(...results),
    };
  }, []);

  if (loading) return <Loading label="Loading portfolio" />;
  const summary = data?.summary || {};

  const columns = [
    { key: "symbol", label: "Symbol" },
    { key: "exchange", label: "Exchange" },
    { key: "quantity", label: "Qty", align: "right" },
    { key: "averagePrice", label: "Average", align: "right", render: (row) => money(row.averagePrice) },
    { key: "currentPrice", label: "LTP", align: "right", render: (row) => money(row.currentPrice) },
    { key: "currentValue", label: "Value", align: "right", render: (row) => money(row.currentValue) },
    { key: "unrealizedPnL", label: "P&L", align: "right", render: (row) => money(row.unrealizedPnL) },
    { key: "pnlPercent", label: "Return", align: "right", render: (row) => percent(row.pnlPercent) },
  ];

  return (
    <>
      <PageHeader eyebrow="Portfolio" title="Capital and holdings" description="Monitor exposure, allocation, and combined realized performance." />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice />}
      <Grid container spacing={2.5}>
        {[
          ["Total capital", money(summary.totalCapital), "primary"],
          ["Used capital", money(summary.usedCapital), "secondary"],
          ["Available capital", money(summary.availableCapital), "success"],
          ["Total P&L", money(summary.totalPnL), pnlTone(summary.totalPnL)],
        ].map(([label, value, tone]) => (
          <Grid key={label} size={{ xs: 12, sm: 6, xl: 3 }}>
            <StatCard label={label} value={value} tone={tone} />
          </Grid>
        ))}
        <Grid size={{ xs: 12, lg: 8 }}>
          <SectionCard title="Holdings" subtitle={`${summary.totalHoldings || 0} active holdings`}>
            <DataTable columns={columns} rows={data?.holdings || []} getRowId={(row) => `${row.exchange}-${row.symbol}`} />
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <SectionCard title="Allocation" subtitle="Share of deployed capital">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={data?.allocation || []} dataKey="allocationPercent" nameKey="symbol" innerRadius={65} outerRadius={95} paddingAngle={4}>
                  {(data?.allocation || []).map((item, index) => (
                    <Cell key={item.symbol} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#101d2e", border: "1px solid #26364c", borderRadius: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
