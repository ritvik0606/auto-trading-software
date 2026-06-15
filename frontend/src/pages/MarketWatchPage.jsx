import { useCallback, useEffect, useState } from "react";
import { Box, Button, Chip, Grid, Typography } from "@mui/material";
import { getDataSafe, visibleError } from "../services/api";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import { dateTime, money } from "../utils/format";

const instruments = [
  { key: "nifty", label: "Nifty 50", path: "/api/market/nifty" },
  { key: "bankNifty", label: "Bank Nifty", path: "/api/market/banknifty" },
  {
    key: "reliance",
    label: "Reliance",
    path: "/api/market/quote/RELIANCE",
  },
];

export default function MarketWatchPage() {
  const [quotes, setQuotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const refresh = useCallback(async () => {
    const results = await Promise.all(
      instruments.map((instrument) =>
        getDataSafe(instrument.path, {
          symbol: instrument.label,
          exchange: "NSE",
          ltp: null,
        })
      )
    );
    const nextQuotes = Object.fromEntries(
      instruments.map((instrument, index) => [
        instrument.key,
        results[index].data,
      ])
    );

    setQuotes(nextQuotes);
    setOffline(results.some((result) => result.unavailable || result.error));
    setError(visibleError(...results));
    setLastUpdated(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <>
      <PageHeader
        eyebrow="Live market"
        title="Market watch"
        description="Angel One LTP monitor with automatic refresh every 10 seconds."
        action={
          <Button variant="outlined" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh quotes"}
          </Button>
        }
      />
      <ErrorAlert message={error} onRetry={refresh} />
      {offline && <OfflineNotice />}
      <Grid container spacing={2.5}>
        {instruments.map((instrument) => {
          const quote = quotes[instrument.key];
          return (
            <Grid key={instrument.key} size={{ xs: 12, md: 4 }}>
              <StatCard
                label={instrument.label}
                value={quote?.ltp == null ? "Data unavailable" : money(quote.ltp)}
                detail={`${quote?.exchange || "NSE"} · ${quote?.symbol || instrument.label}`}
                tone={quote?.ltp == null ? "warning" : "primary"}
                badge={quote?.ltp == null ? "OFFLINE" : "LIVE"}
              />
            </Grid>
          );
        })}
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Feed status" subtitle="Market data service">
            <Box
              display="flex"
              alignItems={{ xs: "flex-start", sm: "center" }}
              justifyContent="space-between"
              flexDirection={{ xs: "column", sm: "row" }}
              gap={1.5}
            >
              <Box>
                <Typography color="text.secondary">Last refresh</Typography>
                <Typography fontWeight={700}>{dateTime(lastUpdated)}</Typography>
              </Box>
              <Chip
                label={offline ? "Broker offline · Paper mode active" : "Market feed online"}
                color={offline ? "warning" : "success"}
                variant="outlined"
              />
            </Box>
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
