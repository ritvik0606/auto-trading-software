import { useState } from "react";
import { Button, Chip, Grid, MenuItem, TextField, Typography } from "@mui/material";
import { getDataSafe } from "../services/api";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import { dateTime, money, number, percent } from "../utils/format";

const groups = [
  ["nifty50", "Nifty 50"],
  ["banknifty", "Bank Nifty"],
  ["fno", "F&O Stocks"],
  ["custom", "Custom Watchlist"],
];

export default function AdvancedScannerPage() {
  const [group, setGroup] = useState("nifty50");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);

  const scan = async () => {
    setLoading(true);
    setError("");
    const response = await getDataSafe(`/api/scanner/${group}`, {
      group: groups.find(([key]) => key === group)?.[1],
      count: 0,
      items: [],
    });
    setResult(response.data);
    setOffline(response.unavailable || Boolean(response.error));
    if (response.error && !response.error.isUnavailable) {
      setError(response.error.message);
    }
    setLoading(false);
  };
  const items = result?.items || [];
  const available = items.filter((item) => !item.error);
  const buySignals = items.filter((item) => item.signal === "BUY" || item.buySignal).length;
  const columns = [
    { key: "symbol", label: "Symbol" },
    {
      key: "ltp",
      label: "LTP",
      align: "right",
      render: (row) => (row.ltp == null ? "Unavailable" : money(row.ltp)),
    },
    {
      key: "changePercent",
      label: "Change",
      align: "right",
      render: (row) => (
        row.changePercent == null
          ? "--"
          : `${row.change == null ? "" : `${money(row.change)} `}(${percent(row.changePercent)})`
      ),
    },
    {
      key: "volume",
      label: "Volume",
      align: "right",
      render: (row) => row.volume == null ? "--" : number(row.volume, 0),
    },
    {
      key: "trend",
      label: "Trend",
      render: (row) => (
        <Chip
          size="small"
          label={row.trend}
          color={
            row.trend === "UPTREND"
              ? "success"
              : row.trend === "DOWNTREND"
                ? "error"
                : "default"
          }
          variant="outlined"
        />
      ),
    },
    {
      key: "signal",
      label: "Signal",
      render: (row) => (
        <Typography
          fontWeight={800}
          color={
            row.signal === "BUY" || row.buySignal
              ? "success.main"
              : row.signal === "SELL" || row.sellSignal
                ? "error.main"
                : "text.secondary"
          }
        >
          {row.signal || (row.buySignal ? "BUY" : row.sellSignal ? "SELL" : "HOLD")}
        </Typography>
      ),
    },
    { key: "rsi", label: "RSI", align: "right", render: (row) => number(row.rsi) },
    { key: "ema20", label: "EMA 20", align: "right", render: (row) => number(row.ema20) },
    { key: "ema50", label: "EMA 50", align: "right", render: (row) => number(row.ema50) },
    { key: "updatedAt", label: "Updated", render: (row) => dateTime(row.updatedAt) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Discovery"
        title="Advanced scanner"
        description="Scan index, F&O, and custom universes for trend and EMA_RSI signals."
      />
      <ErrorAlert message={error} onRetry={scan} />
      {offline && <OfflineNotice title="Scanner market data unavailable" />}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12 }}>
          <Grid container spacing={1.5} alignItems="center">
            <Grid size={{ xs: 12, sm: 5, md: 3 }}>
              <TextField select label="Scanner universe" value={group} onChange={(event) => setGroup(event.target.value)} fullWidth>
                {groups.map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <Button variant="contained" size="large" fullWidth onClick={scan} disabled={loading}>
                {loading ? "Scanning..." : "Run scan"}
              </Button>
            </Grid>
          </Grid>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Symbols scanned" value={result?.count ?? 0} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Buy signals" value={buySignals} tone="success" /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Available data" value={available.length} tone="secondary" /></Grid>
        <Grid size={{ xs: 12 }}>
          <DataTable columns={columns} rows={items} getRowId={(row) => row.symbol} emptyMessage="Run a scan to populate the terminal" />
        </Grid>
      </Grid>
    </>
  );
}
