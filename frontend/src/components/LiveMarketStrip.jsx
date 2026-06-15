import { Box, Chip, Paper, Typography } from "@mui/material";
import useMarketStream from "../hooks/useMarketStream";
import { money } from "../utils/format";
import LiveFeedStatus from "./LiveFeedStatus";

const instruments = [
  ["NIFTY", "Nifty 50"],
  ["BANKNIFTY", "Bank Nifty"],
  ["RELIANCE", "Reliance"],
];

export default function LiveMarketStrip({ symbols = instruments }) {
  const stream = useMarketStream(symbols.map(([symbol]) => symbol));

  return (
    <Paper
      sx={{
        mb: 3,
        px: { xs: 1.5, sm: 2 },
        py: 1.25,
        display: "flex",
        gap: 1,
        alignItems: "center",
        overflowX: "auto",
        scrollbarWidth: "thin",
      }}
    >
      <LiveFeedStatus
        connected={stream.connected}
        state={stream.status.state}
        compact
      />
      {symbols.map(([symbol, label]) => {
        const quote = stream.getQuote(symbol);
        return (
          <Box
            key={symbol}
            sx={{
              minWidth: 155,
              px: 1.5,
              borderLeft: "1px solid",
              borderColor: "divider",
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              fontWeight={700}
            >
              {label}
            </Typography>
            <Typography fontWeight={800} sx={{ fontVariantNumeric: "tabular-nums" }}>
              {quote?.ltp == null ? "--" : money(quote.ltp)}
            </Typography>
          </Box>
        );
      })}
      <Chip
        size="small"
        label="PAPER MODE"
        color="primary"
        variant="outlined"
        sx={{ ml: "auto", flexShrink: 0 }}
      />
    </Paper>
  );
}
