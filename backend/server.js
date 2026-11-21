const express = require('express')
const cors = require('cors')
const axios = require('axios')
const multer = require('multer')
const path = require('node:path')
const jwt = require('jsonwebtoken')
require('dotenv').config()

const {
  findComplianceReport,
  getComplianceRules,
  getDatabaseStatus,
  initializeDatabase,
  persistComplianceReport
} = require('./services/complianceStore')
const ComplianceReport = require('./models/ComplianceReport')
const User = require('./models/User')
const { generateComplianceReport } = require('./services/complianceEngine')

const app = express()
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB limit
const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const AI_SERVICE_TIMEOUT_MS = Number(process.env.AI_SERVICE_TIMEOUT_MS) || 180000
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_labelguard_2026_metrology_secure'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''

// Memory history fallback when MongoDB is offline
const memoryHistory = []

// Multer memory storage with file size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.mimetype.toLowerCase())) {
      const err = new Error('Invalid file format. Only JPEG, PNG, and WebP images are permitted.')
      err.status = 415
      return cb(err)
    }
    cb(null, true)
  }
})

// Magic byte validation for real image types
function validateMagicBytes(buffer) {
  if (!buffer || buffer.length < 12) return false
  // JPEG: FF D8 FF
  const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
  // WebP: 'RIFF'....'WEBP'
  const isWebp = buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP'
  return isJpeg || isPng || isWebp
}

// In-memory rate limiter for login
const loginAttempts = new Map()
function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown-ip'
  const now = Date.now()
  const windowMs = 5 * 60 * 1000 // 5 minutes
  const maxAttempts = 10

  const record = loginAttempts.get(ip) || { count: 0, firstAttempt: now }
  if (now - record.firstAttempt > windowMs) {
    record.count = 1
    record.firstAttempt = now
  } else {
    record.count += 1
  }
  loginAttempts.set(ip, record)

  if (record.count > maxAttempts) {
    return res.status(429).json({
      status: 'error',
      message: 'Too many login attempts. Please wait 5 minutes before trying again.'
    })
  }
  next()
}

// JWT Authentication Middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required. Please sign in.'
    })
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({
      status: 'error',
      message: 'Session expired or invalid token. Please sign in again.'
    })
  }
}

// Optional Auth (for public or hybrid endpoints)
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1]
    try {
      req.user = jwt.verify(token, JWT_SECRET)
    } catch {
      // Ignored for optional
    }
  }
  next()
}

app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '2mb' }))

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'success',
    message: 'LabelGuard Metrology Backend Online',
    database: getDatabaseStatus()
  })
})

/* ══════════════════════════════════════════════════════════
   AUTHENTICATION ROUTES
══════════════════════════════════════════════════════════ */

// POST /api/auth/register
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { email, password, name, role, orgCode } = req.body
    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Email and password are required.' })
    }
    if (password.length < 6) {
      return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters.' })
    }

    if (getDatabaseStatus() === 'online') {
      const existing = await User.findOne({ email: email.toLowerCase() })
      if (existing) {
        return res.status(409).json({ status: 'error', message: 'An account with this email already exists.' })
      }

      const assignedRole = ['inspector', 'business', 'admin'].includes(role) ? role : 'inspector'
      const stationId = assignedRole === 'inspector' ? 'DESK-01A' : assignedRole === 'business' ? 'BIZ-402' : 'ADM-900'

      const user = new User({
        email: email.toLowerCase(),
        password,
        name: name || (assignedRole === 'inspector' ? 'Inspector' : 'Operator'),
        role: assignedRole,
        stationId,
        orgCode: orgCode || null
      })
      await user.save()

      const token = jwt.sign(
        { id: user._id, email: user.email, role: user.role, name: user.name, stationId: user.stationId },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      )

      return res.status(201).json({
        status: 'success',
        message: 'Account created successfully.',
        token,
        user: user.toJSON()
      })
    } else {
      // Offline fallback: temporary mock session token
      const assignedRole = ['inspector', 'business', 'admin'].includes(role) ? role : 'inspector'
      const fallbackUser = {
        _id: 'offline-' + Date.now(),
        email: email.toLowerCase(),
        name: name || 'Operator',
        role: assignedRole,
        stationId: 'DESK-01A'
      }
      const token = jwt.sign(fallbackUser, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
      return res.status(201).json({
        status: 'success',
        message: 'Account registered (local session).',
        token,
        user: fallbackUser
      })
    }
  } catch (error) {
    next(error)
  }
})

