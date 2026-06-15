import { Alert, Box, Typography } from "@mui/material";

export default function OfflineNotice({
  title = "Broker offline",
  details = ["Paper trading mode active", "Data unavailable"],
}) {
  return (
    <Alert
      severity="warning"
      variant="outlined"
      sx={{
        mb: 3,
        bgcolor: "rgba(255, 189, 89, 0.05)",
        borderColor: "rgba(255, 189, 89, 0.25)",
      }}
    >
      <Typography fontWeight={800}>{title}</Typography>
      <Box display="flex" flexWrap="wrap" gap={2} mt={0.5}>
        {details.map((detail) => (
          <Typography key={detail} variant="body2" color="text.secondary">
            {detail}
          </Typography>
        ))}
      </Box>
    </Alert>
  );
}
