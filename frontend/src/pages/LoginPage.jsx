import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Paper,
  TextField,
  Typography,
} from "@mui/material";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event) => {
    event.preventDefault();
    if (email && password) navigate("/dashboard");
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "1.15fr 0.85fr" },
      }}
    >
      <Box
        sx={{
          display: { xs: "none", md: "flex" },
          p: 8,
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "linear-gradient(145deg, rgba(77,232,194,.13), rgba(139,124,255,.08))",
        }}
      >
        <Typography fontWeight={900} fontSize={22}>
          AXIOM TRADE
        </Typography>
        <Box maxWidth={620}>
          <Typography variant="h2" fontWeight={800} letterSpacing="-0.06em">
            Trade with clarity.
          </Typography>
          <Typography variant="h5" color="text.secondary" mt={2} lineHeight={1.5}>
            One command center for paper strategies, risk, performance, and
            portfolio intelligence.
          </Typography>
        </Box>
        <Typography color="text.secondary">
          Secure paper execution environment
        </Typography>
      </Box>
      <Box display="grid" placeItems="center" p={3}>
        <Paper component="form" onSubmit={submit} sx={{ width: "100%", maxWidth: 430, p: 4 }}>
          <Typography color="primary.main" fontWeight={800} variant="overline">
            Operator access
          </Typography>
          <Typography variant="h4" mt={0.5}>
            Welcome back
          </Typography>
          <Typography color="text.secondary" mt={1} mb={4}>
            Sign in to open your trading console.
          </Typography>
          <TextField
            label="Email"
            type="email"
            fullWidth
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            sx={{ mb: 2 }}
            required
          />
          <TextField
            label="Password"
            type="password"
            fullWidth
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            sx={{ mb: 3 }}
            required
          />
          <Button type="submit" variant="contained" size="large" fullWidth>
            Enter dashboard
          </Button>
          <Typography variant="caption" color="text.secondary" display="block" mt={2}>
            UI foundation login only. Connect your authentication provider in a later phase.
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}
