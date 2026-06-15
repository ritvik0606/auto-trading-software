import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
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
import { dateTime, number, percent } from "../utils/format";

const fallbackStatus = {
  primary: "ANGEL_ONE",
  secondary: "PAYTM_MONEY",
  activeBroker: "ANGEL_ONE",
  health: "UNAVAILABLE",
  mode: "PAPER_ONLY",
  brokers: {
    ANGEL_ONE: { healthy: false, sessionValid: false, latencyMs: null },
    PAYTM_MONEY: { healthy: false, sessionValid: false, latencyMs: null },
  },
};

function brokerLabel(broker) {
  return broker === "ANGEL_ONE" ? "Angel One" : "Paytm Money";
}

export default function BrokerManagementPage() {
  const [actionState, setActionState] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { data, loading, error, reload } = useApi(async () => {
    const [status, metrics, history, angelSession, paytmSession] =
      await Promise.all([
      getDataSafe("/api/broker-failover/status", fallbackStatus),
      getDataSafe("/api/broker-failover/metrics", {
        failures: 0,
        averageLatencyMs: { ANGEL_ONE: null, PAYTM_MONEY: null },
        uptime: { ANGEL_ONE: null, PAYTM_MONEY: null },
        lastSwitchTime: null,
        activeBroker: "ANGEL_ONE",
        mode: "PAPER_ONLY",
      }),
      getDataSafe("/api/broker-failover/history", []),
      getDataSafe("/api/broker/angel/status", {
        broker: "ANGEL_ONE",
        connected: false,
        sessionValid: false,
      }),
      getDataSafe("/api/broker/paytm/status", {
        broker: "PAYTM_MONEY",
        connected: false,
        sessionValid: false,
      }),
      ]);
    return {
      status: status.data,
      metrics: metrics.data,
      history: history.data,
      angelSession: angelSession.data,
      paytmSession: paytmSession.data,
      unavailable:
        status.unavailable ||
        metrics.unavailable ||
        history.unavailable ||
        angelSession.unavailable ||
        paytmSession.unavailable,
      partialError: visibleError(
        status,
        metrics,
        history,
        angelSession,
        paytmSession
      ),
    };
  }, []);

  const runAction = async (action) => {
    setSubmitting(true);
    setActionState(null);
    try {
      if (action === "CONNECT_ANGEL") {
        await postData("/api/broker/angel/connect");
        setActionState({
          severity: "success",
          message: "Angel One connection request completed.",
        });
        await reload();
      } else if (action === "CONNECT_PAYTM") {
        await postData("/api/broker/paytm/connect");
        setActionState({
          severity: "success",
          message: "Paytm Money connection request completed.",
        });
        await reload();
      } else if (action === "DISCONNECT") {
        await postData("/api/broker/disconnect");
        setActionState({
          severity: "success",
          message: "Broker sessions disconnected.",
        });
        await reload();
      } else {
        const result = await postData("/api/broker-failover/switch", {
          broker: action,
        });
        setActionState({
          severity: "success",
          message: `Active paper execution broker switched to ${brokerLabel(result.activeBroker)}.`,
        });
        await reload();
      }
    } catch (actionError) {
      setActionState({
        severity: actionError.isUnavailable ? "warning" : "error",
        message: actionError.isUnavailable
          ? "Broker offline. Paper trading mode active. Data unavailable."
          : actionError.message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading label="Checking broker connectivity" />;
  const status = { ...fallbackStatus, ...(data?.status || {}) };
  const metrics = data?.metrics || {};
  const angel =
    data?.angelSession ||
    status.brokers?.ANGEL_ONE ||
    fallbackStatus.brokers.ANGEL_ONE;
  const paytm =
    data?.paytmSession ||
    status.brokers?.PAYTM_MONEY ||
    fallbackStatus.brokers.PAYTM_MONEY;
  const angelConnected = angel.connected ?? angel.healthy;
  const paytmConnected = paytm.connected ?? paytm.healthy;
  const history = Array.isArray(data?.history) ? data.history : [];
  const historyColumns = [
    { key: "id", label: "Event" },
    { key: "primaryBroker", label: "Primary" },
    { key: "secondaryBroker", label: "Secondary" },
    { key: "failureReason", label: "Reason" },
    {
      key: "status",
      label: "Status",
      render: (row) => <Chip size="small" label={row.status} variant="outlined" />,
    },
    { key: "switchTime", label: "Switched", render: (row) => dateTime(row.switchTime) },
    { key: "recoveryTime", label: "Recovered", render: (row) => dateTime(row.recoveryTime) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Connectivity"
        title="Broker management"
        description="Monitor broker health, paper-execution failover, and session availability."
        action={<Chip label="PAPER MODE" color="primary" variant="outlined" />}
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {(data?.unavailable || (!angelConnected && !paytmConnected)) && (
        <OfflineNotice />
      )}
      {actionState && (
        <Alert severity={actionState.severity} sx={{ mb: 3 }}>
          {actionState.message}
        </Alert>
      )}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label="Angel One"
            value={angelConnected ? "Connected" : "Disconnected"}
            tone={angelConnected ? "success" : "warning"}
            detail={
              angel.latencyMs == null
                ? "Latency unavailable"
                : `${number(angel.latencyMs, 0)} ms latency`
            }
            badge={status.activeBroker === "ANGEL_ONE" ? "ACTIVE" : null}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label="Paytm Money"
            value={paytmConnected ? "Connected" : "Disconnected"}
            tone={paytmConnected ? "success" : "warning"}
            detail={
              paytm.latencyMs == null
                ? "Latency unavailable"
                : `${number(paytm.latencyMs, 0)} ms latency`
            }
            badge={status.activeBroker === "PAYTM_MONEY" ? "ACTIVE" : null}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label="Active broker"
            value={brokerLabel(status.activeBroker)}
            tone="primary"
            detail={`${status.health} · ${status.mode}`}
          />
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Broker sessions" subtitle="Connect and inspect session status">
            <Grid container spacing={2}>
              {[
                ["Angel One", angel, angelConnected],
                ["Paytm Money", paytm, paytmConnected],
              ].map(([label, broker, connected]) => (
                <Grid key={label} size={{ xs: 12, md: 6 }}>
                  <Box
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      bgcolor: "rgba(143,163,187,.05)",
                      height: "100%",
                    }}
                  >
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <Typography fontWeight={800}>{label}</Typography>
                      <Chip
                        size="small"
                        label={connected ? "CONNECTED" : "DISCONNECTED"}
                        color={connected ? "success" : "warning"}
                      />
                    </Box>
                    <Typography variant="body2" color="text.secondary" mt={1.5}>
                      Session: {broker.sessionValid ? "Valid" : "Unavailable"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Last login/check:{" "}
                      {dateTime(
                        broker.lastLoginAt ||
                          broker.lastCheckedAt ||
                          broker.checkedAt
                      )}
                    </Typography>
                    {broker.reason && (
                      <Typography variant="caption" color="warning.main" display="block" mt={1}>
                        {broker.reason}
                      </Typography>
                    )}
                  </Box>
                </Grid>
              ))}
            </Grid>
            <Box display="flex" flexWrap="wrap" gap={1.5} mt={2}>
              <Button
                variant="contained"
                disabled={submitting}
                onClick={() => runAction("CONNECT_ANGEL")}
              >
                Angel One Connect
              </Button>
              <Button
                variant="outlined"
                disabled={submitting}
                onClick={() => runAction("CONNECT_PAYTM")}
              >
                Paytm Money Connect
              </Button>
              <Button
                variant="text"
                color="warning"
                disabled={submitting}
                onClick={() => runAction("DISCONNECT")}
              >
                Disconnect
              </Button>
            </Box>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Failover controls" subtitle="Paper execution broker routing">
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6 }}>
                <StatCard label="Failures" value={metrics.failures ?? 0} tone="warning" />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <StatCard
                  label="Last switch"
                  value={metrics.lastSwitchTime ? "Recorded" : "None"}
                  detail={dateTime(metrics.lastSwitchTime)}
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <StatCard
                  label="Angel uptime"
                  value={
                    metrics.uptime?.ANGEL_ONE == null
                      ? "N/A"
                      : percent(metrics.uptime.ANGEL_ONE)
                  }
                  tone="success"
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <StatCard
                  label="Paytm uptime"
                  value={
                    metrics.uptime?.PAYTM_MONEY == null
                      ? "N/A"
                      : percent(metrics.uptime.PAYTM_MONEY)
                  }
                  tone="secondary"
                />
              </Grid>
            </Grid>
            <Box display="flex" flexWrap="wrap" gap={1.5} mt={2}>
              <Button
                variant="outlined"
                disabled={submitting || status.activeBroker === "ANGEL_ONE"}
                onClick={() => runAction("ANGEL_ONE")}
              >
                Switch to Angel One
              </Button>
              <Button
                variant="outlined"
                disabled={submitting || status.activeBroker === "PAYTM_MONEY"}
                onClick={() => runAction("PAYTM_MONEY")}
              >
                Switch to Paytm
              </Button>
              <Button variant="text" disabled={submitting} onClick={reload}>
                Refresh status
              </Button>
            </Box>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Failover history" subtitle="Broker switches and recovery events">
            <DataTable
              columns={historyColumns}
              rows={history}
              emptyMessage="No broker failover events recorded"
            />
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
