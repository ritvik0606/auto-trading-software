import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Grid,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import useApi from "../hooks/useApi";
import { getDataSafe, postData, visibleError } from "../services/api";
import DataTable from "../components/DataTable";
import ErrorAlert from "../components/ErrorAlert";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import { dateTime, money } from "../utils/format";

const masterInitial = { accountName: "Primary Paper Account", status: "ACTIVE" };
const followerInitial = {
  followerName: "",
  quantityMode: "PERCENTAGE",
  fixedQuantity: 1,
  quantityPercentage: 100,
  capitalScale: 1,
  maxRetries: 2,
};
const tradeInitial = {
  masterTradeReference: "",
  symbol: "RELIANCE",
  exchange: "NSE",
  side: "BUY",
  quantity: 1,
  price: 100,
};

export default function TradeCopierPage() {
  const [master, setMaster] = useState(masterInitial);
  const [follower, setFollower] = useState(followerInitial);
  const [trade, setTrade] = useState(tradeInitial);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useApi(async () => {
    const [status, logs] = await Promise.all([
      getDataSafe("/api/trade-copier/status", {}),
      getDataSafe("/api/trade-copier/logs", []),
    ]);
    return {
      status: status.data || {},
      logs: Array.isArray(logs.data) ? logs.data : [],
      partialError: visibleError(status, logs),
    };
  }, []);
  const update = (setter, field) => (event) =>
    setter((current) => ({ ...current, [field]: event.target.value }));

  const runAction = async (path, body, message) => {
    setBusy(true);
    setFeedback(null);
    try {
      await postData(path, body);
      setFeedback({ severity: "success", message });
      await reload();
    } catch (requestError) {
      setFeedback({
        severity: requestError.isUnavailable ? "warning" : "error",
        message: requestError.message,
      });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading trade copier" />;
  const status = data?.status || {};
  const followers = Array.isArray(status.followers) ? status.followers : [];
  const logs = Array.isArray(data?.logs) ? data.logs : [];
  const followerColumns = [
    { key: "followerName", label: "Follower" },
    { key: "quantityMode", label: "Mode" },
    { key: "fixedQuantity", label: "Fixed qty", align: "right" },
    { key: "quantityPercentage", label: "Percentage", align: "right", render: (row) => row.quantityPercentage == null ? "--" : `${row.quantityPercentage}%` },
    { key: "capitalScale", label: "Capital scale", align: "right" },
    { key: "maxRetries", label: "Retries", align: "right" },
    { key: "status", label: "Status" },
  ];
  const logColumns = [
    { key: "createdAt", label: "Time", render: (row) => dateTime(row.createdAt) },
    { key: "masterTradeReference", label: "Master reference" },
    { key: "followerName", label: "Follower" },
    { key: "symbol", label: "Symbol" },
    { key: "side", label: "Side" },
    { key: "copiedQuantity", label: "Qty", align: "right" },
    { key: "price", label: "Price", align: "right", render: (row) => money(row.price) },
    { key: "executionStatus", label: "Execution", render: (row) => <Chip size="small" label={row.executionStatus || "UNKNOWN"} color={row.executionStatus === "SUCCESS" ? "success" : row.executionStatus === "FAILED" ? "error" : "default"} /> },
    { key: "attempts", label: "Attempts", align: "right" },
    { key: "errorMessage", label: "Error" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Automation"
        title="Trade copier"
        description="Copy master BUY and SELL decisions into independently scaled follower paper accounts."
        action={<Chip label="PAPER COPIES ONLY" color="primary" variant="outlined" />}
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {feedback && <Alert severity={feedback.severity} sx={{ mb: 3 }}>{feedback.message}</Alert>}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Copier status" value={status.status || "SETUP_REQUIRED"} tone={status.status === "READY" ? "success" : "warning"} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Active followers" value={status.activeFollowers ?? 0} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Successful copies" value={status.executionSummary?.successful ?? 0} tone="success" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Failed copies" value={status.executionSummary?.failed ?? 0} tone="error" /></Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <SectionCard title="Master account">
            <Stack spacing={2}>
              <TextField label="Account name" value={master.accountName} onChange={update(setMaster, "accountName")} />
              <TextField select label="Status" value={master.status} onChange={update(setMaster, "status")}><MenuItem value="ACTIVE">ACTIVE</MenuItem><MenuItem value="PAUSED">PAUSED</MenuItem></TextField>
              <Button variant="contained" disabled={busy || !master.accountName.trim()} onClick={() => runAction("/api/trade-copier/master", master, "Master account configured.")}>Save Master</Button>
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 8 }}>
          <SectionCard title="Add follower" subtitle="Fixed quantity or percentage of master quantity">
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 4 }}><TextField fullWidth label="Follower name" value={follower.followerName} onChange={update(setFollower, "followerName")} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField select fullWidth label="Mode" value={follower.quantityMode} onChange={update(setFollower, "quantityMode")}><MenuItem value="FIXED">FIXED</MenuItem><MenuItem value="PERCENTAGE">PERCENTAGE</MenuItem></TextField></Grid>
              <Grid size={{ xs: 6, md: 2 }}><TextField fullWidth type="number" label={follower.quantityMode === "FIXED" ? "Fixed qty" : "Quantity %"} value={follower.quantityMode === "FIXED" ? follower.fixedQuantity : follower.quantityPercentage} onChange={update(setFollower, follower.quantityMode === "FIXED" ? "fixedQuantity" : "quantityPercentage")} /></Grid>
              <Grid size={{ xs: 6, md: 2 }}><TextField fullWidth type="number" label="Capital scale" value={follower.capitalScale} onChange={update(setFollower, "capitalScale")} /></Grid>
              <Grid size={{ xs: 6, md: 2 }}><TextField fullWidth type="number" label="Retries" value={follower.maxRetries} onChange={update(setFollower, "maxRetries")} /></Grid>
              <Grid size={{ xs: 12 }}><Button variant="outlined" disabled={busy || !follower.followerName.trim()} onClick={() => runAction("/api/trade-copier/follower", { ...follower, fixedQuantity: Number(follower.fixedQuantity), quantityPercentage: Number(follower.quantityPercentage), capitalScale: Number(follower.capitalScale), maxRetries: Number(follower.maxRetries) }, "Follower account added.")}>Add Follower</Button></Grid>
            </Grid>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Copy master trade" subtitle="Each master reference is copied only once per follower">
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 3 }}><TextField fullWidth label="Master trade reference" value={trade.masterTradeReference} onChange={update(setTrade, "masterTradeReference")} placeholder="MASTER-001" /></Grid>
              <Grid size={{ xs: 6, md: 2 }}><TextField fullWidth label="Symbol" value={trade.symbol} onChange={update(setTrade, "symbol")} /></Grid>
              <Grid size={{ xs: 6, md: 1 }}><TextField select fullWidth label="Side" value={trade.side} onChange={update(setTrade, "side")}><MenuItem value="BUY">BUY</MenuItem><MenuItem value="SELL">SELL</MenuItem></TextField></Grid>
              <Grid size={{ xs: 6, md: 2 }}><TextField fullWidth type="number" label="Master qty" value={trade.quantity} onChange={update(setTrade, "quantity")} /></Grid>
              <Grid size={{ xs: 6, md: 2 }}><TextField fullWidth type="number" label="Price" value={trade.price} onChange={update(setTrade, "price")} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><Button fullWidth variant="contained" sx={{ height: "100%" }} disabled={busy || !trade.masterTradeReference.trim()} onClick={() => runAction("/api/trade-copier/copy-trade", { ...trade, quantity: Number(trade.quantity), price: Number(trade.price) }, "Master trade copy completed.")}>Copy Trade</Button></Grid>
            </Grid>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}><SectionCard title="Follower accounts"><DataTable columns={followerColumns} rows={followers} emptyMessage="No follower accounts configured" /></SectionCard></Grid>
        <Grid size={{ xs: 12 }}><SectionCard title="Execution logs"><DataTable columns={logColumns} rows={logs} emptyMessage="No copied trades recorded" /></SectionCard></Grid>
      </Grid>
    </>
  );
}
