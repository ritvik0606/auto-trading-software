import { Box, Typography } from "@mui/material";

export default function PageHeader({ eyebrow, title, description, action }) {
  return (
    <Box
      display="flex"
      alignItems={{ xs: "flex-start", sm: "center" }}
      justifyContent="space-between"
      flexDirection={{ xs: "column", sm: "row" }}
      gap={2}
      mb={3}
    >
      <Box>
        {eyebrow && (
          <Typography
            color="primary.main"
            variant="overline"
            fontWeight={800}
            letterSpacing="0.14em"
          >
            {eyebrow}
          </Typography>
        )}
        <Typography variant="h4">{title}</Typography>
        {description && (
          <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 680 }}>
            {description}
          </Typography>
        )}
      </Box>
      {action}
    </Box>
  );
}
