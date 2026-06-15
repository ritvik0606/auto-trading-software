import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";
import useMarketStream from "../hooks/useMarketStream";
import LiveFeedStatus from "../components/LiveFeedStatus";

const drawerWidth = 252;
const navigationGroups = [
  {
    label: "Workspace",
    items: [
      ["Dashboard", "/dashboard", "DB"],
      ["Multi Chart", "/multi-chart", "CH"],
      ["Daily P&L", "/daily-pnl", "DP"],
    ],
  },
  {
    label: "Markets",
    items: [
      ["Market Watch", "/market-watch", "MW"],
      ["Option Chain", "/option-chain", "OC"],
      ["Advanced Scanner", "/scanner", "SC"],
      ["Heatmap", "/heatmap", "HM"],
      ["Watchlist", "/watchlist", "WL"],
    ],
  },
  {
    label: "Trading",
    items: [
      ["Orders", "/orders", "OR"],
      ["Order Book", "/order-book", "OB"],
      ["Trade Book", "/trade-book", "TB"],
      ["Trade Journal", "/trade-journal", "TJ"],
      ["Positions", "/positions", "PS"],
      ["Strategies", "/strategies", "ST"],
      ["Strategy Builder", "/strategy-builder", "SB"],
      ["Strategy Generator", "/strategy-generator", "SG"],
      ["Multi Strategy", "/multi-strategy", "MS"],
      ["Auto Trading", "/auto-trading", "AT"],
      ["Trade Copier", "/trade-copier", "TC"],
    ],
  },
  {
    label: "Portfolio",
    items: [
      ["Portfolio", "/portfolio", "PF"],
      ["Holdings", "/holdings", "HD"],
      ["Funds", "/funds", "FD"],
      ["Portfolio Analytics", "/portfolio-analytics", "PA"],
      ["Portfolio Hedging", "/portfolio-hedging", "PH"],
    ],
  },
  {
    label: "Analytics",
    items: [
      ["Execution Analytics", "/execution-analytics", "EA"],
      ["Performance", "/performance", "PM"],
      ["AI Insights", "/ai-insights", "AI"],
      ["AI Strategy Generator", "/ai-strategy", "AG"],
      ["Backtesting Lab", "/backtesting-lab", "BT"],
      ["Risk Engine", "/risk-engine", "RE"],
      ["Risk Dashboard", "/risk", "RK"],
    ],
  },
  {
    label: "System",
    items: [
      ["Brokers", "/brokers", "BR"],
      ["Broker Failover", "/broker-failover", "BF"],
      ["Mobile Control", "/mobile", "MC"],
    ],
  },
];
const safeNavigationGroups = Array.isArray(navigationGroups)
  ? navigationGroups
  : [];
const navigation = safeNavigationGroups.flatMap((group) =>
  Array.isArray(group?.items) ? group.items : []
);

function Sidebar({ onNavigate }) {
  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: 2.5, py: 3 }}>
        <Box display="flex" alignItems="center" gap={1.4}>
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: 2.5,
              display: "grid",
              placeItems: "center",
              bgcolor: "primary.main",
              color: "#03120f",
              fontWeight: 900,
            }}
          >
            AX
          </Box>
          <Box>
            <Typography fontWeight={800} letterSpacing="-0.03em">
              Axiom Trade
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Paper execution console
            </Typography>
          </Box>
        </Box>
      </Box>
      <Divider />
      <List sx={{ px: 1.5, py: 2, flex: 1, overflowY: "auto" }}>
        {safeNavigationGroups.map((group) => (
          <Box key={group.label} mb={1.5}>
            <Typography
              variant="caption"
              color="text.secondary"
              fontWeight={800}
              letterSpacing="0.12em"
              sx={{ px: 1.5 }}
            >
              {group.label.toUpperCase()}
            </Typography>
            {(Array.isArray(group?.items) ? group.items : []).map(
              ([label = "Page", path = "/dashboard", marker = "--"]) => (
              <ListItemButton
                key={path}
                component={NavLink}
                to={path}
                onClick={onNavigate}
                sx={{
                  mt: 0.35,
                  borderRadius: 2,
                  color: "text.secondary",
                  "&.active": {
                    bgcolor: "rgba(77, 232, 194, 0.1)",
                    color: "primary.main",
                  },
                }}
              >
                <Box
                  sx={{
                    width: 30,
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.04em",
                  }}
                >
                  {marker}
                </Box>
                <ListItemText
                  primary={label}
                  primaryTypographyProps={{ fontSize: 13, fontWeight: 650 }}
                />
              </ListItemButton>
              )
            )}
          </Box>
        ))}
      </List>
      <Box sx={{ p: 2 }}>
        <Box
          sx={{
            p: 1.8,
            borderRadius: 2.5,
            bgcolor: "rgba(77, 232, 194, 0.07)",
            border: "1px solid rgba(77, 232, 194, 0.12)",
          }}
        >
          <Typography variant="caption" color="primary.main" fontWeight={800}>
            EXECUTION MODE
          </Typography>
          <Typography variant="body2" fontWeight={700} mt={0.5}>
            Paper trading only
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

export default function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const marketStream =
    useMarketStream(["NIFTY", "BANKNIFTY", "RELIANCE"]) || {};
  const pathname = location?.pathname || "/dashboard";
  const title =
    navigation.find((item) => pathname.startsWith(item?.[1] || ""))?.[0] ||
    "Dashboard";

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          ml: { md: `${drawerWidth}px` },
          width: { md: `calc(100% - ${drawerWidth}px)` },
          bgcolor: "rgba(7, 16, 29, 0.85)",
          backdropFilter: "blur(18px)",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Toolbar sx={{ gap: { xs: 1, sm: 2 } }}>
          <IconButton
            color="inherit"
            onClick={() => setMobileOpen(true)}
            sx={{ display: { md: "none" } }}
          >
            <Typography fontWeight={900} fontSize={12}>MENU</Typography>
          </IconButton>
          <Typography fontWeight={700} sx={{ flex: 1 }}>
            {title}
          </Typography>
          <Box sx={{ display: { xs: "none", sm: "block" } }}>
            <LiveFeedStatus
              connected={marketStream.connected}
              state={marketStream.status?.state || "DISCONNECTED"}
            />
          </Box>
          <Chip size="small" label="PAPER" color="primary" variant="outlined" />
          <Avatar
            sx={{
              width: 34,
              height: 34,
              bgcolor: "secondary.main",
              fontSize: 13,
              display: { xs: "none", sm: "flex" },
            }}
          >
            RT
          </Avatar>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: "block", md: "none" },
            "& .MuiDrawer-paper": { width: drawerWidth },
          }}
        >
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: "none", md: "block" },
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              bgcolor: "#091423",
            },
          }}
          open
        >
          <Sidebar />
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${drawerWidth}px)` },
          pt: 11,
          px: { xs: 2, sm: 3, lg: 4 },
          pb: 5,
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
