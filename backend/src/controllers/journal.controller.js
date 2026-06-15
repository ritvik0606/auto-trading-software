const {
  getJournalEntries,
  getJournalById,
  updateJournalNote,
  getJournalStats,
} = require("../services/journal.service");

function sendJournalError(res, error) {
  console.error("Journal request failed", {
    message: error.message,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Journal request failed",
  });
}

exports.all = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getJournalEntries(),
    });
  } catch (error) {
    sendJournalError(res, error);
  }
};

exports.getById = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getJournalById(req.params.id),
    });
  } catch (error) {
    sendJournalError(res, error);
  }
};

exports.note = async (req, res) => {
  try {
    const entry = await updateJournalNote(req.params.id, req.body.notes);

    res.json({
      success: true,
      message: "Journal note updated",
      data: entry,
    });
  } catch (error) {
    sendJournalError(res, error);
  }
};

exports.stats = async (req, res) => {
  try {
    res.json(await getJournalStats());
  } catch (error) {
    sendJournalError(res, error);
  }
};
