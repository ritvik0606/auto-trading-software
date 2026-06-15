import { Chip, Grid, Stack, Typography } from "@mui/material";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import SectionCard from "../components/SectionCard";
import { dateTime, money, number, percent, pnlTone } from "../utils/format";

const axisStyle = { fill: "#70859e", fontSize: 11 };
const tooltipStyle = {
  background: "#101d2e",
  border: "1px solid #26364c",
  borderRadius: 10,
};

function metricColumns(label) {
  return [
    { key: "name", label },
    {
      key: "totalTrades",
      label: "Trades",
      align: "right",
    },
    {
      key: "winRate",
      label: "Win Rate",
      align: "right",
      render: (row) => percent(row.winRate),
    },
    {
      key: "profitFactor",
      label: "Profit Factor",
      align: "right",
      render: (row) =>
        row.profitFactor == null ? "N/A" : number(row.profitFactor),
    },
    {
      key: "totalPnL",
      label: "P&L",
      align: "right",
      render: (row) => (
        <Typography color={`${pnlTone(row.totalPnL)}.main`}>
          {money(row.totalPnL)}
        </Typography>
      ),
    },
  ];
}

function TradeHighlight({ label, trade, tone }) {
  return (
    <SectionCard title={label}>
      {trade ? (
        <Stack spacing={1.25}>
          <Stack direction="row" justifyContent="space-between" gap={2}>
            <Typography variant="h6">{trade.symbol}</Typography>
            <Chip
              size="small"
              color={tone}
              label={money(trade.pnl)}
              variant="outlined"
            />
          </Stack>
          <Typography color="text.secondary">
            {trade.side} {trade.quantity} @ {money(trade.entryPrice)}
          </Typography>
          <Typography color="text.secondary">
            {trade.strategyName} | {dateTime(trade.closedAt)}
          </Typography>
        </Stack>
      ) : (
        <Typography color="text.secondary">No closed trades available</Typography>
      )}
    </SectionCard>
  );
}

export default function PortfolioAnalyticsPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [summary, performance, drawdown, equity] = await Promise.all([
      getDataSafe("/api/portfolio-analytics/summary", {}),
      getDataSafe("/api/portfolio-analytics/performance", {
        brokerWise: [],
        strategyWise: [],
        symbolWise: [],
      }),
      getDataSafe("/api/portfolio-analytics/drawdown", { data: [] }),
      getDataSafe("/api/portfolio-analytics/equity-curve", { data: [] }),
    ]);

    return {
      summary: summary.data || {},
      performance: performance.data || {},
      drawdown: drawdown.data || {},
      equity: equity.data || {},
      unavailable:
        summary.unavailable ||
        performance.unavailable ||
        drawdown.unavailable ||
        equity.unavailable,
      partialError: visibleError(summary, performance, drawdown, equity),
    };
  }, []);

  if (loading) return <Loading label="Calculating portfolio analytics" />;

  const summary = data?.summary || {};
  const performance = data?.performance || {};
  const equity = Array.isArray(data?.equity?.data) ? data.equity.data : [];
  const drawdown = Array.isArray(data?.drawdown?.data)
    ? data.drawdown.data
    : [];
  const brokerWise = Array.isArray(performance.brokerWise)
    ? performance.brokerWise
    : [];
  const strategyWise = Array.isArray(performance.strategyWise)
    ? performance.strategyWise
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Phase 13"
        title="Advanced Portfolio Analytics"
        description="Paper-trade profitability, attribution, equity growth, and risk-adjusted performance."
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && (
        <OfflineNotice title="Portfolio analytics unavailable" />
      )}

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Total P&L"
            value={money(summary.totalPnL)}
            tone={pnlTone(summary.totalPnL)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Daily P&L"
            value={money(summary.dailyPnL)}
            tone={pnlTone(summary.dailyPnL)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Weekly P&L"
            value={money(summary.weeklyPnL)}
            tone={pnlTone(summary.weeklyPnL)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Monthly P&L"
            value={money(summary.monthlyPnL)}
            tone={pnlTone(summary.monthlyPnL)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Win Rate"
            value={percent(summary.winRate)}
            tone="success"
            detail={`${summary.winningTrades || 0} wins / ${
              summary.totalTrades || 0
            } trades`}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Profit Factor"
            value={
              summary.profitFactor == null
                ? "N/A"
                : number(summary.profitFactor)
            }
            tone="secondary"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Sharpe Ratio"
            value={
              summary.sharpeRatio == null ? "N/A" : number(summary.sharpeRatio)
            }
            detail="Annualized from daily paper P&L"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Max Drawdown"
            value={money(summary.maxDrawdown)}
            tone="error"
            detail={percent(summary.maxDrawdownPercent)}
          />
        </Grid>

        <Grid size={{ xs: 12, xl: 7 }}>
          <SectionCard
            title="Equity Curve"
            subtitle="Cumulative closed paper-trade P&L"
          >
            <ResponsiveContainer width="100%" height={330}>
              <AreaChart data={equity}>
                <defs>
                  <linearGradient id="portfolioEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4de8c2" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#4de8c2" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  tick={axisStyle}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                    })
                  }
                />
                <YAxis tick={axisStyle} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="#4de8c2"
                  fill="url(#portfolioEquity)"
                  strokeWidth={2.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, xl: 5 }}>
          <SectionCard
            title="Drawdown"
            subtitle="Capital below the previous equity peak"
          >
            <ResponsiveContainer width="100%" height={330}>
              <LineChart data={drawdown}>
                <CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  tick={axisStyle}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                    })
                  }
                />
                <YAxis tick={axisStyle} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="drawdown"
                  stroke="#ff6577"
                  strokeWidth={2.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard
            title="Broker Comparison"
            subtitle="Closed trades are attributed to the paper execution engine"
          >
            <DataTable
              columns={metricColumns("Broker")}
              rows={brokerWise}
              getRowId={(row) => row.name}
              emptyMessage="No broker performance available"
            />
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard title="Strategy Performance">
            <DataTable
              columns={metricColumns("Strategy")}
              rows={strategyWise}
              getRowId={(row) => row.name}
              emptyMessage="No strategy performance available"
            />
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <TradeHighlight
            label="Best Trade"
            trade={summary.bestTrade}
            tone="success"
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TradeHighlight
            label="Worst Trade"
            trade={summary.worstTrade}
            tone="error"
          />
        </Grid>
      </Grid>
    </>
  );
}
