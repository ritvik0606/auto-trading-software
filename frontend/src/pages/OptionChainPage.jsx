import { Box, Button, Chip, Grid, Typography } from "@mui/material";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import { money } from "../utils/format";

export default function OptionChainPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [nifty, bankNifty] = await Promise.all([
      getDataSafe("/api/market/nifty", { symbol: "NIFTY", ltp: null }),
      getDataSafe("/api/market/banknifty", {
        symbol: "BANKNIFTY",
        ltp: null,
      }),
    ]);
    return {
      nifty: nifty.data,
      bankNifty: bankNifty.data,
      unavailable: nifty.unavailable || bankNifty.unavailable,
      partialError: visibleError(nifty, bankNifty),
    };
  }, []);
  if (loading) return <Loading label="Loading option workspace" />;

  return (
    <>
      <PageHeader
        eyebrow="Derivatives"
        title="Option chain"
        description="Underlying index monitor prepared for live strike, OI, IV, and Greeks integration."
        action={<Button variant="outlined" onClick={reload}>Refresh underlyings</Button>}
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      <OfflineNotice
        title="Option chain API unavailable"
        details={[
          "Paper trading mode active",
          "Live strike and Greeks data unavailable",
        ]}
      />
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label="Nifty 50 underlying"
            value={data?.nifty?.ltp == null ? "Unavailable" : money(data.nifty.ltp)}
            tone={data?.nifty?.ltp == null ? "warning" : "primary"}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label="Bank Nifty underlying"
            value={data?.bankNifty?.ltp == null ? "Unavailable" : money(data.bankNifty.ltp)}
            tone={data?.bankNifty?.ltp == null ? "warning" : "secondary"}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard label="Execution mode" value="PAPER ONLY" tone="success" />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Option chain matrix" subtitle="Awaiting a backend option-chain data source">
            <DataTable
              rows={[]}
              emptyMessage="No option-chain endpoint is available. Strike, call/put OI, IV, volume, and Greeks are not fabricated."
              columns={[
                { key: "callOi", label: "Call OI" },
                { key: "callLtp", label: "Call LTP" },
                { key: "strike", label: "Strike" },
                { key: "putLtp", label: "Put LTP" },
                { key: "putOi", label: "Put OI" },
              ]}
            />
            <Box display="flex" gap={1} mt={2} flexWrap="wrap">
              {["Open Interest", "Implied Volatility", "Greeks", "PCR"].map((item) => (
                <Chip key={item} label={`${item}: unavailable`} size="small" variant="outlined" />
              ))}
            </Box>
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
