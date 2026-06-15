import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  TextField,
  Typography,
} from "@mui/material";
import {
  getDataSafe,
  postData,
  visibleError,
} from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import SectionCard from "../components/SectionCard";
import { dateTime, money } from "../utils/format";

export default function StrategiesPage() {
  const [symbol, setSymbol] = useState("RELIANCE");
  const [actionState, setActionState] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { data, loading, error, reload } = useApi(async () => {
    const [activeStrategies, strategyInstances] = await Promise.all([
      getDataSafe("/api/strategy/active", []),
      getDataSafe("/api/multi-strategy/all", []),
    ]);

    return {
      activeStrategies: activeStrategies.data,
      strategyInstances: strategyInstances.data,
      unavailable:
        activeStrategies.unavailable || strategyInstances.unavailable,
      partialError: visibleError(activeStrategies, strategyInstances),
    };
  }, []);

  const runAction = async (action) => {
    setSubmitting(true);
    setActionState(null);
    try {
      const result = await postData(`/api/strategy/${action}`, {
        symbol: symbol.trim().toUpperCase(),
        ...(action === "start" ? { strategy: "EMA_RSI" } : {}),
      });
      setActionState({
        severity: "success",
        message:
          action === "start"
            ? `EMA_RSI started for ${result.symbol}`
            : `Strategy stopped for ${result.symbol}`,
      });
      await reload();
    } catch (actionError) {
      setActionState({
        severity: actionError.isUnavailable ? "warning" : "error",
        message: actionError.isUnavailable
          ? "Broker offline. Paper trading mode remains active; strategy market data is unavailable."
          : actionError.message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading label="Loading strategies" />;
  const activeRows = Array.isArray(data?.activeStrategies)
    ? data.activeStrategies
    : [];
  const instanceRows = Array.isArray(data?.strategyInstances)
    ? data.strategyInstances
    : [];
  const allocated = instanceRows.reduce(
    (sum, row) => sum + Number(row.capitalAllocated || 0),
    0
  );
  const statusColor = (status) =>
    status === "ACTIVE"
      ? "success"
      : status === "PAUSED"
        ? "warning"
        : "default";
  const activeColumns = [
    { key: "symbol", label: "Symbol" },
    { key: "strategy", label: "Strategy" },
    {
      key: "status",
      label: "Status",
      render: (row) => <Chip size="small" label={row.status} color="success" />,
    },
    { key: "lastSignal", label: "Last signal" },
    { key: "lastAction", label: "Last action" },
    { key: "lastRunAt", label: "Last cycle", render: (row) => dateTime(row.lastRunAt) },
  ];
  const instanceColumns = [
    { key: "id", label: "ID" },
    { key: "strategyName", label: "Strategy" },
    { key: "symbol", label: "Symbol" },
    { key: "timeframe", label: "Timeframe" },
    {
      key: "capitalAllocated",
      label: "Capital",
      align: "right",
      render: (row) => money(row.capitalAllocated),
    },
    { key: "maxTrades", label: "Max trades", align: "right" },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <Chip size="small" label={row.status} color={statusColor(row.status)} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Automation"
        title="Strategy control"
        description="Start and stop EMA_RSI paper strategies, then monitor every active runner."
        action={<Chip label="PAPER TRADING" color="primary" variant="outlined" />}
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Strategy data unavailable" />}
      {actionState && (
        <Alert severity={actionState.severity} sx={{ mb: 3 }}>
          {actionState.message}
        </Alert>
      )}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Active strategies" value={activeRows.length} tone="success" />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Strategy instances" value={instanceRows.length} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Capital allocated" value={money(allocated)} tone="secondary" />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="EMA_RSI control panel" subtitle="Single-strategy paper runner">
            <Box
              display="flex"
              flexDirection={{ xs: "column", md: "row" }}
              alignItems={{ xs: "stretch", md: "center" }}
              gap={1.5}
            >
              <TextField
                label="Symbol"
                value={symbol}
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                size="small"
                sx={{ minWidth: 220 }}
              />
              <Button
                variant="contained"
                color="success"
                disabled={submitting || !symbol.trim()}
                onClick={() => runAction("start")}
              >
                Start EMA_RSI
              </Button>
              <Button
                variant="outlined"
                color="error"
                disabled={submitting || !symbol.trim()}
                onClick={() => runAction("stop")}
              >
                Stop Strategy
              </Button>
              <Button variant="text" disabled={submitting} onClick={reload}>
                Refresh Active Strategies
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" display="block" mt={1.5}>
              Signals may be unavailable while Angel One is offline; no live orders are placed.
            </Typography>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Active strategy runners" subtitle="In-memory paper execution cycles">
            <DataTable
              columns={activeColumns}
              rows={activeRows}
              getRowId={(row) => row.symbol}
              emptyMessage="No active paper strategies"
            />
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Configured strategy instances" subtitle="Multi-strategy registry">
            <DataTable columns={instanceColumns} rows={instanceRows} />
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
