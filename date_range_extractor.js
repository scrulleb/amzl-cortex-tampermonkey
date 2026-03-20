// ==UserScript==
// @name         Amazon Logistics Date Range Extractor
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Extract data for date ranges (excluding Sundays)
// @author       You
// @match        https://logistics.amazon.de/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    let extractionProgress = {
        isRunning: false,
        current: 0,
        total: 0,
        dates: [],
        results: []
    };

    // Haupt-Extraktionsfunktion für Date Range
    async function extractDateRange(startDate, endDate, serviceAreaId = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx') {
        const dates = generateDateRange(startDate, endDate);
        console.log(`🗓️ Extracting data for ${dates.length} dates:`, dates);

        extractionProgress = {
            isRunning: true,
            current: 0,
            total: dates.length,
            dates: dates,
            results: []
        };

        updateProgressDisplay();

        for (let i = 0; i < dates.length; i++) {
            const date = dates[i];
            extractionProgress.current = i + 1;

            try {
                console.log(`📅 Extracting data for ${date} (${i + 1}/${dates.length})`);
                updateProgressDisplay();

                const data = await extractSingleDate(date, serviceAreaId);
                extractionProgress.results.push({
                    date: date,
                    success: true,
                    data: data,
                    timestamp: new Date().toISOString()
                });

                console.log(`✅ Success for ${date}`);

                // Verzögerung zwischen Requests (1-2 Sekunden)
                if (i < dates.length - 1) {
                    await delay(1000 + Math.random() * 1000);
                }

            } catch (error) {
                console.error(`❌ Failed for ${date}:`, error);
                extractionProgress.results.push({
                    date: date,
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });

                // Bei Fehlern etwas länger warten
                await delay(2000);
            }
        }

        extractionProgress.isRunning = false;
        console.log('🎉 Date range extraction completed!');

        // Ergebnisse speichern und anzeigen
        saveBatchResults(extractionProgress.results, startDate, endDate);
        showBatchResults(extractionProgress.results);

        return extractionProgress.results;
    }

    // Einzelnes Datum extrahieren
    function extractSingleDate(localDate, serviceAreaId) {
        return new Promise((resolve, reject) => {
            const apiUrl = `https://logistics.amazon.de/operations/execution/api/summaries?historicalDay=false&localDate=${localDate}&serviceAreaId=${serviceAreaId}`;

            fetch(apiUrl, {
                method: 'GET',
                credentials: 'same-origin',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'de,en-US;q=0.7,en;q=0.3',
                    'user-ref': 'cortex-webapp-user',
                    'X-Cortex-Timestamp': Date.now().toString(),
                    'X-Cortex-Session': extractSessionFromCookie(),
                    'Referer': window.location.href
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                // Daten einzeln speichern
                saveIndividualData(data, localDate);
                resolve(data);
            })
            .catch(error => {
                reject(error);
            });
        });
    }

    // Date Range generieren (ohne Sonntage)
    function generateDateRange(startDate, endDate) {
        const dates = [];
        const start = new Date(startDate);
        const end = new Date(endDate);

        // Validierung
        if (start > end) {
            throw new Error('Start date must be before end date');
        }

        const current = new Date(start);

        while (current <= end) {
            const dayOfWeek = current.getDay(); // 0 = Sonntag, 1 = Montag, ...

            // Sonntag (0) überspringen
            if (dayOfWeek !== 0) {
                dates.push(current.toISOString().split('T')[0]);
            }

            current.setDate(current.getDate() + 1);
        }

        return dates;
    }

    // Session aus Cookies extrahieren
    function extractSessionFromCookie() {
        const cookies = document.cookie;
        const sessionMatch = cookies.match(/session-id=([^;]+)/);
        return sessionMatch ? sessionMatch[1] : null;
    }

    // Einzelne Daten speichern
    function saveIndividualData(data, date) {
        const key = `logistics_data_${date}`;
        const processedData = {
            date: date,
            extractedAt: new Date().toISOString(),
            rawData: data,
            summary: extractDataSummary(data)
        };

        GM_setValue(key, JSON.stringify(processedData));
        console.log(`💾 Saved data for ${date}`);
    }

    // Batch-Ergebnisse speichern
    function saveBatchResults(results, startDate, endDate) {
        const batchKey = `batch_${startDate}_${endDate}_${Date.now()}`;
        const batchData = {
            startDate: startDate,
            endDate: endDate,
            extractedAt: new Date().toISOString(),
            totalDates: results.length,
            successCount: results.filter(r => r.success).length,
            results: results
        };

        GM_setValue(batchKey, JSON.stringify(batchData));

        // Batch-Index aktualisieren
        const batchIndex = JSON.parse(GM_getValue('batch_index', '[]'));
        batchIndex.push({
            key: batchKey,
            startDate: startDate,
            endDate: endDate,
            timestamp: new Date().toISOString(),
            successCount: batchData.successCount,
            totalCount: batchData.totalDates
        });

        // Nur letzte 20 Batches behalten
        if (batchIndex.length > 20) {
            const oldBatch = batchIndex.shift();
            GM_setValue(oldBatch.key, null);
        }

        GM_setValue('batch_index', JSON.stringify(batchIndex));
        console.log(`📦 Saved batch: ${batchKey}`);
    }

    // Daten-Zusammenfassung extrahieren
    function extractDataSummary(data) {
        const summary = {};

        try {
            // Anpassen je nach tatsächlicher API-Struktur
            if (data.summary) {
                summary.totalRoutes = data.summary.totalRoutes || 0;
                summary.completedRoutes = data.summary.completedRoutes || 0;
                summary.totalPackages = data.summary.totalPackages || 0;
                summary.deliveredPackages = data.summary.deliveredPackages || 0;
            }

            if (data.metrics) {
                summary.metrics = data.metrics;
            }

            // Weitere Felder je nach Bedarf...

        } catch (e) {
            console.warn('Could not extract summary:', e);
        }

        return summary;
    }

    // Progress Display aktualisieren
    function updateProgressDisplay() {
        let progressDiv = document.getElementById('extraction-progress');

        if (!extractionProgress.isRunning) {
            if (progressDiv) progressDiv.remove();
            return;
        }

        if (!progressDiv) {
            progressDiv = document.createElement('div');
            progressDiv.id = 'extraction-progress';
            progressDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                border: 2px solid #007185;
                padding: 20px;
                border-radius: 10px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                z-index: 10002;
                min-width: 300px;
                text-align: center;
                font-family: Arial, sans-serif;
            `;
            document.body.appendChild(progressDiv);
        }

        const percentage = Math.round((extractionProgress.current / extractionProgress.total) * 100);
        const currentDate = extractionProgress.dates[extractionProgress.current - 1] || 'Starting...';

        progressDiv.innerHTML = `
            <h3 style="margin-top: 0; color: #007185;">📊 Extracting Data</h3>
            <div style="margin: 15px 0;">
                <div style="background: #f0f0f0; height: 20px; border-radius: 10px; overflow: hidden;">
                    <div style="background: #007185; height: 100%; width: ${percentage}%; transition: width 0.3s;"></div>
                </div>
                <div style="margin-top: 10px; font-size: 14px;">
                    ${extractionProgress.current} / ${extractionProgress.total} (${percentage}%)
                </div>
            </div>
            <div style="color: #666; font-size: 12px;">
                Current: ${currentDate}
            </div>
            <button onclick="stopExtraction()" style="margin-top: 15px; padding: 5px 15px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;">
                Stop
            </button>
        `;
    }

    // Extraction stoppen
    window.stopExtraction = function() {
        extractionProgress.isRunning = false;
        const progressDiv = document.getElementById('extraction-progress');
        if (progressDiv) progressDiv.remove();
        console.log('🛑 Extraction stopped by user');
    };

    // Batch-Ergebnisse anzeigen
    function showBatchResults(results) {
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.length - successCount;

        const resultsWindow = window.open('', '_blank', 'width=800,height=600');
        resultsWindow.document.write(`
            <html>
                <head>
                    <title>Batch Extraction Results</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; }
                        .success { color: #28a745; }
                        .failure { color: #dc3545; }
                        .result-item {
                            border: 1px solid #ddd;
                            margin: 10px 0;
                            padding: 10px;
                            border-radius: 5px;
                        }
                        .summary {
                            background: #f8f9fa;
                            padding: 15px;
                            border-radius: 5px;
                            margin-bottom: 20px;
                        }
                        button {
                            background: #007185;
                            color: white;
                            border: none;
                            padding: 8px 12px;
                            margin: 5px;
                            border-radius: 4px;
                            cursor: pointer;
                        }
                    </style>
                </head>
                <body>
                    <h1>📊 Batch Extraction Results</h1>

                    <div class="summary">
                        <h3>Summary</h3>
                        <p><strong>Total Dates:</strong> ${results.length}</p>
                        <p><strong class="success">Successful:</strong> ${successCount}</p>
                        <p><strong class="failure">Failed:</strong> ${failureCount}</p>
                        <p><strong>Success Rate:</strong> ${Math.round((successCount / results.length) * 100)}%</p>
                    </div>

                    <div>
                        <button onclick="downloadAllData()">💾 Download All Data</button>
                        <button onclick="downloadSummary()">📋 Download Summary</button>
                    </div>

                    <h3>Individual Results</h3>
                    <div id="results">
                        ${results.map(result => `
                            <div class="result-item">
                                <h4>${result.date}
                                    <span class="${result.success ? 'success' : 'failure'}">
                                        ${result.success ? '✅' : '❌'}
                                    </span>
                                </h4>
                                ${result.success ?
                                    '<p>Data extracted successfully</p>' :
                                    '<p>Error: ' + result.error + '</p>'
                                }
                                <small>Time: ${new Date(result.timestamp).toLocaleString()}</small>
                            </div>
                        `).join('')}
                    </div>

                    <script>
                        function downloadAllData() {
                            const data = ${JSON.stringify(results)};
                            const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'logistics_batch_data_' + new Date().toISOString().split('T')[0] + '.json';
                            a.click();
                            URL.revokeObjectURL(url);
                        }

                        function downloadSummary() {
                            const summary = {
                                totalDates: ${results.length},
                                successCount: ${successCount},
                                failureCount: ${failureCount},
                                successRate: ${Math.round((successCount / results.length) * 100)}
                            };
                            const blob = new Blob([JSON.stringify(summary, null, 2)], {type: 'application/json'});
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'logistics_summary_' + new Date().toISOString().split('T')[0] + '.json';
                            a.click();
                            URL.revokeObjectURL(url);
                        }
                    </script>
                </body>
            </html>
        `);
    }

    // Date Range Dialog
    function showDateRangeDialog() {
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border: 2px solid #007185;
            padding: 25px;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10001;
            font-family: Arial, sans-serif;
            min-width: 350px;
        `;

        const today = new Date().toISOString().split('T')[0];
        const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        dialog.innerHTML = `
            <h3 style="margin-top: 0; color: #007185;">📅 Select Date Range</h3>

            <div style="margin: 15px 0;">
                <label><strong>Start Date:</strong></label><br>
                <input type="date" id="start-date" value="${lastWeek}" style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px;">
            </div>

            <div style="margin: 15px 0;">
                <label><strong>End Date:</strong></label><br>
                <input type="date" id="end-date" value="${today}" style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px;">
            </div>

            <div style="margin: 15px 0;">
                <label><strong>Service Area ID:</strong></label><br>
                <input type="text" id="service-area" value="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style="width: 100%; padding: 8px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px;">
            </div>

            <div style="background: #f8f9fa; padding: 10px; border-radius: 4px; margin: 15px 0; font-size: 12px; color: #666;">
                ℹ️ <strong>Note:</strong> Sundays will be automatically excluded from the range.
            </div>

            <div style="text-align: center; margin-top: 20px;">
                <button id="preview-dates" style="background: #28a745; color: white; border: none; padding: 10px 15px; margin: 5px; border-radius: 4px; cursor: pointer;">
                    👁️ Preview Dates
                </button>
                <button id="start-extraction" style="background: #007185; color: white; border: none; padding: 10px 15px; margin: 5px; border-radius: 4px; cursor: pointer;">
                    🚀 Start Extraction
                </button>
                <button id="cancel-dialog" style="background: #6c757d; color: white; border: none; padding: 10px 15px; margin: 5px; border-radius: 4px; cursor: pointer;">
                    Cancel
                </button>
            </div>

            <div id="date-preview" style="margin-top: 15px;"></div>
        `;

        document.body.appendChild(dialog);

        // Event Listeners
        document.getElementById('preview-dates').addEventListener('click', () => {
            const startDate = document.getElementById('start-date').value;
            const endDate = document.getElementById('end-date').value;

            if (!startDate || !endDate) {
                alert('Please select both start and end dates');
                return;
            }

            try {
                const dates = generateDateRange(startDate, endDate);
                document.getElementById('date-preview').innerHTML = `
                    <div style="background: #e7f3ff; padding: 10px; border-radius: 4px; margin-top: 10px;">
                        <strong>📋 Dates to extract (${dates.length}):</strong><br>
                        <div style="max-height: 150px; overflow-y: auto; margin-top: 5px; font-size: 12px;">
                            ${dates.join(', ')}
                        </div>
                    </div>
                `;
            } catch (error) {
                alert('Error: ' + error.message);
            }
        });

        document.getElementById('start-extraction').addEventListener('click', () => {
            const startDate = document.getElementById('start-date').value;
            const endDate = document.getElementById('end-date').value;
            const serviceAreaId = document.getElementById('service-area').value;

            if (!startDate || !endDate) {
                alert('Please select both start and end dates');
                return;
            }

            if (!serviceAreaId.trim()) {
                alert('Please enter a Service Area ID');
                return;
            }

            dialog.remove();
            extractDateRange(startDate, endDate, serviceAreaId.trim());
        });

        document.getElementById('cancel-dialog').addEventListener('click', () => {
            dialog.remove();
        });
    }

    // Delay-Hilfsfunktion
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Control Panel hinzufügen
    function addControlPanel() {
        const panel = document.createElement('div');
        panel.id = 'date-range-extractor';
        panel.style.cssText = `
            position: fixed;
            top: 20px;
            left: 20px;
            background: white;
            border: 2px solid #007185;
            padding: 15px;
            border-radius: 8px;
            z-index: 9999;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            font-family: Arial, sans-serif;
        `;

        panel.innerHTML = `
            <div style="margin-bottom: 12px; font-weight: bold; color: #007185; font-size: 14px;">
                📊 Logistics Date Range Extractor
            </div>
            <button id="extract-range" style="display: block; width: 100%; margin-bottom: 8px; padding: 8px; background: #007185; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">
                📅 Extract Date Range
            </button>
            <button id="extract-single" style="display: block; width: 100%; margin-bottom: 8px; padding: 8px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">
                📋 Extract Single Date
            </button>
            <button id="view-batches" style="display: block; width: 100%; padding: 8px; background: #ffc107; color: black; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">
                📈 View Batch History
            </button>
        `;

        document.body.appendChild(panel);

        // Event Listeners
        document.getElementById('extract-range').addEventListener('click', showDateRangeDialog);

        document.getElementById('extract-single').addEventListener('click', () => {
            const date = prompt('Enter date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
            if (date) {
                extractDateRange(date, date); // Same start and end date
            }
        });

        document.getElementById('view-batches').addEventListener('click', showBatchHistory);
    }

    // Batch-Historie anzeigen
    function showBatchHistory() {
        const batchIndex = JSON.parse(GM_getValue('batch_index', '[]'));

        if (batchIndex.length === 0) {
            alert('No batch history found');
            return;
        }

        const historyWindow = window.open('', '_blank', 'width=700,height=500');
        historyWindow.document.write(`
            <html>
                <head>
                    <title>Batch History</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; }
                        table { border-collapse: collapse; width: 100%; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #007185; color: white; }
                        .success { color: #28a745; }
                        .partial { color: #ffc107; }
                        .failure { color: #dc3545; }
                        button { background: #007185; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; margin: 2px; }
                    </style>
                </head>
                <body>
                    <h1>📈 Batch Extraction History</h1>
                    <table>
                        <thead>
                            <tr>
                                <th>Date Range</th>
                                <th>Extracted</th>
                                <th>Success Rate</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${batchIndex.reverse().map(batch => {
                                const successRate = Math.round((batch.successCount / batch.totalCount) * 100);
                                const statusClass = successRate === 100 ? 'success' : successRate > 50 ? 'partial' : 'failure';

                                return `
                                    <tr>
                                        <td>${batch.startDate} to ${batch.endDate}</td>
                                        <td>${new Date(batch.timestamp).toLocaleString()}</td>
                                        <td class="${statusClass}">${batch.successCount}/${batch.totalCount} (${successRate}%)</td>
                                        <td>
                                            <button onclick="loadBatch('${batch.key}')">Load</button>
                                            <button onclick="downloadBatch('${batch.key}')">Download</button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>

                    <script>
                        function loadBatch(key) {
                            alert('Batch key: ' + key + '\\nThis would load the batch data in the main script.');
                        }

                        function downloadBatch(key) {
                            alert('Download functionality would be implemented here for: ' + key);
                        }
                    </script>
                </body>
            </html>
        `);
    }

    // Initialisierung
    function init() {
        console.log('🚀 Amazon Logistics Date Range Extractor loaded');
        setTimeout(addControlPanel, 1500);

        // Tampermonkey Menu Commands
        GM_registerMenuCommand('📅 Extract Date Range', showDateRangeDialog);
        GM_registerMenuCommand('📈 View Batch History', showBatchHistory);
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();