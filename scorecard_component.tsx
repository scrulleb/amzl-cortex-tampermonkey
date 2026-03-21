import React, { useState, useEffect } from 'react';
import { hello } from './hello';
import * as CryptoJS from 'crypto-js';
import { Button } from '@mui/material';
import {
    Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Paper, TextField, FormControl, FormLabel, RadioGroup, FormControlLabel, Radio
} from '@mui/material';
import './TableComponent.css';  // Import your styles
import { exportTableDataToExcel } from './exportToExcel'; // Import the new function
import domtoimage from 'dom-to-image';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import CloseIcon from '@mui/icons-material/Close';

interface TableData {
    transporterId: string;
    delivered: string;
    dcr: string;
    dnrDpmo: string;
    lorDpmo: string;
    pod: string;
    cc: string;
    ce: string;
    cdfDpmo: string;
}

const initialData: TableData[] = [
    { transporterId: '', delivered: '', dcr: '', dnrDpmo: '', lorDpmo: '', pod: '', cc: '', ce: '', cdfDpmo: ''}
];

export const convertToDecimal = (value: string, isCeOrDnrDpmo: boolean = false): number => {
    if (value === "-" || value.trim() === "") {
        return NaN;  // Return NaN if the value is empty or a dash
    }
    const number = parseFloat(value.replace(',', '.'));
    return isNaN(number) ? NaN : number;  // Return NaN if the value cannot be parsed
};


const saveDataToLocalStorage = (data: TableData[]) => {
    const dataToSave = data.map(row => ({
        ...row,
        dcr: convertToDecimal(row.dcr),
        dnrDpmo: row.dnrDpmo,
        lorDpmo: row.lorDpmo,
        pod: convertToDecimal(row.pod),
        cc: convertToDecimal(row.cc),
        ce: row.ce,
        cdfDpmo: row.cdfDpmo,
    }));
    localStorage.setItem('tableData', JSON.stringify(dataToSave));
};
interface CalculatedData {
    transporterId: string;
    delivered: string;
    dcr: string;
    dnrDpmo: string;
    lorDpmo: string;
    pod: string;
    cc: string;
    ce: string;
    cdfDpmo: string;
    status: string;
    totalScore: number;
    originalData: {
        dcr: string;
        dnrDpmo: string;
        lorDpmo: string;
        pod: string;
        cc: string;
        ce: string;
        cdfDpmo: string;
    };
}

export const encryptData = (data: string): string => {
    return CryptoJS.AES.encrypt(data, 'u01bign-K41pAIZX_hYpFJ_bpC9wujeVqnAaBhTDLjs').toString();
};

export const decryptData = (encryptedData: string): string => {
    const bytes = CryptoJS.AES.decrypt(encryptedData, 'u01bign-K41pAIZX_hYpFJ_bpC9wujeVqnAaBhTDLjs');
    return bytes.toString(CryptoJS.enc.Utf8);
};

