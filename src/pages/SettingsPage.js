import React from 'react';

export default function SettingsPage({ appSettings }) {
  return (
    <div className="settings-page">
      <h2>Application Settings</h2>
      <p>Default currency: {appSettings.defaultCurrency}</p>
    </div>
  );
}
