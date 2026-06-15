import { useState } from "react";
import { Alert, Button, Chip, Grid, Typography } from "@mui/material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getDataSafe, postData, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import SectionCard from "../components/SectionCard";
import { dateTime, money, number, percent } from "../utils/format";

const axisStyle = { fill: "#70859e", fontSize: 11 };
const tooltipStyle = {
  background: "#101d2e",
  border: "1px solid #26364c",
  borderRadius: 10,
};

export default function ExecutionAnalyticsPage() {
  const [running, setRunning] = useState(false);
  const [actionState, setActionState] = useState(null);
  const { data, loading, error, reload } = useApi(async () => {
    const [summary, slippage, latency, reconciliation] = await Promise.all([
      getDataSafe("/api/execution-analytics/summary", {}),
      getDataSafe("/api/execution-analytics/slippage", []),
      getDataSafe("/api/execution-analytics/latency", []),
      getDataSafe("/api/reconciliation/report", {
        summary: {},
        issues: [],
        coverage: {},
      }),
    ]);
    return {
      summary: summary.data || {},
      slippage: Array.isArray(slippage.data) ? slippage.data : [],
      latency: Array.isArray(latency.data) ? latency.data : [],
      reconciliation: reconciliation.data || {},
      unavailable:
        summary.unavailable ||
        slippage.unavailable ||
        latency.unavailable ||
        reconciliation.unavailable,
      partialError: visibleError(summary, slippage, latency, reconciliation),
    };
  }, []);

  const runReconciliation = async () => {
    setRunning(true);
    setActionState(null);
    try {
      const result = await postData("/api/reconciliation/run");
      setActionState({
        severity:
          result.status === "FAILED"
            ? "error"
            : result.status === "WARNING"
              ? "warning"
              : "success",
        message: `Reconciliation completed: ${result.status}`,
      });
      await reload();
    } catch (actionError) {
      setActionState({
        severity: actionError.isUnavailable ? "warning" : "error",
        message: actionError.message,
      });
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <Loading label="Loading execution analytics" />;

  const summary = data?.summary || {};
  const reconciliation = data?.reconciliation || {};
  const reconciliationSummary = reconciliation.summary || {};
  const issues = Array.isArray(reconciliation.issues)
    ? reconciliation.issues
    : [];
  const brokers = Array.isArray(summary.brokerWise)
    ? summary.brokerWise
    : [];
  const slippage = Array.isArray(data?.slippage) ? data.slippage : [];
  const latency = Array.isArray(data?.latency) ? data.latency : [];
  const brokerColumns = [
    { key: "broker", label: "Broker / Source" },
    { key: "totalOrders", label: "Orders", align: "right" },
    {
      key: "fillRatePercent",
      label: "Fill Rate",
      align: "right",
      render: (row) => percent(row.fillRatePercent),
    },
    {
      key: "rejectionRatePercent",
      label: "Rejected",
      align: "right",
      render: (row) => percent(row.rejectionRatePercent),
    },
    {
      key: "averageLatencyMs",
      label: "Avg Latency",
      align: "right",
      render: (row) =>
        row.averageLatencyMs == null
          ? "N/A"
          : `${number(row.averageLatencyMs)} ms`,
    },
  ];
  const issueColumns = [
    {
      key: "severity",
      label: "Severity",
      render: (row) => (
        <Chip
          size="small"
          label={row.severity}
          color={row.severity === "CRITICAL" ? "error" : "warning"}
          variant="outlined"
        />
      ),
    },
    { key: "type", label: "Issue" },
    { key: "source", label: "Source" },
    { key: "recordId", label: "Record" },
    { key: "message", label: "Description" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Phase 15"
        title="Execution Analytics & Reconciliation"
        description="Track fill quality, slippage, latency, rejection causes, and order-to-position consistency."
        action={
          <Button
            variant="contained"
            disabled={running}
            onClick={runReconciliation}
          >
            {running ? "Reconciling..." : "Run Reconciliation"}
          </Button>
        }
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && (
        <OfflineNotice title="Execution analytics unavailable" />
      )}
      {actionState && (
        <Alert severity={actionState.severity} sx={{ mb: 3 }}>
          {actionState.message}
        </Alert>
      )}

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard label="Total Orders" value={summary.totalOrders || 0} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Fill Rate"
            value={percent(summary.fillRatePercent)}
            tone="success"
            detail={`${summary.filledQuantity || 0} / ${
              summary.requestedQuantity || 0
            } quantity`}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Partial Fills"
            value={summary.partialFillOrders || 0}
            tone="warning"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Rejected Orders"
            value={summary.rejectedOrders || 0}
            tone="error"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Average Latency"
            value={
              summary.averageLatencyMs == null
                ? "N/A"
                : `${number(summary.averageLatencyMs)} ms`
            }
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Average Slippage"
            value={
              summary.averageSlippage == null
                ? "N/A"
                : money(summary.averageSlippage)
            }
            tone="warning"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Reconciliation"
            value={reconciliation.status || "NOT RUN"}
            tone={
              reconciliation.status === "RECONCILED"
                ? "success"
                : reconciliation.status === "FAILED"
                  ? "error"
                  : "warning"
            }
            detail={
              reconciliation.createdAt
                ? dateTime(reconciliation.createdAt)
                : "No report available"
            }
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Position Mismatches"
            value={reconciliationSummary.positionMismatches || 0}
            tone={
              reconciliationSummary.positionMismatches > 0
                ? "error"
                : "success"
            }
          />
        </Grid>

        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard
            title="Slippage Chart"
            subtitle="Positive values indicate unfavorable execution"
          >
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={slippage}>
                <CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} />
                <XAxis dataKey="symbol" tick={axisStyle} />
                <YAxis tick={axisStyle} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="slippage" fill="#ffbd59" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard title="Latency Chart" subtitle="Submission-to-completion time">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={latency}>
                <CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} />
                <XAxis dataKey="symbol" tick={axisStyle} />
                <YAxis tick={axisStyle} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="latencyMs"
                  stroke="#8b7cff"
                  strokeWidth={2.5}
                />
              </LineChart>
            </ResponsiveContainer>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <SectionCard
            title="Broker-wise Execution Statistics"
            subtitle="Paper engines remain explicitly separated from broker audit orders"
          >
            <DataTable
              columns={brokerColumns}
              rows={brokers}
              getRowId={(row) => row.broker}
              emptyMessage="No execution records available"
            />
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <SectionCard
            title="Reconciliation Report"
            subtitle={`Missing orders: ${
              reconciliationSummary.missingOrders || 0
            } | Critical issues: ${
              reconciliationSummary.criticalIssues || 0
            }`}
          >
            {issues.length > 0 && (
              <Alert severity="error" sx={{ mb: 2 }}>
                Position or order mismatches require review before live trading.
              </Alert>
            )}
            <DataTable
              columns={issueColumns}
              rows={issues}
              getRowId={(row) =>
                `${row.source}-${row.recordId}-${row.type}`
              }
              emptyMessage="No reconciliation mismatches detected"
            />
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
