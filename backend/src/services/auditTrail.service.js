const pool = require("../config/db");

const SEVERITIES = new Set(["INFO", "WARNING", "ERROR"]);
const SENSITIVE_KEYS = new Set([
  "password",
  "pin",
  "totp",
  "totpsecret",
  "totp_secret",
  "apikey",
  "api_key",
  "secret",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "authorization",
]);
let schemaReady = null;

class AuditTrailError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "AuditTrailError";
    this.statusCode = statusCode;
  }
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS audit_trail (
          id BIGSERIAL PRIMARY KEY,
          category VARCHAR(50) NOT NULL,
          action VARCHAR(100) NOT NULL,
          severity VARCHAR(20) NOT NULL,
          entity_type VARCHAR(50),
          entity_id VARCHAR(100),
          actor VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
          message TEXT NOT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS audit_trail_created_at_idx
          ON audit_trail (created_at DESC);
        CREATE INDEX IF NOT EXISTS audit_trail_category_idx
          ON audit_trail (category);
        CREATE INDEX IF NOT EXISTS audit_trail_severity_idx
          ON audit_trail (severity);
        CREATE INDEX IF NOT EXISTS audit_trail_action_idx
          ON audit_trail (action);
      `)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}

function sanitize(value, key = "") {
  const normalizedKey = String(key).replace(/[^a-z0-9_]/gi, "").toLowerCase();
  if (SENSITIVE_KEYS.has(normalizedKey)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitize(childValue, childKey),
      ])
    );
  }
  return value;
}

function normalizeText(value, fallback, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maxLength);
}

async function recordAudit(event = {}) {
  await ensureSchema();
  const severity = normalizeText(event.severity, "INFO", 20).toUpperCase();
  if (!SEVERITIES.has(severity)) {
    throw new AuditTrailError(
      `severity must be one of: ${Array.from(SEVERITIES).join(", ")}`,
      400
    );
  }
  const result = await pool.query(
    `INSERT INTO audit_trail (
       category, action, severity, entity_type, entity_id,
       actor, message, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING *`,
    [
      normalizeText(event.category, "SYSTEM", 50).toUpperCase(),
      normalizeText(event.action, "EVENT", 100).toUpperCase(),
      severity,
      event.entityType
        ? normalizeText(event.entityType, null, 50).toUpperCase()
        : null,
      event.entityId === undefined || event.entityId === null
        ? null
        : String(event.entityId).slice(0, 100),
      normalizeText(event.actor, "SYSTEM", 100),
      normalizeText(event.message, "Audit event recorded", 5000),
      JSON.stringify(sanitize(event.metadata || {})),
    ]
  );
  return mapRow(result.rows[0]);
}

async function safeRecordAudit(event) {
  try {
    return await recordAudit(event);
  } catch (error) {
    console.error("Audit trail write failed", {
      category: event?.category,
      action: event?.action,
      message: error.message,
    });
    return null;
  }
}

function parseDate(value, fieldName, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AuditTrailError(`${fieldName} must be a valid date`, 400);
  }
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

function parseInteger(value, fallback, maximum) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new AuditTrailError("Pagination values must be non-negative integers", 400);
  }
  return Math.min(number, maximum);
}

function buildFilters(input = {}, { exportMode = false } = {}) {
  const severity = input.severity
    ? String(input.severity).trim().toUpperCase()
    : null;
  if (severity && !SEVERITIES.has(severity)) {
    throw new AuditTrailError(
      `severity must be one of: ${Array.from(SEVERITIES).join(", ")}`,
      400
    );
  }
  const dateFrom = parseDate(input.dateFrom, "dateFrom");
  const dateTo = parseDate(input.dateTo, "dateTo", true);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new AuditTrailError("dateFrom must not be after dateTo", 400);
  }
  return {
    q: normalizeText(input.q, "", 200),
    category: input.category
      ? normalizeText(input.category, "", 50).toUpperCase()
      : null,
    action: input.action
      ? normalizeText(input.action, "", 100).toUpperCase()
      : null,
    severity,
    entityType: input.entityType
      ? normalizeText(input.entityType, "", 50).toUpperCase()
      : null,
    dateFrom,
    dateTo,
    limit: parseInteger(input.limit, exportMode ? 10000 : 100, exportMode ? 50000 : 1000),
    offset: exportMode ? 0 : parseInteger(input.offset, 0, 1000000),
  };
}

function buildWhere(filters) {
  const clauses = [];
  const values = [];
  const add = (clause, value) => {
    values.push(value);
    clauses.push(clause.replace("?", `$${values.length}`));
  };
  if (filters.q) {
    add(
      `(message ILIKE ? OR action ILIKE $${values.length + 1}
        OR category ILIKE $${values.length + 1}
        OR entity_id ILIKE $${values.length + 1}
        OR metadata::text ILIKE $${values.length + 1})`,
      `%${filters.q}%`
    );
  }
  if (filters.category) add("category = ?", filters.category);
  if (filters.action) add("action = ?", filters.action);
  if (filters.severity) add("severity = ?", filters.severity);
  if (filters.entityType) add("entity_type = ?", filters.entityType);
  if (filters.dateFrom) add("created_at >= ?", filters.dateFrom);
  if (filters.dateTo) add("created_at <= ?", filters.dateTo);
  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

function mapRow(row) {
  return {
    id: Number(row.id),
    category: row.category,
    action: row.action,
    severity: row.severity,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actor: row.actor,
    message: row.message,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

async function getAuditLogs(input = {}, options = {}) {
  await ensureSchema();
  const filters = buildFilters(input, options);
  const where = buildWhere(filters);
  const values = [...where.values, filters.limit, filters.offset];
  const limitIndex = where.values.length + 1;
  const offsetIndex = where.values.length + 2;
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT *
       FROM audit_trail
       ${where.sql}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      values
    ),
    pool.query(
      `SELECT COUNT(*) AS count
       FROM audit_trail
       ${where.sql}`,
      where.values
    ),
  ]);
  return {
    records: rows.rows.map(mapRow),
    total: Number(count.rows[0].count),
    limit: filters.limit,
    offset: filters.offset,
  };
}

function csvCell(value) {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportAuditLogs(input = {}) {
  const result = await getAuditLogs(input, { exportMode: true });
  const headers = [
    "id",
    "createdAt",
    "severity",
    "category",
    "action",
    "entityType",
    "entityId",
    "actor",
    "message",
    "metadata",
  ];
  const lines = [
    headers.map(csvCell).join(","),
    ...result.records.map((record) =>
      headers.map((header) => csvCell(record[header])).join(",")
    ),
  ];
  return lines.join("\r\n");
}

module.exports = {
  AuditTrailError,
  ensureSchema,
  sanitize,
  recordAudit,
  safeRecordAudit,
  getAuditLogs,
  exportAuditLogs,
};