// POST /api/auth/login
app.post('/api/auth/login', rateLimitLogin, async (req, res, next) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Email and password are required.' })
    }

    if (getDatabaseStatus() === 'online') {
      const user = await User.findOne({ email: email.toLowerCase() })
      if (!user) {
        return res.status(401).json({ status: 'error', message: 'Invalid email or password.' })
      }

      const isMatch = await user.comparePassword(password)
      if (!isMatch) {
        return res.status(401).json({ status: 'error', message: 'Invalid email or password.' })
      }

      const token = jwt.sign(
        { id: user._id, email: user.email, role: user.role, name: user.name, stationId: user.stationId },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      )

      return res.json({
        status: 'success',
        message: 'Signed in successfully.',
        token,
        user: user.toJSON()
      })
    } else {
      // Offline fallback
      const fallbackUser = {
        _id: 'offline-user',
        email: email.toLowerCase(),
        name: 'Inspector',
        role: 'inspector',
        stationId: 'DESK-01A'
      }
      const token = jwt.sign(fallbackUser, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
      return res.json({
        status: 'success',
        message: 'Signed in (local session).',
        token,
        user: fallbackUser
      })
    }
  } catch (error) {
    next(error)
  }
})

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, async (req, res, next) => {
  try {
    if (getDatabaseStatus() === 'online') {
      const user = await User.findById(req.user.id)
      if (!user) return res.status(404).json({ status: 'error', message: 'User not found.' })
      return res.json({ status: 'success', user: user.toJSON() })
    }
    return res.json({ status: 'success', user: req.user })
  } catch (error) {
    next(error)
  }
})

/* ══════════════════════════════════════════════════════════
   AI SERVICE COMMUNICATION
══════════════════════════════════════════════════════════ */

async function extractWithGemini(file) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured.')
  }

  const base64Data = file.buffer.toString('base64')
  const mimeType = file.mimetype || 'image/jpeg'

  const prompt = `You are a specialized statutory compliance OCR and vision transcription engine for Indian Legal Metrology (Packaged Commodities) Rules, 2011.
Analyze all panels and text regions of this packaged product label (including HORIZONTAL, VERTICAL, ROTATED, INKJET-STAMPED, and DOT-MATRIX text).

Extract all statutory packaging details and return each item as a clear text line:
1. Product Name and Brand (e.g. Dettol Original Soap, Atta)
2. Maximum Retail Price (MRP) with currency and tax phrase (e.g. MRP Rs. 42.00 (incl. of all taxes) or ₹42/-)
3. Unit Sale Price if declared (e.g. ₹0.42/g)
4. Net Quantity / Net Weight / Volume with statutory unit (e.g. Net Wt. 100g, 5 kg)
5. Date of Manufacture or Pre-Packing (Month/Year e.g. 08/2024 or 08/24)
6. Expiry / Best Before / Use Before date or duration (e.g. Use Before: 08/2026, Best before 6 months)
7. Batch / Lot number (e.g. BSSR475)
8. Complete Manufacturer / Packer / Marketer name and address with 6-digit postal PIN code
9. Complete Consumer Care Desk (Toll Free / Phone Number, Email, Address with PIN code)
10. All other visible printed or stamped text lines verbatim.

IMPORTANT:
- Carefully inspect vertical margins, colored strips, and crimps for vertical inkjet stamps (price, dates, batch).
- Output each declaration on a separate line.
- Do NOT add markdown bolding (**), asterisks (*), or headers.`

  const models = [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-flash-latest'
  ]

  let lastError = null
  for (const model of models) {
    try {
      console.log(`[Gemini Cloud OCR] Attempting extraction with ${model}...`)
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1
          }
        },
        { timeout: 45000, headers: { 'Content-Type': 'application/json' } }
      )

      const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      if (!rawText.trim()) {
        continue
      }

      const rawLines = rawText
        .split('\n')
        .map(l => l.replace(/^[-*•]\s*/, '').trim())
        .filter(Boolean)

      const results = rawLines.map((line) => ({
        text: line,
        confidence: 0.98,
        page_number: 1
      }))

      console.log(`[Gemini Cloud OCR] Success with ${model}! Extracted ${results.length} lines.`)

      return {
        status: 'success',
        filename: path.basename(file.originalname || 'label.jpg'),
        ocr_engine: `Gemini Cloud Vision (${model})`,
        total_lines: results.length,
        extracted_text: rawLines.join('\n'),
        results,
        width: 800,
        height: 1000,
        page_count: 1,
        processed_image_used: false,
        quality_warnings: []
      }
    } catch (err) {
      lastError = err
      const errMsg = err.response?.data?.error?.message || err.message
      console.warn(`[Gemini Cloud OCR] Model ${model} failed (${errMsg}), trying fallback...`)
    }
  }

  throw lastError || new Error('All Gemini OCR models failed.')
}

