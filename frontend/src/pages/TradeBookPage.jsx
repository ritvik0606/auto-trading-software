import { Chip, Grid, Typography } from "@mui/material";
import { getDataSafe, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import { money, pnlTone } from "../utils/format";

function mergeTrades(journal, paperTrades) {
  const notesByTrade = new Map(
    journal.map((entry) => [entry.tradeId, entry])
  );
  return paperTrades.map((trade) => {
    const entry = notesByTrade.get(trade.id);
    return {
      id: trade.id,
      symbol: trade.symbol,
      entry: trade.entryPrice,
      exit: trade.exitPrice,
      quantity: trade.quantity,
      pnl: trade.pnl,
      status: trade.status,
      notes: entry?.notes || "",
    };
  });
}

export default function TradeBookPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [journal, paperTrades] = await Promise.all([
      getDataSafe("/api/journal/all", []),
      getDataSafe("/api/paper-trade/all", []),
    ]);
    return {
      rows: mergeTrades(journal.data, paperTrades.data),
      unavailable: journal.unavailable || paperTrades.unavailable,
      partialError: visibleError(journal, paperTrades),
    };
  }, []);
  if (loading) return <Loading label="Loading trade book" />;
  const rows = data?.rows || [];
  const closed = rows.filter((row) => row.status === "CLOSED").length;
  const totalPnl = rows.reduce((sum, row) => sum + Number(row.pnl || 0), 0);
  const columns = [
    { key: "id", label: "Trade ID" },
    { key: "symbol", label: "Symbol" },
    {
      key: "entry",
      label: "Entry",
      align: "right",
      render: (row) => money(row.entry),
    },
    {
      key: "exit",
      label: "Exit",
      align: "right",
      render: (row) => (row.exit == null ? "--" : money(row.exit)),
    },
    { key: "quantity", label: "Quantity", align: "right" },
    {
      key: "pnl",
      label: "P&L",
      align: "right",
      render: (row) => (
        <Typography color={`${pnlTone(row.pnl)}.main`} fontWeight={700}>
          {money(row.pnl)}
        </Typography>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <Chip
          size="small"
          label={row.status}
          color={row.status === "OPEN" ? "warning" : "default"}
        />
      ),
    },
    {
      key: "notes",
      label: "Notes",
      render: (row) => row.notes || "No notes",
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Journal"
        title="Trade book"
        description="Paper-trade lifecycle with journal notes and realized performance."
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Trade book data unavailable" />}
      <Grid container spacing={2.5} mb={2.5}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Total trades" value={rows.length} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Closed trades" value={closed} tone="secondary" />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Total P&L" value={money(totalPnl)} tone={pnlTone(totalPnl)} />
        </Grid>
      </Grid>
      <DataTable columns={columns} rows={rows} emptyMessage="No trades available" />
    </>
  );
}
