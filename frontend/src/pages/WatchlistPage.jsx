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
import { dateTime, money } from "../utils/format";

export default function WatchlistPage() {
  const { data, loading, error, reload } = useApi(
    () => getDataSafe("/api/watchlist", []),
    []
  );
  const rows = Array.isArray(data?.data) ? data.data : [];
  const marketStream = useMarketStream(rows.map((row) => row.symbol));
  const liveRows = rows.map((row) => {
    const quote = marketStream.getQuote(row.symbol);
    return {
      ...row,
      symbolToken: row.symbolToken || row.symbol_token,
      createdAt: row.createdAt || row.created_at,
      ltp: quote?.ltp ?? null,
      priceSource: quote?.source || null,
    };
  });
  if (loading) return <Loading label="Loading watchlist" />;
  const exchanges = new Set(rows.map((row) => row.exchange)).size;
  const tokenized = rows.filter(
    (row) => row.symbolToken || row.symbol_token
  ).length;
  const columns = [
    { key: "symbol", label: "Symbol", render: (row) => <Chip label={row.symbol} size="small" color="primary" variant="outlined" /> },
    { key: "exchange", label: "Exchange" },
    {
      key: "ltp",
      label: "Live LTP",
      align: "right",
      render: (row) =>
        row.ltp == null ? "Data unavailable" : money(row.ltp),
    },
    {
      key: "priceSource",
      label: "Feed",
      render: (row) => (
        <Chip
          size="small"
          label={
            row.priceSource === "ANGEL_ONE_WEBSOCKET"
              ? "LIVE"
              : "WAITING"
          }
          color={
            row.priceSource === "ANGEL_ONE_WEBSOCKET"
              ? "success"
              : "warning"
          }
          variant="outlined"
        />
      ),
    },
    { key: "symbolToken", label: "Symbol token" },
    { key: "createdAt", label: "Added", render: (row) => dateTime(row.createdAt) },
  ];

  return (
    <>
      <PageHeader eyebrow="Market universe" title="Watchlist" description="Symbols selected for scanning, signals, and paper strategy execution." />
      <ErrorAlert message={error} onRetry={reload} />
      {(data?.unavailable || !marketStream.connected) && (
        <OfflineNotice
          title={
            data?.unavailable
              ? "Watchlist data unavailable"
              : "Live prices unavailable"
          }
        />
      )}
      <Grid container spacing={2.5} mb={2.5}>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Symbols" value={rows.length} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Exchanges" value={exchanges} tone="secondary" /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Broker tokens" value={tokenized} tone="success" /></Grid>
      </Grid>
      <DataTable columns={columns} rows={liveRows} getRowId={(row) => row.id || `${row.exchange}-${row.symbol}`} />
    </>
  );
}
