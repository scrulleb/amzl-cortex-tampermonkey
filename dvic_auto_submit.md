```markdown
# Feature: DVIC Auto-Submit TamperMonkey Script

## Overview

Automate the Driver Vehicle Inspection Checklist (DVIC) submission process on
`https://logistics.amazon.de`. The script runs as a TamperMonkey userscript
inside the user's authenticated browser session. It generates a minimal dummy
PNG file, uploads it through Amazon's document pipeline, and submits the
inspection — all in one click.

## Context

The DVIC submission is a **pro-forma process** that requires uploading a
document (screenshot/PDF of the inspection) and then submitting the inspection
payload. The actual file content is irrelevant — Amazon only validates that a
file was uploaded, not its contents. This makes it possible to generate a 1x1
transparent PNG client-side and use that as the upload artifact.

---

## Architecture

The script must execute **4 sequential API calls**, all authenticated via the
browser's existing session cookies (`credentials: 'include'`).

```
┌─────────────────────────┐
│ 1. GET  /document/api/v2/template        → upload credentials
│ 2. POST /flexam/documents/upload/v2      → upload dummy PNG
│ 3. POST /document/api/v1/metadata        → register file metadata
│ 4. POST /fleet-management/api/inspections → submit inspection
└─────────────────────────┘
```

---

## API Specification

### Step 1: Get Upload Template

Retrieves server-generated signature, session ID, token, and upload parameters.

| Field         | Value                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| **URL**       | `https://logistics.amazon.de/document/api/v2/template`                         |
| **Method**    | `GET`                                                                          |
| **Auth**      | Session cookies (automatic via `credentials: 'include'`)                       |

**Query Parameters:**

| Param          | Value                    |
| -------------- | ------------------------ |
| `docClass`     | `PaperInspectionReport`  |
| `numFiles`     | `1`                      |
| `numCSVFiles`  | `0`                      |
| `clientAppId`  | `FleetMgmt`              |

**Response (JSON):**

```json
{
  "enctype": "multipart/form-data",
  "AX-Signature": "<server-generated RSA signature>",
  "method": "POST",
  "AX-SessionID": "<session-id>",
  "requestId": "<request-id>",
  "AX-DocumentDisposition": "KAAGZAAT_PLATFORM-file-1=urn:alx:cls:<class-id>",
  "filenames": ["KAAGZAAT_PLATFORM-file-1"],
  "action": "/flexam/documents/upload/v2",
  "accept": "audio,video,zip,...,image-png,...",
  "token": "<url-encoded-token>"
}
```

**Key fields to extract and forward:**

- `AX-Signature` → used in Step 2
- `AX-SessionID` → used in Step 2
- `AX-DocumentDisposition` → used in Step 2
- `filenames[0]` → form field name for file in Step 2
- `action` → upload endpoint path for Step 2
- `token` → used in Step 3 (must be **double-encoded** for the query string)

---

### Step 2: Upload Dummy File

Uploads the generated dummy PNG via multipart form POST.

| Field         | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| **URL**       | `https://logistics.amazon.de/flexam/documents/upload/v2`     |
| **Method**    | `POST`                                                       |
| **Encoding**  | `multipart/form-data`                                        |

**Form Fields:**

| Field                      | Value                                              |
| -------------------------- | -------------------------------------------------- |
| `_utf8_enable`             | `✓` (literal checkmark character)                  |
| `AX-SessionID`             | from Step 1 response                               |
| `AX-DocumentDisposition`   | from Step 1 response                               |
| `AX-Signature`             | from Step 1 response                               |
| `KAAGZAAT_PLATFORM-file-1` | the dummy PNG `File` object (field name from Step 1 `filenames[0]`) |

**Response:**

The response body is prefixed with `while(1);` as an anti-JSON-hijacking
measure. **Strip this prefix** before parsing.

```json
{
  "type": "REQUEST_SUCCEEDED",
  "version": "1.0",
  "content": {
    "documentUploadResponseList": {
      "KAAGZAAT_PLATFORM-file-1": {
        "operation": "DOCUMENT_UPLOAD",
        "content": {
          "documentClassId": "urn:alx:cls:<class-id>",
          "documentId": "urn:alx:doc:<class-id>:<doc-uuid>",
          "contentLength": 95
        },
        "status": "SUCCESSFUL"
      }
    },
    "requestId": "<request-id>",
    "passthroughFields": {}
  }
}
```

**Key field to extract:**

- `content.documentUploadResponseList[filenames[0]].content.documentId` → used
  as `storeToken` in Step 3

---

### Step 3: Set Document Metadata

Associates the uploaded document with the vehicle.

| Field         | Value                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| **URL**       | `https://logistics.amazon.de/document/api/v1/metadata`                 |
| **Method**    | `POST`                                                                 |
| **Headers**   | `Content-Type: application/json`                                       |

**Query Parameters:**

| Param         | Value                                                                                |
| ------------- | ------------------------------------------------------------------------------------ |
| `clientAppId` | `FleetMgmt`                                                                         |
| `token`       | from Step 1 response — **double URL-encoded** (encode the already-encoded token once more) |

> **Important:** The token from Step 1 is already URL-encoded. For the metadata
> endpoint query string, it must be encoded **again**. Example:
> `gxJNLBjiprc7gFy%2BMWeBaO%2B...` becomes
> `gxJNLBjiprc7gFy%252BMWeBaO%252B...`

**Request Body (JSON):**

```json
{
  "docSubjectId": "<vehicle-asset-id>",
  "docClass": "PaperInspectionReport",
  "docSubjectType": "Vehicle",
  "files": [
    {
      "title": "inspection-report.png",
      "storeToken": "<documentId from Step 2>",
      "fileStore": "Alexandria"
    }
  ]
}
```