const TableComponent: React.FC = () => {
    const [showInputTable, setShowInputTable] = useState(false);
    const [inputData, setInputData] = useState<{ associate: string; DAtransporterId: string }[]>([{ associate: '', DAtransporterId: '' }]);
    const [calculatedData, setCalculatedData] = useState<CalculatedData[]>([]);
    const [tableData, setTableData] = useState<TableData[]>(initialData);
    const [encryptedInputData, setEncryptedInputData] = useState<{ associate: string; DAtransporterId: string }[]>([]);

    const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
        event.preventDefault();
        const clipboardData = event.clipboardData;
        let pastedData = clipboardData.getData('Text').trim();

        // Replace "DNR DPMO" with a placeholder to prevent splitting
        pastedData = pastedData.replace(/DNR\s+DPMO/g, "DNR_DPMO");

        // Detect format based on the presence of tabs, commas, or spaces
        const firstRow = pastedData.split('\n')[0];
        if (firstRow.includes('\t')) {
            // Excel paste logic: split by new lines and tabs
            const rawRows = pastedData.split(/\n/).map(row => row.split(/\t/));
            const parsedRows = rawRows.map(row => {
                // Replace "DNR DPMO" with a placeholder to prevent splitting
                const modifiedRow = row.join(' ').replace(/DNR\s+DPMO/g, "DNR DPMO");
                const splitRow = modifiedRow.trim().split(/\t/);
                // Restore "DNR DPMO" from the placeholder
                splitRow[8] = splitRow[8].replace("DNR_DPMO", "DNR DPMO");
                if (splitRow[8] && splitRow[8].includes("DNR DPMO")) {
                    splitRow[8] = "DNR";
                }
                return splitRow;
            });

            const excelTableData = parsedRows.map((row) => ({
                transporterId: row[0] || '',
                delivered: row[1] || '',
                dcr: row[2] || '',
                dnrDpmo: row[3] || '',
                lorDpmo: row[4] || '',
                pod: row[5] || '',
                cc: row[6] || '',
                ce: row[7] || '',
                cdfDpmo: row[8] || ''
            }));

            setTableData(tableData);
        } else if (pastedData.includes(',') && !firstRow.includes('\t')) {
            // CSV paste logic: split by new lines and commas
            const csvRawRows = pastedData.split(/\n/);
            const csvParsedRows = csvRawRows.map(row => row.trim().split(/,/));

            const csvTableData = csvParsedRows.map((row) => ({
                transporterId: row[0] || '',
                delivered: row[1] || '',
                dcr: row[2] || '',
                dnrDpmo: row[3] || '',
                lorDpmo: row[4] || '',
                pod: row[5] || '',
                cc: row[6] || '',
                ce: row[7] || '',
                cdfDpmo: row[8] || ''
            }));

            setTableData(csvTableData);
        } else if (pastedData.includes(' ')) {
            // Space-separated paste logic: split by new lines and spaces
            const rawRows = pastedData.split(/\n/);
            const parsedRows = rawRows.map(row => row.trim().split(/\s+/));

            const newTableData = parsedRows.map((row) => ({
                transporterId: row[0] || '',
                delivered: row[1] || '',
                dcr: row[2] || '',
                dnrDpmo: row[3] || '',
                lorDpmo: row[4] || '',
                pod: row[5] || '',
                cc: row[6] || '',
                ce: row[7] || '',
                cdfDpmo: row[8] || ''
            }));

            setTableData(newTableData);
        } else {
            // PDF paste logic: split by new lines and group into rows of 9
            // Replace "DNR DPMO" with a placeholder to prevent splitting
            const modifiedData = pastedData.replace(/DNR\s+DPMO/g, "DNR_DPMO");
            const rawValues = modifiedData.split(/\n/).filter(line => line.trim() !== '');
            const groupedRows: string[][] = [];
            let currentRow: string[] = [];

            console.log("Raw Values:", rawValues); // Log raw values for debugging

            for (let i = 0; i < rawValues.length; i++) {
                currentRow.push(rawValues[i].trim());
                if (currentRow.length === 9) {
                    groupedRows.push(currentRow);
                    currentRow = [];
                }
            }

            // Add the last row if it has any data
            if (currentRow.length > 0) {
                while (currentRow.length < 9) {
                    currentRow.push('');
                }
                groupedRows.push(currentRow);
            }

            console.log("Grouped Rows:", groupedRows); // Log grouped rows for debugging

            const newTableData = groupedRows.map((row) => {
                return {
                    transporterId: row[0],
                    delivered: row[1],
                    dcr: row[2],
                    dnrDpmo: row[3],
                    lorDpmo: row[4],
                    pod: row[5],
                    cc: row[6],
                    ce: row[7],
                    cdfDpmo: row[8]
                };
            });

            // Limit the number of rows to prevent performance issues
            setTableData(newTableData.slice(0, 100));
        }
    };

    useEffect(() => {
        const savedData = localStorage.getItem('tableData');
        if (savedData) {
            setTableData(JSON.parse(savedData));
        }
    }, []);

    const handleChange = (index: number, field: keyof TableData, value: string) => {
        const updatedData = [...tableData];
        updatedData[index][field] = value.replace(',', '.');
        setTableData(updatedData);
    };

    const [showOutputTable, setShowOutputTable] = useState(false);
    const toggleInputTable = () => {
        setShowInputTable(!showInputTable);
    };

    const handleInputPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
        event.preventDefault();
        const clipboardData = event.clipboardData.getData('Text').trim();
        const rows = clipboardData.split(/\n/).map(row => row.split(/\t/));

        const newInputData = rows.map(row => ({
            associate: row[0] || '',
            DAtransporterId: row[1] || ''
        }));

        setInputData(newInputData);
    };

    const handleInputChange = (index: number, field: keyof typeof inputData[0], value: string) => {
        const updatedData = [...inputData];
        updatedData[index][field] = value;
        setInputData(updatedData);
    };

    const downloadTableAsExcel = () => {
        const dataToExport = calculatedData.map(row => ({
            TransporterID: row.transporterId,
            Status: row.status,
            TotalScore: row.totalScore.toFixed(2),
            Delivered: row.delivered,
            DCR: row.dcr,
            DNRDPMO: parseInt(row.dnrDpmo, 10),
            POD: row.pod,
            CC: row.cc,
            CE: parseInt(row.ce, 10),
            CDFDPMO: parseInt(row.cdfDpmo, 10),
        }));
        exportTableDataToExcel(dataToExport, 'OutputTableData');
    };
    const clearTableData = () => {
        setTableData(initialData)
        setInputData([{ associate: '', DAtransporterId: '' }])
        setShowOutputTable(false);
    };
    const getColor = (value: number, type: string): string => {
        switch (type) {
            case 'DCR':
                return value < 97 ? 'rgb(235, 50, 35)' :
                       value < 98.5 ? 'rgb(223, 130, 68)' :
                       value < 99.5 ? 'rgb(126, 170, 85)' : 'rgb(77, 115, 190)';
            case 'DNRDPMO':
                return value < 1100 ? 'rgb(77, 115, 190)' :
                       value < 1300 ? 'rgb(126, 170, 85)' :
                       value < 1500 ? 'rgb(223, 130, 68)' : 'rgb(235, 50, 35)';
            case 'LORDPMO':
                return value < 1100 ? 'rgb(77, 115, 190)' :
                       value < 1300 ? 'rgb(126, 170, 85)' :
                       value < 1500 ? 'rgb(223, 130, 68)' : 'rgb(235, 50, 35)';
            case 'POD':
                return value < 94 ? 'rgb(235, 50, 35)' :
                       value < 95.5 ? 'rgb(223, 130, 68)' :
                       value < 97 ? 'rgb(126, 170, 85)' : 'rgb(77, 115, 190)';
            case 'CC':
                return value < 70 ? 'rgb(235, 50, 35)' :
                       value < 95 ? 'rgb(223, 130, 68)' :
                       value < 98.5 ? 'rgb(126, 170, 85)' : 'rgb(77, 115, 190)';
            case 'CE':
                return value === 0 ? 'rgb(77, 115, 190)' : 'rgb(235, 50, 35)';
            case 'CDFDPMO':
                return value > 5460 ? 'rgb(235, 50, 35)' :
                       value > 4450 ? 'rgb(223, 130, 68)' :
                       value > 3680 ? 'rgb(126, 170, 85)' : 'rgb(77, 115, 190)';
            default:
                return 'black';
        }
    };
    const getColorForStatus = (status: string): string => {
        switch (status) {
            case 'Poor':
                return 'rgb(235, 50, 35)';
            case 'Fair':
                return 'rgb(223, 130, 68)';
            case 'Great':
                return 'rgb(126, 170, 85)';
            case 'Fantastic':
                return 'rgb(77, 115, 190)';
            case 'Fantastic Plus':
                return getColorForStatus('Fantastic'); // Ensure same color as Fantastic
            default:
                return 'black';
        }
    };
    const calculateScores = () => {
        console.log('calculateScores called, tableData length:', tableData.length);
        const newCalculatedData = tableData.map((row, index) => {
            try {
                console.log(`Processing row ${index}:`, row);
                const dcr = (convertToDecimal(row.dcr === "-" ? "100" : row.dcr) || 0) / 100;
                const dnrDpmo = parseFloat(row.dnrDpmo) || 0;
                const lorDpmo = parseFloat(row.lorDpmo) || 0;
                const pod = (convertToDecimal(row.pod === "-" ? "100" : row.pod) || 0) / 100;
                const cc = (convertToDecimal(row.cc === "-" ? "100" : row.cc) || 0) / 100;
                const ce = parseFloat(row.ce) || 0;
                const cdfDpmo = parseFloat(row.cdfDpmo) || 0;
                const delivered = row.delivered;

            // Ursprüngliche Berechnung des Total Score
          let totalScore = Math.max(Math.min(
            (132.88 * dcr) +    // DCR weight
            (10 * Math.max(0, 1 - (cdfDpmo / 10000))) -     // CDF DPMO weight - reduced impact
            (0.0024 * dnrDpmo) -// DNR DPMO 
            (8.54 * ce) +       // CE weight
            (10 * pod) +        // POD weight
            (4 * cc) +          // CC weight
            (0.00045 * parseFloat(delivered)) - // Delivered weight
            60.88,              // Adjusted constant (was 132.72, reduced by ~72 to compensate)
            100), 0);           // Cap at 100 and floor at 0

        // Perfekte Bewertung: Alle KPIs auf 100% und CE sowie DNR DPMO auf 0, CDF DPMO auf 0
        if (dcr === 1 && pod === 1 && cc === 1 && cdfDpmo === 0 && ce === 0 && dnrDpmo === 0 && lorDpmo === 0) {
            totalScore = 100;
        } else {
            // Zähle, wie viele KPIs als "Poor" gelten
            let poorCount = 0;
            if ((dcr * 100) < 97) poorCount++;           // DCR: Poor, wenn Wert < 97
            if (dnrDpmo >= 1500) poorCount++;            // DNR DPMO: Poor, wenn Wert ≥ 1500
            if ((pod * 100) < 94) poorCount++;           // POD: Poor, wenn Wert < 94
            if ((cc * 100) < 70) poorCount++;            // CC: Poor, wenn Wert < 70
            if (ce !== 0) poorCount++;                   // CE: Nur optimal bei 0, ansonsten Poor
            if (cdfDpmo >= 8000) poorCount++;            // CDF DPMO: Poor bei >= 8000

            // Anpassen des Total Score basierend auf der Anzahl schlechter KPIs:
            if (poorCount >= 2) {
                let severitySum = 0;
                if ((dcr * 100) < 97) severitySum += (97 - dcr * 100) / 5;
                if (dnrDpmo >= 1500) severitySum += (dnrDpmo - 1500) / 1000;
                if ((pod * 100) < 94) severitySum += (94 - pod * 100) / 10;
                if ((cc * 100) < 70) severitySum += (70 - cc * 100) / 50;
                if (ce !== 0) severitySum += ce * 1;
                if (cdfDpmo >= 8000) severitySum += (cdfDpmo - 8000) / 2000;
                
                const penalty = Math.min(3, severitySum);
                totalScore = Math.min(totalScore, 70 - penalty);
            } else if (poorCount === 1) {
                let severitySum = 0;
                if ((dcr * 100) < 97) severitySum += (97 - dcr * 100) / 5;
                if (dnrDpmo >= 1500) severitySum += (dnrDpmo - 1500) / 1000;
                if ((pod * 100) < 94) severitySum += (94 - pod * 100) / 10;
                if ((cc * 100) < 70) severitySum += (70 - cc * 100) / 50;
                if (ce !== 0) severitySum += ce * 1;
                if (cdfDpmo >= 8000) severitySum += (cdfDpmo - 8000) / 2000;

                const penalty = Math.min(3, severitySum);
                totalScore = Math.min(totalScore, 85 - penalty);
            }
        }
                

            const roundedScore = parseFloat(totalScore.toFixed(2));
            // "DNR" wird in "DNR DPMO" umbenannt

            const status = roundedScore < 40.00 ? 'Poor' :
                roundedScore < 70.00 ? 'Fair' :
                    roundedScore < 85.00 ? 'Great' :
                        roundedScore < 93.00 ? 'Fantastic' : 'Fantastic Plus';

            return {
                transporterId: row.transporterId,
                delivered: row.delivered,
                dcr: (dcr * 100).toFixed(2),
                dnrDpmo: dnrDpmo.toFixed(2),
                lorDpmo: lorDpmo.toFixed(2),
                pod: (pod * 100).toFixed(2),
                cc: (cc * 100).toFixed(2),
                ce: ce.toFixed(2),
                cdfDpmo: cdfDpmo.toFixed(2),
                status,
                totalScore: totalScore,
                originalData: {
                    dcr: row.dcr,
                    dnrDpmo: row.dnrDpmo,
                    lorDpmo: row.lorDpmo,
                    pod: row.pod,
                    cc: row.cc,
                    ce: row.ce,
                    cdfDpmo: row.cdfDpmo
                }
            };
            }
            catch (error) {
                console.error(`Error processing row ${index}:`, error);
                return undefined;
            }
        }).filter((item): item is CalculatedData => item !== undefined);

        // Sortiere die berechneten Daten absteigend basierend auf totalScore
        const sortedData = newCalculatedData.sort((a, b) => b.totalScore - a.totalScore);
        setCalculatedData(sortedData);
        setShowOutputTable(true);
    };



