import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Box, TextField, Button, IconButton, styled, Snackbar, Chip, Grid, CircularProgress } from '@mui/material';
import QrCodeIcon from '@mui/icons-material/QrCode';
import CssBaseline from '@mui/material/CssBaseline';
import QrCodeIconComponent from './QrCodeIconComponent';
import QRCode from 'qrcode.react';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import html2canvas from 'html2canvas';
import './App.css';
import Header from './Header';
import * as XLSX from 'xlsx';
import UploadButton from './upload';

const theme = createTheme({
    palette: {
        mode: 'light',
        primary: {
            main: '#1976d2',
        },
        secondary: {
            main: '#dc004e',
        },
    },
    typography: {
        fontSize: 14, // Reduce font size by approximately 15%
    },
    components: {
        MuiButton: {
            styleOverrides: {
                root: {
                    fontSize: '0.85rem', // Reduce button text size
                },
            },
        },
        MuiTextField: {
            styleOverrides: {
                root: {
                    '& .MuiInputBase-input': {
                        fontSize: '0.85rem', // Reduce input text size
                    },
                },
            },
        },
    },
});

const UploadBox = styled(Box)(({ theme }) => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '8rem',
    border: '2px dashed',
    borderColor: theme.palette.grey[300],
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.grey[50],
    cursor: 'pointer',
    '&:hover': {
        backgroundColor: theme.palette.grey[100],
        borderColor: theme.palette.grey[400],
    },
}));

const VisuallyHiddenInput = styled('input')({
    clip: 'rect(0 0 0 0)',
    clipPath: 'inset(50%)',
    height: 1,
    overflow: 'hidden',
    position: 'absolute',
    bottom: 0,
    left: 0,
    whiteSpace: 'nowrap',
    width: 1,
});

