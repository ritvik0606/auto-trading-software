import { Grid } from "@mui/material";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import SectionCard from "../components/SectionCard";
import { dateTime, number, percent } from "../utils/format";

export default function ExecutionAnalyticsPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [summary, orders, slippage, broker] = await Promise.all([
      getDataSafe("/api/execution/summary", {}),
      getDataSafe("/api/execution/orders", []),
      getDataSafe("/api/execution/slippage", []),
      getDataSafe("/api/execution/broker-performance", {}),
    ]);
    return {
      summary: summary.data,
      orders: orders.data,
      slippage: slippage.data,
      broker: broker.data,
      unavailable: [summary, orders, slippage, broker].some((item) => item.unavailable),
      partialError: visibleError(summary, orders, slippage, broker),
    };
  }, []);
  if (loading) return <Loading label="Loading execution analytics" />;
  const summary = data?.summary || {};
  const columns = [
    { key: "id", label: "Order" },
    { key: "symbol", label: "Symbol" },
    { key: "side", label: "Side" },
    { key: "quantity", label: "Qty", align: "right" },
    { key: "status", label: "Status" },
    { key: "entryTime", label: "Entry time", render: (row) => dateTime(row.entryTime) },
    { key: "exitTime", label: "Exit time", render: (row) => dateTime(row.exitTime) },
    { key: "executionTimeMs", label: "Execution ms", align: "right" },
  ];

  return (
    <>
      <PageHeader eyebrow="Quality" title="Execution analytics" description="Order outcomes, latency, rejection rate, and recorded slippage." />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Execution analytics unavailable" />}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Total orders" value={summary.totalOrders ?? 0} /></Grid>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Filled" value={summary.filledOrders ?? 0} tone="success" /></Grid>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Rejected" value={summary.rejectedOrders ?? 0} tone="warning" /></Grid>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Success rate" value={percent(summary.successRatePercent)} tone="primary" /></Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Broker performance">
            <StatCard label="Broker" value={data?.broker?.brokerName || "Angel One"} detail={`Average execution: ${data?.broker?.averageExecutionTimeMs == null ? "N/A" : `${number(data.broker.averageExecutionTimeMs)} ms`}`} />
            <Grid container spacing={1.5} mt={0.5}>
              <Grid size={{ xs: 6 }}><StatCard label="Success" value={percent(data?.broker?.successPercent)} tone="success" /></Grid>
              <Grid size={{ xs: 6 }}><StatCard label="Rejection" value={percent(data?.broker?.rejectionPercent)} tone="error" /></Grid>
            </Grid>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Slippage by symbol">
            <ResponsiveContainer width="100%" height={270}>
              <BarChart data={data?.slippage || []}><CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} /><XAxis dataKey="symbol" /><YAxis /><Tooltip contentStyle={{ background: "#101d2e", border: "1px solid #26364c" }} /><Bar dataKey="slippage" fill="#ffbd59" radius={[5, 5, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}><DataTable columns={columns} rows={data?.orders || []} /></Grid>
      </Grid>
    </>
  );
}
