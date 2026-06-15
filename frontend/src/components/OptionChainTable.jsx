import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { money, number } from "../utils/format";

const ceColumns = [
  ["ceOi", "OI"],
  ["ceVolume", "Volume"],
  ["ceIv", "IV"],
  ["ceDelta", "Delta"],
  ["ceGamma", "Gamma"],
  ["ceTheta", "Theta"],
  ["ceVega", "Vega"],
  ["ceLtp", "LTP"],
];

const peColumns = [
  ["peLtp", "LTP"],
  ["peVega", "Vega"],
  ["peTheta", "Theta"],
  ["peGamma", "Gamma"],
  ["peDelta", "Delta"],
  ["peIv", "IV"],
  ["peVolume", "Volume"],
  ["peOi", "OI"],
];

function formatValue(key, value) {
  if (value == null) return "--";
  if (key.endsWith("Ltp")) return money(value);
  if (key.endsWith("Oi") || key.endsWith("Volume")) return number(value, 0);
  return number(value, 4);
}

export default function OptionChainTable({
  rows = [],
  atmStrike = 0,
  emptyMessage = "Option Chain Data Unavailable",
}) {
  const safeRows = Array.isArray(rows)
    ? rows.filter((row) => row && typeof row === "object")
    : [];

  return (
    <TableContainer
      component={Paper}
      sx={{ maxHeight: 600, borderColor: "divider" }}
    >
      <Table stickyHeader size="small" sx={{ minWidth: 1540 }}>
        <TableHead>
          <TableRow>
            <TableCell
              align="center"
              colSpan={ceColumns.length}
              sx={{
                color: "success.main",
                bgcolor: "#0b1b22",
                fontSize: 13,
              }}
            >
              CALLS (CE)
            </TableCell>
            <TableCell
              rowSpan={2}
              align="center"
              sx={{
                minWidth: 110,
                bgcolor: "#152236",
                color: "primary.main",
                zIndex: 4,
              }}
            >
              Strike
            </TableCell>
            <TableCell
              align="center"
              colSpan={peColumns.length}
              sx={{
                color: "error.main",
                bgcolor: "#20151f",
                fontSize: 13,
              }}
            >
              PUTS (PE)
            </TableCell>
          </TableRow>
          <TableRow>
            {ceColumns.map(([key, label]) => (
              <TableCell
                key={key}
                align="right"
                sx={{ bgcolor: "#0b1b22" }}
              >
                {label}
              </TableCell>
            ))}
            {peColumns.map(([key, label]) => (
              <TableCell
                key={key}
                align="right"
                sx={{ bgcolor: "#20151f" }}
              >
                {label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {safeRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={17}>
                <Box textAlign="center" py={7}>
                  <Typography fontWeight={800}>
                    Option Chain Data Unavailable
                  </Typography>
                  <Typography
                    color="text.secondary"
                    variant="body2"
                    mt={0.75}
                  >
                    {emptyMessage}
                  </Typography>
                </Box>
              </TableCell>
            </TableRow>
          ) : (
            safeRows.map((row, index) => {
              const strike = Number(row.strike ?? 0);
              const isAtm = strike > 0 && strike === Number(atmStrike || 0);
              return (
                <TableRow
                  hover
                  key={`${row.expiry || "expiry"}-${strike || index}`}
                  sx={{
                    bgcolor: isAtm
                      ? "rgba(77, 232, 194, 0.06)"
                      : "transparent",
                  }}
                >
                  {ceColumns.map(([key]) => (
                    <TableCell key={key} align="right">
                      {formatValue(key, row[key])}
                    </TableCell>
                  ))}
                  <TableCell
                    align="center"
                    sx={{
                      bgcolor: isAtm ? "#173331" : "#152236",
                      color: isAtm ? "primary.main" : "text.primary",
                      fontWeight: 900,
                    }}
                  >
                    {strike > 0 ? number(strike, 0) : "--"}
                  </TableCell>
                  {peColumns.map(([key]) => (
                    <TableCell key={key} align="right">
                      {formatValue(key, row[key])}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