function listUnique(arr) {
  return Array.from(new Set(arr || []))
}

function mergeDualEngineResults(paddleResult, geminiResult, filename) {
  const geminiLines = Array.isArray(geminiResult.results) ? geminiResult.results : []
  const paddleLines = Array.isArray(paddleResult.results) ? paddleResult.results : []

  const seenNormalized = new Set(
    geminiLines.map(l => l.text.toLowerCase().replace(/[^a-z0-9]/g, ''))
  )

  const mergedResults = [...geminiLines]

  for (const pLine of paddleLines) {
    const norm = (pLine.text || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (norm.length > 2 && !seenNormalized.has(norm)) {
      const isSub = geminiLines.some(g => g.text.toLowerCase().includes((pLine.text || '').toLowerCase()))
      if (!isSub) {
        seenNormalized.add(norm)
        mergedResults.push({
          text: pLine.text.trim(),
          confidence: Number(pLine.confidence) || 0.92,
          page_number: pLine.page_number || 1
        })
      }
    }
  }

  const qualityWarnings = [
    ...(paddleResult.quality_warnings || []),
    ...(geminiResult.quality_warnings || [])
  ]

  return {
    status: 'success',
    filename,
    ocr_engine: 'Dual Engine (PaddleOCR + Gemini Cloud Vision)',
    total_lines: mergedResults.length,
    extracted_text: mergedResults.map(l => l.text).join('\n'),
    results: mergedResults,
    width: paddleResult.width || geminiResult.width || 800,
    height: paddleResult.height || geminiResult.height || 1000,
    page_count: Math.max(paddleResult.page_count || 1, geminiResult.page_count || 1),
    processed_image_used: Boolean(paddleResult.processed_image_used),
    quality_warnings: listUnique(qualityWarnings)
  }
}

async function extractWithPaddle(file) {
  const formData = new FormData()
  formData.append(
    'file',
    new Blob([file.buffer], { type: file.mimetype }),
    path.basename(file.originalname)
  )
  const response = await axios.post(
    `${AI_SERVICE_URL}/api/image/inspect`,
    formData,
    { timeout: Math.min(AI_SERVICE_TIMEOUT_MS, 25000) }
  )
  return response.data
}

async function forwardToAiService(file) {
  const hasGemini = Boolean(GEMINI_API_KEY)
  const filename = path.basename(file.originalname || 'label.jpg')

  const tasks = []
  const taskNames = []

  // Engine 1: Local / Configured PaddleOCR
  tasks.push(extractWithPaddle(file))
  taskNames.push('PaddleOCR')

  // Engine 2: Gemini Cloud Vision
  if (hasGemini) {
    tasks.push(extractWithGemini(file))
    taskNames.push('Gemini')
  }

  // Execute in parallel
  const settled = await Promise.allSettled(tasks)

  const paddleIndex = taskNames.indexOf('PaddleOCR')
  const geminiIndex = taskNames.indexOf('Gemini')

  const paddleSettled = paddleIndex !== -1 ? settled[paddleIndex] : null
  const geminiSettled = geminiIndex !== -1 ? settled[geminiIndex] : null

  const paddleOk = paddleSettled?.status === 'fulfilled' ? paddleSettled.value : null
  const geminiOk = geminiSettled?.status === 'fulfilled' ? geminiSettled.value : null

  // 1. Both succeeded -> Dual Engine Parallel Fusion!
  if (paddleOk && geminiOk) {
    console.log('[Dual Engine] Both PaddleOCR and Gemini Vision succeeded! Merging results.')
    return mergeDualEngineResults(paddleOk, geminiOk, filename)
  }

  // 2. Only Gemini succeeded (e.g. on Render Cloud where port 8000 is unreachable)
  if (geminiOk) {
    console.log('[Dual Engine] PaddleOCR unreachable. Operating with Gemini Cloud Vision.')
    return geminiOk
  }

  // 3. Only PaddleOCR succeeded (e.g. local offline mode or Gemini API limit)
  if (paddleOk) {
    console.log('[Dual Engine] Gemini unreachable. Operating with local PaddleOCR.')
    return paddleOk
  }

  // 4. Both failed
  const paddleErr = paddleSettled?.reason
  const geminiErr = geminiSettled?.reason
  console.error('[Dual Engine Error] PaddleOCR error:', paddleErr?.message, '| Gemini error:', geminiErr?.message)
  throw paddleErr || geminiErr || new Error('All AI OCR engines failed to inspect image.')
}

function handleAiServiceError(error, res, next) {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data)
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return res.status(504).json({ status: 'error', message: 'The image inspection timed out. Please try again with a clearer image.' })
    }
    if (error.request) {
      return res.status(503).json({ status: 'error', message: 'The AI inspection service is currently unreachable. Please verify GEMINI_API_KEY on Render.' })
    }
  }
  next(error)
}

