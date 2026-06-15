import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import useApi from "../hooks/useApi";
import { getData, getDataSafe, postData } from "../services/api";
import DataTable from "../components/DataTable";
import ErrorAlert from "../components/ErrorAlert";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import { dateTime, money, percent, pnlTone } from "../utils/format";

const initialForm = {
  strategyName: "EMA_RSI",
  symbol: "RELIANCE",
  timeframe: "5m",
  capitalAllocated: 25000,
  maxTrades: 3,
};

export default function MultiStrategyEnginePage() {
  const [form, setForm] = useState(initialForm);
  const [performance, setPerformance] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const { data, loading, error, reload } = useApi(
    () => getDataSafe("/api/multi-strategy/all", []),
    []
  );
  const strategies = Array.isArray(data?.data) ? data.data : [];
  const activeCount = strategies.filter((item) => item?.status === "ACTIVE").length;
  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const addStrategy = async () => {
    setBusyId("add");
    setFeedback(null);
    try {
      await postData("/api/multi-strategy/add", {
        ...form,
        symbol: form.symbol.trim().toUpperCase(),
        capitalAllocated: Number(form.capitalAllocated),
        maxTrades: Number(form.maxTrades),
      });
      setFeedback({ severity: "success", message: "Paper strategy instance added." });
      await reload();
    } catch (requestError) {
      setFeedback({ severity: requestError.isUnavailable ? "warning" : "error", message: requestError.message });
    } finally {
      setBusyId(null);
    }
  };

  const runAction = async (id, action) => {
    setBusyId(`${action}-${id}`);
    setFeedback(null);
    try {
      await postData(`/api/multi-strategy/${action}/${id}`);
      setFeedback({ severity: "success", message: `Strategy ${action} action completed.` });
      await reload();
    } catch (requestError) {
      setFeedback({ severity: requestError.isUnavailable ? "warning" : "error", message: requestError.message });
    } finally {
      setBusyId(null);
    }
  };

  const loadPerformance = async (id) => {
    setBusyId(`performance-${id}`);
    try {
      setPerformance((await getData(`/api/multi-strategy/performance/${id}`)) || {});
    } catch (requestError) {
      setFeedback({ severity: requestError.isUnavailable ? "warning" : "error", message: requestError.message });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <Loading label="Loading multi-strategy engine" />;
  const columns = [
    { key: "strategyName", label: "Strategy" },
    { key: "symbol", label: "Symbol" },
    { key: "timeframe", label: "Frame" },
    { key: "status", label: "Status", render: (row) => <Chip size="small" label={row.status || "UNKNOWN"} color={row.status === "ACTIVE" ? "success" : row.status === "PAUSED" ? "warning" : "default"} /> },
    { key: "capitalAllocated", label: "Capital", align: "right", render: (row) => money(row.capitalAllocated) },
    { key: "maxTrades", label: "Max trades", align: "right" },
    { key: "lastAction", label: "Last action", render: (row) => row.lastAction || "--" },
    {
      key: "actions",
      label: "Controls",
      render: (row) => (
        <Stack direction="row" spacing={0.5}>
          <Button size="small" disabled={Boolean(busyId) || row.status === "ACTIVE"} onClick={() => runAction(row.id, "start")}>Start</Button>
          <Button size="small" color="warning" disabled={Boolean(busyId) || row.status !== "ACTIVE"} onClick={() => runAction(row.id, "pause")}>Pause</Button>
          <Button size="small" color="error" disabled={Boolean(busyId) || row.status === "STOPPED"} onClick={() => runAction(row.id, "stop")}>Stop</Button>
          <Button size="small" disabled={Boolean(busyId)} onClick={() => loadPerformance(row.id)}>Stats</Button>
        </Stack>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Automation"
        title="Multi-strategy engine"
        description="Run, pause, stop, and monitor independent strategy instances with per-instance paper capital limits."
        action={<Chip label="PAPER EXECUTION" color="primary" variant="outlined" />}
      />
      <ErrorAlert message={error} onRetry={reload} />
      {feedback && <Alert severity={feedback.severity} sx={{ mb: 3 }}>{feedback.message}</Alert>}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Add strategy instance" subtitle="Duplicate active symbol and strategy combinations are blocked by the backend">
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 2 }}><TextField select fullWidth label="Strategy" value={form.strategyName} onChange={update("strategyName")}><MenuItem value="EMA_RSI">EMA_RSI</MenuItem></TextField></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField fullWidth label="Symbol" value={form.symbol} onChange={update("symbol")} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField select fullWidth label="Timeframe" value={form.timeframe} onChange={update("timeframe")}>{["1m", "5m", "15m", "30m", "1h", "1d"].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField fullWidth type="number" label="Capital" value={form.capitalAllocated} onChange={update("capitalAllocated")} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField fullWidth type="number" label="Max trades" value={form.maxTrades} onChange={update("maxTrades")} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><Button fullWidth variant="contained" sx={{ height: "100%" }} disabled={Boolean(busyId) || !form.symbol.trim()} onClick={addStrategy}>Add instance</Button></Grid>
            </Grid>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Strategy instances" value={strategies.length} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Active" value={activeCount} tone="success" /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Paper capital allocated" value={money(strategies.reduce((sum, item) => sum + Number(item?.capitalAllocated || 0), 0))} /></Grid>
        <Grid size={{ xs: 12 }}><SectionCard title="Strategy fleet"><DataTable columns={columns} rows={strategies} emptyMessage="No strategy instances configured" /></SectionCard></Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Selected performance" subtitle={performance?.strategy ? `${performance.strategy.strategyName} on ${performance.strategy.symbol}` : "Select Stats on a strategy instance"}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 6, md: 2 }}><StatCard label="Total trades" value={performance.totalTrades ?? 0} /></Grid>
              <Grid size={{ xs: 6, md: 2 }}><StatCard label="Open trades" value={performance.openTrades ?? 0} /></Grid>
              <Grid size={{ xs: 6, md: 2 }}><StatCard label="Win rate" value={percent(performance.winRate)} tone="success" /></Grid>
              <Grid size={{ xs: 6, md: 2 }}><StatCard label="Total P&L" value={money(performance.totalPnL)} tone={pnlTone(performance.totalPnL)} /></Grid>
              <Grid size={{ xs: 6, md: 2 }}><StatCard label="Capital in use" value={money(performance.capitalInUse)} /></Grid>
              <Grid size={{ xs: 6, md: 2 }}><StatCard label="Trades remaining" value={performance.tradesRemaining ?? 0} /></Grid>
            </Grid>
            {performance?.strategy?.lastRunAt && <Typography variant="caption" color="text.secondary" display="block" mt={2}>Last cycle: {dateTime(performance.strategy.lastRunAt)}</Typography>}
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
