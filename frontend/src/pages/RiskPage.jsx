import {
  Box,
  Chip,
  Grid,
  LinearProgress,
  Typography,
} from "@mui/material";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import OfflineNotice from "../components/OfflineNotice";
import { money, percent } from "../utils/format";

export default function RiskPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [dashboard, status] = await Promise.all([
      getDataSafe("/api/risk/dashboard", {
        totalCapital: 100000,
        usedCapital: 0,
        availableCapital: 100000,
        maxDailyLoss: 0,
        currentDailyLoss: 0,
        riskUtilizationPercent: 0,
        openPositions: 0,
        activeAlerts: 0,
      }),
      getDataSafe("/api/risk/status", {
        status: "UNKNOWN",
        tradingAllowed: false,
        reasons: [],
      }),
    ]);
    return {
      dashboard: dashboard.data,
      status: status.data,
      unavailable: dashboard.unavailable || status.unavailable,
      partialError: visibleError(dashboard, status),
    };
  }, []);
  if (loading) return <Loading label="Loading risk controls" />;
  const risk = data?.dashboard || {};
  const status = data?.status || {};

  return (
    <>
      <PageHeader
        eyebrow="Capital protection"
        title="Risk dashboard"
        description="Real-time limits, utilization, and trade permission state."
        action={
          <Chip
            label={status.tradingAllowed ? "Trading allowed" : "Trading locked"}
            color={status.tradingAllowed ? "success" : "error"}
            variant="outlined"
          />
        }
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Risk data unavailable" />}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><StatCard label="Total capital" value={money(risk.totalCapital)} /></Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><StatCard label="Used capital" value={money(risk.usedCapital)} tone="secondary" /></Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><StatCard label="Daily loss" value={money(risk.currentDailyLoss)} tone="error" detail={`Limit ${money(risk.maxDailyLoss)}`} /></Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><StatCard label="Open positions" value={risk.openPositions ?? 0} tone="warning" detail={`${risk.activeAlerts ?? 0} active alerts`} /></Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Risk utilization" subtitle="Daily loss consumption against configured limit">
            <Box py={2}>
              <Box display="flex" justifyContent="space-between" mb={1.25}>
                <Typography color="text.secondary">Loss budget used</Typography>
                <Typography fontWeight={800}>{percent(risk.riskUtilizationPercent)}</Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={Math.min(Number(risk.riskUtilizationPercent || 0), 100)}
                color={Number(risk.riskUtilizationPercent) > 75 ? "error" : "primary"}
                sx={{ height: 12, borderRadius: 8, bgcolor: "rgba(143,163,187,.1)" }}
              />
            </Box>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Protection state">
            {[
              ["Kill switch", risk.killSwitchActive],
              ["Orders disabled", risk.ordersDisabled],
              ["Daily loss lock", risk.dailyLossLocked],
            ].map(([label, active]) => (
              <Box key={label} display="flex" justifyContent="space-between" alignItems="center" py={1}>
                <Typography color="text.secondary">{label}</Typography>
                <Chip size="small" label={active ? "ACTIVE" : "CLEAR"} color={active ? "error" : "success"} variant="outlined" />
              </Box>
            ))}
          </SectionCard>
        </Grid>
        {status.reasons?.length > 0 && (
          <Grid size={{ xs: 12 }}>
            <SectionCard title="Lock reasons">
              {status.reasons.map((reason) => (
                <Typography key={reason} color="error.main" py={0.5}>
                  {reason}
                </Typography>
              ))}
            </SectionCard>
          </Grid>
        )}
      </Grid>
    </>
  );
}
