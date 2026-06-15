import { Chip, Grid } from "@mui/material";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import { dateTime, money } from "../utils/format";

function mergeOrders(executionOrders, orders, paperTrades) {
  const rows = [];
  const seen = new Set();
  for (const order of orders) {
    const key = `ORDER-${order.id}`;
    seen.add(key);
    rows.push({
      key,
      id: order.id,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      price: order.price,
      status: order.status,
      time: order.createdAt,
      mode: order.mode || "PAPER",
    });
  }
  for (const execution of executionOrders) {
    const key = `ORDER-${execution.id}`;
    if (seen.has(key)) continue;
    rows.push({
      key,
      id: execution.id,
      symbol: execution.symbol,
      side: execution.side,
      quantity: execution.quantity,
      price: null,
      status: execution.status,
      time: execution.entryTime,
      mode: "PAPER",
    });
  }
  for (const trade of paperTrades) {
    rows.push({
      key: `TRADE-${trade.id}`,
      id: `T-${trade.id}`,
      symbol: trade.symbol,
      side: trade.tradeType,
      quantity: trade.quantity,
      price: trade.entryPrice,
      status: trade.status,
      time: trade.createdAt,
      mode: "PAPER",
    });
  }
  return rows.sort(
    (left, right) => new Date(right.time || 0) - new Date(left.time || 0)
  );
}

export default function OrderBookPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [execution, orders, paperTrades] = await Promise.all([
      getDataSafe("/api/execution/orders", []),
      getDataSafe("/api/orders/all", []),
      getDataSafe("/api/paper-trade/all", []),
    ]);
    return {
      rows: mergeOrders(execution.data, orders.data, paperTrades.data),
      unavailable: execution.unavailable || orders.unavailable || paperTrades.unavailable,
      partialError: visibleError(execution, orders, paperTrades),
    };
  }, []);
  if (loading) return <Loading label="Loading order book" />;
  const rows = data?.rows || [];
  const paperOrders = rows.filter((row) => row.mode === "PAPER").length;
  const blocked = rows.filter((row) => row.status === "BLOCKED").length;
  const columns = [
    { key: "id", label: "Order ID" },
    { key: "symbol", label: "Symbol" },
    {
      key: "side",
      label: "Side",
      render: (row) => (
        <Chip
          size="small"
          label={row.side}
          color={row.side === "BUY" ? "success" : "error"}
          variant="outlined"
        />
      ),
    },
    { key: "quantity", label: "Quantity", align: "right" },
    {
      key: "price",
      label: "Price",
      align: "right",
      render: (row) => (row.price == null ? "--" : money(row.price)),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <Chip
          size="small"
          label={row.status}
          color={
            row.status === "OPEN"
              ? "warning"
              : row.status === "BLOCKED"
                ? "error"
                : "default"
          }
        />
      ),
    },
    { key: "time", label: "Time", render: (row) => dateTime(row.time) },
    {
      key: "mode",
      label: "Mode",
      render: (row) => (
        <Chip size="small" label={row.mode} color={row.mode === "LIVE" ? "error" : "primary"} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="Order book"
        description="Combined order audit, execution analytics, and paper-trade entries."
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Order book data unavailable" />}
      <Grid container spacing={2.5} mb={2.5}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Total entries" value={rows.length} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Paper mode" value={paperOrders} tone="success" />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Blocked safely" value={blocked} tone="warning" />
        </Grid>
      </Grid>
      <DataTable columns={columns} rows={rows} getRowId={(row) => row.key} />
    </>
  );
}
