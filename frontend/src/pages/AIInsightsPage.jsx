import { Box, Chip, Grid, Typography } from "@mui/material";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import OfflineNotice from "../components/OfflineNotice";

const riskColor = (level) =>
  level === "HIGH" ? "error" : level === "MEDIUM" ? "warning" : "success";

export default function AIInsightsPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [summary, recommendations, warning] = await Promise.all([
      getDataSafe("/api/ai-insights/summary", {
        overallScore: 0,
        performanceTrend: "DATA_UNAVAILABLE",
        mainStrength: "Data unavailable",
        mainWeakness: "Data unavailable",
        recommendation: "Paper trading mode remains active",
        analyzedTrades: 0,
      }),
      getDataSafe("/api/ai-insights/recommendations", {
        recommendations: [],
      }),
      getDataSafe("/api/ai-insights/risk-warning", {
        currentRiskLevel: "UNKNOWN",
      }),
    ]);
    return {
      summary: summary.data,
      recommendations: recommendations.data,
      warning: warning.data,
      unavailable:
        summary.unavailable ||
        recommendations.unavailable ||
        warning.unavailable,
      partialError: visibleError(summary, recommendations, warning),
    };
  }, []);
  if (loading) return <Loading label="Analyzing trading behavior" />;
  const summary = data?.summary || {};
  const warning = data?.warning || {};
  const recommendations = data?.recommendations?.recommendations || [];

  return (
    <>
      <PageHeader eyebrow="Rule-based intelligence" title="AI trade insights" description="Actionable analysis derived from paper trades, risk settings, and performance history." />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Insights data unavailable" />}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Overall score" value={`${summary.overallScore ?? 0}/100`} tone="primary" badge={summary.performanceTrend} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Current risk" value={warning.currentRiskLevel || "--"} tone={riskColor(warning.currentRiskLevel)} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Trades analyzed" value={summary.analyzedTrades ?? 0} tone="secondary" /></Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Signal quality assessment">
            <Box py={1}>
              <Typography variant="overline" color="success.main" fontWeight={800}>Main strength</Typography>
              <Typography variant="h6" mb={2.5}>{summary.mainStrength}</Typography>
              <Typography variant="overline" color="warning.main" fontWeight={800}>Main weakness</Typography>
              <Typography variant="h6">{summary.mainWeakness}</Typography>
            </Box>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Risk monitors">
            {[
              ["Daily loss", warning.dailyLossRisk?.level],
              ["Open exposure", warning.openExposureRisk?.level],
              ["Overtrading", warning.overtradingRisk?.level],
              ["Capital utilization", warning.capitalUtilizationRisk?.level],
            ].map(([label, level]) => (
              <Box key={label} display="flex" justifyContent="space-between" alignItems="center" py={1}>
                <Typography color="text.secondary">{label}</Typography>
                <Chip size="small" label={level || "LOW"} color={riskColor(level)} variant="outlined" />
              </Box>
            ))}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Recommendations" subtitle={summary.recommendation}>
            <Grid container spacing={2}>
              {recommendations.map((item, index) => (
                <Grid key={`${item.recommendation}-${index}`} size={{ xs: 12, md: 6 }}>
                  <Box sx={{ p: 2, borderRadius: 2, bgcolor: "rgba(143,163,187,.05)", height: "100%" }}>
                    <Chip label={item.priority} size="small" color={item.priority === "HIGH" ? "error" : item.priority === "MEDIUM" ? "warning" : "success"} />
                    <Typography fontWeight={750} mt={1.5}>{item.recommendation}</Typography>
                    <Typography variant="body2" color="text.secondary" mt={0.75}>{item.reason}</Typography>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
