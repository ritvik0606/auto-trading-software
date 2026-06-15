import { Chip, Grid } from "@mui/material";
import { getDataSafe } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import OfflineNotice from "../components/OfflineNotice";
import { money, dateTime } from "../utils/format";

export default function StrategiesPage() {
  const { data, loading, error, reload } = useApi(
    () => getDataSafe("/api/multi-strategy/all", []),
    []
  );
  if (loading) return <Loading label="Loading strategies" />;
  const rows = Array.isArray(data?.data) ? data.data : [];
  const active = rows.filter((row) => row.status === "ACTIVE").length;
  const allocated = rows.reduce((sum, row) => sum + Number(row.capitalAllocated || 0), 0);
  const statusColor = (status) =>
    status === "ACTIVE" ? "success" : status === "PAUSED" ? "warning" : "default";
  const columns = [
    { key: "id", label: "ID" },
    { key: "strategyName", label: "Strategy" },
    { key: "symbol", label: "Symbol" },
    { key: "timeframe", label: "Timeframe" },
    { key: "capitalAllocated", label: "Capital", align: "right", render: (row) => money(row.capitalAllocated) },
    { key: "maxTrades", label: "Max trades", align: "right" },
    { key: "lastSignal", label: "Last signal" },
    { key: "status", label: "Status", render: (row) => <Chip size="small" label={row.status} color={statusColor(row.status)} /> },
    { key: "updatedAt", label: "Updated", render: (row) => dateTime(row.updatedAt) },
  ];

  return (
    <>
      <PageHeader eyebrow="Automation" title="Strategies" description="Monitor independent paper strategies, allocation limits, and execution state." />
      <ErrorAlert message={error} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Strategy data unavailable" />}
      <Grid container spacing={2.5} mb={2.5}>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Strategy instances" value={rows.length} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Active" value={active} tone="success" /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Capital allocated" value={money(allocated)} tone="secondary" /></Grid>
      </Grid>
      <DataTable columns={columns} rows={rows} />
    </>
  );
}
