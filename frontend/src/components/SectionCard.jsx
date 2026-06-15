import { Box, Paper, Typography } from "@mui/material";

export default function SectionCard({ title, subtitle, action, children, sx }) {
  return (
    <Paper sx={{ p: { xs: 2, md: 2.5 }, ...sx }}>
      {(title || action) && (
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          flexDirection={{ xs: "column", sm: "row" }}
          gap={1.5}
          mb={2}
        >
          <Box>
            <Typography variant="h6">{title}</Typography>
            {subtitle && (
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          {action}
        </Box>
      )}
      {children}
    </Paper>
  );
}
