import { useEffect, useState } from "react";
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
import { getDataSafe, postData, visibleError } from "../services/api";
import DataTable from "../components/DataTable";
import ErrorAlert from "../components/ErrorAlert";
import Loading from "../components/Loading";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import { dateTime, money, number } from "../utils/format";

const initialForm = {
  strategyName: "EMA_RSI",
  symbol: "RELIANCE",
  quantity: 1,
  intervalSeconds: 30,
};

export default function AutoTradingPage() {
  const [form, setForm] = useState(initialForm);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useApi(async () => {
    const [status, runners, signals] = await Promise.all([
      getDataSafe("/api/auto-trade/status", {}),
      getDataSafe("/api/auto-trade/runners", []),
      getDataSafe("/api/auto-trade/signals", []),
    ]);
    return {
      status: status.data || {},
      runners: Array.isArray(runners.data) ? runners.data : [],
      signals: Array.isArray(signals.data) ? signals.data : [],
      unavailable: status.unavailable || runners.unavailable || signals.unavailable,
      partialError: visibleError(status, runners, signals),
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(reload, 10000);
    return () => clearInterval(timer);
  }, [reload]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const start = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await postData("/api/auto-trade/start", {
        ...form,
        symbol: form.symbol.trim().toUpperCase(),
        quantity: Number(form.quantity),
        intervalSeconds: Number(form.intervalSeconds),
      });
      setFeedback({ severity: "success", message: "Paper auto-trading runner started." });
      await reload();
    } catch (requestError) {
      setFeedback({ severity: requestError.isUnavailable ? "warning" : "error", message: requestError.message });
    } finally {
      setBusy(false);
    }
  };

  const stop = async (runner) => {
    setBusy(true);
    setFeedback(null);
    try {
      await postData("/api/auto-trade/stop", {
        strategyName: runner.strategyName,
        symbol: runner.symbol,
      });
      setFeedback({ severity: "success", message: `${runner.symbol} runner stopped.` });
      await reload();
    } catch (requestError) {
      setFeedback({ severity: requestError.isUnavailable ? "warning" : "error", message: requestError.message });
    } finally {
      setBusy(false);
    }
  };

  const stopAll = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await postData("/api/auto-trade/stop", {});
      setFeedback({ severity: "success", message: "All auto-trade runners stopped." });
      await reload();
    } catch (requestError) {
      setFeedback({ severity: requestError.isUnavailable ? "warning" : "error", message: requestError.message });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading auto-trading engine" />;
  const status = data?.status || {};
  const runners = Array.isArray(data?.runners) ? data.runners : [];
  const signals = Array.isArray(data?.signals) ? data.signals : [];
  const openTrades = Array.isArray(status?.openPaperTrades)
    ? status.openPaperTrades
    : [];
  const marketConnected = Boolean(status?.marketStream?.connected);
  const runnerColumns = [
    { key: "strategyName", label: "Strategy" },
    { key: "symbol", label: "Symbol" },
    { key: "status", label: "Status", render: (row) => <Chip size="small" label={row.status || "STOPPED"} color={row.status === "RUNNING" ? "success" : "default"} /> },
    { key: "intervalSeconds", label: "Cycle", align: "right", render: (row) => `${row.intervalSeconds || 0}s` },
    { key: "lastSignal", label: "Last signal", render: (row) => <Chip size="small" label={row.lastSignal || "PENDING"} color={row.lastSignal === "BUY" ? "success" : row.lastSignal === "SELL" ? "error" : "default"} /> },
    { key: "lastPrice", label: "Live LTP", align: "right", render: (row) => row.lastPrice ? money(row.lastPrice) : "--" },
    { key: "lastAction", label: "Last action" },
    { key: "lastRunAt", label: "Last cycle", render: (row) => dateTime(row.lastRunAt) },
    { key: "lastExecutionAt", label: "Last execution", render: (row) => dateTime(row.lastExecutionAt) },
    { key: "actions", label: "", render: (row) => <Button size="small" color="error" disabled={busy} onClick={() => stop(row)}>Stop</Button> },
  ];
  const signalColumns = [
    { key: "createdAt", label: "Time", render: (row) => dateTime(row.createdAt) },
    { key: "symbol", label: "Symbol" },
    { key: "strategyName", label: "Strategy" },
    { key: "signal", label: "Signal", render: (row) => <Chip size="small" label={row.signal || "HOLD"} color={row.signal === "BUY" ? "success" : row.signal === "SELL" ? "error" : "default"} /> },
    { key: "ltp", label: "LTP", align: "right", render: (row) => row.ltp ? money(row.ltp) : "--" },
    { key: "ema20", label: "EMA 20", align: "right", render: (row) => number(row.ema20) },
    { key: "ema50", label: "EMA 50", align: "right", render: (row) => number(row.ema50) },
    { key: "rsi", label: "RSI", align: "right", render: (row) => number(row.rsi) },
  ];
  const tradeColumns = [
    { key: "id", label: "Trade" },
    { key: "symbol", label: "Symbol" },
    { key: "tradeType", label: "Side" },
    { key: "quantity", label: "Qty", align: "right" },
    { key: "entryPrice", label: "Entry", align: "right", render: (row) => money(row.entryPrice) },
    { key: "status", label: "Status" },
    { key: "createdAt", label: "Opened", render: (row) => dateTime(row.createdAt) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Automation"
        title="Auto trading engine"
        description="Schedule EMA_RSI paper-execution cycles using Angel One WebSocket prices."
        action={<Chip label="REAL ORDERS DISABLED" color="primary" variant="outlined" />}
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {(data?.unavailable || !marketConnected) && (
        <OfflineNotice
          title="Live market stream unavailable"
          details={["Paper trading mode active", "No trade executes without a live Angel One tick"]}
        />
      )}
      {feedback && <Alert severity={feedback.severity} sx={{ mb: 3 }}>{feedback.message}</Alert>}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12 }}>
          <SectionCard
            title="Start scheduler"
            subtitle="Each strategy and symbol pair can have only one active runner"
            action={<Button color="error" variant="outlined" disabled={busy || runners.length === 0} onClick={stopAll}>Stop all</Button>}
          >
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 3 }}><TextField select fullWidth label="Strategy" value={form.strategyName} onChange={update("strategyName")}><MenuItem value="EMA_RSI">EMA_RSI</MenuItem></TextField></Grid>
              <Grid size={{ xs: 12, md: 3 }}><TextField fullWidth label="Symbol" value={form.symbol} onChange={update("symbol")} /></Grid>
              <Grid size={{ xs: 6, md: 2 }}><TextField fullWidth type="number" label="Quantity" value={form.quantity} onChange={update("quantity")} /></Grid>
              <Grid size={{ xs: 6, md: 2 }}><TextField select fullWidth label="Cycle" value={form.intervalSeconds} onChange={update("intervalSeconds")}>{[30, 45, 60].map((value) => <MenuItem key={value} value={value}>{value} seconds</MenuItem>)}</TextField></Grid>
              <Grid size={{ xs: 12, md: 2 }}><Button fullWidth variant="contained" sx={{ height: "100%" }} disabled={busy || !form.symbol.trim()} onClick={start}>{busy ? "Working..." : "Start runner"}</Button></Grid>
            </Grid>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Engine status" value={status.engineStatus || "STOPPED"} tone={status.engineStatus === "RUNNING" ? "success" : "secondary"} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Running strategies" value={runners.length} tone="success" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Open paper trades" value={openTrades.length} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Market stream" value={marketConnected ? "CONNECTED" : "OFFLINE"} tone={marketConnected ? "success" : "error"} /></Grid>
        <Grid size={{ xs: 12 }}><SectionCard title="Running strategies"><DataTable columns={runnerColumns} rows={runners} emptyMessage="No auto-trade runners are active" /></SectionCard></Grid>
        <Grid size={{ xs: 12 }}><SectionCard title="Signal history" subtitle="Latest EMA 20, EMA 50, and RSI decisions"><DataTable columns={signalColumns} rows={signals} emptyMessage="No scheduler signals recorded yet" /></SectionCard></Grid>
        <Grid size={{ xs: 12 }}><SectionCard title="Open paper trades"><DataTable columns={tradeColumns} rows={openTrades} emptyMessage="No open paper trades" /></SectionCard></Grid>
      </Grid>
    </>
  );
}
