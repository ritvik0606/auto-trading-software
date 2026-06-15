import { Chip, Grid } from "@mui/material";
import { getDataSafe } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import OfflineNotice from "../components/OfflineNotice";
import { dateTime } from "../utils/format";

export default function WatchlistPage() {
  const { data, loading, error, reload } = useApi(
    () => getDataSafe("/api/watchlist", []),
    []
  );
  if (loading) return <Loading label="Loading watchlist" />;
  const rows = Array.isArray(data?.data) ? data.data : [];
  const exchanges = new Set(rows.map((row) => row.exchange)).size;
  const tokenized = rows.filter((row) => row.symbolToken).length;
  const columns = [
    { key: "symbol", label: "Symbol", render: (row) => <Chip label={row.symbol} size="small" color="primary" variant="outlined" /> },
    { key: "exchange", label: "Exchange" },
    { key: "symbolToken", label: "Symbol token" },
    { key: "createdAt", label: "Added", render: (row) => dateTime(row.createdAt) },
  ];

  return (
    <>
      <PageHeader eyebrow="Market universe" title="Watchlist" description="Symbols selected for scanning, signals, and paper strategy execution." />
      <ErrorAlert message={error} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Watchlist data unavailable" />}
      <Grid container spacing={2.5} mb={2.5}>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Symbols" value={rows.length} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Exchanges" value={exchanges} tone="secondary" /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Broker tokens" value={tokenized} tone="success" /></Grid>
      </Grid>
      <DataTable columns={columns} rows={rows} getRowId={(row) => row.id || `${row.exchange}-${row.symbol}`} />
    </>
  );
}
