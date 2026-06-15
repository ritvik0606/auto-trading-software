import { Box, Button, Grid, Typography } from "@mui/material";
import { getDataSafe } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import { percent } from "../utils/format";
import useMarketStream from "../hooks/useMarketStream";
import LiveFeedStatus from "../components/LiveFeedStatus";

function cellColor(change) {
  if (change == null) return "rgba(143,163,187,.08)";
  const strength = Math.min(Math.abs(change) / 4, 1);
  return change >= 0
    ? `rgba(53, 211, 138, ${0.15 + strength * 0.65})`
    : `rgba(255, 101, 119, ${0.15 + strength * 0.65})`;
}

export default function HeatmapPage() {
  const { data, loading, error, reload } = useApi(
    () => getDataSafe("/api/scanner/nifty50", { count: 0, items: [] }),
    []
  );
  const items = data?.data?.items || [];
  const stream = useMarketStream(items.map((item) => item.symbol));
  const liveItems = items.map((item) => {
    const quote = stream.getQuote(item.symbol);
    return {
      ...item,
      ltp: quote?.ltp ?? item.ltp,
      live: Boolean(quote),
    };
  });
  if (loading) return <Loading label="Building market heatmap" />;
  const gainers = liveItems.filter((item) => Number(item.changePercent) > 0).length;
  const losers = liveItems.filter((item) => Number(item.changePercent) < 0).length;

  return (
    <>
      <PageHeader
        eyebrow="Breadth"
        title="Market heatmap"
        description="Nifty 50 color map using scanner change percentages and trend state."
        action={<Box display="flex" gap={1}><LiveFeedStatus connected={stream.connected} state={stream.status.state} /><Button variant="outlined" onClick={reload}>Refresh</Button></Box>}
      />
      <ErrorAlert message={error} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Heatmap market data unavailable" />}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Symbols" value={liveItems.length} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Gainers" value={gainers} tone="success" /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Losers" value={losers} tone="error" /></Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Nifty 50 heatmap" subtitle="Green indicates gains; red indicates losses">
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "repeat(2, minmax(0, 1fr))",
                  sm: "repeat(4, minmax(0, 1fr))",
                  lg: "repeat(6, minmax(0, 1fr))",
                  xl: "repeat(8, minmax(0, 1fr))",
                },
                gap: 1,
              }}
            >
              {liveItems.map((item) => (
                <Box
                  key={item.symbol}
                  sx={{
                    minHeight: 88,
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: cellColor(item.changePercent),
                    border: "1px solid rgba(255,255,255,.08)",
                  }}
                >
                  <Typography fontWeight={800}>{item.symbol}</Typography>
                  <Typography variant="h6" mt={0.5}>
                    {item.changePercent == null ? "--" : percent(item.changePercent)}
                  </Typography>
                  <Box display="flex" justifyContent="space-between" gap={1}>
                    <Typography variant="caption">{item.trend}</Typography>
                    <Typography variant="caption">{item.ltp ?? "--"}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
            {liveItems.length === 0 && (
              <Typography color="text.secondary" textAlign="center" py={7}>
                Data unavailable
              </Typography>
            )}
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
