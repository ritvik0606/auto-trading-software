import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getDataSafe, postData, visibleError } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import SectionCard from "../components/SectionCard";
import { dateTime, money, pnlTone } from "../utils/format";

const initialOrder = {
  symbol: "RELIANCE",
  exchange: "NSE",
  side: "BUY",
  quantity: "1",
  price: "",
  strategyTemplateId: "",
};
const axisStyle = { fill: "#70859e", fontSize: 11 };

export default function PaperSimulatorPage() {
  const [order, setOrder] = useState(initialOrder);
  const [closePrices, setClosePrices] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [actionState, setActionState] = useState(null);
  const { data, loading, error, reload } = useApi(async () => {
    const [account, positions, history, strategies] = await Promise.all([
      getDataSafe("/api/paper-simulator/account", {}),
      getDataSafe("/api/paper-simulator/positions", []),
      getDataSafe("/api/paper-simulator/history", {
        orders: [],
        equityCurve: [],
      }),
      getDataSafe("/api/strategy-generator/history", []),
    ]);

    return {
      account: account.data || {},
      positions: Array.isArray(positions.data) ? positions.data : [],
      history: history.data || {},
      strategies: Array.isArray(strategies.data) ? strategies.data : [],
      unavailable:
        account.unavailable || positions.unavailable || history.unavailable,
      partialError: visibleError(account, positions, history, strategies),
    };
  }, []);

  const updateOrder = (field) => (event) => {
    const value =
      field === "symbol" || field === "exchange"
        ? event.target.value.toUpperCase()
        : event.target.value;
    setOrder((current) => ({ ...current, [field]: value }));
  };

  const submitOrder = async () => {
    setSubmitting(true);
    setActionState(null);
    try {
      const result = await postData("/api/paper-simulator/order", {
        action: "OPEN",
        symbol: order.symbol.trim().toUpperCase(),
        exchange: order.exchange.trim().toUpperCase(),
        side: order.side,
        quantity: Number(order.quantity),
        ...(order.price ? { price: Number(order.price) } : {}),
        ...(order.strategyTemplateId
          ? { strategyTemplateId: Number(order.strategyTemplateId) }
          : {}),
      });
      setActionState({
        severity: "success",
        message: `${result.position.side} simulator position #${result.position.id} opened`,
      });
      await reload();
    } catch (actionError) {
      setActionState({
        severity: actionError.isUnavailable ? "warning" : "error",
        message: actionError.isUnavailable
          ? "Market data unavailable. Enter a manual paper price."
          : actionError.message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const closePosition = async (position) => {
    setSubmitting(true);
    setActionState(null);
    try {
      const price = closePrices[position.id];
      const result = await postData("/api/paper-simulator/order", {
        action: "CLOSE",
        positionId: position.id,
        ...(price ? { price: Number(price) } : {}),
      });
      setActionState({
        severity: "success",
        message: `Position #${position.id} closed with P&L ${money(
          result.position.realizedPnl
        )}`,
      });
      setClosePrices((current) => ({ ...current, [position.id]: "" }));
      await reload();
    } catch (actionError) {
      setActionState({
        severity: actionError.isUnavailable ? "warning" : "error",
        message: actionError.isUnavailable
          ? "Market data unavailable. Enter a manual exit price."
          : actionError.message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const resetSimulator = async () => {
    if (!window.confirm("Reset the simulator account, positions, and history?")) {
      return;
    }
    setSubmitting(true);
    setActionState(null);
    try {
      await postData("/api/paper-simulator/reset", { confirm: "RESET" });
      setOrder(initialOrder);
      setClosePrices({});
      setActionState({
        severity: "success",
        message: "Paper simulator reset to its default virtual balance",
      });
      await reload();
    } catch (actionError) {
      setActionState({ severity: "error", message: actionError.message });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading label="Loading paper simulator" />;

  const account = data?.account || {};
  const positions = Array.isArray(data?.positions) ? data.positions : [];
  const orders = Array.isArray(data?.history?.orders)
    ? data.history.orders
    : [];
  const equityCurve = Array.isArray(data?.history?.equityCurve)
    ? data.history.equityCurve
    : [];
  const strategies = Array.isArray(data?.strategies) ? data.strategies : [];
  const positionColumns = [
    { key: "id", label: "ID" },
    { key: "symbol", label: "Symbol" },
    {
      key: "side",
      label: "Side",
      render: (row) => (
        <Chip
          size="small"
          label={row.side}
          color={row.side === "BUY" ? "success" : "error"}
          variant="outlined"
        />
      ),
    },
    { key: "quantity", label: "Qty", align: "right" },
    {
      key: "averagePrice",
      label: "Average",
      align: "right",
      render: (row) => money(row.averagePrice),
    },
    {
      key: "currentPrice",
      label: "LTP",
      align: "right",
      render: (row) => money(row.currentPrice),
    },
    {
      key: "unrealizedPnl",
      label: "Unrealized P&L",
      align: "right",
      render: (row) => (
        <Typography color={`${pnlTone(row.unrealizedPnl)}.main`}>
          {money(row.unrealizedPnl)}
        </Typography>
      ),
    },
    { key: "strategyName", label: "Strategy" },
    {
      key: "actions",
      label: "Exit",
      render: (row) => (
        <Box display="flex" gap={1} minWidth={240}>
          <TextField
            size="small"
            type="number"
            placeholder="Live LTP"
            value={closePrices[row.id] || ""}
            onChange={(event) =>
              setClosePrices((current) => ({
                ...current,
                [row.id]: event.target.value,
              }))
            }
          />
          <Button
            size="small"
            color="warning"
            variant="outlined"
            disabled={submitting}
            onClick={() => closePosition(row)}
          >
            Close
          </Button>
        </Box>
      ),
    },
  ];
  const orderColumns = [
    { key: "id", label: "Order" },
    { key: "symbol", label: "Symbol" },
    { key: "action", label: "Action" },
    { key: "side", label: "Side" },
    { key: "quantity", label: "Qty", align: "right" },
    {
      key: "price",
      label: "Price",
      align: "right",
      render: (row) => money(row.price),
    },
    {
      key: "pnl",
      label: "P&L",
      align: "right",
      render: (row) => (
        <Typography color={`${pnlTone(row.pnl)}.main`}>{money(row.pnl)}</Typography>
      ),
    },
    { key: "strategyName", label: "Strategy" },
    { key: "createdAt", label: "Time", render: (row) => dateTime(row.createdAt) },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Phase 14"
        title="Paper Trading Simulator"
        description="Operate a dedicated virtual account with risk-controlled long and short simulations."
        action={<Chip label="PAPER ONLY" color="primary" variant="outlined" />}
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && (
        <OfflineNotice title="Simulator data unavailable" />
      )}
      {actionState && (
        <Alert severity={actionState.severity} sx={{ mb: 3 }}>
          {actionState.message}
        </Alert>
      )}

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Virtual Balance"
            value={money(account.virtualBalance)}
            badge={account.mode || "PAPER_ONLY"}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard label="Available Cash" value={money(account.cashBalance)} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Total P&L"
            value={money(account.totalPnl)}
            tone={pnlTone(account.totalPnl)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Open Positions"
            value={account.openPositions || 0}
            tone={account.tradingAllowed ? "success" : "error"}
            detail={`Risk engine: ${account.riskStatus || "UNKNOWN"}`}
          />
        </Grid>

        <Grid size={{ xs: 12, xl: 5 }}>
          <SectionCard
            title="Place Simulator Order"
            subtitle="Leave price blank to use the latest NSE quote"
          >
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 7 }}>
                <TextField
                  label="Symbol"
                  fullWidth
                  value={order.symbol}
                  onChange={updateOrder("symbol")}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 5 }}>
                <TextField
                  label="Exchange"
                  fullWidth
                  value={order.exchange}
                  onChange={updateOrder("exchange")}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  select
                  label="Side"
                  fullWidth
                  value={order.side}
                  onChange={updateOrder("side")}
                >
                  <MenuItem value="BUY">BUY</MenuItem>
                  <MenuItem value="SELL">SELL</MenuItem>
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="Quantity"
                  type="number"
                  fullWidth
                  value={order.quantity}
                  onChange={updateOrder("quantity")}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="Price (optional)"
                  type="number"
                  fullWidth
                  value={order.price}
                  onChange={updateOrder("price")}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  select
                  label="Saved Strategy (optional)"
                  fullWidth
                  value={order.strategyTemplateId}
                  onChange={updateOrder("strategyTemplateId")}
                >
                  <MenuItem value="">Manual</MenuItem>
                  {strategies.map((strategy) => (
                    <MenuItem key={strategy.id} value={strategy.id}>
                      {strategy.strategyName}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>
            <Box display="flex" flexWrap="wrap" gap={1.5} mt={2}>
              <Button
                variant="contained"
                disabled={submitting || !account.tradingAllowed}
                onClick={submitOrder}
              >
                Simulate {order.side}
              </Button>
              <Button
                variant="text"
                color="error"
                disabled={submitting}
                onClick={resetSimulator}
              >
                Reset Simulator
              </Button>
            </Box>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, xl: 7 }}>
          <SectionCard
            title="Equity Curve"
            subtitle="Virtual account equity after each simulator event"
          >
            <ResponsiveContainer width="100%" height={330}>
              <AreaChart data={equityCurve}>
                <defs>
                  <linearGradient id="simulatorEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4de8c2" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#4de8c2" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(143,163,187,.08)" vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  tick={axisStyle}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  }
                />
                <YAxis tick={axisStyle} />
                <Tooltip
                  contentStyle={{
                    background: "#101d2e",
                    border: "1px solid #26364c",
                    borderRadius: 10,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="#4de8c2"
                  fill="url(#simulatorEquity)"
                  strokeWidth={2.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <SectionCard title="Open Positions">
            <DataTable
              columns={positionColumns}
              rows={positions}
              emptyMessage="No simulator positions are open"
            />
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <SectionCard title="Order History">
            <DataTable
              columns={orderColumns}
              rows={orders}
              emptyMessage="No simulator orders recorded"
            />
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