**Response (JSON):**

```json
{
  "docSubjectId": "<vehicle-asset-id>",
  "docClass": "PaperInspectionReport",
  "docInstanceId": "<generated-instance-uuid>",
  "docSubjectType": "Vehicle",
  "docVersion": 1,
  "docLifecycleStatus": "ACTIVE",
  "files": [...]
}
```

**Key field to extract:**

- `docInstanceId` → used as `paperInspectionDocId` in Step 4

---

### Step 4: Submit Inspection

Final API call that creates the inspection record.

| Field         | Value                                                          |
| ------------- | -------------------------------------------------------------- |
| **URL**       | `https://logistics.amazon.de/fleet-management/api/inspections` |
| **Method**    | `POST`                                                         |
| **Headers**   | `Content-Type: application/json`                               |

**Request Body (JSON):**

```json
{
  "inspectionStartTime": 1774432800000,
  "inspectionType": "POST_TRIP_DVIC",
  "VIN": "WV1ZZZSY1R9005534",
  "defectsFound": [],
  "paperInspectionDocId": "<docInstanceId from Step 3>",
  "reporterId": "A2K2OSTD4MJ2MG",
  "serviceAreaId": "cf144c46-1c56-44d3-b344-fcd32986b6d5"
}
```

**Field explanations:**

| Field                     | Description                                          | Source                              |
| ------------------------- | ---------------------------------------------------- | ----------------------------------- |
| `inspectionStartTime`     | Unix timestamp in milliseconds                       | Generate dynamically or user input  |
| `inspectionType`          | `"PRE_TRIP_DVIC"` or `"POST_TRIP_DVIC"`              | User selection / page context       |
| `VIN`                     | Vehicle Identification Number                        | Extract from page                   |
| `defectsFound`            | Array of defect objects (empty = no defects)          | Hardcoded `[]` for auto-submit      |
| `paperInspectionDocId`    | UUID linking to the uploaded document                 | `docInstanceId` from Step 3         |
| `reporterId`              | Amazon transporter/driver ID                          | Extract from page or hardcode       |
| `serviceAreaId`           | UUID of the service area                              | Extract from page or hardcode       |

**Response (JSON):**

```json
{
  "meta": null,
  "data": "GROUNDED"
}
```

> Note: `"GROUNDED"` appears to be a valid success status in this context.

---

## Dummy PNG Generation

Generate a minimal 1x1 transparent PNG entirely client-side. No external
libraries needed.

```javascript
function createDummyPNG() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(
          new File([blob], "inspection-report.png", { type: "image/png" })
        );
      },
      "image/png"
    );
  });
}
```

---

## Data Extraction from Page

The script needs to extract dynamic values from the current page. These values
change per vehicle/inspection. Identify them from the DOM or from embedded
JavaScript data:

| Value              | Where to find                                                           |
| ------------------ | ----------------------------------------------------------------------- |
| `VIN`              | Visible on page header (e.g. `VIN: WV1ZZZ7HZPH046393`)                 |
| `docSubjectId`     | Hidden in page data / React state (e.g. `aaid_c823dc16-...`)           |
| `reporterId`       | Transporter ID shown on page (e.g. `A2K2OSTD4MJ2MG`)                   |
| `serviceAreaId`    | Hidden in page data / React state (e.g. `cf144c46-...`)                |
| `inspectionType`   | Shown on page as "Pre-trip" or "Post-trip" → map to enum                |
| `inspectionStartTime` | Shown on page as date → convert to unix ms timestamp                 |

> **Implementation Note:** Inspect the page DOM and any `window.__DATA__`,
> `window.__NEXT_DATA__`, or similar global objects that Amazon's frontend may
> expose. React DevTools or searching `document.body.innerHTML` for known UUIDs
> can help locate these values.

---

## TamperMonkey Script Requirements

### UserScript Header

```javascript
// ==UserScript==
// @name         DVIC Auto-Submit
// @namespace    https://logistics.amazon.de
// @version      1.0
// @description  One-click DVIC inspection submission with dummy document
// @match        https://logistics.amazon.de/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
```

### UI Requirements

- Add a clearly visible button (e.g. `⚡ Auto Submit DVIC`) near the existing
  "Submit inspection" button on the review page
- Show a loading state while the 4 API calls execute
- Show success/error feedback via a toast notification or alert
- Log all API responses to `console.log` for debugging

### Error Handling

- Each API call must check for HTTP errors and non-success responses
- If any step fails, abort the chain and show which step failed
- Log the full error response body for debugging

### Token Double-Encoding

This is the trickiest part. The `token` from Step 1 is already URL-encoded.
When constructing the query string for Step 3, apply `encodeURIComponent()`
**once more** to achieve double-encoding:

```javascript
const doubleEncodedToken = encodeURIComponent(templateData.token);
const metadataUrl = `https://logistics.amazon.de/document/api/v1/metadata?clientAppId=FleetMgmt&token=${doubleEncodedToken}`;
```

---

## File Structure

Single file: `dvic-auto-submit.user.js`

All logic self-contained in an IIFE. No external dependencies.

---

## Testing Checklist

- [ ] Step 1 returns valid template with signature and token
- [ ] Step 2 upload succeeds with dummy PNG (check `status: "SUCCESSFUL"`)
- [ ] Step 3 metadata creation returns `docInstanceId`
- [ ] Step 4 inspection submission returns success response
- [ ] Button appears on the DVIC review page
- [ ] Error states are handled gracefully
- [ ] All dynamic values (VIN, IDs, timestamps) are correctly extracted from page
- [ ] Token is correctly double-encoded for Step 3
```