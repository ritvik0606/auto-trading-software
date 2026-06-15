import { Chip, Grid } from "@mui/material";
import { getDataSafe } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import OfflineNotice from "../components/OfflineNotice";
import { dateTime, money } from "../utils/format";

export default function OrdersPage() {
  const { data, loading, error, reload } = useApi(
    () => getDataSafe("/api/orders/all", []),
    []
  );
  if (loading) return <Loading label="Loading orders" />;
  const rows = Array.isArray(data?.data) ? data.data : [];
  const blocked = rows.filter((row) => row.status === "BLOCKED").length;
  const columns = [
    { key: "id", label: "Order ID" },
    { key: "symbol", label: "Symbol" },
    { key: "side", label: "Side", render: (row) => <Chip size="small" label={row.side} color={row.side === "BUY" ? "success" : "error"} variant="outlined" /> },
    { key: "orderType", label: "Type" },
    { key: "quantity", label: "Quantity", align: "right" },
    { key: "price", label: "Price", align: "right", render: (row) => money(row.price) },
    { key: "mode", label: "Mode", render: (row) => <Chip size="small" label={row.mode || "PAPER"} color="secondary" /> },
    { key: "status", label: "Status", render: (row) => <Chip size="small" label={row.status} color={row.status === "BLOCKED" ? "warning" : "success"} /> },
    { key: "createdAt", label: "Created", render: (row) => dateTime(row.createdAt) },
  ];

  return (
    <>
      <PageHeader eyebrow="Safety layer" title="Orders" description="Audit order requests and confirm that execution remains in protected paper mode." />
      <ErrorAlert message={error} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Order data unavailable" />}
      <Grid container spacing={2.5} mb={2.5}>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Total orders" value={rows.length} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Blocked safely" value={blocked} tone="warning" /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Execution mode" value="PAPER" tone="success" /></Grid>
      </Grid>
      <DataTable columns={columns} rows={rows} />
    </>
  );
}
