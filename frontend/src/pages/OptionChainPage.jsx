import { useState } from "react";
import {
  Box,
  Button,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import { money, number } from "../utils/format";
import useMarketStream from "../hooks/useMarketStream";
import LiveFeedStatus from "../components/LiveFeedStatus";
import LiveMarketStrip from "../components/LiveMarketStrip";
import OptionChainTable from "../components/OptionChainTable";

export default function OptionChainPage() {
  const [underlying, setUnderlying] = useState("NIFTY");
  const stream = useMarketStream(["NIFTY", "BANKNIFTY"]) || {};
  const { data, loading, error, reload } = useApi(async () => {
    const [nifty, bankNifty, optionChain] = await Promise.all([
      getDataSafe("/api/market/nifty", { symbol: "NIFTY", ltp: null }),
      getDataSafe("/api/market/banknifty", {
        symbol: "BANKNIFTY",
        ltp: null,
      }),
      getDataSafe("/api/market/option-chain", {
        symbol: "NIFTY",
        expiry: null,
        spot: null,
        strikes: [],
      }),
    ]);
    return {
      nifty: nifty.data,
      bankNifty: bankNifty.data,
      optionChain: optionChain.data,
      unavailable:
        nifty.unavailable ||
        bankNifty.unavailable ||
        optionChain.unavailable,
      partialError: visibleError(nifty, bankNifty, optionChain),
    };
  }, []);
  const pageData = data && typeof data === "object" ? data : {};
  const optionChain =
    pageData.optionChain && typeof pageData.optionChain === "object"
      ? pageData.optionChain
      : {};
  const getQuote =
    typeof stream.getQuote === "function" ? stream.getQuote : () => null;
  const nifty = getQuote("NIFTY") || pageData.nifty || {};
  const bankNifty = getQuote("BANKNIFTY") || pageData.bankNifty || {};
  const selectedQuote = underlying === "NIFTY" ? nifty : bankNifty;
  const strikeStep = underlying === "NIFTY" ? 50 : 100;
  const selectedLtp = Number(selectedQuote?.ltp ?? 0);
  const atmStrike =
    selectedLtp > 0
      ? Math.round(selectedLtp / strikeStep) * strikeStep
      : 0;
  const optionRows = Array.isArray(optionChain.strikes)
    ? optionChain.strikes
    : [];
  const optionMessage =
    optionRows.length === 0
      ? "Option Chain Data Unavailable"
      : "";

  if (loading) return <Loading label="Loading option workspace" />;

  return (
    <>
      <PageHeader
        eyebrow="Derivatives"
        title="Option chain"
        description="Professional CE/PE derivatives workspace with live Angel One underlyings and Greek-ready strike columns."
        action={
          <Box display="flex" gap={1}>
            <LiveFeedStatus
              connected={Boolean(stream.connected)}
              state={stream.status?.state || "DISCONNECTED"}
            />
            <Button variant="outlined" onClick={reload}>Refresh</Button>
          </Box>
        }
      />
      <LiveMarketStrip symbols={[["NIFTY", "Nifty 50"], ["BANKNIFTY", "Bank Nifty"]]} />
      <ErrorAlert message={error || pageData.partialError || ""} onRetry={reload} />
      {!stream.connected && <OfflineNotice />}
      {optionMessage && (
        <OfflineNotice
          title={optionMessage}
          details={["Paper trading mode active", "Strike data unavailable"]}
        />
      )}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label="Nifty 50 underlying"
            value={nifty?.ltp == null ? "Unavailable" : money(nifty.ltp)}
            tone={nifty?.ltp == null ? "warning" : "primary"}
            badge={nifty?.source === "ANGEL_ONE_WEBSOCKET" ? "LIVE" : "REST"}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label="Bank Nifty underlying"
            value={bankNifty?.ltp == null ? "Unavailable" : money(bankNifty.ltp)}
            tone={bankNifty?.ltp == null ? "warning" : "secondary"}
            badge={bankNifty?.source === "ANGEL_ONE_WEBSOCKET" ? "LIVE" : "REST"}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label={`${underlying} ATM strike`}
            value={atmStrike > 0 ? number(atmStrike, 0) : "Unavailable"}
            detail={`Nearest ${strikeStep}-point strike`}
            tone="success"
          />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard
            title="CE / PE option chain"
            subtitle="Greeks, IV, volume, OI, LTP, and ATM highlighting"
            action={
              <Box display="flex" gap={1.25} flexWrap="wrap">
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>Underlying</InputLabel>
                  <Select
                    value={underlying}
                    label="Underlying"
                    onChange={(event) => setUnderlying(event.target.value)}
                  >
                    <MenuItem value="NIFTY">Nifty 50</MenuItem>
                    <MenuItem value="BANKNIFTY">Bank Nifty</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel>Expiry</InputLabel>
                  <Select value="" label="Expiry" disabled>
                    <MenuItem value="">Unavailable</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            }
          >
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", md: "center" }}
              flexDirection={{ xs: "column", md: "row" }}
              gap={1.5}
              mb={2}
            >
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Selected underlying
                </Typography>
                <Typography variant="h6">
                  {underlying}{" "}
                  {selectedQuote?.ltp == null
                    ? "--"
                    : money(selectedQuote.ltp)}
                </Typography>
              </Box>
              <Box display="flex" gap={1} flexWrap="wrap">
                <Chip label={`ATM ${atmStrike || "--"}`} color="primary" />
                <Chip label="PCR unavailable" variant="outlined" />
                <Chip label="Max pain unavailable" variant="outlined" />
              </Box>
            </Box>
            <OptionChainTable
              rows={optionRows}
              atmStrike={atmStrike}
              emptyMessage={optionMessage}
            />
            <Box display="flex" gap={1} mt={2} flexWrap="wrap">
              {["Delta", "Gamma", "Theta", "Vega", "IV", "Open Interest"].map((item) => (
                <Chip key={item} label={`${item}: awaiting feed`} size="small" variant="outlined" />
              ))}
            </Box>
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
