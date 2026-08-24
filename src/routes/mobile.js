const express = require('express');

const router = express.Router();

const defaultMobileSettings = {
  enabledModules: ['dashboard', 'attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking'],
  allowClockIn: true,
  allowClockOut: true,
  requireClockInPhoto: false,
  requireLocationOnClock: true,
  autoSendLocationOnClock: true,
  autoStartTrackingOnClockIn: true,
  allowLoanView: true,
  allowLoanRequest: true,
  allowLeaveView: true,
  allowLeaveRequest: true,
  allowTrackingView: true,
};

function getSettingsCollection(db) {
  return db.collection('appSettings');
}

function normalizeMobileSettings(payload) {
  const source = payload || {};
  return {
    enabledModules: Array.isArray(source.enabledModules)
      ? source.enabledModules.map((value) => String(value || '').trim()).filter(Boolean)
      : defaultMobileSettings.enabledModules,
    allowClockIn: source.allowClockIn === undefined ? defaultMobileSettings.allowClockIn : Boolean(source.allowClockIn),
    allowClockOut: source.allowClockOut === undefined ? defaultMobileSettings.allowClockOut : Boolean(source.allowClockOut),
    requireClockInPhoto:
      source.requireClockInPhoto === undefined
        ? defaultMobileSettings.requireClockInPhoto
        : Boolean(source.requireClockInPhoto),
    requireLocationOnClock:
      source.requireLocationOnClock === undefined
        ? defaultMobileSettings.requireLocationOnClock
        : Boolean(source.requireLocationOnClock),
    autoSendLocationOnClock:
      source.autoSendLocationOnClock === undefined
        ? defaultMobileSettings.autoSendLocationOnClock
        : Boolean(source.autoSendLocationOnClock),
    autoStartTrackingOnClockIn:
      source.autoStartTrackingOnClockIn === undefined
        ? defaultMobileSettings.autoStartTrackingOnClockIn
        : Boolean(source.autoStartTrackingOnClockIn),
    allowLoanView: source.allowLoanView === undefined ? defaultMobileSettings.allowLoanView : Boolean(source.allowLoanView),
    allowLoanRequest:
      source.allowLoanRequest === undefined ? defaultMobileSettings.allowLoanRequest : Boolean(source.allowLoanRequest),
    allowLeaveView: source.allowLeaveView === undefined ? defaultMobileSettings.allowLeaveView : Boolean(source.allowLeaveView),
    allowLeaveRequest:
      source.allowLeaveRequest === undefined ? defaultMobileSettings.allowLeaveRequest : Boolean(source.allowLeaveRequest),
    allowTrackingView:
      source.allowTrackingView === undefined ? defaultMobileSettings.allowTrackingView : Boolean(source.allowTrackingView),
  };
}

router.get('/settings', async (req, res) => {
  try {
    const collection = getSettingsCollection(req.db);
    const record = await collection.findOne({ _id: 'mobile-app' });
    const settings = normalizeMobileSettings(record?.value);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load mobile settings' });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const settings = normalizeMobileSettings(req.body);
    await getSettingsCollection(req.db).updateOne(
      { _id: 'mobile-app' },
      {
        $set: {
          value: settings,
          updatedAt: new Date().toISOString(),
        },
        $setOnInsert: {
          createdAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save mobile settings' });
  }
});

module.exports = router;
