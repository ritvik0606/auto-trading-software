import { Box, Chip, Paper, Typography } from "@mui/material";

const tones = {
  primary: "#4de8c2",
  secondary: "#8b7cff",
  success: "#35d38a",
  warning: "#ffbd59",
  error: "#ff6577",
};

export default function StatCard({
  label,
  value,
  detail,
  tone = "primary",
  badge,
}) {
  const color = tones[tone] || tones.primary;

  return (
    <Paper sx={{ p: 2.5, height: "100%", position: "relative", overflow: "hidden" }}>
      <Box
        sx={{
          position: "absolute",
          inset: "0 auto 0 0",
          width: 3,
          bgcolor: color,
        }}
      />
      <Box display="flex" justifyContent="space-between" gap={1}>
        <Typography color="text.secondary" variant="body2" fontWeight={600}>
          {label}
        </Typography>
        {badge && (
          <Chip
            label={badge}
            size="small"
            sx={{ height: 22, color, bgcolor: `${color}14` }}
          />
        )}
      </Box>
      <Typography variant="h5" sx={{ mt: 1.4, fontVariantNumeric: "tabular-nums" }}>
        {value ?? "--"}
      </Typography>
      {detail && (
        <Typography variant="caption" color="text.secondary">
          {detail}
        </Typography>
      )}
    </Paper>
  );
}
