import { Component } from "react";
import { Alert, Box, Button, Typography } from "@mui/material";

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Frontend render failed", {
      message: error?.message,
      componentStack: info?.componentStack,
    });
  }

  reset = () => {
    this.setState({ error: null });
    window.location.assign("/dashboard");
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          p: 3,
        }}
      >
        <Alert severity="warning" variant="outlined" sx={{ maxWidth: 560 }}>
          <Typography variant="h6">Workspace temporarily unavailable</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75, mb: 2 }}>
            A page failed to render. Paper trading remains active and no order
            was placed.
          </Typography>
          <Button variant="contained" onClick={this.reset}>
            Return to dashboard
          </Button>
        </Alert>
      </Box>
    );
  }
}