const downloadTableAsImage = async () => {
    const tableElement = document.querySelector('.table-container-paper') as HTMLElement;
    if (tableElement) {
        try {
            // Wait for fonts to load
            await document.fonts.ready;
            
            // Add white background temporarily
            const originalBg = tableElement.style.backgroundColor;
            tableElement.style.backgroundColor = '#ffffff';
            
            const dataUrl = await domtoimage.toPng(tableElement, { 
                quality: 1, 
                scale: 4
            });
            
            // Restore original background
            tableElement.style.backgroundColor = originalBg;
            
            const link = document.createElement('a');
            link.download = 'driver_performance.png';
            link.href = dataUrl;
            link.click();
        } catch (error) {
            console.error('Error generating image:', error);
        }
    }
};

    const handleCloseFloatingTable = () => {
        setShowOutputTable(false);
    }

    return (
        <>
        <div className="button-group">
            <Button
                variant="contained"
                color="primary"
                startIcon={showInputTable ? <CloseIcon /> : <MenuOpenIcon />}
                onClick={toggleInputTable}
            >
                {showInputTable ? 'Close DA Data' : 'Open DA Data'}
            </Button>
            <Button variant="contained" color="success" onClick={calculateScores}>
                Calculate
            </Button>
            <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteForeverIcon />}
                onClick={clearTableData}
            >
                Clear Data
            </Button>
            <Button variant="contained" color="primary" startIcon={<CloudDownloadIcon />} onClick={downloadTableAsImage}>
                Image
            </Button>
        </div>
        {showInputTable && (
            <div
                className="input-table-container"
                onPaste={handleInputPaste} // Add this line
                style={{ 
                    position: 'fixed',
                    top: '10px',
                    left: '10px',
                    width: '250px',
                    backgroundColor: 'white',
                    border: '1px solid #ccc',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                    zIndex: 1000,
                    padding: '10px',
                }}
            >
                <TableContainer component={Paper} className="DAtable-container-paper">
                    <Table className="DATable" size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Associate</TableCell>
                                <TableCell>Transporter ID</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {inputData.map((row, index) => (
                                <TableRow key={index}>
                                    <TableCell>
                                        <TextField
                                            value={row.associate}
                                            onChange={(e) => handleInputChange(index, 'associate', e.target.value)}
                                            fullWidth
                                            sx={{ input: { fontSize: '12px', padding: '8px' } }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <TextField
                                            value={row.DAtransporterId}
                                            onChange={(e) => handleInputChange(index, 'DAtransporterId', e.target.value)}
                                            fullWidth
                                            sx={{ input: { fontSize: '12px', padding: '8px' } }}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </div>
        )}
        {!showOutputTable ? (
            <div className="table-container">
                <TableContainer component={Paper} className="table-container-paper" onPaste={handlePaste}>
                    <Table className="table" size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ fontSize: '16px' }}>TransporterID</TableCell>
                                <TableCell sx={{ fontSize: '16px' }}>Delivered</TableCell>
                                <TableCell sx={{ fontSize: '16px' }}>DCR</TableCell>
                                <TableCell sx={{ fontSize: '16px' }}>DNR DPMO</TableCell>
                                <TableCell sx={{ fontSize: '16px' }}>LoR DPMO</TableCell>
                                <TableCell sx={{ fontSize: '16px' }}>POD</TableCell>
                                <TableCell sx={{ fontSize: '16px' }}>CC</TableCell>
                                <TableCell sx={{ fontSize: '16px' }}>CE</TableCell>
                                <TableCell sx={{ fontSize: '16px' }}>CDF DPMO</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {tableData.map((row, index) => (
                                <TableRow key={index}>
                                    <TableCell>
                                        <TextField
                                            value={row.transporterId}
                                            onChange={(e) => handleChange(index, 'transporterId', e.target.value)}
                                            fullWidth
                                            sx={{ input: { fontSize: '12px', padding: '8px' } }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <TextField
                                            value={row.delivered}
                                            onChange={(e) => handleChange(index, 'delivered', e.target.value)}
                                            fullWidth
                                            sx={{ input: { fontSize: '12px', padding: '8px' } }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <TextField
                                            value={row.dcr}
                                            onChange={(e) => handleChange(index, 'dcr', e.target.value)}
                                            fullWidth
                                            sx={{ input: { fontSize: '12px', padding: '8px' } }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <TextField
                                            value={row.dnrDpmo}
                                            onChange={(e) => handleChange(index, 'dnrDpmo', e.target.value)}
                                            fullWidth
                                            sx={{ input: { fontSize: '12px', padding: '8px' } }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <TextField
                                            value={row.lorDpmo}
                                            onChange={(e) => handleChange(index, 'lorDpmo', e.target.value)}
                                            fullWidth
                                            sx={{ input: { fontSize: '12px', padding: '8px' } }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <TextField
                                            value={row.pod}
                                            onChange={(e) => handleChange(index, 'pod', e.target.value)}
                                            fullWidth
                                            sx={{ input: { fontSize: '12px', padding: '8px' } }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <TextField
                                            value={row.cc}
                                            onChange={(e) => handleChange(index, 'cc', e.target.value)}
                                            fullWidth
                                            sx={{ input: { fontSize: '12px', padding: '8px' } }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <TextField
                                            value={row.ce}
                                            onChange={(e) => handleChange(index, 'ce', e.target.value)}
                                            fullWidth
                                            sx={{ input: { fontSize: '12px', padding: '8px' } }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <TextField
                                            value={row.cdfDpmo}
                                            onChange={(e) => handleChange(index, 'cdfDpmo', e.target.value)}
                                            fullWidth
                                            sx={{ input: { fontSize: '12px', padding: '8px' } }}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </div>
        ) : (
            <div className="table-container">
                <TableContainer component={Paper} className="table-container-paper">
                    <Table className="table" size="medium">
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ fontSize: '12px' }}>Place</TableCell>
                                <TableCell sx={{ fontSize: '12px' }}>Associate</TableCell>
                                <TableCell sx={{ fontSize: '12px' }}>Status</TableCell>
                                <TableCell sx={{ fontSize: '12px' }}>Total Score</TableCell>
                                <TableCell sx={{ fontSize: '12px' }}>Delivered</TableCell>
                                <TableCell sx={{ fontSize: '12px' }}>DCR</TableCell>
                                <TableCell sx={{ fontSize: '12px' }}>DNR DPMO</TableCell>
                                <TableCell sx={{ fontSize: '12px' }}>LOR DPMO</TableCell>
                                <TableCell sx={{ fontSize: '12px' }}>POD</TableCell>
                                <TableCell sx={{ fontSize: '12px' }}>CC</TableCell>
                                <TableCell sx={{ fontSize: '12px' }}>CE</TableCell>
                                <TableCell sx={{ fontSize: '12px' }}>CDF DPMO</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {calculatedData.map((row, index) => {
                                const matchingInput = inputData.find(input => input.DAtransporterId === row.transporterId);
                                const associate = matchingInput ? matchingInput.associate : row.transporterId;

                                return (
                                    <TableRow key={index}>
                                        <TableCell>{index + 1}</TableCell>
                                        <TableCell>{associate}</TableCell>
                                        <TableCell style={{ color: getColorForStatus(row.status) }}>
                                            {row.status}
                                        </TableCell>
                                        <TableCell>{row.totalScore.toFixed(2)}</TableCell>
                                        <TableCell>{row.delivered}</TableCell>
                                        <TableCell style={{ color: getColor(parseFloat(row.dcr), 'DCR') }}>
                                            {row.dcr}%
                                        </TableCell>
                                        <TableCell style={{ color: getColor(parseFloat(row.dnrDpmo), 'DNRDPMO') }}>
                                            {parseInt(row.dnrDpmo, 10)}
                                        </TableCell>
                                        <TableCell style={{ color: getColor(parseFloat(row.lorDpmo), 'LORDPMO') }}>
                                            {parseInt(row.lorDpmo, 10)}
                                        </TableCell>
                                        <TableCell style={{ color: getColor(parseFloat(row.pod), 'POD') }}>
                                            {row.pod}%
                                        </TableCell>
                                        <TableCell style={{ color: getColor(parseFloat(row.cc), 'CC') }}>
                                            {row.cc}%
                                        </TableCell>
                                        <TableCell style={{ color: getColor(parseFloat(row.ce), 'CE') }}>
                                            {parseInt(row.ce, 10)}
                                        </TableCell>
                                        <TableCell style={{ color: getColor(parseFloat(row.cdfDpmo), 'CDFDPMO') }}>
                                            {parseInt(row.cdfDpmo, 10)}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            </div>
        )}
        </>
    );
};

export default TableComponent;