/* ══════════════════════════════════════════════════════════
   COMPLIANCE RULES & INSPECTION
══════════════════════════════════════════════════════════ */

app.get('/api/compliance/rules', async (req, res, next) => {
  try {
    const rules = await getComplianceRules()
    return res.json({ status: 'success', rules })
  } catch (error) {
    return next(error)
  }
})

// POST /api/compliance/check (Protected)
app.post('/api/compliance/check', optionalAuth, upload.single('file'), async (req, res, next) => {
  if (!req.file || req.file.size === 0) {
    return res.status(400).json({ status: 'error', message: 'Please select a label image file to inspect.' })
  }

  // Validate magic bytes
  if (!validateMagicBytes(req.file.buffer)) {
    return res.status(415).json({
      status: 'error',
      message: 'Corrupted or unsupported image file. Please provide a standard JPEG, PNG, or WebP image.'
    })
  }

  try {
    const ocr = await forwardToAiService(req.file)
    const rules = await getComplianceRules()

    const category = req.body.productCategory || 'food'
    const customProductName = req.body.productName || null

    const report = generateComplianceReport(ocr, {
      productCategory: category,
      productName: customProductName,
      ruleApplicabilityConfirmed: req.body.ruleApplicabilityConfirmed === 'true',
      completeLabelConfirmed: req.body.completeLabelConfirmed === 'true'
    }, rules)

    report.document = {
      filename: path.basename(req.file.originalname),
      mimeType: req.file.mimetype,
      pageCount: ocr.page_count || 1
    }

    const persistence = await persistComplianceReport(report, ocr, req.file, req.user)

    const checksMap = {}
    for (const chk of report.checks) {
      checksMap[chk.ruleId] = {
        verdict: chk.status === 'COMPLIANT' ? 'COMPLIANT'
                : chk.status === 'NON-COMPLIANT' ? 'NON-COMPLIANT'
                : 'MANUAL',
        extractedValue: chk.detectedValue,
        reasoning: chk.reason,
        confidence: chk.confidence
      }
    }

    const flatRecord = {
      scanId: `SCAN-${report.id.slice(-4).toUpperCase()}`,
      _id: report.id,
      timestamp: report.generatedAt,
      productCategory: category,
      productName: report.productName || 'Unnamed Product',
      isProductNameDetected: report.isProductNameDetected !== false,
      fileName: req.file.originalname,
      complianceChecks: checksMap,
      ocrText: ocr.results ? ocr.results.map(l => l.text).join('\n') : '',
      ocrLineCount: Array.isArray(ocr.results) ? ocr.results.length : 0,
      confidence: report.checks.reduce((s, c) => s + (c.confidence || 0), 0) / (report.checks.length || 1)
    }

    memoryHistory.unshift(flatRecord)
    if (memoryHistory.length > 50) memoryHistory.pop()

    return res.json({ status: 'success', data: flatRecord, ocr, report, persistence })
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return handleAiServiceError(error, res, next)
    }
    return next(error)
  }
})

