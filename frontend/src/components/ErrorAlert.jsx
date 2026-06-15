import { Alert, Button } from "@mui/material";

export default function ErrorAlert({ message, onRetry }) {
  if (!message) return null;

  return (
    <Alert
      severity="error"
      action={
        onRetry ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            Retry
          </Button>
        ) : null
      }
      sx={{ mb: 3 }}
    >
      {message}
    </Alert>
  );
}
