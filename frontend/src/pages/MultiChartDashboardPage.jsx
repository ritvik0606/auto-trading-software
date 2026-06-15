import { Chip, Grid } from "@mui/material";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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
import SectionCard from "../components/SectionCard";
import LiveMarketStrip from "../components/LiveMarketStrip";
import useMarketStream from "../hooks/useMarketStream";

const axis = { fill: "#70859e", fontSize: 10 };
const chartProps = {
  margin: { top: 10, right: 10, left: -15, bottom: 0 },
};

export default function MultiChartDashboardPage() {
  const stream = useMarketStream(["NIFTY", "BANKNIFTY", "RELIANCE"]);
  const [intraday, setIntraday] = useState({
    NIFTY: [],
    BANKNIFTY: [],
    RELIANCE: [],
  });
  const { data, loading, error, reload } = useApi(async () => {
    const [daily, weekly, monthly, equity, drawdown] = await Promise.all([
      getDataSafe("/api/performance/daily", []),
      getDataSafe("/api/performance/weekly", []),
      getDataSafe("/api/performance/monthly", []),
      getDataSafe("/api/performance/equity-curve", { data: [] }),
      getDataSafe("/api/performance/drawdown", { data: [] }),
    ]);
    return {
      daily: daily.data,
      weekly: weekly.data,
      monthly: monthly.data,
      equity: equity.data?.data || [],
      drawdown: drawdown.data?.data || [],
      unavailable: [daily, weekly, monthly, equity, drawdown].some((item) => item.unavailable),
      partialError: visibleError(daily, weekly, monthly, equity, drawdown),
    };
  }, []);
  useEffect(() => {
    setIntraday((current) => {
      let changed = false;
      const next = { ...current };
      for (const symbol of Object.keys(current)) {
        const quote = stream.getQuote(symbol);
        if (!quote?.receivedAt) continue;
        const last = current[symbol][current[symbol].length - 1];
        if (last?.timestamp === quote.receivedAt) continue;
        next[symbol] = [
          ...current[symbol],
          { timestamp: quote.receivedAt, ltp: quote.ltp },
        ].slice(-120);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [stream.quotes]);
  if (loading) return <Loading label="Loading chart workspace" />;
  const tooltip = { background: "#101d2e", border: "1px solid #26364c", borderRadius: 10 };

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Multi chart dashboard" description="Daily, weekly, monthly, equity, and drawdown views in one terminal." />
      <LiveMarketStrip />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Some chart data is unavailable" />}
      <Grid container spacing={2.5}>
        {Object.entries(intraday).map(([symbol, points]) => (
          <Grid key={symbol} size={{ xs: 12, lg: 4 }}>
            <SectionCard
              title={symbol}
              subtitle="Live Angel One LTP"
              action={<Chip size="small" label={stream.connected ? "LIVE" : "WAITING"} color={stream.connected ? "success" : "warning"} />}
            >
              <ResponsiveContainer width="100%" height={210}>
                <LineChart data={points} {...chartProps}>
                  <CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} />
                  <XAxis dataKey="timestamp" hide />
                  <YAxis tick={axis} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={tooltip} />
                  <Line dataKey="ltp" stroke="#4de8c2" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </SectionCard>
          </Grid>
        ))}
        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard title="Daily P&L">
            <ResponsiveContainer width="100%" height={280}><BarChart data={data?.daily || []} {...chartProps}><CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} /><XAxis dataKey="date" tick={axis} /><YAxis tick={axis} /><Tooltip contentStyle={tooltip} /><Bar dataKey="pnl" fill="#4de8c2" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard title="Weekly P&L">
            <ResponsiveContainer width="100%" height={280}><LineChart data={data?.weekly || []} {...chartProps}><CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} /><XAxis dataKey="weekStarting" tick={axis} /><YAxis tick={axis} /><Tooltip contentStyle={tooltip} /><Line dataKey="pnl" stroke="#8b7cff" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard title="Equity curve">
            <ResponsiveContainer width="100%" height={280}><AreaChart data={data?.equity || []} {...chartProps}><CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} /><XAxis dataKey="timestamp" tick={axis} /><YAxis tick={axis} /><Tooltip contentStyle={tooltip} /><Area dataKey="equity" stroke="#35d38a" fill="#35d38a22" strokeWidth={2.5} /></AreaChart></ResponsiveContainer>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, xl: 6 }}>
          <SectionCard title="Drawdown">
            <ResponsiveContainer width="100%" height={280}><AreaChart data={data?.drawdown || []} {...chartProps}><CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} /><XAxis dataKey="timestamp" tick={axis} /><YAxis tick={axis} /><Tooltip contentStyle={tooltip} /><Area dataKey="drawdown" stroke="#ff6577" fill="#ff657722" strokeWidth={2.5} /></AreaChart></ResponsiveContainer>
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
