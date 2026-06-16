const service = require("../services/auditTrail.service");

function sendError(res, error) {
  console.error("Audit trail request failed", { message: error.message });
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Audit trail request failed",
  });
}

async function sendLogs(req, res) {
  try {
    res.json({ success: true, data: await service.getAuditLogs(req.query) });
  } catch (error) {
    sendError(res, error);
  }
}

exports.logs = sendLogs;
exports.search = sendLogs;

exports.export = async (req, res) => {
  try {
    const csv = await service.exportAuditLogs(req.query);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-trail-${date}.csv"`
    );
    res.send(csv);
  } catch (error) {
    sendError(res, error);
  }
};
