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
import useApi from "../hooks/useApi";
import { getDataSafe, postData } from "../services/api";
import DataTable from "../components/DataTable";
import ErrorAlert from "../components/ErrorAlert";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import { dateTime, money, percent } from "../utils/format";

const initialForm = {
  index: "NIFTY",
  hedgeThreshold: 10000,
  targetCoveragePercent: 75,
  optionPremium: "",
  spotPrice: "",
};

export default function PortfolioHedgingPage() {
  const [form, setForm] = useState(initialForm);
  const [analysis, setAnalysis] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data: statusResult, loading, error, reload } = useApi(
    () => getDataSafe("/api/hedging/status", {}),
    []
  );
  const status = statusResult?.data || {};
  const suggestion = analysis?.suggestion || {};
  const symbols = Array.isArray(analysis?.symbolWiseExposure)
    ? analysis.symbolWiseExposure
    : [];
  const sectors = Array.isArray(analysis?.sectorWiseExposure)
    ? analysis.sectorWiseExposure
    : [];
  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));
  const requestBody = () => ({
    index: form.index,
    hedgeThreshold: Number(form.hedgeThreshold),
    targetCoveragePercent: Number(form.targetCoveragePercent),
    ...(form.optionPremium
      ? { optionPremium: Number(form.optionPremium) }
      : {}),
    ...(form.spotPrice ? { spotPrice: Number(form.spotPrice) } : {}),
  });

  const run = async (path, successMessage) => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await postData(path, requestBody());
      setAnalysis(result || {});
      setFeedback({ severity: "success", message: successMessage });
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

  if (loading) return <Loading label="Loading portfolio hedging" />;
  const symbolColumns = [
    { key: "symbol", label: "Symbol" },
    { key: "exchange", label: "Exchange" },
    { key: "longExposure", label: "Long", align: "right", render: (row) => money(row.longExposure) },
    { key: "shortExposure", label: "Short", align: "right", render: (row) => money(row.shortExposure) },
    { key: "netExposure", label: "Net", align: "right", render: (row) => money(row.netExposure) },
  ];
  const sectorColumns = [
    { key: "sector", label: "Sector" },
    { key: "grossExposure", label: "Gross", align: "right", render: (row) => money(row.grossExposure) },
    { key: "netExposure", label: "Net", align: "right", render: (row) => money(row.netExposure) },
    { key: "classification", label: "Classification" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Capital protection"
        title="Portfolio hedging"
        description="Measure directional exposure and model NIFTY or BANKNIFTY option protection in paper mode."
        action={<Chip label="PAPER HEDGES ONLY" color="primary" variant="outlined" />}
      />
      <ErrorAlert message={error} onRetry={reload} />
      {feedback && <Alert severity={feedback.severity} sx={{ mb: 3 }}>{feedback.message}</Alert>}
      {(analysis.sampleDataUsed || status.sampleDataUsed) && (
        <Alert severity="info" sx={{ mb: 3 }}>
          No live paper portfolio was available. Clearly labelled sample portfolio data is being used.
        </Alert>
      )}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Hedge analysis" subtitle="Live paper positions are preferred automatically">
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}><TextField select fullWidth label="Hedge index" value={form.index} onChange={update("index")}><MenuItem value="NIFTY">NIFTY</MenuItem><MenuItem value="BANKNIFTY">BANKNIFTY</MenuItem></TextField></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}><TextField fullWidth type="number" label="Exposure threshold" value={form.hedgeThreshold} onChange={update("hedgeThreshold")} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}><TextField fullWidth type="number" label="Coverage %" value={form.targetCoveragePercent} onChange={update("targetCoveragePercent")} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}><TextField fullWidth type="number" label="Spot override" value={form.spotPrice} onChange={update("spotPrice")} helperText="Optional" /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}><TextField fullWidth type="number" label="Premium override" value={form.optionPremium} onChange={update("optionPremium")} helperText="Optional" /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <Stack spacing={1}>
                  <Button variant="contained" disabled={busy} onClick={() => run("/api/hedging/analyze", "Portfolio exposure analyzed.")}>Analyze</Button>
                  <Button variant="outlined" disabled={busy} onClick={() => run("/api/hedging/suggest", "Paper hedge suggestion generated.")}>Suggest Hedge</Button>
                </Stack>
              </Grid>
            </Grid>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Hedge status" value={status.status || "UNKNOWN"} tone={status.status === "HEDGED" ? "success" : "warning"} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Gross exposure" value={money(analysis.grossExposure ?? status.grossExposure)} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Net exposure" value={money(analysis.netExposure ?? status.netExposure)} tone={Number(analysis.netExposure ?? status.netExposure) >= 0 ? "success" : "error"} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Hedge required" value={(analysis.hedgeRequired ?? status.hedgeRequired) ? "YES" : "NO"} tone={(analysis.hedgeRequired ?? status.hedgeRequired) ? "warning" : "success"} /></Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="Option hedge suggestion" subtitle={suggestion.note || "Generate a suggestion to view estimated protection"}>
            <Stack spacing={1.5}>
              <Typography color="text.secondary">Instrument <strong>{suggestion.instrument || "--"}</strong></Typography>
              <Typography color="text.secondary">Suggested quantity <strong>{suggestion.suggestedHedgeQuantity ?? 0}</strong></Typography>
              <Typography color="text.secondary">Estimated premium <strong>{suggestion.estimatedOptionPremium ? money(suggestion.estimatedOptionPremium) : "--"}</strong></Typography>
              <Typography color="text.secondary">Estimated hedge cost <strong>{suggestion.hedgeCostEstimate ? money(suggestion.hedgeCostEstimate) : "--"}</strong></Typography>
              <Typography color="text.secondary">Risk reduction <strong>{percent(suggestion.riskReductionPercentage)}</strong></Typography>
              <Button color="warning" variant="contained" disabled={busy || !suggestion.executable} onClick={() => run("/api/hedging/apply-paper-hedge", "Paper option hedge applied.")}>
                Apply Paper Hedge
              </Button>
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Active paper hedge">
            {status.activePaperHedge ? (
              <Stack spacing={1.2}>
                <Typography>Trade #{status.activePaperHedge.trade?.id}</Typography>
                <Typography color="text.secondary">{status.activePaperHedge.suggestion?.instrument} · {status.activePaperHedge.trade?.quantity} units</Typography>
                <Typography color="text.secondary">Applied {dateTime(status.activePaperHedge.appliedAt)}</Typography>
              </Stack>
            ) : (
              <Typography color="text.secondary" py={5} textAlign="center">No paper hedge has been applied in this server session</Typography>
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}><SectionCard title="Symbol-wise exposure"><DataTable columns={symbolColumns} rows={symbols} emptyMessage="Run portfolio analysis to view symbol exposure" /></SectionCard></Grid>
        <Grid size={{ xs: 12 }}><SectionCard title="Sector-wise exposure" subtitle="Unclassified positions remain explicit placeholders"><DataTable columns={sectorColumns} rows={sectors} emptyMessage="Run portfolio analysis to view sector exposure" /></SectionCard></Grid>
      </Grid>
    </>
  );
}
