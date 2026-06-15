import { Box, CircularProgress, Typography } from "@mui/material";

export default function Loading({ label = "Loading market data" }) {
  return (
    <Box
      sx={{
        minHeight: 220,
        display: "grid",
        placeItems: "center",
        textAlign: "center",
      }}
    >
      <Box>
        <CircularProgress size={30} thickness={4} />
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          {label}
        </Typography>
      </Box>
    </Box>
  );
}
