const exportManualPdf = () => {
  const manualContent = document.getElementById('system-manual-content');
  if (!manualContent) {
    return;
  }
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    return;
  }
  const generatedAt = new Date().toLocaleString();
  printWindow.document.write(`
    <html>
      <head>
        <title>PTHR System Manual</title>
        <style>
          body { font-family: Segoe UI, Arial, sans-serif; padding: 18px; color: #1f3670; }
          h1 { margin: 0 0 4px; font-size: 24px; }
          h2 { margin: 18px 0 8px; font-size: 18px; border-bottom: 1px solid #dce7fb; padding-bottom: 4px; }
          h3 { margin: 14px 0 6px; font-size: 15px; color: #294987; }
          p { margin: 0 0 8px; color: #3e578a; line-height: 1.45; }
          ul { margin: 6px 0 10px 18px; padding: 0; }
          li { margin: 4px 0; line-height: 1.4; color: #355185; }
          table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; }
          th, td { border: 1px solid #d7e3f9; text-align: left; padding: 8px; font-size: 12px; vertical-align: top; }
          th { background: #f5f9ff; }
          .manual-export-actions { display: none !important; }
          .manual-shot-placeholder { border: 1px dashed #9ab6ef; padding: 10px; border-radius: 8px; text-align: center; margin-bottom: 8px; }
        </style>
      </head>
      <body>
        <h1>PTHR System Manual</h1>
        <p>Generated: ${generatedAt}</p>
        ${manualContent.innerHTML}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
};

export default function ManualPage() {
  return (
    <div className="manual-page" id="system-manual-content">
      <div className="manual-hero">
        <div>
          <h3>System Manual</h3>
          <p>
            Complete guide for Admin and Mobile usage, including clocking rules, lateness calculation, early clock-out,
            payroll penalties, overtime, penalty clearance, and monitoring/tracking details.
          </p>
        </div>
        <div className="manual-export-actions">
          <button type="button" className="primary-btn" onClick={exportManualPdf}>
            Export Manual PDF
          </button>
        </div>
      </div>

      <section className="manual-section">
        <h4>1. Core Navigation</h4>
        <ul>
          <li>Use the left menu to open Employee, Attendance, Leave, Loan, Payroll, Tracking, Settings, and Manual.</li>
          <li>Use the top search and filter controls on each module to narrow records before actions.</li>
          <li>Click a table row to open details; edit/delete actions are available in the row action buttons.</li>
        </ul>
      </section>

      <section className="manual-section">
        <h4>2. Attendance & Shift Rules</h4>
        <ul>
          <li>Each employee is assigned to a shift in Attendance → Shift Assignment.</li>
          <li>Shift rules come from Settings → Attendance Rules → Shift Templates.</li>
          <li>
            Lateness formula: <strong>Minutes Late = Clock In - (Shift Report Time + Grace In Minutes)</strong>, minimum 0.
          </li>
          <li>Example: Morning 08:00 + 15 min grace means 08:16+ is Late; 08:20 becomes 5 minutes late.</li>
          <li>
            Early clock-out is evaluated against shift end; if before end time, the day can show <strong>Left Early</strong>{' '}
            in compliance.
          </li>
        </ul>
      </section>

      <section className="manual-section">
        <h4>3. Payroll Penalty and Overtime Logic</h4>
        <ul>
          <li>Late minutes recorded in attendance are consumed automatically by payroll calculations.</li>
          <li>Deduction mode can be automatic or fixed per minute based on settings scope.</li>
          <li>No clock-in, no clock-out, and absent penalties are calculated from daily compliance rules.</li>
          <li>Overtime is shift-specific using toggle, start-after minutes, and pay-per-minute fields.</li>
          <li>Payroll table and details include overtime minutes, overtime earnings, total earnings, and net payable.</li>
        </ul>
      </section>

      <section className="manual-section">
        <h4>4. Penalty Clearance (Late Comers)</h4>
        <ul>
          <li>Open Attendance → Penalty Clearance tab.</li>
          <li>The table fetches penalty rows for the selected date and shows outstanding/cleared amounts.</li>
          <li>Late-comer penalties appear under lateness entries with amount and outstanding balance.</li>
          <li>
            Open a penalty row and use <strong>Partial</strong> or <strong>Full</strong> clearance mode.
          </li>
          <li>Saved clearance entries update ledger history and reduce outstanding penalties immediately.</li>
        </ul>
      </section>

      <section className="manual-section">
        <h4>5. Mobile App Path</h4>
        <ul>
          <li>Login as employee and open Attendance card.</li>
          <li>Clock In captures time and location, then syncs to attendance-time records.</li>
          <li>If auto-start tracking is enabled in Settings → Mobile App, tracking starts on clock-in.</li>
          <li>Clock Out finalizes worked duration and daily status.</li>
          <li>Loan and Leave cards allow employee request submission with toast confirmations.</li>
        </ul>
      </section>

      <section className="manual-section">
        <h4>6. Monitoring & Tracking (Detailed)</h4>
        <p>
          This section explains every visible block in Monitoring & Tracking, how it is derived, and how often it
          refreshes.
        </p>
        <h5>Live Data Fetch Frequency</h5>
        <ul>
          <li>Employee tracking list refresh: every 3 seconds.</li>
          <li>WhatsApp alerts refresh: every 3 seconds (loaded together with employee tracking).</li>
          <li>Movement trail for selected employee: every 3 seconds.</li>
          <li>Reverse-geocode address: fetched when selected employee coordinates change.</li>
          <li>Movement detail modal trail list limit: latest 80 points.</li>
        </ul>
        <h5>Main Page Components</h5>
        <table className="manual-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>What It Shows</th>
              <th>How It Is Derived</th>
              <th>Refresh</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Legend</td>
              <td>Inside / Outside / Offline color meaning</td>
              <td>Status color map from each employee tracking status</td>
              <td>Static labels; statuses refresh every 3s</td>
            </tr>
            <tr>
              <td>Live Summary</td>
              <td>Selected employee, movement count, alert summary</td>
              <td>Selected row + trail length + alerts array</td>
              <td>Every 3s</td>
            </tr>
            <tr>
              <td>Employee Table</td>
              <td>Employee, status, distance, last seen, WiFi, flags</td>
              <td>Tracking API response fields and policy flags</td>
              <td>Every 3s</td>
            </tr>
            <tr>
              <td>Live Map View</td>
              <td>Employee markers + selected movement path</td>
              <td>Lat/lng normalized into map bounds; path from movement trail</td>
              <td>Every 3s</td>
            </tr>
            <tr>
              <td>Full Map Modal</td>
              <td>Bigger map + route playback</td>
              <td>Trail points replayed index-by-index for visual route progression</td>
              <td>Playback tick 650ms; source data every 3s</td>
            </tr>
          </tbody>
        </table>
        <h5>Detail Modal Components</h5>
        <table className="manual-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Definition</th>
              <th>Source / Formula</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Last Seen</td>
              <td>Most recent telemetry timestamp</td>
              <td>Tracking employee object `lastSeen`</td>
            </tr>
            <tr>
              <td>Coordinates</td>
              <td>Current latitude/longitude</td>
              <td>Tracking employee `lat` and `lng`</td>
            </tr>
            <tr>
              <td>Resolved Address</td>
              <td>Human-readable location text</td>
              <td>Reverse geocode API on selected coordinates</td>
            </tr>
            <tr>
              <td>Movement Trail Table</td>
              <td>Recent movement points with map links</td>
              <td>Movement endpoint for selected employee, up to 80 records</td>
            </tr>
            <tr>
              <td>Accuracy</td>
              <td>GPS accuracy in meters</td>
              <td>Movement point accuracy from mobile location payload</td>
            </tr>
          </tbody>
        </table>
        <h5>Flags Interpretation</h5>
        <ul>
          <li>
            <strong>OUTSIDE PREMISES:</strong> Device outside geofence radius from office lat/lng.
          </li>
          <li>
            <strong>OFFLINE:</strong> No recent movement update inside configured offline threshold.
          </li>
          <li>
            <strong>WiFi Mismatch:</strong> Connected WiFi does not match approved SSID/BSSID policy.
          </li>
          <li>
            <strong>GPS Suspicious:</strong> Anti-spoofing heuristics detect potential mocked coordinates.
          </li>
        </ul>
      </section>

      <section className="manual-section">
        <h4>7. Screenshot & Arrow Guide</h4>
        <div className="manual-media-grid">
          <article className="manual-shot">
            <div className="manual-shot-placeholder">Add Admin Screenshot Here</div>
            <ul>
              <li>➡ Filter bar: select department/status/date.</li>
              <li>➡ Table row: click to open details.</li>
              <li>➡ Action button: Add/Edit/Delete/Approve.</li>
            </ul>
          </article>
          <article className="manual-shot">
            <div className="manual-shot-placeholder">Add Mobile Screenshot Here</div>
            <ul>
              <li>➡ Clock In / Clock Out buttons on Attendance card.</li>
              <li>➡ Refresh button to sync latest state.</li>
              <li>➡ Tracking card to start/stop/send location.</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="manual-section">
        <h4>8. Operations Checklist</h4>
        <ul>
          <li>Create department and shift templates first.</li>
          <li>Assign shifts to employees before attendance processing.</li>
          <li>Confirm attendance status and late minutes daily in compliance tab.</li>
          <li>Clear justified penalties in penalty clearance tab.</li>
          <li>Run payroll after attendance and penalty data are finalized.</li>
        </ul>
      </section>
    </div>
  );
}
