import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Grid,
  Stack,
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
import { dateTime, number, percent } from "../utils/format";

const fallbackStatus = {
  primary: "ANGEL_ONE",
  secondary: "PAYTM_MONEY",
  activeBroker: "ANGEL_ONE",
  health: "UNAVAILABLE",
  mode: "PAPER_ONLY",
  overrideMode: "AUTO",
  heartbeat: { intervalSeconds: 30, running: false },
  brokers: {},
};

function brokerLabel(value) {
  return value === "PAYTM_MONEY" ? "Paytm Money" : "Angel One";
}

export default function BrokerFailoverPage() {
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useApi(async () => {
    const [status, logs, metrics] = await Promise.all([
      getDataSafe("/api/broker-failover/status", fallbackStatus),
      getDataSafe("/api/broker-failover/logs", []),
      getDataSafe("/api/broker-failover/metrics", {}),
    ]);
    return {
      status: status.data || fallbackStatus,
      logs: Array.isArray(logs.data) ? logs.data : [],
      metrics: metrics.data || {},
      unavailable: status.unavailable || logs.unavailable || metrics.unavailable,
      partialError: visibleError(status, logs, metrics),
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(reload, 10000);
    return () => clearInterval(timer);
  }, [reload]);

  const switchBroker = async (broker) => {
    setBusy(true);
    setFeedback(null);
    try {
      await postData("/api/broker-failover/switch", { broker });
      setFeedback({
        severity: "success",
        message:
          broker === "AUTO"
            ? "Automatic broker selection restored."
            : `Manual override set to ${brokerLabel(broker)}.`,
      });
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

  if (loading) return <Loading label="Loading broker failover monitor" />;
  const status = { ...fallbackStatus, ...(data?.status || {}) };
  const angel = status.brokers?.ANGEL_ONE || {};
  const paytm = status.brokers?.PAYTM_MONEY || {};
  const metrics = data?.metrics || {};
  const logs = Array.isArray(data?.logs) ? data.logs : [];
  const columns = [
    { key: "id", label: "Event" },
    { key: "status", label: "Type", render: (row) => <Chip size="small" label={row.status || "EVENT"} color={row.status === "FAILED" ? "error" : row.status === "ACTIVE" ? "warning" : "default"} /> },
    { key: "failureReason", label: "Details" },
    { key: "switchTime", label: "Switch time", render: (row) => dateTime(row.switchTime) },
    { key: "recoveryTime", label: "Recovery", render: (row) => dateTime(row.recoveryTime) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Reliability"
        title="Broker failover"
        description="Thirty-second broker heartbeat, automatic paper-routing failover, and manual override controls."
        action={<Chip label="PAPER ROUTING ONLY" color="primary" variant="outlined" />}
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Failover monitor unavailable" />}
      {feedback && <Alert severity={feedback.severity} sx={{ mb: 3 }}>{feedback.message}</Alert>}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard label="Active broker" value={brokerLabel(status.activeBroker)} badge={status.overrideMode} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard label="Routing health" value={status.health} tone={status.health === "HEALTHY" ? "success" : "error"} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard label="Heartbeat" value={`${status.heartbeat?.intervalSeconds || 30}s`} detail={dateTime(status.heartbeat?.lastHeartbeatAt)} tone={status.heartbeat?.running ? "success" : "warning"} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard label="Failover events" value={metrics.failures ?? logs.length} detail={`Last switch ${dateTime(metrics.lastSwitchTime)}`} /></Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Broker heartbeat" subtitle="Session validity and observed health">
            <Grid container spacing={2}>
              {[
                ["Angel One", "ANGEL_ONE", angel],
                ["Paytm Money", "PAYTM_MONEY", paytm],
              ].map(([label, key, broker]) => (
                <Grid key={key} size={{ xs: 12, md: 6 }}>
                  <SectionCard
                    title={label}
                    action={<Chip size="small" label={broker.healthy ? "HEALTHY" : "UNAVAILABLE"} color={broker.healthy ? "success" : "error"} />}
                    sx={{ height: "100%" }}
                  >
                    <Stack spacing={1}>
                      <Typography color="text.secondary">Configured <strong>{broker.configured ? "Yes" : "No"}</strong></Typography>
                      <Typography color="text.secondary">Session valid <strong>{broker.sessionValid ? "Yes" : "No"}</strong></Typography>
                      <Typography color="text.secondary">Latency <strong>{broker.latencyMs == null ? "--" : `${number(broker.latencyMs, 0)} ms`}</strong></Typography>
                      <Typography color="text.secondary">Uptime <strong>{metrics.uptime?.[key] == null ? "--" : percent(metrics.uptime[key])}</strong></Typography>
                      {broker.reason && <Typography variant="caption" color="warning.main">{broker.reason}</Typography>}
                    </Stack>
                  </SectionCard>
                </Grid>
              ))}
            </Grid>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Routing controls" subtitle="Manual overrides suspend automatic switching">
            <Stack spacing={1.5}>
              <Button variant="contained" disabled={busy || status.activeBroker === "ANGEL_ONE" && status.overrideMode === "MANUAL"} onClick={() => switchBroker("ANGEL_ONE")}>
                Override to Angel One
              </Button>
              <Button variant="outlined" disabled={busy || status.activeBroker === "PAYTM_MONEY" && status.overrideMode === "MANUAL"} onClick={() => switchBroker("PAYTM_MONEY")}>
                Override to Paytm Money
              </Button>
              <Button color="warning" variant="text" disabled={busy || status.overrideMode === "AUTO"} onClick={() => switchBroker("AUTO")}>
                Resume Automatic Failover
              </Button>
              <Button variant="text" disabled={busy} onClick={reload}>Run Health Check</Button>
              <Alert severity={status.overrideMode === "MANUAL" ? "warning" : "info"}>
                {status.overrideMode === "MANUAL"
                  ? `Manual override active: ${brokerLabel(status.manualOverride)}`
                  : "Automatic failover is active."}
              </Alert>
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Failover event logs" subtitle="Automatic failures, recoveries, and manual routing changes">
            <DataTable columns={columns} rows={logs} emptyMessage="No failover events recorded" />
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