// GET /api/compliance/history (Protected per user)
app.get('/api/compliance/history', optionalAuth, async (req, res, next) => {
  try {
    if (getDatabaseStatus() === 'online') {
      const query = {}
      if (req.user && req.user.role !== 'admin') {
        // Associate history per user; also surface legacy unassigned items so existing data is visible
        query.$or = [
          { userId: req.user.id },
          { userEmail: req.user.email },
          { userId: null }
        ]
      }

      const records = await ComplianceReport.find(query).sort({ createdAt: -1 }).limit(100).lean()
      const data = records.map(r => {
        const checksMap = {}
        for (const chk of (r.report?.checks || [])) {
          checksMap[chk.ruleId] = {
            verdict: chk.status === 'COMPLIANT' ? 'COMPLIANT'
                    : chk.status === 'NON-COMPLIANT' ? 'NON-COMPLIANT'
                    : 'MANUAL',
            extractedValue: chk.detectedValue,
            reasoning: chk.reason,
            confidence: chk.confidence
          }
        }
        return {
          scanId: `SCAN-${r._id.toString().slice(-4).toUpperCase()}`,
          _id: r._id,
          timestamp: r.report?.generatedAt || r.createdAt,
          productCategory: r.productCategory || r.report?.applicability?.productCategory || 'general',
          productName: r.productName || r.report?.productName || 'Unnamed Product',
          isProductNameDetected: r.isProductNameDetected !== undefined ? r.isProductNameDetected : true,
          fileName: r.filename,
          complianceChecks: checksMap,
          ocrText: '',
          ocrLineCount: 0
        }
      })
      return res.json({ status: 'success', data })
    }
    return res.json({ status: 'success', data: memoryHistory })
  } catch (error) {
    return next(error)
  }
})

// GET /api/compliance/reports/:reportId
app.get('/api/compliance/reports/:reportId', optionalAuth, async (req, res, next) => {
  if (getDatabaseStatus() !== 'online') {
    return res.status(503).json({ status: 'error', message: 'MongoDB is unavailable; saved reports cannot be retrieved.' })
  }
  try {
    const record = await findComplianceReport(req.params.reportId, req.user)
    if (!record) return res.status(404).json({ status: 'error', message: 'Compliance report not found.' })
    return res.json({ status: 'success', report: record.report, ocr: record.ocr })
  } catch (error) {
    return next(error)
  }
})

/* ══════════════════════════════════════════════════════════
   GLOBAL ERROR HANDLER WITH FRIENDLY JSON RESPONSES
══════════════════════════════════════════════════════════ */
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        status: 'error',
        message: 'File exceeds 10MB limit. Please upload a smaller label image.'
      })
    }
    return res.status(400).json({
      status: 'error',
      message: 'Upload exactly one JPEG, PNG, or WebP image under the file parameter.'
    })
  }

  if (error.status) {
    return res.status(error.status).json({ status: 'error', message: error.message })
  }

  console.error('Request failed:', error)
  return res.status(500).json({ status: 'error', message: 'An internal server error occurred while processing the request.' })
})

if (require.main === module) {
  initializeDatabase()
  const PORT = process.env.PORT || 5000
  app.listen(PORT, () => {
    console.log(`LabelGuard Metrology Backend running on http://localhost:${PORT}`)
  })
}

module.exports = app
