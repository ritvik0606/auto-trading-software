import { Grid, Box, Chip, Typography } from "@mui/material";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import OfflineNotice from "../components/OfflineNotice";
import { money, pnlTone } from "../utils/format";

const fallbackSummary = {
  capital: 100000,
  usedCapital: 0,
  availableCapital: 100000,
  todayPnL: 0,
  openPositions: 0,
  watchlistCount: 0,
};

export default function DashboardPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [summary, broker, portfolio, risk, positions, performance] =
      await Promise.all([
        getDataSafe("/api/dashboard/summary", null),
        getDataSafe("/api/dashboard/broker-status", {
          broker: "Angel One",
          connected: false,
        }),
        getDataSafe("/api/portfolio/summary", null),
        getDataSafe("/api/risk/dashboard", null),
        getDataSafe("/api/positions/all", []),
        getDataSafe("/api/performance/summary", null),
      ]);
    const openPositions = Array.isArray(positions.data)
      ? positions.data.filter((position) => position.status === "OPEN").length
      : 0;
    const resolvedSummary = {
      ...fallbackSummary,
      capital:
        portfolio.data?.totalCapital ??
        risk.data?.totalCapital ??
        fallbackSummary.capital,
      usedCapital:
        portfolio.data?.usedCapital ??
        risk.data?.usedCapital ??
        fallbackSummary.usedCapital,
      availableCapital:
        portfolio.data?.availableCapital ??
        risk.data?.availableCapital ??
        fallbackSummary.availableCapital,
      todayPnL:
        risk.data?.todayPnL ??
        portfolio.data?.totalPnL ??
        performance.data?.totalPnL ??
        fallbackSummary.todayPnL,
      openPositions:
        portfolio.data?.openPositions ??
        risk.data?.openPositions ??
        openPositions,
      ...(summary.data || {}),
    };

    return {
      summary: resolvedSummary,
      broker: broker.data,
      brokerUnavailable: broker.unavailable,
      dataUnavailable:
        summary.unavailable ||
        portfolio.unavailable ||
        risk.unavailable ||
        positions.unavailable ||
        performance.unavailable,
      partialError: visibleError(
        summary,
        broker,
        portfolio,
        risk,
        positions,
        performance
      ),
    };
  }, []);

  if (loading) return <Loading />;

  const summary = data?.summary || {};
  const connected = data?.broker?.connected;
  const showOffline = !connected || data?.brokerUnavailable || data?.dataUnavailable;

  return (
    <>
      <PageHeader
        eyebrow="Command center"
        title="Trading overview"
        description="A live operational view of capital, positions, and broker connectivity."
        action={
          <Chip
            label={connected ? "Angel One connected" : "Broker offline"}
            color={connected ? "success" : "error"}
            variant="outlined"
          />
        }
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {showOffline && <OfflineNotice />}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard label="Total capital" value={money(summary.capital)} detail="Configured trading capital" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard label="Available capital" value={money(summary.availableCapital)} tone="success" detail={`${money(summary.usedCapital)} deployed`} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard label="Today's P&L" value={money(summary.todayPnL)} tone={pnlTone(summary.todayPnL)} detail="Closed trading activity" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard label="Open positions" value={summary.openPositions ?? 0} tone="secondary" detail={`${summary.watchlistCount ?? 0} watchlist symbols`} />
        </Grid>
        <Grid size={{ xs: 12, lg: 8 }}>
          <SectionCard title="Capital utilization" subtitle="Current allocation across the paper portfolio">
            <Box sx={{ py: 2 }}>
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography color="text.secondary">Capital deployed</Typography>
                <Typography fontWeight={700}>{money(summary.usedCapital)}</Typography>
              </Box>
              <Box sx={{ height: 14, bgcolor: "rgba(143,163,187,.1)", borderRadius: 10, overflow: "hidden" }}>
                <Box
                  sx={{
                    height: "100%",
                    width: `${Math.min((Number(summary.usedCapital || 0) / Math.max(Number(summary.capital || 1), 1)) * 100, 100)}%`,
                    background: "linear-gradient(90deg, #4de8c2, #8b7cff)",
                    borderRadius: 10,
                  }}
                />
              </Box>
              <Box display="flex" justifyContent="space-between" mt={1.5}>
                <Typography variant="caption" color="text.secondary">Used capital</Typography>
                <Typography variant="caption" color="text.secondary">Available {money(summary.availableCapital)}</Typography>
              </Box>
            </Box>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <SectionCard title="System status" subtitle="Execution services">
            {[
              ["Backend API", "Online", "success.main"],
              ["Broker session", connected ? "Connected" : "Disconnected", connected ? "success.main" : "error.main"],
              ["Execution", "Paper only", "warning.main"],
            ].map(([label, value, color]) => (
              <Box key={label} display="flex" justifyContent="space-between" py={1.25}>
                <Typography color="text.secondary">{label}</Typography>
                <Typography fontWeight={700} color={color}>{value}</Typography>
              </Box>
            ))}
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
