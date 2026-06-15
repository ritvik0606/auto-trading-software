import { Chip } from "@mui/material";

export default function LiveFeedStatus({ connected, state, compact = false }) {
  const label = connected
    ? compact
      ? "LIVE"
      : "Angel stream live"
    : state === "RECONNECTING"
      ? compact
        ? "RETRY"
        : "Feed reconnecting"
      : compact
        ? "OFFLINE"
        : "Market feed offline";

  return (
    <Chip
      size="small"
      label={label}
      color={connected ? "success" : "warning"}
      variant="outlined"
      sx={{ fontWeight: 800, letterSpacing: "0.04em" }}
    />
  );
}
