# AI-Based Product Label Compliance Checker

A limited five-declaration food-package review MVP using PaddleOCR and the Legal Metrology (Packaged Commodities) Rules, 2011. It is not a complete legal compliance assessment or certification tool.

## Architecture

- `frontend/`: React + Vite user interface
- `backend/`: Node.js + Express API
- `ai-service/`: Python + FastAPI + PaddleOCR/OpenCV image and PDF text extraction
- MongoDB: Mongoose persistence for configurable compliance rules and generated reports

**Important:** This is a development starter, not a legal compliance certification tool. OCR may miss text, and a missing OCR result is not proof that a declaration is absent. Legal rules must be verified against current official sources and their applicability before production use.

## Requirements

- Node.js LTS and npm
- Python 3.11 (recommended for the pinned PaddleOCR CPU dependencies)
- MongoDB (required to persist and retrieve compliance reports)
- Git (optional but recommended)

## Run the project

Open three terminals from the project root.

### 1. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

### 2. Backend

```powershell
cd backend
npm install
npm run dev
```

Test: `http://localhost:5000/api/health`

### 3. Python AI service

```powershell
cd ai-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

Test: `http://localhost:8000/api/health` and `http://localhost:8000/docs`.

If PowerShell blocks activation, run this in that terminal:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

## MongoDB setup

1. Start a MongoDB instance or create a MongoDB Atlas deployment.
2. Copy `backend/.env.example` to `backend/.env`.
3. Set `MONGO_URI` to the connection string.
4. Keep `.env` private; never commit it.

The backend seeds the five default rules into the `compliancerules` collection when it connects. The database values are used for rule metadata, matching keywords, units, and thresholds. Reports and OCR results are written to `compliancereports`; original uploaded files are not retained. If MongoDB is not configured or available, a report can be generated for the current response, but it is explicitly marked as not saved and cannot be retrieved later.

## Current functionality

- Responsive frontend workspace with backend and AI-service health indicators.
- Product-label image/PDF upload with JPG, PNG, WEBP and PDF validation, drag-and-drop and 10 MB limit.
- Express forwards uploads from memory to FastAPI; PDF pages are rendered in memory with PyMuPDF and passed through the existing PaddleOCR engine.
- CPU PaddleOCR text detection and recognition with confidence scores and bounding boxes.
- OpenCV preprocessing is compared with the original image when initial OCR confidence is low.
- Five independent checks: MRP, net quantity, manufacturer/packer/importer, date declaration, and consumer-care details.
- OCR-context and pattern-based extraction for the selected declarations; unrelated numbers/dates are not treated as declarations.
- Each check returns `COMPLIANT`, `NON-COMPLIANT`, or `NEEDS MANUAL VERIFICATION`, with evidence, confidence, rationale, corrective action, and rule reference.
- Missing declarations are marked non-compliant only when the user confirms rule applicability, complete label coverage, and readable OCR. Unconfirmed applicability, poor OCR, or ambiguous information stays manual.
- A database-backed report retrieval endpoint is available when MongoDB is connected.

## Legal scope and safeguards

- The rules data is in `backend/config/complianceRules.json` and is seeded once into MongoDB. It records clauses, source links, effective dates, versions, validation conditions, and applicability/exemption notes; update it only after checking current official legal sources.
- The configuration cites the Ministry of Consumer Affairs' consolidated Rules and official Gazette amendments. Rule metadata is reviewed through G.S.R. 826(E), dated 21 September 2026.
- Rule 6(1)(a), Explanation III expressly excludes food-package manufacturer details and points to the Food Safety and Standards Act, 2006. Rule 6(1)(d) has a separate food-article proviso. Those two rows therefore remain `NEEDS MANUAL VERIFICATION`; this MVP does not assess FSSAI declarations.
- Rule 6(1)(e) has product-specific provisos (including alcoholic beverages/spirituous liquor and authority-fixed essential-commodity prices); Rule 6(2) requires the complaint contact name, address, telephone and email. Rule 3 and Rule 26 also contain applicability limits and exemptions. The UI requires the user to confirm applicability before automatic scoring.
- The MRP check looks for an MRP context, Indian currency, tax-inclusive wording and the stated rupee/50-paise rounding. Net quantity is tied to a nearby net-quantity label and recognized units. Contact details must be associated with consumer-complaint context.
- OCR confidence is not legal proof. This tool is a screening aid, does not identify products or assess all labeling laws, and must not be used as legal advice or a compliance certification.

## API endpoints

- `GET /api/health` — Express health and MongoDB state.
- `GET /api/health` on FastAPI — OCR service health.
- `POST /api/image/inspect` — OCR extraction for an image or PDF.
- `POST /api/compliance/check` — OCR plus the five-check report; multipart fields are `file`, `ruleApplicabilityConfirmed`, and `completeLabelConfirmed`.
- `GET /api/compliance/rules` — the active five-rule configuration.
- `GET /api/compliance/reports/:reportId` — retrieve a saved report when MongoDB is online.

## Tests

Run the backend declaration-extraction tests:

```powershell
cd backend
npm test
```

The test suite covers context association, conditional missing-field findings, low-confidence handling, food-specific manual checks, and report totals. Real OCR extraction should also be checked using representative product packages; a generated test page does not establish accuracy on commercial packaging.
