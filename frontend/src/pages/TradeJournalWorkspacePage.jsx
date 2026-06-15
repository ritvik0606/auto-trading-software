import { useState } from "react";
import { Alert, Button, Chip, Grid, TextField, Typography } from "@mui/material";
import { getDataSafe, postData, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import SectionCard from "../components/SectionCard";
import { money, pnlTone } from "../utils/format";
import LiveMarketStrip from "../components/LiveMarketStrip";

export default function TradeJournalWorkspacePage() {
  const [journalId, setJournalId] = useState("");
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState(null);
  const { data, loading, error, reload } = useApi(async () => {
    const [entries, stats] = await Promise.all([
      getDataSafe("/api/journal/all", []),
      getDataSafe("/api/journal/stats", {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnL: 0,
      }),
    ]);
    return {
      entries: entries.data,
      stats: stats.data,
      unavailable: entries.unavailable || stats.unavailable,
      partialError: visibleError(entries, stats),
    };
  }, []);

  const saveNote = async () => {
    setFeedback(null);
    try {
      await postData(`/api/journal/note/${journalId}`, { notes });
      setFeedback({ severity: "success", message: "Journal note updated." });
      setJournalId("");
      setNotes("");
      await reload();
    } catch (saveError) {
      setFeedback({
        severity: saveError.isUnavailable ? "warning" : "error",
        message: saveError.isUnavailable ? "Journal service unavailable. Note was not saved." : saveError.message,
      });
    }
  };

  if (loading) return <Loading label="Loading trade journal" />;
  const entries = data?.entries || [];
  const stats = data?.stats || {};
  const columns = [
    { key: "tradeId", label: "Trade" },
    { key: "symbol", label: "Symbol" },
    { key: "side", label: "Side" },
    { key: "entryPrice", label: "Entry", align: "right", render: (row) => money(row.entryPrice) },
    { key: "exitPrice", label: "Exit", align: "right", render: (row) => money(row.exitPrice) },
    { key: "quantity", label: "Qty", align: "right" },
    {
      key: "pnl",
      label: "P&L",
      align: "right",
      render: (row) => <Typography color={`${pnlTone(row.pnl)}.main`} fontWeight={700}>{money(row.pnl)}</Typography>,
    },
    { key: "result", label: "Result", render: (row) => <Chip size="small" label={row.result} color={row.result === "WIN" ? "success" : row.result === "LOSS" ? "error" : "default"} /> },
    { key: "notes", label: "Notes", render: (row) => row.notes || "No notes" },
  ];

  return (
    <>
      <PageHeader eyebrow="Review" title="Trade journal" description="Review closed paper trades, performance outcomes, and execution notes." />
      <LiveMarketStrip />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Journal data unavailable" />}
      {feedback && <Alert severity={feedback.severity} sx={{ mb: 3 }}>{feedback.message}</Alert>}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Total trades" value={stats.totalTrades ?? 0} /></Grid>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Win rate" value={`${stats.winRate ?? 0}%`} tone="success" /></Grid>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Winning trades" value={stats.winningTrades ?? 0} tone="success" /></Grid>
        <Grid size={{ xs: 12, sm: 3 }}><StatCard label="Total P&L" value={money(stats.totalPnL)} tone={pnlTone(stats.totalPnL)} /></Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Add trading note" subtitle="Attach a note to a journal entry">
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, md: 2 }}><TextField label="Journal ID" type="number" fullWidth value={journalId} onChange={(event) => setJournalId(event.target.value)} /></Grid>
              <Grid size={{ xs: 12, md: 8 }}><TextField label="Notes" fullWidth value={notes} onChange={(event) => setNotes(event.target.value)} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><Button variant="contained" fullWidth sx={{ height: "100%" }} disabled={!journalId || !notes.trim()} onClick={saveNote}>Save note</Button></Grid>
            </Grid>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}><DataTable columns={columns} rows={entries} /></Grid>
      </Grid>
    </>
  );
}
