import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
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

const indicatorOptions = ["EMA", "RSI", "MACD", "VWAP", "VOLUME"];
const initialForm = {
  strategyName: "",
  templateCode: "EMA_CROSSOVER",
  market: "EQUITY",
  timeframe: "15m",
  riskProfile: "MEDIUM",
  indicators: ["EMA"],
};

export default function StrategyGeneratorDashboardPage() {
  const [form, setForm] = useState(initialForm);
  const [generated, setGenerated] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useApi(async () => {
    const [templates, history] = await Promise.all([
      getDataSafe("/api/strategy-generator/templates", []),
      getDataSafe("/api/strategy-generator/history", []),
    ]);
    return {
      templates: Array.isArray(templates.data) ? templates.data : [],
      history: Array.isArray(history.data) ? history.data : [],
      partialError: visibleError(templates, history),
    };
  }, []);
  const templates = Array.isArray(data?.templates) ? data.templates : [];
  const history = Array.isArray(data?.history) ? data.history : [];
  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const selectTemplate = (templateCode) => {
    const template = templates.find((item) => item.code === templateCode);
    setForm((current) => ({
      ...current,
      templateCode,
      indicators: Array.isArray(template?.indicators)
        ? template.indicators
        : current.indicators,
    }));
  };

  const toggleIndicator = (indicator) => {
    setForm((current) => ({
      ...current,
      templateCode: "MULTI_INDICATOR",
      indicators: current.indicators.includes(indicator)
        ? current.indicators.filter((item) => item !== indicator)
        : [...current.indicators, indicator],
    }));
  };

  const generate = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await postData("/api/strategy-generator/generate", form);
      setGenerated(result || {});
      setFeedback({ severity: "success", message: "Strategy template generated." });
    } catch (requestError) {
      setFeedback({ severity: requestError.isUnavailable ? "warning" : "error", message: requestError.message });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await postData("/api/strategy-generator/save", generated);
      setGenerated(result || generated);
      setFeedback({ severity: "success", message: "Strategy template saved to history." });
      await reload();
    } catch (requestError) {
      setFeedback({ severity: requestError.isUnavailable ? "warning" : "error", message: requestError.message });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading strategy generator" />;
  const columns = [
    { key: "strategyName", label: "Strategy" },
    { key: "templateCode", label: "Template" },
    { key: "indicators", label: "Indicators", render: (row) => (Array.isArray(row.indicators) ? row.indicators.join(" + ") : "--") },
    { key: "strategyScore", label: "Score", align: "right", render: (row) => number(row.strategyScore) },
    { key: "riskScore", label: "Risk", align: "right", render: (row) => number(row.riskScore) },
    { key: "expectedWinRate", label: "Expected win rate", align: "right", render: (row) => percent(row.expectedWinRate) },
    { key: "createdAt", label: "Saved", render: (row) => dateTime(row.createdAt) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="Strategy generator"
        description="Compose indicator templates, score structural quality and risk, then save reusable strategy designs."
        action={<Chip label="ANALYSIS ONLY" color="primary" variant="outlined" />}
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {feedback && <Alert severity={feedback.severity} sx={{ mb: 3 }}>{feedback.message}</Alert>}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 4 }}>
          <SectionCard title="Indicator selection" subtitle="Choose a template or build a multi-indicator strategy">
            <Stack spacing={2}>
              <TextField select label="Template" value={form.templateCode} onChange={(event) => selectTemplate(event.target.value)}>
                {templates.map((template) => <MenuItem key={template.code} value={template.code}>{template.name}</MenuItem>)}
                <MenuItem value="MULTI_INDICATOR">Multi-indicator builder</MenuItem>
              </TextField>
              <TextField label="Strategy name" value={form.strategyName} onChange={update("strategyName")} placeholder="Generated automatically if empty" />
              <Grid container spacing={0.5}>
                {indicatorOptions.map((indicator) => (
                  <Grid key={indicator} size={{ xs: 6 }}>
                    <FormControlLabel control={<Checkbox checked={form.indicators.includes(indicator)} onChange={() => toggleIndicator(indicator)} />} label={indicator} />
                  </Grid>
                ))}
              </Grid>
              <TextField select label="Market" value={form.market} onChange={update("market")}>{["EQUITY", "NIFTY", "BANKNIFTY"].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
              <TextField select label="Timeframe" value={form.timeframe} onChange={update("timeframe")}>{["1m", "5m", "15m", "30m", "1h", "1d"].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
              <TextField select label="Risk profile" value={form.riskProfile} onChange={update("riskProfile")}>{["LOW", "MEDIUM", "HIGH"].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
              <Button variant="contained" disabled={busy || form.indicators.length === 0} onClick={generate}>Generate Strategy</Button>
            </Stack>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 8 }}>
          <SectionCard title="Generated strategy" subtitle={generated.strategyName || "Select indicators and generate a strategy"}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Strategy score" value={`${generated.strategyScore ?? 0}/100`} tone="success" /></Grid>
              <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Risk score" value={`${generated.riskScore ?? 0}/100`} tone={Number(generated.riskScore) > 60 ? "error" : "warning"} /></Grid>
              <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Expected win rate" value={percent(generated.expectedWinRate)} detail="Rule-based estimate, not a backtest" /></Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography fontWeight={800} mb={1}>Entry rules</Typography>
                {(Array.isArray(generated.entryRules) ? generated.entryRules : []).map((rule) => <Typography key={rule} color="text.secondary" py={0.4}>- {rule}</Typography>)}
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography fontWeight={800} mb={1}>Exit rules</Typography>
                {(Array.isArray(generated.exitRules) ? generated.exitRules : []).map((rule) => <Typography key={rule} color="text.secondary" py={0.4}>- {rule}</Typography>)}
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Button variant="outlined" disabled={busy || !generated.strategyName} onClick={save}>Save Strategy</Button>
              </Grid>
            </Grid>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Strategy history" subtitle="Saved reusable templates">
            <DataTable columns={columns} rows={history} emptyMessage="No strategy templates saved" />
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
