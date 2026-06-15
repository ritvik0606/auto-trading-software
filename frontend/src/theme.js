import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#4de8c2" },
    secondary: { main: "#8b7cff" },
    success: { main: "#35d38a" },
    error: { main: "#ff6577" },
    warning: { main: "#ffbd59" },
    background: {
      default: "#07101d",
      paper: "#0d1929",
    },
    text: {
      primary: "#edf4ff",
      secondary: "#8fa3bb",
    },
    divider: "rgba(143, 163, 187, 0.14)",
  },
  typography: {
    fontFamily: '"Inter", "Segoe UI", sans-serif',
    h4: { fontWeight: 750, letterSpacing: "-0.04em" },
    h5: { fontWeight: 700, letterSpacing: "-0.025em" },
    h6: { fontWeight: 700 },
    button: { fontWeight: 700, textTransform: "none" },
  },
  shape: { borderRadius: 14 },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          border: "1px solid rgba(143, 163, 187, 0.12)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 10, boxShadow: "none" },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: "rgba(143, 163, 187, 0.1)" },
        head: {
          color: "#8fa3bb",
          fontWeight: 700,
          fontSize: "0.72rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        },
      },
    },
  },
});

export default theme;
