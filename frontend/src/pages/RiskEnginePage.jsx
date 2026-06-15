import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  FormControlLabel,
  Grid,
  Stack,
  Switch,
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
import { dateTime, money } from "../utils/format";

const fallbackConfig = {
  dailyLossLimit: 2000,
  maxOpenPositions: 5,
  maxCapitalPerTrade: 20000,
  maxDailyTrades: 10,
  profitLockEnabled: true,
  profitLockTrigger: 5000,
  profitLockGiveback: 2000,
  maxDrawdown: 5000,
};

export default function RiskEnginePage() {
  const [form, setForm] = useState(fallbackConfig);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useApi(async () => {
    const [status, events] = await Promise.all([
      getDataSafe("/api/risk-engine/status", {
        status: "UNKNOWN",
        tradingAllowed: false,
        config: fallbackConfig,
        metrics: {},
        reasons: [],
      }),
      getDataSafe("/api/risk-engine/events", []),
    ]);
    return {
      status: status.data || {},
      events: Array.isArray(events.data) ? events.data : [],
      unavailable: status.unavailable || events.unavailable,
      partialError: visibleError(status, events),
    };
  }, []);

  useEffect(() => {
    if (data?.status?.config) {
      setForm((current) => ({ ...current, ...data.status.config }));
    }
  }, [data]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const runAction = async (path, body, successMessage) => {
    setBusy(true);
    setFeedback(null);
    try {
      await postData(path, body);
      setFeedback({ severity: "success", message: successMessage });
      await reload();
    } catch (requestError) {
      setFeedback({
        severity: requestError.isUnavailable ? "warning" : "error",
        message: requestError.message,
      });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    runAction(
      "/api/risk-engine/config",
      {
        dailyLossLimit: Number(form.dailyLossLimit),
        maxOpenPositions: Number(form.maxOpenPositions),
        maxCapitalPerTrade: Number(form.maxCapitalPerTrade),
        maxDailyTrades: Number(form.maxDailyTrades),
        profitLockEnabled: Boolean(form.profitLockEnabled),
        profitLockTrigger: Number(form.profitLockTrigger),
        profitLockGiveback: Number(form.profitLockGiveback),
        maxDrawdown: Number(form.maxDrawdown),
      },
      "Risk configuration saved."
    );

  if (loading) return <Loading label="Loading advanced risk engine" />;
  const status = data?.status || {};
  const metrics = status.metrics || {};
  const events = Array.isArray(data?.events) ? data.events : [];
  const columns = [
    { key: "createdAt", label: "Time", render: (row) => dateTime(row.createdAt) },
    { key: "eventType", label: "Event" },
    { key: "severity", label: "Severity", render: (row) => <Chip size="small" label={row.severity || "INFO"} color={row.severity === "CRITICAL" ? "error" : row.severity === "WARNING" ? "warning" : "default"} /> },
    { key: "message", label: "Message" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Capital protection"
        title="Advanced risk engine"
        description="Hard limits for paper execution, automatic strategy shutdown, profit protection, and emergency control."
        action={<Chip label="PAPER ONLY" color="primary" variant="outlined" />}
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Risk engine unavailable" />}
      {feedback && <Alert severity={feedback.severity} sx={{ mb: 3 }}>{feedback.message}</Alert>}
      {Array.isArray(status.reasons) && status.reasons.length > 0 && (
        <Alert severity="error" sx={{ mb: 3 }}>{status.reasons.join(". ")}</Alert>
      )}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Risk status" value={status.status || "UNKNOWN"} tone={status.tradingAllowed ? "success" : "error"} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Daily P&L" value={money(metrics.dailyPnL)} tone={Number(metrics.dailyPnL) >= 0 ? "success" : "error"} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Daily loss limit" value={money(form.dailyLossLimit)} detail={`${money(metrics.remainingDailyLoss)} remaining`} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Kill switch" value={status.killSwitchActive ? "ACTIVE" : "CLEAR"} tone={status.killSwitchActive ? "error" : "success"} /></Grid>
        <Grid size={{ xs: 12, lg: 8 }}>
          <SectionCard title="Risk configuration" subtitle="Limits apply before every new paper trade">
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField fullWidth type="number" label="Daily loss limit" value={form.dailyLossLimit} onChange={update("dailyLossLimit")} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField fullWidth type="number" label="Max open positions" value={form.maxOpenPositions} onChange={update("maxOpenPositions")} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField fullWidth type="number" label="Capital per trade" value={form.maxCapitalPerTrade} onChange={update("maxCapitalPerTrade")} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField fullWidth type="number" label="Max daily trades" value={form.maxDailyTrades} onChange={update("maxDailyTrades")} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField fullWidth type="number" label="Profit lock trigger" value={form.profitLockTrigger} onChange={update("profitLockTrigger")} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField fullWidth type="number" label="Profit giveback" value={form.profitLockGiveback} onChange={update("profitLockGiveback")} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField fullWidth type="number" label="Max drawdown" value={form.maxDrawdown} onChange={update("maxDrawdown")} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><FormControlLabel control={<Switch checked={Boolean(form.profitLockEnabled)} onChange={(event) => setForm((current) => ({ ...current, profitLockEnabled: event.target.checked }))} />} label="Profit lock enabled" /></Grid>
            </Grid>
            <Button variant="contained" sx={{ mt: 2 }} disabled={busy} onClick={save}>Save Risk Config</Button>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <SectionCard title="Emergency controls">
            <Stack spacing={2}>
              <Typography color="text.secondary">
                Kill switch stops auto-trading runners, blocks new paper trades, and closes open paper positions.
              </Typography>
              <Button color="error" variant="contained" disabled={busy || status.killSwitchActive} onClick={() => runAction("/api/risk-engine/kill-switch", { confirmation: "ACTIVATE", reason: "Risk Engine dashboard activation" }, "Emergency kill switch activated.")}>
                Activate Kill Switch
              </Button>
              <Button color="warning" variant="outlined" disabled={busy || (!status.riskLocked && !status.killSwitchActive)} onClick={() => runAction("/api/risk-engine/unlock", { confirmation: "DEACTIVATE" }, "Risk engine unlocked.")}>
                Unlock Risk Engine
              </Button>
              <Typography variant="caption" color="warning.main">
                Unlocking permits new paper trades again; it never enables real orders.
              </Typography>
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Open positions" value={metrics.openPositions ?? 0} detail={`Limit ${form.maxOpenPositions}`} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Daily trades" value={metrics.dailyTrades ?? 0} detail={`Limit ${form.maxDailyTrades}`} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Capital per trade" value={money(form.maxCapitalPerTrade)} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Current drawdown" value={money(metrics.currentDrawdown)} detail={`Limit ${money(form.maxDrawdown)}`} tone="warning" /></Grid>
        <Grid size={{ xs: 12 }}><SectionCard title="Risk events"><DataTable columns={columns} rows={events} emptyMessage="No risk events recorded" /></SectionCard></Grid>
      </Grid>
    </>
  );
}
