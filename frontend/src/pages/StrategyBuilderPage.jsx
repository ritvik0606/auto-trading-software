import { useMemo, useState } from "react";
import { Alert, Button, Chip, Grid, MenuItem, TextField, Typography } from "@mui/material";
import { postData } from "../services/api";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";

export default function StrategyBuilderPage() {
  const [form, setForm] = useState({
    name: "EMA_RSI_CUSTOM",
    market: "NIFTY",
    style: "INTRADAY",
    risk: "MEDIUM",
    fastEma: 20,
    slowEma: 50,
    rsiLength: 14,
    buyRsi: 55,
    sellRsi: 45,
  });
  const [feedback, setFeedback] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));
  const score = useMemo(() => {
    const separation = Math.max(Number(form.slowEma) - Number(form.fastEma), 0);
    const rsiBand = Number(form.buyRsi) - Number(form.sellRsi);
    return Math.max(0, Math.min(100, Math.round(55 + separation * 0.5 + rsiBand)));
  }, [form]);

  const generate = async () => {
    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await postData("/api/ai-strategy/generate", {
        market: form.market,
        style: form.style,
        risk: form.risk,
      });
      setFeedback({
        severity: "success",
        message: `Generated strategy ${result.strategyName || result.strategy_name || "saved"} using historical paper data.`,
      });
    } catch (error) {
      setFeedback({
        severity: error.isUnavailable ? "warning" : "error",
        message: error.isUnavailable
          ? "Strategy generation data unavailable. Your local rule draft is preserved."
          : error.message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="Strategy builder"
        description="Compose EMA and RSI rules, review a local configuration score, and request historical paper-data validation."
        action={<Chip label="NO LIVE ORDERS" color="primary" variant="outlined" />}
      />
      {feedback && <Alert severity={feedback.severity} sx={{ mb: 3 }}>{feedback.message}</Alert>}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, xl: 8 }}>
          <SectionCard title="Rule composer" subtitle="EMA_RSI strategy parameters">
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}><TextField label="Strategy name" fullWidth value={form.name} onChange={update("name")} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField label="Fast EMA" type="number" fullWidth value={form.fastEma} onChange={update("fastEma")} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField label="Slow EMA" type="number" fullWidth value={form.slowEma} onChange={update("slowEma")} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField label="RSI length" type="number" fullWidth value={form.rsiLength} onChange={update("rsiLength")} /></Grid>
              <Grid size={{ xs: 12, md: 3 }}><TextField label="BUY RSI threshold" type="number" fullWidth value={form.buyRsi} onChange={update("buyRsi")} /></Grid>
              <Grid size={{ xs: 12, md: 3 }}><TextField label="SELL RSI threshold" type="number" fullWidth value={form.sellRsi} onChange={update("sellRsi")} /></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField select label="Market" fullWidth value={form.market} onChange={update("market")}><MenuItem value="NIFTY">NIFTY</MenuItem><MenuItem value="BANKNIFTY">BANKNIFTY</MenuItem></TextField></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField select label="Style" fullWidth value={form.style} onChange={update("style")}><MenuItem value="INTRADAY">INTRADAY</MenuItem><MenuItem value="SWING">SWING</MenuItem></TextField></Grid>
              <Grid size={{ xs: 12, md: 2 }}><TextField select label="Risk" fullWidth value={form.risk} onChange={update("risk")}><MenuItem value="LOW">LOW</MenuItem><MenuItem value="MEDIUM">MEDIUM</MenuItem><MenuItem value="HIGH">HIGH</MenuItem></TextField></Grid>
            </Grid>
            <Button variant="contained" sx={{ mt: 2 }} onClick={generate} disabled={submitting}>
              {submitting ? "Validating..." : "Generate from paper history"}
            </Button>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, xl: 4 }}>
          <SectionCard title="Strategy preview">
            <StatCard label="Configuration score" value={`${score}/100`} tone="success" />
            <Typography fontWeight={800} mt={2}>BUY rule</Typography>
            <Typography color="text.secondary">EMA {form.fastEma} &gt; EMA {form.slowEma} and RSI {form.rsiLength} &gt; {form.buyRsi}</Typography>
            <Typography fontWeight={800} mt={2}>SELL rule</Typography>
            <Typography color="text.secondary">EMA {form.fastEma} &lt; EMA {form.slowEma} and RSI {form.rsiLength} &lt; {form.sellRsi}</Typography>
            <Typography variant="caption" color="warning.main" display="block" mt={2}>
              This score evaluates configuration structure only, not market performance.
            </Typography>
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
