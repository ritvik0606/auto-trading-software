import { Grid, Typography } from "@mui/material";
import { getDataSafe } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import { money, percent, pnlTone } from "../utils/format";
import useMarketStream from "../hooks/useMarketStream";
import LiveMarketStrip from "../components/LiveMarketStrip";
import { applyLivePrice, sumBy } from "../utils/liveMarket";

export default function HoldingsPage() {
  const { data, loading, error, reload } = useApi(
    () => getDataSafe("/api/portfolio/holdings", []),
    []
  );
  const storedRows = Array.isArray(data?.data) ? data.data : [];
  const stream = useMarketStream(storedRows.map((row) => row.symbol));
  const rows = storedRows.map((row) =>
    applyLivePrice(row, stream.getQuote(row.symbol))
  );
  if (loading) return <Loading label="Loading holdings" />;
  const investedValue = sumBy(rows, "investedValue");
  const currentValue = sumBy(rows, "currentValue");
  const pnl = sumBy(rows, "unrealizedPnL");
  const columns = [
    { key: "symbol", label: "Symbol" },
    { key: "exchange", label: "Exchange" },
    { key: "quantity", label: "Quantity", align: "right" },
    {
      key: "averagePrice",
      label: "Average price",
      align: "right",
      render: (row) => money(row.averagePrice),
    },
    {
      key: "currentPrice",
      label: "LTP",
      align: "right",
      render: (row) =>
        row.currentPrice == null ? "Data unavailable" : money(row.currentPrice),
    },
    {
      key: "currentValue",
      label: "Current value",
      align: "right",
      render: (row) => money(row.currentValue),
    },
    {
      key: "unrealizedPnL",
      label: "P&L",
      align: "right",
      render: (row) => (
        <Typography color={`${pnlTone(row.unrealizedPnL)}.main`} fontWeight={700}>
          {money(row.unrealizedPnL)}
        </Typography>
      ),
    },
    {
      key: "pnlPercent",
      label: "Return",
      align: "right",
      render: (row) => percent(row.pnlPercent),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Holdings"
        description="Current paper holdings with invested value and mark-to-market returns."
      />
      <LiveMarketStrip />
      <ErrorAlert message={error} onRetry={reload} />
      {(data?.unavailable || !stream.connected) && <OfflineNotice title="Live holdings feed unavailable" />}
      <Grid container spacing={2.5} mb={2.5}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Holdings" value={rows.length} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Invested value" value={money(investedValue)} tone="secondary" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Current value" value={money(currentValue)} tone="primary" badge={stream.connected ? "LIVE" : "REST"} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Unrealized P&L" value={money(pnl)} tone={pnlTone(pnl)} />
        </Grid>
      </Grid>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => `${row.exchange}-${row.symbol}`}
        emptyMessage="No holdings available"
      />
    </>
  );
}
