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
import { getDataSafe, postData, visibleError } from "../services/api";
import DataTable from "../components/DataTable";
import ErrorAlert from "../components/ErrorAlert";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import { dateTime, number, percent } from "../utils/format";

const initialForm = { market: "NIFTY", style: "INTRADAY", risk: "MEDIUM" };

export default function AIStrategyGeneratorPage() {
  const [form, setForm] = useState(initialForm);
  const [generation, setGeneration] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useApi(async () => {
    const [best, history, recommendations] = await Promise.all([
      getDataSafe("/api/ai-strategy/best", []),
      getDataSafe("/api/ai-strategy/history", []),
      getDataSafe("/api/ai-strategy/recommendations", {}),
    ]);
    return {
      best: Array.isArray(best.data) ? best.data : [],
      history: Array.isArray(history.data) ? history.data : [],
      recommendations: recommendations.data || {},
      partialError: visibleError(best, history, recommendations),
    };
  }, []);
  const candidates = Array.isArray(generation?.candidates)
    ? generation.candidates
    : [];
  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const generate = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await postData("/api/ai-strategy/generate", form);
      setGeneration(result || {});
      setFeedback({
        severity: "success",
        message: `${result?.candidates?.length || 0} strategies evaluated from completed paper trades.`,
      });
    } catch (requestError) {
      setGeneration({});
      setFeedback({
        severity: requestError.isUnavailable ? "warning" : "info",
        message: requestError.message,
      });
    } finally {
      setBusy(false);
    }
  };

  const saveCandidate = async (candidateIndex) => {
    setBusy(true);
    setFeedback(null);
    try {
      const saved = await postData("/api/ai-strategy/save", {
        ...form,
        candidateIndex,
      });
      setFeedback({
        severity: "success",
        message: `${saved?.strategyName || "Strategy"} saved to strategy history.`,
      });
      await reload();
    } catch (requestError) {
      setFeedback({ severity: "error", message: requestError.message });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading AI strategy workspace" />;
  const history = Array.isArray(data?.history) ? data.history : [];
  const best = Array.isArray(data?.best) ? data.best : [];
  const recommendations = data?.recommendations || {};
  const columns = [
    { key: "strategyName", label: "Strategy" },
    { key: "score", label: "Score", align: "right", render: (row) => number(row.score) },
    { key: "winRate", label: "Win rate", align: "right", render: (row) => percent(row.winRate) },
    { key: "profitFactor", label: "Profit factor", align: "right", render: (row) => row.profitFactor ?? "--" },
    { key: "createdAt", label: "Saved", render: (row) => dateTime(row.createdAt) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="AI strategy generator"
        description="Generate rule-based indicator combinations and score them only against completed paper-trade history."
        action={<Chip label="ANALYSIS ONLY" color="primary" variant="outlined" />}
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {feedback && <Alert severity={feedback.severity} sx={{ mb: 3 }}>{feedback.message}</Alert>}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 4 }}>
          <SectionCard title="Generation profile" subtitle="Select the market, trading style, and risk profile">
            <Stack spacing={2}>
              <TextField select label="Market" value={form.market} onChange={update("market")}>
                {["NIFTY", "BANKNIFTY", "ALL"].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
              </TextField>
              <TextField select label="Style" value={form.style} onChange={update("style")}>
                {["INTRADAY", "SWING", "POSITIONAL"].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
              </TextField>
              <TextField select label="Risk" value={form.risk} onChange={update("risk")}>
                {["LOW", "MEDIUM", "HIGH"].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
              </TextField>
              <Button variant="contained" disabled={busy} onClick={generate}>
                {busy ? "Evaluating..." : "Generate strategies"}
              </Button>
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 8 }}>
          <SectionCard title="Generated candidates" subtitle={generation?.note || "No performance is fabricated when paper history is unavailable"}>
            {candidates.length === 0 ? (
              <Typography color="text.secondary" py={5} textAlign="center">
                Generate a strategy set to review scored candidates.
              </Typography>
            ) : (
              <Grid container spacing={2}>
                {candidates.map((candidate, index) => (
                  <Grid key={candidate.strategyName || index} size={{ xs: 12, md: 6 }}>
                    <SectionCard
                      title={candidate.strategyName || `Candidate ${index + 1}`}
                      action={<Chip label={`${number(candidate.score)} / 100`} color="success" size="small" />}
                      sx={{ height: "100%" }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        {(Array.isArray(candidate.indicators) ? candidate.indicators : []).join(" + ") || "Indicator rules unavailable"}
                      </Typography>
                      <Stack direction="row" spacing={1} mt={2} flexWrap="wrap" useFlexGap>
                        <Chip size="small" label={`Win ${percent(candidate.winRate)}`} />
                        <Chip size="small" label={`PF ${candidate.profitFactor ?? "--"}`} />
                        <Chip size="small" label={`DD ${number(candidate.maxDrawdown)}`} />
                      </Stack>
                      <Button fullWidth variant="outlined" sx={{ mt: 2 }} disabled={busy} onClick={() => saveCandidate(index)}>
                        Save candidate
                      </Button>
                    </SectionCard>
                  </Grid>
                ))}
              </Grid>
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}><StatCard label="Saved strategies" value={history.length} /></Grid>
        <Grid size={{ xs: 12, md: 4 }}><StatCard label="Best score" value={best[0]?.score ?? 0} tone="success" /></Grid>
        <Grid size={{ xs: 12, md: 4 }}><StatCard label="Evaluated profiles" value={recommendations.evaluatedStrategies ?? 0} /></Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Strategy history"><DataTable columns={columns} rows={history} emptyMessage="No generated strategies have been saved" /></SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
