import { Grid } from "@mui/material";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import ErrorAlert from "./ErrorAlert";
import OfflineNotice from "./OfflineNotice";
import SectionCard from "./SectionCard";
import StatCard from "./StatCard";
import { money, pnlTone } from "../utils/format";

const fallbackPortfolio = {
  totalCapital: 100000,
  usedCapital: 0,
  availableCapital: 100000,
  totalPnL: 0,
  openPositions: 0,
};

export default function LivePortfolioPanel({ compact = false }) {
  const { data, loading, error, reload } = useApi(async () => {
    const [portfolio, positions] = await Promise.all([
      getDataSafe("/api/portfolio/summary", fallbackPortfolio),
      getDataSafe("/api/positions/open", []),
    ]);
    const openPositions = Array.isArray(positions.data)
      ? positions.data.length
      : portfolio.data?.openPositions ?? 0;

    return {
      portfolio: {
        ...fallbackPortfolio,
        ...(portfolio.data || {}),
        openPositions,
      },
      unavailable: portfolio.unavailable || positions.unavailable,
      partialError: visibleError(portfolio, positions),
    };
  }, []);
  const portfolio = data?.portfolio || fallbackPortfolio;

  return (
    <SectionCard
      title="Live portfolio"
      subtitle={loading ? "Refreshing capital state" : "Paper portfolio snapshot"}
    >
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && (
        <OfflineNotice
          title="Live position prices unavailable"
          details={["Paper trading mode active", "Using portfolio fallback values"]}
        />
      )}
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, sm: compact ? 6 : 4 }}>
          <StatCard label="Total capital" value={money(portfolio.totalCapital)} />
        </Grid>
        <Grid size={{ xs: 12, sm: compact ? 6 : 4 }}>
          <StatCard
            label="Used capital"
            value={money(portfolio.usedCapital)}
            tone="secondary"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: compact ? 6 : 4 }}>
          <StatCard
            label="Available"
            value={money(portfolio.availableCapital)}
            tone="success"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: compact ? 6 : 4 }}>
          <StatCard
            label="Total P&L"
            value={money(portfolio.totalPnL)}
            tone={pnlTone(portfolio.totalPnL)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: compact ? 6 : 4 }}>
          <StatCard
            label="Open positions"
            value={portfolio.openPositions}
            tone="warning"
          />
        </Grid>
      </Grid>
    </SectionCard>
  );
}
