import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

export default function DataTable({
  columns,
  rows = [],
  emptyMessage = "No records available",
  getRowId,
}) {
  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell key={column.key} align={column.align || "left"}>
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} align="center">
                <Typography color="text.secondary" sx={{ py: 5 }}>
                  {emptyMessage}
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, index) => (
              <TableRow hover key={getRowId ? getRowId(row) : row.id ?? index}>
                {columns.map((column) => (
                  <TableCell key={column.key} align={column.align || "left"}>
                    {column.render ? column.render(row) : row[column.key] ?? "--"}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