function App() {
    const [station, setStation] = useState('XYZ1');
    const [shortcode, setShortcode] = useState('TEST');
    const [vehicles, setVehicles] = useState([{ licensePlate: '', vin: '' }]);
    const [generatedVehicles, setGeneratedVehicles] = useState([]);
    const [qrCodeCount, setQrCodeCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    const qrCodeIconRef = useRef();

    useEffect(() => {
        const updateFavicon = () => {
            if (qrCodeIconRef.current) {
                const svgString = new XMLSerializer().serializeToString(qrCodeIconRef.current.querySelector('svg'));
                const canvas = document.createElement('canvas');
                canvas.width = 32;
                canvas.height = 32;
                const ctx = canvas.getContext('2d');
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, 0, 32, 32);
                    const link = document.querySelector("link[rel*='icon']") || document.createElement('link');
                    link.type = 'image/x-icon';
                    link.rel = 'shortcut icon';
                    link.href = canvas.toDataURL();
                    document.getElementsByTagName('head')[0].appendChild(link);
                };
                img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
            }
        };

        updateFavicon();
    }, []);

    const handleStationChange = (event) => {
        const value = event.target.value.trim();
        if (value.length <= 20) {
            setStation(value);
        } else {
            setSnackbar({ open: true, message: 'Station name must be 20 characters or less', severity: 'error' });
        }
    };

    const handleShortcodeChange = (event) => {
        const value = event.target.value.trim();
        if (value.length <= 10) {
            setShortcode(value);
        } else {
            setSnackbar({ open: true, message: 'Shortcode must be 10 characters or less', severity: 'error' });
        }
    };

    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    const handleVehicleChange = (index, field, value) => {
        const newVehicles = [...vehicles];
        newVehicles[index][field] = value.trim();
    
        // Basic input validation
        if (field === 'licensePlate' && !/^[A-Za-z0-9 -]{1,20}$/.test(value)) {
            setSnackbar({ open: true, message: 'Invalid license plate format', severity: 'error' });
            return;
        }
        if (field === 'vin' && !/^[A-HJ-NPR-Z0-9]{17}$/.test(value)) {
            setSnackbar({ open: true, message: 'Invalid VIN format', severity: 'error' });
            return;
        }

        setVehicles(newVehicles);

        // Generate QR codes dynamically
        const validVehicles = newVehicles.filter(v => v.licensePlate && v.vin);
        setGeneratedVehicles(validVehicles);

        if (index === vehicles.length - 1 && newVehicles[index].licensePlate && newVehicles[index].vin) {
            addVehicle();
        }
    };

    // Effect to update generatedVehicles whenever vehicles change
    React.useEffect(() => {
        const validVehicles = vehicles.filter(v => v.licensePlate && v.vin);
        setGeneratedVehicles(validVehicles);
        setQrCodeCount(validVehicles.length);
    }, [vehicles]);

    const addVehicle = () => {
        setVehicles([...vehicles, { licensePlate: '', vin: '' }]);
    };

    const removeVehicle = (index) => {
        const newVehicles = vehicles.filter((_, i) => i !== index);
        setVehicles(newVehicles);
    };

    // Remove handleSubmit function as it's no longer needed

    const handlePrint = () => {
        window.print();
    };

    const handleClear = () => {
        setStation('XYZ1');
        setShortcode('TEST');
        setVehicles([{ licensePlate: '', vin: '' }]);
        setGeneratedVehicles([]);
        setQrCodeCount(0);
        setSnackbar({ open: true, message: 'All data cleared', severity: 'info' });
        
        // Reset the file input
        const fileInput = document.getElementById('upload-excel-file');
        if (fileInput) {
            fileInput.value = '';
        }
    };

    const processExcelData = useCallback((data) => {
        if (data.length > 0) {
            const newVehicles = data.map(row => ({
                licensePlate: row['License Plate'] || '',
                vin: row['VIN'] || ''
            })).filter(vehicle => vehicle.licensePlate || vehicle.vin);

            setVehicles(newVehicles);
        }
    }, [setVehicles]);

    const handleFileUpload = useCallback((file) => {
        if (!file) return;

        // Check file size (e.g., max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            setSnackbar({ open: true, message: 'File size exceeds 5MB limit', severity: 'error' });
            return;
        }

        // Check file type
        if (!['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'].includes(file.type)) {
            setSnackbar({ open: true, message: 'Invalid file type. Please upload an Excel file.', severity: 'error' });
            return;
        }

        // Clear existing data before processing new file
        setVehicles([]);
        setGeneratedVehicles([]);
        setIsLoading(true);

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json(ws);
                processExcelData(data);
                setSnackbar({ open: true, message: 'File uploaded successfully', severity: 'success' });
            } catch (error) {
                console.error('Error processing file:', error);
                setSnackbar({ open: true, message: 'Error processing file', severity: 'error' });
            } finally {
                setIsLoading(false);
            }
        };
        reader.onerror = (error) => {
            console.error('Error reading file:', error);
            setSnackbar({ open: true, message: 'Error reading file', severity: 'error' });
            setIsLoading(false);
        };
        reader.readAsBinaryString(file);
    }, [setSnackbar, setVehicles, setGeneratedVehicles, processExcelData]);

    const handleDownloadExample = () => {
        const worksheet = XLSX.utils.json_to_sheet([
            { 'License Plate': 'ABC123', 'VIN': '1HGBH41JXMN109186' },
            { 'License Plate': 'XYZ789', 'VIN': 'WAUGGAFR1DA002148' },
        ]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Vehicles");
        XLSX.writeFile(workbook, "example_vehicle_data.xlsx");
    };

    const downloadAsPng = useCallback((index) => {
        const element = document.getElementById(`vehicle-frame-${index}`);
        if (element) {
            html2canvas(element, {
                scale: 3, // Increase scale for higher resolution
                useCORS: true, // Enable CORS to handle cross-origin images
                logging: false, // Disable logging for better performance
            }).then((canvas) => {
                const link = document.createElement('a');
                const licensePlate = generatedVehicles[index].licensePlate.replace(/\s+/g, '_');
                link.download = `${licensePlate}.png`;
                link.href = canvas.toDataURL('image/png', 1.0); // Use maximum quality
                link.click();
            }).catch(error => {
                console.error('Error generating PNG:', error);
                setSnackbar({ open: true, message: 'Error generating PNG', severity: 'error' });
            });
        }
    }, [generatedVehicles, setSnackbar]);

    const renderPrintVersion = () => (
        <div className="print-version">
            {chunk(generatedVehicles, 8).map((pageVehicles, pageIndex) => (
                <div key={pageIndex} className="print-page">
                    {pageVehicles.map((vehicle, index) => (
                        <div key={index} className="vehicle-frame-print">
                            <div className="title">{station}</div>
                            <div className="shortcode">{shortcode}</div>
                            <div className="license-plate">License Plate: <span className="bold-text">{vehicle.licensePlate}</span></div>
                            <div className="vin">VIN: <span className="bold-text">{vehicle.vin}</span></div>
                            <div className="qr-code">
                                <QRCode value={vehicle.vin} size={128} />
                            </div>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );

    const chunk = (arr, size) =>
        Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
            arr.slice(i * size, i * size + size)
        );

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <div style={{ display: 'none' }}>
                <QrCodeIconComponent ref={qrCodeIconRef} />
            </div>
            <div className="App">
                <Header />
                <Grid container spacing={2} sx={{ p: 2 }}>
                    <Grid item xs={12} md={5}>
                        <Box sx={{ maxWidth: 600, marginRight: 'auto' }}>
                            <form>
                        <Button
                            variant="outlined"
                            startIcon={<CloudDownloadIcon />}
                            onClick={handleDownloadExample}
                            fullWidth
                            sx={{ mb: 2 }}
                        >
                            Download Example Excel File
                        </Button>

                        <UploadButton handleFileUpload={handleFileUpload} />

                        {isLoading && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                                <CircularProgress />
                            </Box>
                        )}

                        <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 2, mb: 1 }}>
                            <TextField
                                label="Station"
                                value={station}
                                onChange={handleStationChange}
                                variant="outlined"
                                size="small"
                                sx={{ width: '120px', mr: 2 }}
                            />
                            <TextField
                                label="Shortcode"
                                value={shortcode}
                                onChange={handleShortcodeChange}
                                variant="outlined"
                                size="small"
                                sx={{ width: '120px' }}
                            />
                        </Box>

                        <Box sx={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: '4px', p: 1 }}>
                            {vehicles.map((vehicle, index) => (
                                <Box key={index} sx={{ display: 'flex', mb: 2 }}>
                                    <TextField
                                        label={`License Plate ${index + 1}`}
                                        value={vehicle.licensePlate}
                                        onChange={(e) => handleVehicleChange(index, 'licensePlate', e.target.value)}
                                        variant="outlined"
                                        size="small"
                                        sx={{ mr: 1, flexGrow: 1 }}
                                    />
                                    <TextField
                                        label={`VIN ${index + 1}`}
                                        value={vehicle.vin}
                                        onChange={(e) => handleVehicleChange(index, 'vin', e.target.value)}
                                        variant="outlined"
                                        size="small"
                                        sx={{ flexGrow: 1 }}
                                    />
                                    {vehicles.length > 1 && (
                                        <IconButton onClick={() => removeVehicle(index)} color="secondary">
                                            <DeleteOutlineIcon />
                                        </IconButton>
                                    )}
                                </Box>
                            ))}
                        </Box>

                        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
                            <Button
                                variant="contained"
                                color="secondary"
                                onClick={handlePrint}
                                sx={{ mr: 1 }}
                            >
                                Print
                            </Button>
                            <Button
                                variant="contained"
                                color="error"
                                onClick={handleClear}
                                sx={{ mr: 1 }}
                            >
                                Clear
                            </Button>
                            <Chip
                                icon={<QrCodeIcon />}
                                label={`${qrCodeCount} QR Codes generated`}
                                color="primary"
                                variant="filled"
                                sx={{ mr: 1 }}
                            />
                        </Box>
                            </form>
                        </Box>
                    </Grid>
                    <Grid item xs={12} md={7}>
                        <Box sx={{ height: '80vh', overflowY: 'auto', marginLeft: '0' }}>
                            <div className="container">
                                {generatedVehicles.map((vehicle, index) => (
                                    <div
                                        key={index}
                                        className="vehicle-frame"
                                        id={`vehicle-frame-${index}`}
                                        onClick={() => downloadAsPng(index)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <div className="title">{station}</div>
                                        <div className="shortcode">{shortcode}</div>
                                        <div className="license-plate">License Plate: <span className="bold-text">{vehicle.licensePlate}</span></div>
                                        <div className="vin">VIN:<span className="bold-text"> {vehicle.vin}</span></div>
                                        <div className="qr-code">
                                            <QRCode value={vehicle.vin} size={320} level="H" renderAs="svg"/>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Box>
                    </Grid>
                </Grid>
            </div>
            {renderPrintVersion()}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={6000}
                onClose={() => setSnackbar({ ...snackbar, open: false })}
                message={snackbar.message}
                severity={snackbar.severity}
                anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
            />
        </ThemeProvider>
    );
}

export default App;
