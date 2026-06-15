import { Grid } from "@mui/material";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import { money, percent } from "../utils/format";

const portfolioFallback = {
  totalCapital: 100000,
  usedCapital: 0,
  availableCapital: 100000,
};

export default function FundsPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [portfolio, dashboard, settings] = await Promise.all([
      getDataSafe("/api/portfolio/summary", portfolioFallback),
      getDataSafe("/api/risk/dashboard", {
        maxDailyLoss: 0,
        currentDailyLoss: 0,
        riskUtilizationPercent: 0,
      }),
      getDataSafe("/api/risk/settings", {
        riskPerTradePercent: 1,
        maxDailyLoss: 2000,
        maxTradesPerDay: 5,
      }),
    ]);
    return {
      portfolio: portfolio.data,
      dashboard: dashboard.data,
      settings: settings.data,
      unavailable:
        portfolio.unavailable || dashboard.unavailable || settings.unavailable,
      partialError: visibleError(portfolio, dashboard, settings),
    };
  }, []);
  if (loading) return <Loading label="Loading funds and margin" />;
  const portfolio = { ...portfolioFallback, ...(data?.portfolio || {}) };
  const risk = data?.dashboard || {};
  const settings = data?.settings || {};
  const marginPercent =
    Number(portfolio.totalCapital) === 0
      ? 0
      : (Number(portfolio.usedCapital) / Number(portfolio.totalCapital)) * 100;

  return (
    <>
      <PageHeader
        eyebrow="Capital"
        title="Funds & margin"
        description="Available paper capital, deployed margin, and configured risk limits."
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Funds data unavailable" />}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard label="Total capital" value={money(portfolio.totalCapital)} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard label="Used capital" value={money(portfolio.usedCapital)} tone="secondary" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard label="Available capital" value={money(portfolio.availableCapital)} tone="success" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard label="Margin used" value={percent(marginPercent)} tone="warning" />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label="Risk per trade"
            value={percent(settings.riskPerTradePercent)}
            detail="Configured position risk"
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label="Daily loss limit"
            value={money(settings.maxDailyLoss ?? risk.maxDailyLoss)}
            tone="error"
            detail={`${money(risk.currentDailyLoss)} used today`}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label="Max trades per day"
            value={settings.maxTradesPerDay ?? 0}
            tone="primary"
          />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Capital policy" subtitle="Paper account safeguards">
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatCard label="Loss utilization" value={percent(risk.riskUtilizationPercent)} tone="warning" />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatCard label="Open positions" value={risk.openPositions ?? portfolio.openPositions ?? 0} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatCard label="Execution mode" value="PAPER" tone="success" />
              </Grid>
            </Grid>
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
