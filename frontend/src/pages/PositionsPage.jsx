import { Chip, Grid } from "@mui/material";
import { getDataSafe } from "../services/api";
import useApi from "../hooks/useApi";
import useMarketStream from "../hooks/useMarketStream";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import OfflineNotice from "../components/OfflineNotice";
import { money, pnlTone } from "../utils/format";

export default function PositionsPage() {
  const { data, loading, error, reload } = useApi(
    () => getDataSafe("/api/positions/all", []),
    []
  );

  const storedRows = Array.isArray(data?.data) ? data.data : [];
  const marketStream = useMarketStream(
    storedRows
      .filter((row) => row.status === "OPEN")
      .map((row) => row.symbol)
  );
  const rows = storedRows.map((row) => {
    if (row.status !== "OPEN") {
      return row;
    }

    const quote = marketStream.getQuote(row.symbol);
    if (!quote) {
      return row;
    }

    const currentPrice = quote.ltp;
    const quantity = Number(row.quantity || 0);
    const averagePrice = Number(row.averagePrice || 0);
    const direction = row.side === "SELL" ? -1 : 1;
    return {
      ...row,
      currentPrice,
      unrealizedPnl:
        (currentPrice - averagePrice) * quantity * direction,
      totalPositionValue: currentPrice * quantity,
      priceSource: quote.source,
    };
  });
  if (loading) return <Loading label="Loading positions" />;
  const open = rows.filter((row) => row.status === "OPEN");
  const unrealized = open.reduce((sum, row) => sum + Number(row.unrealizedPnl || 0), 0);
  const value = open.reduce(
    (sum, row) => sum + Number(row.currentPrice || 0) * Number(row.quantity || 0),
    0
  );
  const columns = [
    { key: "symbol", label: "Symbol" },
    { key: "side", label: "Side", render: (row) => <Chip size="small" label={row.side} color={row.side === "BUY" ? "success" : "error"} variant="outlined" /> },
    { key: "quantity", label: "Quantity", align: "right" },
    { key: "averagePrice", label: "Average", align: "right", render: (row) => money(row.averagePrice) },
    { key: "currentPrice", label: "Current", align: "right", render: (row) => money(row.currentPrice) },
    { key: "unrealizedPnl", label: "Unrealized", align: "right", render: (row) => money(row.unrealizedPnl) },
    { key: "realizedPnl", label: "Realized", align: "right", render: (row) => money(row.realizedPnl) },
    { key: "status", label: "Status", render: (row) => <Chip size="small" label={row.status} color={row.status === "OPEN" ? "warning" : "default"} /> },
  ];

  return (
    <>
      <PageHeader eyebrow="Execution" title="Positions" description="Track open and closed paper positions with mark-to-market performance." />
      <ErrorAlert message={error} onRetry={reload} />
      {(data?.unavailable || !marketStream.connected) && (
        <OfflineNotice
          title={
            data?.unavailable
              ? "Position data unavailable"
              : "Live MTM unavailable"
          }
        />
      )}
      <Grid container spacing={2.5} mb={2.5}>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Open positions" value={open.length} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Position value" value={money(value)} tone="secondary" /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Unrealized P&L" value={money(unrealized)} tone={pnlTone(unrealized)} /></Grid>
      </Grid>
      <DataTable columns={columns} rows={rows} />
    </>
  );
}
