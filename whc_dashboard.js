// ==UserScript==
// @name         Amazon Logistics - WHC Dashboard
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Working Hour Compliance für DAs mit dynamischer Fahrerliste
// @match        https://logistics.amazon.de/*
// @grant        GM_addStyle
// @connect      logistics.amazon.de
// ==/UserScript==

(function () {
  "use strict";

  // ============ KONFIGURATION ============
  const API_URL =
    "https://logistics.amazon.de/scheduling/home/api/v2/associate-attributes";
  const SERVICE_AREA_ID = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
  const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

  let nameMap = {};
  let associates = [];
  let lastQueryResult = null;
  let lastQueryMode = null;

  // ============ STYLES ============
  GM_addStyle(`
    #az-wz-btn {
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      background: #232f3e; color: #ff9900; border: 2px solid #ff9900;
      padding: 10px 18px; border-radius: 8px; cursor: pointer;
      font-weight: bold; font-size: 14px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    }
    #az-wz-btn:hover { background: #ff9900; color: #232f3e; }

    #az-wz-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.6); z-index: 100000; display: none;
      justify-content: center; align-items: flex-start; padding-top: 40px;
    }
    #az-wz-overlay.visible { display: flex; }

    #az-wz-panel {
      background: #fff; border-radius: 10px; padding: 24px;
      max-width: 95vw; max-height: 90vh; overflow: auto;
      box-shadow: 0 4px 30px rgba(0,0,0,0.4); min-width: 600px;
    }
    #az-wz-panel h2 { margin: 0 0 16px; color: #232f3e; }

    .az-controls {
      display: flex; gap: 10px; align-items: center;
      flex-wrap: wrap; margin-bottom: 16px;
    }
    .az-controls input, .az-controls select, .az-controls button {
      padding: 8px 12px; border-radius: 5px; border: 1px solid #ccc;
      font-size: 13px;
    }
    .az-controls button {
      background: #ff9900; color: #232f3e; font-weight: bold;
      cursor: pointer; border: none;
    }
    .az-controls button:hover { background: #e88b00; }
    .az-controls button.close {
      background: #cc0000; color: #fff; margin-left: auto;
    }

    #az-wz-status {
      padding: 8px; margin-bottom: 10px; font-style: italic; color: #555;
    }

    #az-wz-table {
      width: 100%; border-collapse: collapse; font-size: 12px;
    }
    #az-wz-table th, #az-wz-table td {
      border: 1px solid #ddd; padding: 6px 8px; text-align: center;
      white-space: nowrap;
    }
    #az-wz-table th {
      background: #232f3e; color: #ff9900; position: sticky; top: 0;
    }
    #az-wz-table tr:nth-child(even) { background: #f9f9f9; }
    #az-wz-table tr:hover { background: #fff3d6; }

    .az-ok { color: #0a7; font-weight: bold; }
    .az-warn { color: #e67e00; font-weight: bold; }
    .az-danger { color: #cc0000; font-weight: bold; }
    .az-breach { background: #ffe0e0 !important; }
    .az-nodata { color: #aaa; }
  `);

  // ============ HILFSFUNKTIONEN ============
  function minsToHM(mins) {
    if (mins === null || mins === undefined || mins === 0) return "-";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m.toString().padStart(2, "0")}m`;
  }

  function minsClass(mins) {
    if (!mins || mins === 0) return "az-nodata";
    if (mins > 600) return "az-danger";
    if (mins > 540) return "az-warn";
    return "az-ok";
  }

  function getMonday(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().split("T")[0];
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().split("T")[0];
  }

  function getCSRFToken() {
    const meta = document.querySelector(
      'meta[name="anti-csrftoken-a2z"]'
    );
    if (meta) return meta.getAttribute("content");
    const cookies = document.cookie.split(";");
    for (const c of cookies) {
      const [k, v] = c.trim().split("=");
      if (k === "anti-csrftoken-a2z") return v;
    }
    return null;
  }

  function resolveName(id) {
    return nameMap[id] || id;
  }

  // ============ API CALLS ============
  async function fetchNames(fromDate, toDate) {
    const url =
      `https://logistics.amazon.de/scheduling/home/api/v2/rosters` +
      `?fromDate=${fromDate}` +
      `&serviceAreaId=${SERVICE_AREA_ID}` +
      `&toDate=${toDate || fromDate}`;

    const csrf = getCSRFToken();
    const headers = { Accept: "application/json" };
    if (csrf) headers["anti-csrftoken-a2z"] = csrf;

    const resp = await fetch(url, {
      method: "GET",
      headers: headers,
      credentials: "include",
    });

    if (!resp.ok)
      throw new Error(`Roster API Fehler ${resp.status}`);
    const json = await resp.json();

    const roster = Array.isArray(json)
      ? json
      : json?.data || json?.rosters || [];

    const ids = new Set();

    const processEntries = (entries) => {
      for (const entry of entries) {
        if (entry.driverPersonId) {
          ids.add(entry.driverPersonId);
          if (entry.driverName) {
            nameMap[entry.driverPersonId] = entry.driverName;
          }
        }
      }
    };

    if (Array.isArray(roster)) {
      processEntries(roster);
    } else if (typeof roster === "object") {
      for (const val of Object.values(roster)) {
        if (Array.isArray(val)) processEntries(val);
      }
    }

    associates = [...ids];
    console.log(
      `📊 ${associates.length} Fahrer gefunden, ` +
        `${Object.keys(nameMap).length} Namen geladen`
    );
  }

  async function fetchDay(date) {
    const payload = {
      associatesList: associates,
      date: date,
      mode: "daily",
      serviceAreaId: SERVICE_AREA_ID,
    };

    const csrf = getCSRFToken();
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (csrf) headers["anti-csrftoken-a2z"] = csrf;

    const resp = await fetch(API_URL, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
      credentials: "include",
    });

    if (!resp.ok)
      throw new Error(`API Fehler ${resp.status} für ${date}`);
    return resp.json();
  }

  // ============ DATEN VERARBEITEN ============
  function extractDayData(json) {
    const result = {};
    const data =
      json?.data?.daWorkSummaryAndEligibility || {};
    for (const [id, entry] of Object.entries(data)) {
      const ws = entry?.workSummary;
      if (!ws) continue;
      result[id] = {
        scheduledDay: ws.daScheduledDayMins || 0,
        actualDay: ws.daActualWorkDayMins || 0,
        scheduledWeek: ws.daScheduledWeekMins || 0,
        actualWeek: ws.daActualWorkWeekMins || 0,
        last7Days: ws.daScheduledLast7DaysMins || 0,
        breached: ws.isDailyLeapThresholdBreached || false,
      };
    }
    return result;
  }

  // ============ EINZELTAG ANZEIGE ============
  function renderSingleDay(date, dayData) {
    const rows = Object.entries(dayData)
      .sort((a, b) => b[1].actualDay - a[1].actualDay)
      .map(([id, d]) => {
        const cls = d.breached ? "az-breach" : "";
        return `<tr class="${cls}">
          <td title="${id}">${resolveName(id)}</td>
          <td>${minsToHM(d.scheduledDay)}</td>
          <td class="${minsClass(d.actualDay)}">${minsToHM(d.actualDay)}</td>
          <td>${minsToHM(d.scheduledWeek)}</td>
          <td>${minsToHM(d.actualWeek)}</td>
          <td>${minsToHM(d.last7Days)}</td>
          <td>${d.breached ? "⚠️ JA" : "✅ Nein"}</td>
        </tr>`;
      })
      .join("");

    return `
      <table id="az-wz-table">
        <thead><tr>
          <th>Fahrer</th>
          <th>Geplant (Tag)</th>
          <th>Ist (Tag)</th>
          <th>Geplant (Woche)</th>
          <th>Ist (Woche)</th>
          <th>Letzten 7 Tage</th>
          <th>Threshold Breach</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // ============ WOCHENANSICHT ============
  function renderWeek(weekData) {
    const dates = Object.keys(weekData).sort();
    const allIds = new Set();
    for (const dd of Object.values(weekData)) {
      for (const id of Object.keys(dd)) allIds.add(id);
    }

    const dayHeaders = dates
      .map((d, i) => {
        const label = DAYS[i] || d;
        return `<th colspan="2">${label} (${d.slice(5)})</th>`;
      })
      .join("");

    const subHeaders = dates
      .map(() => `<th>Geplant</th><th>Ist</th>`)
      .join("");

    const sortedRows = [...allIds]
      .map((id) => {
        let totalActual = 0;
        let anyBreach = false;
        let weekActual = 0;

        const cells = dates
          .map((date) => {
            const d = weekData[date]?.[id];
            if (!d)
              return (
                '<td class="az-nodata">-</td>' +
                '<td class="az-nodata">-</td>'
              );
            totalActual += d.actualDay;
            if (d.breached) anyBreach = true;
            weekActual = d.actualWeek;
            return `
              <td>${minsToHM(d.scheduledDay)}</td>
              <td class="${minsClass(d.actualDay)}">${minsToHM(d.actualDay)}</td>
            `;
          })
          .join("");

        const cls = anyBreach ? "az-breach" : "";
        const row = `<tr class="${cls}">
          <td title="${id}">${resolveName(id)}</td>
          ${cells}
          <td class="${minsClass(totalActual / dates.length)}">${minsToHM(totalActual)}</td>
          <td>${minsToHM(weekActual)}</td>
          <td>${anyBreach ? "⚠️ JA" : "✅"}</td>
        </tr>`;

        return { row, anyBreach, totalActual };
      })
      .sort((a, b) => {
        if (a.anyBreach !== b.anyBreach)
          return a.anyBreach ? -1 : 1;
        return b.totalActual - a.totalActual;
      })
      .map((r) => r.row)
      .join("");

    return `
      <table id="az-wz-table">
        <thead>
          <tr>
            <th rowspan="2">Fahrer</th>
            ${dayHeaders}
            <th rowspan="2">Σ Ist</th>
            <th rowspan="2">API Woche</th>
            <th rowspan="2">Breach</th>
          </tr>
          <tr>${subHeaders}</tr>
        </thead>
        <tbody>${sortedRows}</tbody>
      </table>
    `;
  }

  // ============ UI ============
  function createUI() {
    const btn = document.createElement("button");
    btn.id = "az-wz-btn";
    btn.textContent = "📊 WHC";
    document.body.appendChild(btn);

    const overlay = document.createElement("div");
    overlay.id = "az-wz-overlay";
    overlay.innerHTML = `
      <div id="az-wz-panel">
        <h2>📊 DA WHC-Dashboard</h2>
        <div class="az-controls">
          <label>Datum:</label>
          <input type="date" id="az-wz-date"
            value="${new Date().toISOString().split("T")[0]}">
          <select id="az-wz-mode">
            <option value="day">Einzelner Tag</option>
            <option value="week">Ganze Woche (Mo–So)</option>
          </select>
          <button id="az-wz-go">🔍 Abfragen</button>
          <button id="az-wz-export">📋 CSV Export</button>
          <button class="close" id="az-wz-close">
            ✕ Schließen
          </button>
        </div>
        <div id="az-wz-status"></div>
        <div id="az-wz-result"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    btn.addEventListener("click", () =>
      overlay.classList.add("visible")
    );
    document
      .getElementById("az-wz-close")
      .addEventListener("click", () =>
        overlay.classList.remove("visible")
      );
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("visible");
    });

    document
      .getElementById("az-wz-go")
      .addEventListener("click", runQuery);
    document
      .getElementById("az-wz-export")
      .addEventListener("click", exportCSV);
  }

  // ============ ABFRAGE ============
  async function runQuery() {
    const date = document.getElementById("az-wz-date").value;
    const mode = document.getElementById("az-wz-mode").value;
    const status = document.getElementById("az-wz-status");
    const result = document.getElementById("az-wz-result");

    if (!date) {
      status.textContent = "⚠️ Bitte Datum auswählen!";
      return;
    }

    result.innerHTML = "";
    lastQueryMode = mode;

    // Roster laden → Namen + IDs
    try {
      status.textContent = "⏳ Lade Fahrer-Liste...";
      if (mode === "week") {
        const monday = getMonday(date);
        const sunday = addDays(monday, 6);
        await fetchNames(monday, sunday);
      } else {
        await fetchNames(date);
      }
      status.textContent =
        `⏳ ${associates.length} Fahrer gefunden, lade Daten...`;
    } catch (e) {
      status.textContent = `❌ Roster-Fehler: ${e.message}`;
      console.error(e);
      return;
    }

    if (associates.length === 0) {
      status.textContent =
        "⚠️ Keine Fahrer im Roster gefunden für dieses Datum!";
      return;
    }

    if (mode === "day") {
      status.textContent = `⏳ Lade Daten für ${date}...`;
      try {
        const json = await fetchDay(date);
        const dayData = extractDayData(json);
        lastQueryResult = { [date]: dayData };
        result.innerHTML = renderSingleDay(date, dayData);
        const count = Object.keys(dayData).length;
        const breaches = Object.values(dayData).filter(
          (d) => d.breached
        ).length;
        status.textContent =
          `✅ ${count} Fahrer geladen | ` +
          `${breaches} Threshold-Breaches | ${date}`;
      } catch (e) {
        status.textContent = `❌ Fehler: ${e.message}`;
        console.error(e);
      }
    } else {
      const monday = getMonday(date);
      const weekData = {};

      try {
        for (let i = 0; i < 7; i++) {
          const d = addDays(monday, i);
          status.textContent =
            `⏳ Lade ${DAYS[i]} (${d})... (${i + 1}/7)`;
          try {
            const json = await fetchDay(d);
            weekData[d] = extractDayData(json);
          } catch (e) {
            console.warn(`Fehler für ${d}:`, e);
            weekData[d] = {};
          }
          if (i < 6)
            await new Promise((r) => setTimeout(r, 500));
        }
        lastQueryResult = weekData;
        result.innerHTML = renderWeek(weekData);

        let totalBreaches = 0;
        for (const dd of Object.values(weekData)) {
          for (const d of Object.values(dd)) {
            if (d.breached) totalBreaches++;
          }
        }
        status.textContent =
          `✅ Woche ${monday} geladen | ` +
          `${totalBreaches} Breach-Einträge`;
      } catch (e) {
        status.textContent = `❌ Fehler: ${e.message}`;
        console.error(e);
      }
    }
  }

  // ============ CSV EXPORT ============
  function exportCSV() {
    if (!lastQueryResult) {
      alert("Bitte zuerst eine Abfrage starten!");
      return;
    }

    let csv = "";

    if (lastQueryMode === "day") {
      const date = Object.keys(lastQueryResult)[0];
      const data = lastQueryResult[date];
      csv =
        "Name;Associate ID;Geplant (Tag);Ist (Tag);" +
        "Geplant (Woche);Ist (Woche);Letzten 7 Tage;Breach\n";
      for (const [id, d] of Object.entries(data)) {
        csv +=
          `${resolveName(id)};${id};${d.scheduledDay};` +
          `${d.actualDay};${d.scheduledWeek};${d.actualWeek};` +
          `${d.last7Days};${d.breached}\n`;
      }
    } else {
      const dates = Object.keys(lastQueryResult).sort();
      const allIds = new Set();
      for (const dd of Object.values(lastQueryResult)) {
        for (const id of Object.keys(dd)) allIds.add(id);
      }

      csv = "Name;Associate ID";
      for (const d of dates) {
        csv += `;${d} Geplant;${d} Ist`;
      }
      csv += ";Breach\n";

      for (const id of allIds) {
        csv += `${resolveName(id)};${id}`;
        let anyBreach = false;
        for (const date of dates) {
          const d = lastQueryResult[date]?.[id];
          csv += `;${d?.scheduledDay || 0};${d?.actualDay || 0}`;
          if (d?.breached) anyBreach = true;
        }
        csv += `;${anyBreach}\n`;
      }
    }

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      `arbeitszeiten_${lastQueryMode}_` +
      `${Object.keys(lastQueryResult)[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ============ START ============
  createUI();
})();