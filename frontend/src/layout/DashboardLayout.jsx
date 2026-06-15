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

const drawerWidth = 252;
const navigation = [
  ["Dashboard", "/dashboard", "DB"],
  ["Portfolio", "/portfolio", "PF"],
  ["Positions", "/positions", "PS"],
  ["Orders", "/orders", "OR"],
  ["Strategies", "/strategies", "ST"],
  ["Watchlist", "/watchlist", "WL"],
  ["Risk Dashboard", "/risk", "RK"],
  ["Performance", "/performance", "PM"],
  ["AI Insights", "/ai-insights", "AI"],
  ["Mobile Control", "/mobile", "MC"],
];

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
      <List sx={{ px: 1.5, py: 2, flex: 1 }}>
        {navigation.map(([label, path, marker]) => (
          <ListItemButton
            key={path}
            component={NavLink}
            to={path}
            onClick={onNavigate}
            sx={{
              mb: 0.5,
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
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.04em",
              }}
            >
              {marker}
            </Box>
            <ListItemText
              primary={label}
              primaryTypographyProps={{ fontSize: 14, fontWeight: 650 }}
            />
          </ListItemButton>
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
  const title =
    navigation.find((item) => location.pathname.startsWith(item[1]))?.[0] ||
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
        <Toolbar sx={{ gap: 2 }}>
          <IconButton
            color="inherit"
            onClick={() => setMobileOpen(true)}
            sx={{ display: { md: "none" } }}
          >
            <Typography fontWeight={900}>MENU</Typography>
          </IconButton>
          <Typography fontWeight={700} sx={{ flex: 1 }}>
            {title}
          </Typography>
          <Chip
            size="small"
            label="System online"
            color="success"
            variant="outlined"
            sx={{ display: { xs: "none", sm: "flex" } }}
          />
          <Avatar sx={{ width: 34, height: 34, bgcolor: "secondary.main", fontSize: 13 }}>
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
