import { Box, Button, Chip, Grid, Typography } from "@mui/material";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import OfflineNotice from "../components/OfflineNotice";
import { money, pnlTone } from "../utils/format";

export default function MobileControlPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [dashboard, health] = await Promise.all([
      getDataSafe("/api/mobile/dashboard", {
        activeStrategies: 0,
        openPositions: 0,
        dailyPnL: 0,
        broker: "ANGEL_ONE",
        brokerConnected: false,
        status: "PAPER_MODE",
        mode: "PAPER_ONLY",
      }),
      getDataSafe("/api/mobile/health", {
        server: "UNKNOWN",
        database: "UNKNOWN",
        broker: "DISCONNECTED",
      }),
    ]);
    return {
      dashboard: dashboard.data,
      health: health.data,
      unavailable: dashboard.unavailable || health.unavailable,
      partialError: visibleError(dashboard, health),
    };
  }, []);
  if (loading) return <Loading label="Checking remote control services" />;
  const dashboard = data?.dashboard || {};
  const health = data?.health || {};

  return (
    <>
      <PageHeader
        eyebrow="Remote operations"
        title="Mobile control"
        description="Monitor the paper-trading engine and remote service availability."
        action={<Button variant="outlined" onClick={reload}>Refresh status</Button>}
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {(data?.unavailable || dashboard.brokerConnected === false) && (
        <OfflineNotice />
      )}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><StatCard label="Active strategies" value={dashboard.activeStrategies ?? 0} /></Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><StatCard label="Open positions" value={dashboard.openPositions ?? 0} tone="secondary" /></Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><StatCard label="Daily P&L" value={money(dashboard.dailyPnL)} tone={pnlTone(dashboard.dailyPnL)} /></Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}><StatCard label="Engine status" value={dashboard.status || "--"} tone={dashboard.status === "RUNNING" ? "success" : "warning"} /></Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard title="Service health" subtitle="Current connectivity">
            {[
              ["API server", health.server],
              ["PostgreSQL", health.database],
              ["Angel One", health.broker],
            ].map(([label, value]) => (
              <Box key={label} display="flex" justifyContent="space-between" alignItems="center" py={1.25}>
                <Typography color="text.secondary">{label}</Typography>
                <Chip
                  label={value || "UNKNOWN"}
                  color={["ONLINE", "CONNECTED"].includes(value) ? "success" : "error"}
                  size="small"
                  variant="outlined"
                />
              </Box>
            ))}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard title="Remote execution policy">
            <Typography color="text.secondary" lineHeight={1.8}>
              Mobile commands control internal paper strategies only. Real broker
              order execution remains outside this dashboard and protected by the
              backend safety layer.
            </Typography>
            <Chip label={dashboard.mode || "PAPER_ONLY"} color="primary" sx={{ mt: 2 }} />
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
