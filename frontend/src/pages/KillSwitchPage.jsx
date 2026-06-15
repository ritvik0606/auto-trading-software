import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  Grid,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { getDataSafe, postData, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import SectionCard from "../components/SectionCard";
import { dateTime, money } from "../utils/format";

export default function KillSwitchPage() {
  const [activation, setActivation] = useState({
    confirmation: "",
    reason: "",
    autoRecovery: true,
  });
  const [recovery, setRecovery] = useState({
    confirmation: "",
    reason: "",
    force: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [actionState, setActionState] = useState(null);
  const { data, loading, error, reload } = useApi(async () => {
    const [status, history] = await Promise.all([
      getDataSafe("/api/kill-switch/status", {}),
      getDataSafe("/api/kill-switch/history", []),
    ]);
    return {
      status: status.data || {},
      history: Array.isArray(history.data) ? history.data : [],
      unavailable: status.unavailable || history.unavailable,
      partialError: visibleError(status, history),
    };
  }, []);

  const activate = async () => {
    setSubmitting(true);
    setActionState(null);
    try {
      await postData("/api/kill-switch/activate", activation);
      setActivation({ confirmation: "", reason: "", autoRecovery: true });
      setActionState({
        severity: "error",
        message: "Master kill switch activated. New trading is blocked.",
      });
      await reload();
    } catch (actionError) {
      setActionState({
        severity: actionError.isUnavailable ? "warning" : "error",
        message: actionError.message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const deactivate = async () => {
    setSubmitting(true);
    setActionState(null);
    try {
      await postData("/api/kill-switch/deactivate", recovery);
      setRecovery({ confirmation: "", reason: "", force: false });
      setActionState({
        severity: "success",
        message: "Master kill switch deactivated. Trading gates are open.",
      });
      await reload();
    } catch (actionError) {
      setActionState({
        severity: actionError.isUnavailable ? "warning" : "error",
        message: actionError.message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading label="Loading master kill switch" />;

  const status = data?.status || {};
  const history = Array.isArray(data?.history) ? data.history : [];
  const historyColumns = [
    {
      key: "action",
      label: "Action",
      render: (row) => (
        <Chip
          size="small"
          label={row.action}
          color={row.action === "ACTIVATED" ? "error" : "success"}
          variant="outlined"
        />
      ),
    },
    { key: "triggerType", label: "Trigger" },
    { key: "reason", label: "Reason" },
    { key: "stoppedStrategies", label: "Stopped", align: "right" },
    { key: "cancelledOrders", label: "Cancelled", align: "right" },
    {
      key: "autoRecovery",
      label: "Auto Recovery",
      render: (row) => (row.autoRecovery ? "Enabled" : "Disabled"),
    },
    {
      key: "createdAt",
      label: "Time",
      render: (row) => dateTime(row.createdAt),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Phase 16"
        title="Master Kill Switch"
        description="The highest-priority trading gate for strategies, paper execution, simulator orders, and broker requests."
        action={
          <Chip
            label={status.active ? "EMERGENCY STOP" : "TRADING ENABLED"}
            color={status.active ? "error" : "success"}
          />
        }
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && (
        <OfflineNotice title="Kill switch status unavailable" />
      )}
      {actionState && (
        <Alert severity={actionState.severity} sx={{ mb: 3 }}>
          {actionState.message}
        </Alert>
      )}

      <Paper
        sx={{
          p: { xs: 2.5, md: 4 },
          mb: 3,
          border: "1px solid",
          borderColor: status.active ? "error.main" : "rgba(255,101,119,.45)",
          background:
            "linear-gradient(135deg, rgba(255,101,119,.18), rgba(22,13,23,.92))",
        }}
      >
        <Grid container spacing={3} alignItems="center">
          <Grid size={{ xs: 12, lg: 7 }}>
            <Typography color="error.main" variant="overline" fontWeight={900}>
              EMERGENCY TRADING CONTROL
            </Typography>
            <Typography variant="h3" sx={{ mt: 0.5 }}>
              {status.active ? "Trading is stopped" : "Trading is operational"}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1.5, maxWidth: 720 }}>
              {status.active
                ? status.reason || "All new trading requests are blocked."
                : "Activation stops all running strategies, cancels pending orders, and blocks every new trade path."}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, lg: 5 }}>
            <Box
              sx={{
                p: 2.5,
                borderRadius: 3,
                bgcolor: "rgba(0,0,0,.22)",
              }}
            >
              <Typography fontWeight={800}>
                Active broker: {status.broker?.activeBroker || "Unavailable"}
              </Typography>
              <Typography color="text.secondary">
                Broker health: {status.broker?.health || "UNKNOWN"}
              </Typography>
              <Typography color="text.secondary">
                Pending orders: {status.pendingOrders || 0}
              </Typography>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Global Trading"
            value={status.tradingEnabled ? "ON" : "OFF"}
            tone={status.tradingEnabled ? "success" : "error"}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Daily Loss"
            value={money(status.dailyLoss)}
            tone={
              Number(status.dailyLoss) >= Number(status.dailyLossLimit)
                ? "error"
                : "warning"
            }
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Daily Loss Limit"
            value={money(status.dailyLossLimit)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Auto Recovery"
            value={status.autoRecovery ? "ENABLED" : "DISABLED"}
            detail={status.triggerType || "No active trigger"}
          />
        </Grid>

        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard
            title="Activate Emergency Stop"
            subtitle='Type "ACTIVATE" to confirm this destructive control action'
          >
            <Box display="flex" flexDirection="column" gap={2}>
              <TextField
                label="Reason"
                value={activation.reason}
                onChange={(event) =>
                  setActivation((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
              />
              <TextField
                label='Confirmation phrase: ACTIVATE'
                value={activation.confirmation}
                onChange={(event) =>
                  setActivation((current) => ({
                    ...current,
                    confirmation: event.target.value.toUpperCase(),
                  }))
                }
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={activation.autoRecovery}
                    onChange={(event) =>
                      setActivation((current) => ({
                        ...current,
                        autoRecovery: event.target.checked,
                      }))
                    }
                  />
                }
                label="Allow next-day automatic recovery for daily-loss triggers"
              />
              <Button
                color="error"
                variant="contained"
                size="large"
                disabled={
                  submitting ||
                  status.active ||
                  activation.confirmation !== "ACTIVATE"
                }
                onClick={activate}
              >
                Activate Master Kill Switch
              </Button>
            </Box>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard
            title="Recover Trading"
            subtitle='Review the cause, then type "DEACTIVATE"'
          >
            <Box display="flex" flexDirection="column" gap={2}>
              <TextField
                label="Recovery reason"
                value={recovery.reason}
                onChange={(event) =>
                  setRecovery((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
              />
              <TextField
                label='Confirmation phrase: DEACTIVATE'
                value={recovery.confirmation}
                onChange={(event) =>
                  setRecovery((current) => ({
                    ...current,
                    confirmation: event.target.value.toUpperCase(),
                  }))
                }
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={recovery.force}
                    onChange={(event) =>
                      setRecovery((current) => ({
                        ...current,
                        force: event.target.checked,
                      }))
                    }
                  />
                }
                label="Force recovery even if the daily-loss limit remains breached"
              />
              <Button
                color="success"
                variant="contained"
                size="large"
                disabled={
                  submitting ||
                  !status.active ||
                  recovery.confirmation !== "DEACTIVATE"
                }
                onClick={deactivate}
              >
                Restore Trading
              </Button>
            </Box>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <SectionCard title="Trigger History">
            <DataTable
              columns={historyColumns}
              rows={history}
              emptyMessage="No master kill-switch events recorded"
            />
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
