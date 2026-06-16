import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import api, { getDataSafe } from "../services/api";
import useApi from "../hooks/useApi";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import OfflineNotice from "../components/OfflineNotice";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import SectionCard from "../components/SectionCard";
import { dateTime } from "../utils/format";

const emptyFilters = {
  q: "",
  category: "",
  severity: "",
  dateFrom: "",
  dateTo: "",
};

function queryString(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  params.set("limit", "500");
  return params.toString();
}

export default function AuditTrailPage() {
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [exporting, setExporting] = useState(false);
  const [actionState, setActionState] = useState(null);
  const { data, loading, error, reload } = useApi(async () => {
    const result = await getDataSafe(
      `/api/audit-trail/search?${queryString(applied)}`,
      { records: [], total: 0 }
    );
    return {
      records: Array.isArray(result.data?.records) ? result.data.records : [],
      total: Number(result.data?.total || 0),
      unavailable: result.unavailable,
      partialError: result.error && !result.error.isUnavailable
        ? result.error.message
        : "",
    };
  }, [
    applied.q,
    applied.category,
    applied.severity,
    applied.dateFrom,
    applied.dateTo,
  ]);

  const update = (field) => (event) => {
    setFilters((current) => ({ ...current, [field]: event.target.value }));
  };

  const applyFilters = () => {
    setApplied({ ...filters });
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setApplied(emptyFilters);
  };

  const exportLogs = async () => {
    setExporting(true);
    setActionState(null);
    try {
      const response = await api.get(
        `/api/audit-trail/export?${queryString(applied)}`,
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setActionState({
        severity: "success",
        message: "Filtered audit trail exported",
      });
    } catch (exportError) {
      setActionState({
        severity: exportError.isUnavailable ? "warning" : "error",
        message: exportError.message,
      });
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <Loading label="Loading audit trail" />;

  const records = Array.isArray(data?.records) ? data.records : [];
  const severityCount = (severity) =>
    records.filter((record) => record.severity === severity).length;
  const columns = [
    { key: "createdAt", label: "Time", render: (row) => dateTime(row.createdAt) },
    {
      key: "severity",
      label: "Severity",
      render: (row) => (
        <Chip
          size="small"
          label={row.severity}
          color={
            row.severity === "ERROR"
              ? "error"
              : row.severity === "WARNING"
                ? "warning"
                : "info"
          }
          variant="outlined"
        />
      ),
    },
    { key: "category", label: "Category" },
    { key: "action", label: "Action" },
    {
      key: "entity",
      label: "Entity",
      render: (row) =>
        [row.entityType, row.entityId].filter(Boolean).join(" #") || "--",
    },
    { key: "actor", label: "Actor" },
    {
      key: "message",
      label: "Message",
      render: (row) => (
        <Typography variant="body2" sx={{ minWidth: 260 }}>
          {row.message}
        </Typography>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Phase 17"
        title="Audit Trail"
        description="Append-only operational history across orders, strategies, risk controls, brokers, settings, and emergency actions."
        action={
          <Button variant="outlined" disabled={exporting} onClick={exportLogs}>
            {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        }
      />
      <ErrorAlert message={error || data?.partialError} onRetry={reload} />
      {data?.unavailable && <OfflineNotice title="Audit trail unavailable" />}
      {actionState && (
        <Alert severity={actionState.severity} sx={{ mb: 3 }}>
          {actionState.message}
        </Alert>
      )}

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard label="Matching Records" value={data?.total || 0} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard label="Info" value={severityCount("INFO")} tone="primary" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Warnings"
            value={severityCount("WARNING")}
            tone="warning"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <StatCard
            label="Errors"
            value={severityCount("ERROR")}
            tone="error"
          />
        </Grid>

        <Grid size={{ xs: 12 }}>
          <SectionCard title="Filters" subtitle="Search messages, actions, IDs, and metadata">
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField
                  fullWidth
                  label="Search"
                  value={filters.q}
                  onChange={update("q")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyFilters();
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <TextField
                  select
                  fullWidth
                  label="Category"
                  value={filters.category}
                  onChange={update("category")}
                >
                  <MenuItem value="">All</MenuItem>
                  {["ORDER", "STRATEGY", "RISK", "BROKER", "KILL_SWITCH", "SETTINGS", "SYSTEM"].map(
                    (category) => (
                      <MenuItem key={category} value={category}>
                        {category}
                      </MenuItem>
                    )
                  )}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <TextField
                  select
                  fullWidth
                  label="Severity"
                  value={filters.severity}
                  onChange={update("severity")}
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="INFO">INFO</MenuItem>
                  <MenuItem value="WARNING">WARNING</MenuItem>
                  <MenuItem value="ERROR">ERROR</MenuItem>
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <TextField
                  fullWidth
                  type="date"
                  label="From"
                  value={filters.dateFrom}
                  onChange={update("dateFrom")}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <TextField
                  fullWidth
                  type="date"
                  label="To"
                  value={filters.dateTo}
                  onChange={update("dateTo")}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
            </Grid>
            <Box display="flex" gap={1.5} mt={2}>
              <Button variant="contained" onClick={applyFilters}>
                Apply Filters
              </Button>
              <Button variant="text" onClick={resetFilters}>
                Reset
              </Button>
            </Box>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <SectionCard title="Audit Records">
            <DataTable
              columns={columns}
              rows={records}
              emptyMessage="No audit records match these filters"
            />
          </SectionCard>
        </Grid>
      </Grid>
    </>
  );
}
