import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  TextField,
  Typography,
} from "@mui/material";
import {
  getDataSafe,
  postData,
  visibleError,
} from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import SectionCard from "../components/SectionCard";
import { dateTime, money, pnlTone } from "../utils/format";

const initialTrade = {
  symbol: "RELIANCE",
  exchange: "NSE",
  quantity: "1",
  price: "",
};

export default function OrdersPage() {
  const [trade, setTrade] = useState(initialTrade);
  const [exitTrade, setExitTrade] = useState({ id: "", exitPrice: "" });
  const [actionState, setActionState] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { data, loading, error, reload } = useApi(async () => {
    const [openTrades, allTrades, orderAudit] = await Promise.all([
      getDataSafe("/api/paper-trade/open", []),
      getDataSafe("/api/paper-trade/all", []),
      getDataSafe("/api/orders/all", []),
    ]);

    return {
      openTrades: openTrades.data,
      allTrades: allTrades.data,
      orderAudit: orderAudit.data,
      unavailable:
        openTrades.unavailable ||
        allTrades.unavailable ||
        orderAudit.unavailable,
      partialError: visibleError(openTrades, allTrades, orderAudit),
    };
  }, []);

  const updateTrade = (field) => (event) => {
    const value =
      field === "symbol" || field === "exchange"
        ? event.target.value.toUpperCase()
        : event.target.value;
    setTrade((current) => ({ ...current, [field]: value }));
  };

  const submitTrade = async (side) => {
    setSubmitting(true);
    setActionState(null);
    try {
      const body = {
        symbol: trade.symbol.trim().toUpperCase(),
        exchange: trade.exchange.trim().toUpperCase(),
        quantity: Number(trade.quantity),
        ...(trade.price ? { price: Number(trade.price) } : {}),
      };
      const result = await postData(`/api/paper-trade/${side}`, body);
      setActionState({
        severity: "success",
        message: `${result.tradeType} paper trade #${result.id} opened`,
      });
      await reload();
    } catch (actionError) {
      setActionState({
        severity: actionError.isUnavailable ? "warning" : "error",
        message: actionError.isUnavailable
          ? "Broker offline. Enter a manual paper price or retry when market data is available."
          : actionError.message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const submitExit = async () => {
    setSubmitting(true);
    setActionState(null);
    try {
      const body = exitTrade.exitPrice
        ? { exitPrice: Number(exitTrade.exitPrice) }
        : {};
      const result = await postData(
        `/api/paper-trade/exit/${exitTrade.id}`,
        body
      );
      setActionState({
        severity: "success",
        message: `Paper trade #${result.id} closed with P&L ${money(result.pnl)}`,
      });
      setExitTrade({ id: "", exitPrice: "" });
      await reload();
    } catch (actionError) {
      setActionState({
        severity: actionError.isUnavailable ? "warning" : "error",
        message: actionError.isUnavailable
          ? "Broker offline. Enter a manual exit price to close the paper trade."
          : actionError.message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading label="Loading paper trades" />;
  const openRows = Array.isArray(data?.openTrades) ? data.openTrades : [];
  const allRows = Array.isArray(data?.allTrades) ? data.allTrades : [];
  const blockedOrders = Array.isArray(data?.orderAudit)
    ? data.orderAudit.filter((order) => order.status === "BLOCKED").length
    : 0;
  const totalPnl = allRows.reduce(
    (sum, row) => sum + Number(row.pnl || 0),
    0
  );
  const columns = [
    { key: "id", label: "Trade ID" },
    { key: "symbol", label: "Symbol" },
    {
      key: "tradeType",
      label: "Side",
      render: (row) => (
        <Chip
          size="small"
          label={row.tradeType}
          color={row.tradeType === "BUY" ? "success" : "error"}
          variant="outlined"
        />
      ),
    },
    { key: "quantity", label: "Qty", align: "right" },
    {
      key: "entryPrice",
      label: "Entry",
      align: "right",
      render: (row) => money(row.entryPrice),
    },
    {
      key: "exitPrice",
      label: "Exit",
      align: "right",
      render: (row) => (row.exitPrice == null ? "--" : money(row.exitPrice)),
    },
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
    { key: "createdAt", label: "Opened", render: (row) => dateTime(row.createdAt) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Paper execution"
        title="Trade terminal"
        description="Create and exit simulated trades without sending live broker orders."
        action={<Chip label="PAPER ONLY" color="primary" variant="outlined" />}
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Trade data unavailable" />}
      {actionState && (
        <Alert severity={actionState.severity} sx={{ mb: 3 }}>
          {actionState.message}
        </Alert>
      )}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Open paper trades" value={openRows.length} tone="warning" />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Paper P&L" value={money(totalPnl)} tone={pnlTone(totalPnl)} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Real orders blocked" value={blockedOrders} tone="success" />
        </Grid>
        <Grid size={{ xs: 12, xl: 7 }}>
          <SectionCard title="Open paper trade" subtitle="Price is optional; blank uses live LTP">
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="Symbol" fullWidth value={trade.symbol} onChange={updateTrade("symbol")} />
              </Grid>
              <Grid size={{ xs: 12, sm: 2 }}>
                <TextField label="Exchange" fullWidth value={trade.exchange} onChange={updateTrade("exchange")} />
              </Grid>
              <Grid size={{ xs: 12, sm: 2 }}>
                <TextField label="Quantity" type="number" fullWidth value={trade.quantity} onChange={updateTrade("quantity")} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="Paper price (optional)" type="number" fullWidth value={trade.price} onChange={updateTrade("price")} />
              </Grid>
            </Grid>
            <Box display="flex" flexWrap="wrap" gap={1.5} mt={2}>
              <Button variant="contained" color="success" disabled={submitting} onClick={() => submitTrade("buy")}>
                Buy Paper Trade
              </Button>
              <Button variant="contained" color="error" disabled={submitting} onClick={() => submitTrade("sell")}>
                Sell Paper Trade
              </Button>
              <Button variant="text" disabled={submitting} onClick={() => setTrade(initialTrade)}>
                Reset
              </Button>
            </Box>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, xl: 5 }}>
          <SectionCard title="Exit paper trade" subtitle="Blank exit price uses live LTP">
            <Box display="flex" flexDirection="column" gap={1.5}>
              <TextField
                label="Trade ID"
                type="number"
                value={exitTrade.id}
                onChange={(event) =>
                  setExitTrade((current) => ({ ...current, id: event.target.value }))
                }
              />
              <TextField
                label="Exit price (optional)"
                type="number"
                value={exitTrade.exitPrice}
                onChange={(event) =>
                  setExitTrade((current) => ({
                    ...current,
                    exitPrice: event.target.value,
                  }))
                }
              />
              <Button
                variant="outlined"
                color="warning"
                disabled={submitting || !exitTrade.id}
                onClick={submitExit}
              >
                Exit Trade
              </Button>
            </Box>
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="Open paper trades" subtitle="Positions eligible for exit">
            <DataTable columns={columns} rows={openRows} emptyMessage="No open paper trades" />
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <SectionCard title="All paper trades" subtitle="Complete paper execution history">
            <DataTable columns={columns} rows={allRows} emptyMessage="No paper trades recorded" />
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
