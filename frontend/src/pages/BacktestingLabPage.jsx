import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import useApi from "../hooks/useApi";
import { getData, getDataSafe, postData } from "../services/api";
import DataTable from "../components/DataTable";
import ErrorAlert from "../components/ErrorAlert";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import { dateTime, money, number, percent, pnlTone } from "../utils/format";

const initialForm = {
  strategyName: "EMA_RSI",
  symbol: "RELIANCE",
  timeframe: "5m",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
};

export default function BacktestingLabPage() {
  const [form, setForm] = useState(initialForm);
  const [report, setReport] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data: historyResult, loading, error, reload } = useApi(
    () => getDataSafe("/api/backtest/history", []),
    []
  );
  const history = Array.isArray(historyResult?.data) ? historyResult.data : [];
  const trades = Array.isArray(report?.trades) ? report.trades : [];
  const equity = Array.isArray(report?.equity) ? report.equity : [];
  const summary = report?.summary || {};
  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const loadReport = async (id) => {
    setBusy(true);
    setFeedback(null);
    try {
      const [summaryData, tradeData, equityData, drawdownData] = await Promise.all([
        getData(`/api/backtest/summary/${id}`),
        getData(`/api/backtest/trades/${id}`),
        getData(`/api/backtest/equity/${id}`),
        getData(`/api/backtest/drawdown/${id}`),
      ]);
      setReport({
        summary: summaryData || {},
        trades: Array.isArray(tradeData) ? tradeData : [],
        equity: Array.isArray(equityData) ? equityData : [],
        drawdown: drawdownData || {},
      });
    } catch (requestError) {
      setFeedback({ severity: requestError.isUnavailable ? "warning" : "error", message: requestError.message });
    } finally {
      setBusy(false);
    }
  };

  const runBacktest = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const run = await postData("/api/backtest/run", {
        ...form,
        symbol: form.symbol.trim().toUpperCase(),
      });
      setFeedback({ severity: "success", message: `Backtest #${run.id} completed from historical paper trades.` });
      await reload();
      await loadReport(run.id);
    } catch (requestError) {
      setFeedback({
        severity: requestError.isUnavailable ? "warning" : "info",
        message: requestError.message,
      });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading backtesting lab" />;
  const historyColumns = [
    { key: "id", label: "Run" },
    { key: "symbol", label: "Symbol" },
    { key: "timeframe", label: "Timeframe" },
    { key: "totalTrades", label: "Trades", align: "right" },
    { key: "winRate", label: "Win rate", align: "right", render: (row) => percent(row.winRate) },
    { key: "netProfit", label: "Net P&L", align: "right", render: (row) => <Typography color={`${pnlTone(row.netProfit)}.main`}>{money(row.netProfit)}</Typography> },
    { key: "action", label: "", render: (row) => <Button size="small" disabled={busy} onClick={() => loadReport(row.id)}>Open</Button> },
  ];
  const tradeColumns = [
    { key: "sequence", label: "#" },
    { key: "symbol", label: "Symbol" },
    { key: "side", label: "Side" },
    { key: "entryPrice", label: "Entry", align: "right", render: (row) => money(row.entryPrice) },
    { key: "exitPrice", label: "Exit", align: "right", render: (row) => money(row.exitPrice) },
    { key: "pnl", label: "P&L", align: "right", render: (row) => money(row.pnl) },
    { key: "exitTime", label: "Exit time", render: (row) => dateTime(row.exitTime) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="Backtesting lab"
        description="Replay completed paper trades across a selected date range and inspect the resulting report."
        action={<Chip label="PAPER HISTORY" color="primary" variant="outlined" />}
      />
      <ErrorAlert message={error} onRetry={reload} />
      {feedback && <Alert severity={feedback.severity} sx={{ mb: 3 }}>{feedback.message}</Alert>}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Create backtest" subtitle="EMA_RSI reports use existing completed paper trades">
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 2 }}><TextField select fullWidth label="Strategy" value={form.strategyName} onChange={update("strategyName")}><MenuItem value="EMA_RSI">EMA_RSI</MenuItem></TextField></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField fullWidth label="Symbol" value={form.symbol} onChange={update("symbol")} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField select fullWidth label="Timeframe" value={form.timeframe} onChange={update("timeframe")}>{["1m", "5m", "15m", "30m", "1h", "1d"].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField fullWidth type="date" label="Start date" value={form.startDate} onChange={update("startDate")} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField fullWidth type="date" label="End date" value={form.endDate} onChange={update("endDate")} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><Button fullWidth variant="contained" sx={{ height: "100%" }} disabled={busy || !form.symbol.trim()} onClick={runBacktest}>{busy ? "Running..." : "Run backtest"}</Button></Grid>
            </Grid>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard label="Total trades" value={summary.totalTrades ?? 0} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard label="Win rate" value={percent(summary.winRate)} tone="success" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard label="Net profit" value={money(summary.netProfit)} tone={pnlTone(summary.netProfit)} /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard label="Max drawdown" value={money(summary.maxDrawdown)} tone="error" /></Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Equity curve" subtitle={summary.id ? `Backtest #${summary.id}` : "Open a historical run"}>
            {equity.length === 0 ? (
              <Typography color="text.secondary" py={8} textAlign="center">No equity curve selected</Typography>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={equity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="sequence" stroke="#8290a5" />
                  <YAxis stroke="#8290a5" />
                  <Tooltip />
                  <Line type="monotone" dataKey="cumulativePnL" stroke="#4de8c2" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Report metrics">
            <Stack spacing={1.4}>
              <Typography color="text.secondary">Profit factor <strong>{summary.profitFactor ?? "--"}</strong></Typography>
              <Typography color="text.secondary">Sharpe ratio <strong>{summary.sharpeRatio ?? "--"}</strong></Typography>
              <Typography color="text.secondary">Winning trades <strong>{summary.winningTrades ?? 0}</strong></Typography>
              <Typography color="text.secondary">Losing trades <strong>{summary.losingTrades ?? 0}</strong></Typography>
              <Typography color="text.secondary">Drawdown report <strong>{number(report?.drawdown?.maxDrawdown)}</strong></Typography>
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}><SectionCard title="Run history"><DataTable columns={historyColumns} rows={history} emptyMessage="No backtest runs available" /></SectionCard></Grid>
        <Grid size={{ xs: 12 }}><SectionCard title="Backtest trades"><DataTable columns={tradeColumns} rows={trades} emptyMessage="Open a backtest to inspect its trades" /></SectionCard></Grid>
      </Grid>
    </>
  );
}
