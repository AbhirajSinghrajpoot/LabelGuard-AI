import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import './App.css'

/* ── API Configuration ──────────────────────────────────── */
const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
axios.defaults.baseURL = API_BASE

/* ── Constants ──────────────────────────────────────────── */
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const CATEGORIES = [
  { id: 'food',        name: 'Packaged Food',      tag: 'Rule 6 / Sched II' },
  { id: 'cosmetics',   name: 'Personal Care',      tag: 'Cosmetics Mandate' },
  { id: 'electronics', name: 'Electronics',        tag: 'Standard Pack' },
  { id: 'general',     name: 'General Goods',      tag: 'Standard Metric' },
]

/* ── Verdict Helpers ────────────────────────────────────── */
function verdictClass(v) {
  if (!v) return 'na'
  const s = String(v).toLowerCase()
  if (s === 'compliant' || s === 'pass')   return 'pass'
  if (s === 'non-compliant' || s === 'fail') return 'fail'
  if (s === 'manual' || s.includes('manual') || s === 'review') return 'review'
  return 'na'
}

function verdictLabel(v) {
  if (!v) return 'N/A'
  const s = String(v).toLowerCase()
  if (s === 'compliant' || s === 'pass')     return '★ PASS'
  if (s === 'non-compliant' || s === 'fail') return '✕ FAIL'
  if (s === 'manual' || s.includes('manual') || s === 'review') return '◈ REVIEW'
  return 'N/A'
}

function tallyResults(results) {
  let pass = 0, fail = 0, review = 0, na = 0
  Object.values(results || {}).forEach(r => {
    const c = verdictClass(r?.verdict)
    if (c === 'pass') pass++
    else if (c === 'fail') fail++
    else if (c === 'review') review++
    else na++
  })
  return { pass, fail, review, na }
}

function overallVerdict(results) {
  const { fail, review } = tallyResults(results)
  if (fail > 0) return 'fail'
  if (review > 0) return 'review'
  return 'pass'
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return String(iso)
  }
}

/* ── Material Symbol Icon Component ─────────────────────── */
function MS({ name, style = {}, className = '' }) {
  return <span className={`material-symbols-outlined ${className}`} style={style}>{name}</span>
}

/* ══════════════════════════════════════════════════════════
   APP ROOT
══════════════════════════════════════════════════════════ */
export default function App() {
  const [page, setPage] = useState('home') // 'home' | 'scanner' | 'results' | 'history' | 'sample-report' | 'auth'
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('labelguard_user')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })
  const [scanResult, setScanResult] = useState(null)
  const [history, setHistory] = useState([])
  const [toast, setToast] = useState(null)

  // Configure axios token on initial mount
  useEffect(() => {
    const token = localStorage.getItem('labelguard_token')
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
    }
  }, [])

  // Load history
  const loadHistory = () => {
    axios.get('/api/compliance/history')
      .then(res => {
        setHistory(res.data?.data || [])
      })
      .catch(() => {
        // Ignored if offline
      })
  }

  useEffect(() => {
    loadHistory()
  }, [user])

  const showToast = (msg, type = 'info', duration = 4000) => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), duration)
  }

  const goTo = (targetPage) => {
    // Route guard: protected routes require login
    if (['scanner', 'results', 'history'].includes(targetPage) && !user) {
      showToast('Please sign in to access this feature.', 'info')
      setPage('auth')
      window.scrollTo(0, 0)
      return
    }
    setPage(targetPage)
    window.scrollTo(0, 0)
  }

  const handleScanComplete = (record) => {
    setScanResult(record)
    setHistory(prev => [record, ...prev])
    goTo('results')
  }

  const handleLogout = () => {
    setUser(null)
    localStorage.removeItem('labelguard_user')
    localStorage.removeItem('labelguard_token')
    delete axios.defaults.headers.common['Authorization']
    showToast('Signed out of workstation.', 'info')
    goTo('home')
  }

  return (
    <>
      <Navbar
        page={page}
        goTo={goTo}
        user={user}
        onLogout={handleLogout}
      />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {page === 'home' && <HomePage goTo={goTo} />}
        {page === 'scanner' && <ScannerPage onScanDone={handleScanComplete} showToast={showToast} goTo={goTo} />}
        {page === 'results' && <ResultsPage result={scanResult} goTo={goTo} />}
        {page === 'history' && <HistoryPage history={history} goTo={goTo} setScanResult={setScanResult} reloadHistory={loadHistory} />}
        {page === 'sample-report' && <SampleReportPage goTo={goTo} />}
        {page === 'auth' && <AuthPage user={user} setUser={setUser} goTo={goTo} showToast={showToast} />}
        {!['home', 'scanner', 'results', 'history', 'sample-report', 'auth'].includes(page) && (
          <NotFoundPage goTo={goTo} />
        )}
      </main>

      {page !== 'home' && page !== 'auth' && (
        <footer className="border-t border-[#DED9D2] py-4 bg-[#F4F1EA]">
          <div className="app-container flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left font-mono-tech text-[11px] text-[#5C584E]">
            <p className="uppercase tracking-wider">
              LabelGuard AI — Statutory Compliance Standard · PCR 2011
            </p>
            <p className="uppercase">
              {user ? `Operator: ${user.name || user.email} (${(user.role || 'INSPECTOR').toUpperCase()})` : 'Public Demonstration Session'}
            </p>
          </div>
        </footer>
      )}

      {toast && (
        <div className="toast-container no-print">
          <div className={`toast ${toast.type}`}>
            <MS name={toast.type === 'success' ? 'check_circle' : toast.type === 'error' ? 'error' : 'info'} style={{ fontSize: 18 }} />
            <span>{toast.msg}</span>
          </div>
        </div>
      )}
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   NAVBAR (CLEAN, SINGLE CTA, RESPONSIVE HAMBURGER)
══════════════════════════════════════════════════════════ */
function Navbar({ page, goTo, user, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false)

  const handleNav = (p) => {
    setMenuOpen(false)
    goTo(p)
  }

  return (
    <header className="app-header no-print">
      <div className="app-container app-header-inner">
        {/* Brand Logo */}
        <button onClick={() => handleNav('home')} className="app-logo" aria-label="LabelGuard AI Home">
          <img src="/logo.png" alt="LabelGuard" className="w-6 h-6 object-contain" />
          <span className="app-logo-name">LabelGuard</span>
        </button>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-2">
          <button
            onClick={() => handleNav('home')}
            className={`app-nav-btn ${page === 'home' ? 'active' : ''}`}
          >
            Overview
          </button>
          <button
            onClick={() => handleNav('scanner')}
            className={`app-nav-btn ${page === 'scanner' ? 'active' : ''}`}
          >
            New Scan
          </button>
          <button
            onClick={() => handleNav('history')}
            className={`app-nav-btn ${page === 'history' ? 'active' : ''}`}
          >
            History
          </button>
        </nav>

        {/* User Session & Sign In / Out */}
        <div className="flex items-center gap-3">
          {user ? (
            <div className="hidden sm:flex items-center gap-3">
              <div className="user-session-chip">
                <span className="w-2 h-2 rounded-full bg-[#1F7A5A] inline-block animate-pulse" />
                <span>{user.name || user.email}</span>
                <span className="user-role-badge">{user.role || 'INSPECTOR'}</span>
              </div>
              <button
                onClick={onLogout}
                className="btn-secondary !py-2 !px-3 !min-h-[38px] text-xs"
                title="Sign out of workstation"
              >
                <MS name="logout" style={{ fontSize: 16 }} />
                <span>Sign out</span>
              </button>
            </div>
          ) : (
            <button
              onClick={() => handleNav('auth')}
              className={`btn-secondary !py-2 !px-4 !min-h-[38px] text-xs ${page === 'auth' ? '!border-[#14130F] !bg-[#ECE8DE]' : ''}`}
            >
              <MS name="login" style={{ fontSize: 16 }} />
              <span>Sign in</span>
            </button>
          )}

          {/* Mobile Hamburger Toggle */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden flex items-center justify-center p-2 bg-[#F4F1EA] border border-[#DCD7CE] rounded cursor-pointer min-h-[44px] min-w-[44px]"
            aria-label="Toggle navigation menu"
          >
            <MS name={menuOpen ? 'close' : 'menu'} style={{ fontSize: 22, color: 'var(--ink)' }} />
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {menuOpen && (
        <div className="md:hidden bg-[#FEF9F1] border-b border-[#DCD7CE] px-6 py-4 flex flex-col gap-2 font-mono-tech text-xs tracking-wider uppercase shadow-xl animate-fadeIn">
          <button
            onClick={() => handleNav('home')}
            className={`text-left py-3 border-b border-[#DCD7CE]/60 bg-transparent border-none cursor-pointer flex items-center gap-2 ${page === 'home' ? 'text-[#D6372A] font-bold' : 'text-[#14130F]'}`}
          >
            <MS name="home" style={{ fontSize: 18 }} />
            <span>Overview</span>
          </button>
          <button
            onClick={() => handleNav('scanner')}
            className={`text-left py-3 border-b border-[#DCD7CE]/60 bg-transparent border-none cursor-pointer flex items-center gap-2 ${page === 'scanner' ? 'text-[#D6372A] font-bold' : 'text-[#14130F]'}`}
          >
            <MS name="document_scanner" style={{ fontSize: 18 }} />
            <span>New Scan</span>
          </button>
          <button
            onClick={() => handleNav('history')}
            className={`text-left py-3 border-b border-[#DCD7CE]/60 bg-transparent border-none cursor-pointer flex items-center gap-2 ${page === 'history' ? 'text-[#D6372A] font-bold' : 'text-[#14130F]'}`}
          >
            <MS name="history" style={{ fontSize: 18 }} />
            <span>History</span>
          </button>

          {user ? (
            <div className="pt-2 flex flex-col gap-2">
              <div className="text-[11px] text-[#5C584E] normal-case py-1">
                Signed in as: <strong>{user.name || user.email}</strong> ({user.role})
              </div>
              <button
                onClick={() => { setMenuOpen(false); onLogout(); }}
                className="btn-secondary !w-full justify-center !min-h-[44px]"
              >
                <MS name="logout" style={{ fontSize: 16 }} />
                <span>Sign out</span>
              </button>
            </div>
          ) : (
            <div className="pt-2">
              <button
                onClick={() => handleNav('auth')}
                className="btn-primary !w-full justify-center !min-h-[44px]"
              >
                <MS name="login" style={{ fontSize: 16 }} />
                <span>Sign in</span>
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  )
}

/* ══════════════════════════════════════════════════════════
   LANDING PAGE (HERO, PIPELINE, VERDICTS, SAMPLE REPORT)
══════════════════════════════════════════════════════════ */
function HomePage({ goTo }) {
  return (
    <div className="w-full flex-1 flex flex-col">
      {/* ── HERO SECTION ── */}
      <section className="app-container py-12 md:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Left: Typography & Primary Action */}
          <div className="lg:col-span-7 flex flex-col items-start">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-[#F4F1EA] border border-[#DCD7CE] text-[#5C584E] font-mono-tech text-xs uppercase tracking-wider mb-5">
              <span>Legal Metrology (Packaged Commodities) Rules, 2011</span>
            </div>

            <h1 className="font-serif-display text-4xl sm:text-5xl lg:text-6xl text-[#14130F] font-normal leading-[1.1] mb-6">
              Every label, <span className="italic font-normal text-[#B2230B]">verified.</span>
            </h1>

            <p className="font-body-sans text-base sm:text-lg text-[#5C584E] leading-relaxed max-w-2xl mb-8">
              Upload a packaged product label. LabelGuard reads statutory declarations, evaluates metric compliance under India’s Legal Metrology Rules, and delivers unambiguous audit verdicts.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={() => goTo('scanner')}
                className="btn-primary !px-6 !py-3.5 text-sm"
              >
                <span>Scan a label</span>
                <MS name="arrow_forward" style={{ fontSize: 18 }} />
              </button>
              <button
                onClick={() => goTo('sample-report')}
                className="btn-secondary !px-5 !py-3.5 text-sm"
              >
                <span>See sample report</span>
                <MS name="description" style={{ fontSize: 18 }} />
              </button>
            </div>

            {/* Architecture summary cards */}
            <div className="grid grid-cols-3 gap-3 w-full max-w-lg mt-10 pt-6 border-t border-[#DCD7CE]">
              <div>
                <div className="font-mono-tech text-[11px] text-[#5C584E] uppercase">Verdicts</div>
                <div className="font-mono-tech text-sm font-bold text-[#14130F]">4 States</div>
              </div>
              <div>
                <div className="font-mono-tech text-[11px] text-[#5C584E] uppercase">Declarations</div>
                <div className="font-mono-tech text-sm font-bold text-[#14130F]">5 Clauses</div>
              </div>
              <div>
                <div className="font-mono-tech text-[11px] text-[#5C584E] uppercase">OCR Pipeline</div>
                <div className="font-mono-tech text-sm font-bold text-[#14130F]">PaddleOCR + OpenCV</div>
              </div>
            </div>
          </div>

          {/* Right: Specimen Viewfinder */}
          <div className="lg:col-span-5 w-full flex justify-center">
            <div className="w-full max-w-md bg-[#FEF9F1] border-2 border-[#14130F] p-4 shadow-[6px_6px_0px_#14130F] relative">
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#DCD7CE] font-mono-tech text-[11px] text-[#5C584E]">
                <span className="font-bold text-[#14130F]">SPECIMEN AUDIT RETICLE</span>
                <span className="text-[#1F7A5A] font-semibold">ENGINE ACTIVE</span>
              </div>

              <div className="relative aspect-[3/4] bg-[#ECE8DE] border border-[#DCD7CE] overflow-hidden">
                <img
                  src="/flour_bag.jpg"
                  alt="Packaging specimen"
                  className="w-full h-full object-cover"
                />
                {/* Stamp overlay */}
                <div className="absolute top-4 right-4 stamp-badge pass text-xs">
                  ★ PASS: STANDARD
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between font-mono-tech text-[11px] text-[#5C584E]">
                <span>Sample image, illustrative only</span>
                <span>PaddleOCR + OpenCV</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PERFORATED DIVIDER ── */}
      <div className="app-container">
        <div className="perforated-rule" />
      </div>

      {/* ── HOW IT WORKS SECTION ── */}
      <section className="app-container py-12">
        <div className="mb-8">
          <span className="font-mono-tech text-xs uppercase tracking-widest text-[#B2230B] block mb-1">§01 · Inspection Flow</span>
          <h2 className="font-serif-display text-3xl sm:text-4xl text-[#14130F]">How it works.</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { num: '01', title: 'Upload', desc: 'Ingest label scan, camera capture, or packaging artwork with aspect preservation.' },
            { num: '02', title: 'Preprocess', desc: 'Contrast adjustment, skew rectification, and noise removal for crisp text separation.' },
            { num: '03', title: 'PaddleOCR', desc: 'Extract statutory lines, numeral values, standard metric units, and date patterns.' },
            { num: '04', title: 'Audit Verdict', desc: 'Cross-examine mandatory declarations against PCR 2011 clauses and issue actionable ledger.' }
          ].map((s) => (
            <div key={s.num} className="bg-[#F4F1EA] border border-[#DCD7CE] p-6 flex flex-col justify-between">
              <div>
                <div className="w-8 h-8 rounded-full bg-[#14130F] text-[#FEF9F1] font-mono-tech text-xs font-bold flex items-center justify-center mb-4">
                  {s.num}
                </div>
                <h3 className="font-mono-tech text-sm font-bold uppercase tracking-wider text-[#14130F] mb-2">{s.title}</h3>
                <p className="font-body-sans text-xs text-[#5C584E] leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── VERDICTS SECTION ── */}
      <section className="app-container py-12">
        <div className="mb-8">
          <span className="font-mono-tech text-xs uppercase tracking-widest text-[#B2230B] block mb-1">§02 · Verdict Taxonomy</span>
          <h2 className="font-serif-display text-3xl sm:text-4xl text-[#14130F]">Four unambiguous states. No black box ambiguity.</h2>
          <p className="font-serif-display italic text-lg text-[#5C584E] mt-2">
            "Unclear text becomes <span className="text-[#C98A12] font-semibold">REVIEW</span>, never a false FAIL."
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-[#FEF9F1] p-6 border border-[#DCD7CE] flex flex-col justify-between shadow-sm">
            <div className="text-center">
              <div className="stamp-badge pass text-base mb-4 inline-flex">PASS</div>
              <h3 className="font-mono-tech text-xs font-bold uppercase text-[#1F7A5A] mb-2">Conforms to Standard</h3>
              <p className="font-body-sans text-xs text-[#5C584E]">Mandatory declaration detected, clearly legible, and compliant with statutory requirements.</p>
            </div>
          </div>

          <div className="bg-[#FEF9F1] p-6 border border-[#DCD7CE] flex flex-col justify-between shadow-sm">
            <div className="text-center">
              <div className="stamp-badge fail text-base mb-4 inline-flex">FAIL</div>
              <h3 className="font-mono-tech text-xs font-bold uppercase text-[#D6372A] mb-2">Statutory Breach</h3>
              <p className="font-body-sans text-xs text-[#5C584E]">Mandatory clause omitted, unrounded price, or non-metric unit on confirmed complete label.</p>
            </div>
          </div>

          <div className="bg-[#FEF9F1] p-6 border border-[#DCD7CE] flex flex-col justify-between shadow-sm">
            <div className="text-center">
              <div className="stamp-badge review text-base mb-4 inline-flex">REVIEW</div>
              <h3 className="font-mono-tech text-xs font-bold uppercase text-[#C98A12] mb-2">Discretionary Inspection</h3>
              <p className="font-body-sans text-xs text-[#5C584E]">Occluded text, blurry packaging folds, low confidence OCR, or ambiguous date syntax needing human verification.</p>
            </div>
          </div>

          <div className="bg-[#FEF9F1] p-6 border border-[#DCD7CE] flex flex-col justify-between shadow-sm">
            <div className="text-center">
              <div className="stamp-badge na text-base mb-4 inline-flex">N / A</div>
              <h3 className="font-mono-tech text-xs font-bold uppercase text-[#7A776E] mb-2">Clause Exempt</h3>
              <p className="font-body-sans text-xs text-[#5C584E]">Exempted clause under specific category rules (e.g. importer clause on indigenous commodity).</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SAMPLE REPORT CTA ── */}
      <section className="app-container py-12">
        <div className="bg-[#F4F1EA] border border-[#DCD7CE] p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="max-w-xl">
            <span className="font-mono-tech text-xs uppercase tracking-widest text-[#B2230B] block mb-2">§03 · Exportable Audit Ledger</span>
            <h2 className="font-serif-display text-3xl sm:text-4xl text-[#14130F] mb-4">Every scan produces a structured report you can keep.</h2>
            <p className="font-body-sans text-sm text-[#5C584E] leading-relaxed">
              Generate structured, exportable verification records complete with extracted declaration tokens, confidence levels, and printable auditor sign-off sheets.
            </p>
          </div>
          <button
            onClick={() => goTo('sample-report')}
            className="btn-primary !py-3.5 !px-6 whitespace-nowrap"
          >
            <MS name="description" style={{ fontSize: 18 }} />
            <span>View Sample Report</span>
          </button>
        </div>
      </section>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   SCANNER PAGE (2-COLUMN, PRODUCT NAME INPUT, REAL CATEGORY)
══════════════════════════════════════════════════════════ */
function ScannerPage({ onScanDone, showToast, goTo }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [category, setCategory] = useState('food')
  const [productName, setProductName] = useState('')
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef(null)

  const handleFileSelect = (selectedFile) => {
    if (!selectedFile) return
    if (!ACCEPTED_MIME_TYPES.includes(selectedFile.type)) {
      showToast('Invalid file format. Please upload a JPG, PNG, or WebP image.', 'error')
      return
    }
    if (selectedFile.size > MAX_FILE_SIZE) {
      showToast('File exceeds 10MB limit. Please upload a smaller image.', 'error')
      return
    }
    setFile(selectedFile)
    const reader = new FileReader()
    reader.onload = (e) => setPreview(e.target.result)
    reader.readAsDataURL(selectedFile)
  }

  const runInspection = async () => {
    if (!file) {
      showToast('Please select a label image first.', 'error')
      return
    }

    setLoading(true)
    const form = new FormData()
    form.append('file', file)
    form.append('productCategory', category)
    if (productName.trim()) {
      form.append('productName', productName.trim())
    }
    form.append('ruleApplicabilityConfirmed', 'true')
    form.append('completeLabelConfirmed', 'true')

    try {
      const res = await axios.post('/api/compliance/check', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000
      })
      showToast('Inspection completed successfully.', 'success')
      onScanDone(res.data?.data || res.data)
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Inspection failed. Please check services.'
      showToast(msg, 'error', 6000)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="scanner-page">
      <div className="app-container">
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-6 border-b border-[#DCD7CE] gap-2">
          <div>
            <nav className="font-mono-tech text-xs text-[#5C584E] uppercase mb-1">
              <span>Scans</span> / <span className="text-[#14130F] font-bold">New Inspection</span>
            </nav>
            <h1 className="font-serif-display text-3xl text-[#14130F]">Product Label Ingestion</h1>
          </div>
          <div className="font-mono-tech text-xs text-[#5C584E] bg-[#F4F1EA] px-3 py-1.5 border border-[#DCD7CE] self-start sm:self-auto">
            Engine: <strong>PaddleOCR + OpenCV</strong>
          </div>
        </div>

        {/* Two-Column Desktop Workspace (~65% Left, ~35% Right) */}
        <div className="scanner-workspace-grid">
          {/* Left Column: Dropzone / Specimen Preview */}
          <div className="flex flex-col gap-4">
            <div
              className={`drop-zone ${preview ? '!p-2' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
              onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('dragover');
                if (e.dataTransfer.files?.[0]) handleFileSelect(e.dataTransfer.files[0]);
              }}
            >
              {preview ? (
                <div className="relative w-full h-[460px] bg-[#ECE8DE] flex items-center justify-center overflow-hidden">
                  <img src={preview} alt="Specimen preview" className="max-w-full max-h-full object-contain" />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); }}
                    className="absolute top-3 right-3 btn-secondary !py-1.5 !px-3 text-xs bg-white/90 shadow-md"
                  >
                    <MS name="close" style={{ fontSize: 16 }} />
                    <span>Change Image</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 p-6">
                  <div className="w-16 h-16 rounded-full bg-[#F4F1EA] border border-[#DCD7CE] flex items-center justify-center text-[#14130F]">
                    <MS name="add_photo_alternate" style={{ fontSize: 32 }} />
                  </div>
                  <h3 className="font-serif-display text-2xl text-[#14130F]">Drop label scan or click to browse</h3>
                  <p className="font-body-sans text-xs text-[#5C584E] max-w-sm">
                    JPEG, PNG, or WebP format. High-contrast frontal photograph or print-ready flat packaging artwork (max 10MB).
                  </p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files?.[0])}
              />
            </div>

            {/* Amber Note */}
            <div className="bg-[#FFF9ED] border-l-4 border-[#C98A12] p-3 text-xs text-[#5C584E] font-body-sans">
              <strong>Statutory Principle:</strong> Amber = unclear text, needs manual review. The engine will never falsely pass unclear declarations.
            </div>
          </div>

          {/* Right Column: Parameters & Inspection Trigger */}
          <div className="flex flex-col gap-5 bg-[#F4F1EA] border border-[#DCD7CE] p-6">
            {/* Product Name Input */}
            <div>
              <label className="font-mono-tech text-xs uppercase tracking-wider font-bold text-[#14130F] block mb-2">
                Product Name (Optional)
              </label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g. AARAV WHEAT FLOUR 5 KG"
                className="w-full p-2.5 bg-[#FEF9F1] border border-[#DCD7CE] font-mono-tech text-xs text-[#14130F] focus:outline-none focus:border-[#14130F]"
              />
              <span className="font-body-sans text-[11px] text-[#5C584E] mt-1 block">
                Leave blank to auto-detect from prominent packaging text.
              </span>
            </div>

            {/* Commodity Category */}
            <div>
              <label className="font-mono-tech text-xs uppercase tracking-wider font-bold text-[#14130F] block mb-2">
                Commodity Category
              </label>
              <div className="category-grid">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategory(c.id)}
                    className={`category-chip ${category === c.id ? 'active' : ''}`}
                  >
                    <span className="font-mono-tech text-xs font-bold text-[#14130F]">{c.name}</span>
                    <span className="font-mono-tech text-[10px] text-[#5C584E]">{c.tag}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Statutory Rules Evaluated */}
            <div className="pt-2 border-t border-[#DCD7CE]">
              <label className="font-mono-tech text-xs uppercase tracking-wider font-bold text-[#14130F] block mb-2">
                Active Statutory Rules
              </label>
              <div className="space-y-1.5 font-mono-tech text-[11px] text-[#5C584E]">
                <div className="flex justify-between">
                  <span>Maximum Retail Price (MRP)</span>
                  <span className="text-[#1F7A5A]">Rule 6(1)(e)</span>
                </div>
                <div className="flex justify-between">
                  <span>Net Quantity & Unit</span>
                  <span className="text-[#1F7A5A]">Rule 6(1)(c)</span>
                </div>
                <div className="flex justify-between">
                  <span>Manufacturer / Packer</span>
                  <span className="text-[#1F7A5A]">Rule 6(1)(a)</span>
                </div>
                <div className="flex justify-between">
                  <span>Mfg / Packing Date</span>
                  <span className="text-[#1F7A5A]">Rule 6(1)(d)</span>
                </div>
                <div className="flex justify-between">
                  <span>Consumer Care Desk</span>
                  <span className="text-[#1F7A5A]">Rule 6(2)</span>
                </div>
              </div>
            </div>

            {/* Run Button */}
            <button
              onClick={runInspection}
              disabled={loading || !file}
              className="btn-primary !w-full !py-3.5 mt-2"
            >
              {loading ? (
                <>
                  <MS name="progress_activity" className="animate-spin" style={{ fontSize: 18 }} />
                  <span>Processing OCR Inspection...</span>
                </>
              ) : (
                <>
                  <MS name="document_scanner" style={{ fontSize: 18 }} />
                  <span>Run OCR Inspection</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   RESULTS PAGE (REAL METROLOGY LEDGER)
══════════════════════════════════════════════════════════ */
function ResultsPage({ result, goTo }) {
  if (!result) {
    return (
      <div className="app-container py-16 text-center">
        <MS name="find_in_page" style={{ fontSize: 48, color: 'var(--ink-faint)' }} />
        <h2 className="font-serif-display text-2xl text-[#14130F] mt-4 mb-2">No scan result active</h2>
        <p className="font-body-sans text-sm text-[#5C584E] mb-6">Run a new scan to view statutory evaluation results.</p>
        <button onClick={() => goTo('scanner')} className="btn-primary">
          <span>Go to Scanner</span>
        </button>
      </div>
    )
  }

  const checks = result.complianceChecks || {}
  const ov = overallVerdict(checks)
  const isDetected = result.isProductNameDetected !== false

  return (
    <div className="app-container py-8">
      {/* Top Breadcrumb & Action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-6 border-b border-[#DCD7CE] gap-4">
        <div>
          <nav className="font-mono-tech text-xs text-[#5C584E] uppercase mb-1">
            <span>Scans</span> / <span>{result.scanId || 'SCAN'}</span> / <span className="text-[#14130F] font-bold">Audit Summary</span>
          </nav>
          <div className="flex items-center gap-3">
            <h1 className="font-serif-display text-3xl text-[#14130F]">
              {result.productName || 'Unnamed Product'}
            </h1>
            {isDetected && (
              <span className="font-mono-tech text-[10px] uppercase bg-[#ECE8DE] text-[#5C584E] px-2 py-0.5 border border-[#DCD7CE]">
                Detected
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 no-print">
          <button onClick={() => window.print()} className="btn-secondary !py-2 !px-3 text-xs">
            <MS name="print" style={{ fontSize: 16 }} />
            <span>Print Report</span>
          </button>
          <button onClick={() => goTo('scanner')} className="btn-primary !py-2 !px-4 text-xs">
            <MS name="add" style={{ fontSize: 16 }} />
            <span>New Scan</span>
          </button>
        </div>
      </div>

      {/* Overall Verdict Banner */}
      <div className={`p-4 border mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
        ov === 'pass' ? 'bg-[#F2FBF6] border-[#1F7A5A]' : ov === 'fail' ? 'bg-[#FCF4F4] border-[#D6372A]' : 'bg-[#FFFDF7] border-[#C98A12]'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`stamp-badge ${ov} text-sm`}>
            {ov === 'pass' ? '★ PASS' : ov === 'fail' ? '✕ FAIL' : '◈ REVIEW'}
          </div>
          <div>
            <div className="font-mono-tech text-xs font-bold uppercase text-[#14130F]">
              {ov === 'pass' ? 'All Mandatory Declarations Conforming' : ov === 'fail' ? 'Statutory Infringement Detected' : 'Discretionary Review Required'}
            </div>
            <div className="font-body-sans text-xs text-[#5C584E]">
              Category: <strong className="uppercase">{result.productCategory || 'GENERAL'}</strong> · Scanned: {fmtDate(result.timestamp)}
            </div>
          </div>
        </div>
      </div>

      {/* Rules Evaluation Ledger Table */}
      <div className="bg-[#FEF9F1] border border-[#DCD7CE] p-6 shadow-sm mb-8">
        <h3 className="font-mono-tech text-xs uppercase tracking-wider font-bold text-[#14130F] mb-4">
          Statutory Rule Evaluation Ledger
        </h3>
        <div className="overflow-x-auto">
          <table className="history-desktop-table !bg-transparent">
            <thead>
              <tr>
                <th>Clause</th>
                <th>Declaration Item</th>
                <th>Extracted Value</th>
                <th>Confidence</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {[
                { id: 'mrp', name: 'Maximum Retail Price (MRP)', clause: 'Rule 6(1)(e)' },
                { id: 'net-quantity', name: 'Net Quantity', clause: 'Rule 6(1)(c)' },
                { id: 'manufacturer-details', name: 'Manufacturer Details', clause: 'Rule 6(1)(a)' },
                { id: 'date-declaration', name: 'Mfg / Packing Date', clause: 'Rule 6(1)(d)' },
                { id: 'consumer-care', name: 'Consumer Care Desk', clause: 'Rule 6(2)' },
              ].map(item => {
                const c = checks[item.id] || {}
                const vc = verdictClass(c.verdict)
                return (
                  <tr key={item.id}>
                    <td className="font-mono-tech text-xs text-[#5C584E]">{item.clause}</td>
                    <td className="font-medium text-[#14130F]">{item.name}</td>
                    <td className="font-mono-tech text-xs max-w-xs truncate" title={c.extractedValue || '—'}>
                      {c.extractedValue || <span className="text-[#8C867A]">Not detected</span>}
                    </td>
                    <td className="font-mono-tech text-xs">
                      {c.confidence ? `${(c.confidence * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td>
                      <span className={`stamp-badge ${vc} text-[10px]`}>
                        {verdictLabel(c.verdict)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   HISTORY PAGE (TABLE >=768px, CARDS <768px, CSV EXPORT)
══════════════════════════════════════════════════════════ */
function HistoryPage({ history, goTo, setScanResult, reloadHistory }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [pageIndex, setPageIndex] = useState(1)
  const pageSize = 10

  const stats = {
    total: history.length,
    pass: history.filter(h => overallVerdict(h.complianceChecks || {}) === 'pass').length,
    review: history.filter(h => overallVerdict(h.complianceChecks || {}) === 'review').length,
    fail: history.filter(h => overallVerdict(h.complianceChecks || {}) === 'fail').length,
  }

  const filtered = history.filter(h => {
    const ov = overallVerdict(h.complianceChecks || {})
    const matchFilter = filter === 'all' || ov === filter
    const q = search.toLowerCase().trim()
    const matchSearch = !q
      || (h.scanId || '').toLowerCase().includes(q)
      || (h.productName || '').toLowerCase().includes(q)
      || (h.productCategory || '').toLowerCase().includes(q)
    return matchFilter && matchSearch
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((pageIndex - 1) * pageSize, pageIndex * pageSize)

  // CSV Export with formula injection prevention
  const exportCsv = () => {
    if (!filtered.length) return

    const escapeCell = (val) => {
      if (val === null || val === undefined) return '""'
      let s = String(val)
      // Prevent formula injection: prefix =, +, -, @ with single quote '
      if (/^[=+\-@\t\r]/.test(s)) {
        s = "'" + s
      }
      return `"${s.replace(/"/g, '""')}"`
    }

    const headers = ['Scan ID', 'Product Name', 'Category', 'MRP Verdict', 'Net Qty Verdict', 'Consumer Care Verdict', 'Overall Verdict', 'Date']
    const rows = filtered.map(h => {
      const checks = h.complianceChecks || {}
      return [
        escapeCell(h.scanId || ''),
        escapeCell(h.productName || 'Unnamed Product'),
        escapeCell(h.productCategory || 'general'),
        escapeCell(checks.mrp?.verdict || 'MANUAL'),
        escapeCell(checks['net-quantity']?.verdict || 'MANUAL'),
        escapeCell(checks['consumer-care']?.verdict || 'MANUAL'),
        escapeCell(overallVerdict(checks).toUpperCase()),
        escapeCell(h.timestamp || '')
      ].join(',')
    })

    const csvContent = [headers.join(','), ...rows].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `labelguard_compliance_history_${Date.now()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const viewRecord = (rec) => {
    setScanResult(rec)
    goTo('results')
  }

  return (
    <div className="history-page">
      <div className="app-container">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-6 border-b border-[#DCD7CE] gap-4">
          <div>
            <nav className="font-mono-tech text-xs text-[#5C584E] uppercase mb-1">
              <span>Audit Records</span> / <span className="text-[#14130F] font-bold">History</span>
            </nav>
            <h1 className="font-serif-display text-3xl text-[#14130F]">Scan History</h1>
            <p className="font-body-sans text-xs text-[#5C584E] mt-1">
              Historical statutory audit log under Legal Metrology (Packaged Commodities) Rules, 2011.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={exportCsv} className="btn-secondary !py-2 !px-3 text-xs" title="Export CSV table">
              <MS name="download" style={{ fontSize: 16 }} />
              <span>Export CSV</span>
            </button>
            <button onClick={() => goTo('scanner')} className="btn-primary !py-2 !px-4 text-xs">
              <MS name="add" style={{ fontSize: 16 }} />
              <span>New Scan</span>
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="history-stats-grid">
          <div className="stat-card total">
            <div className="stat-card-label">Total Scans</div>
            <div className="stat-card-num">{String(stats.total).padStart(4, '0')}</div>
          </div>
          <div className="stat-card pass">
            <div className="stat-card-label">Passed</div>
            <div className="stat-card-num">{String(stats.pass).padStart(4, '0')}</div>
          </div>
          <div className="stat-card review">
            <div className="stat-card-label">Needs Review</div>
            <div className="stat-card-num">{String(stats.review).padStart(4, '0')}</div>
          </div>
          <div className="stat-card fail">
            <div className="stat-card-label">Failed</div>
            <div className="stat-card-num">{String(stats.fail).padStart(4, '0')}</div>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="filter-bar">
          <div className="filter-search-box">
            <MS name="search" style={{ color: 'var(--ink-faint)', fontSize: 18 }} />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPageIndex(1); }}
              placeholder="Search scan ID, product name, category..."
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="bg-transparent border-none text-xs text-[#5C584E] cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          <div className="filter-tabs">
            {['all', 'pass', 'review', 'fail'].map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => { setFilter(tab); setPageIndex(1); }}
                className={`filter-tab-btn ${filter === tab ? 'active' : ''}`}
              >
                {tab === 'all' ? `All (${stats.total})` : tab === 'pass' ? `Passed (${stats.pass})` : tab === 'review' ? `Review (${stats.review})` : `Failed (${stats.fail})`}
              </button>
            ))}
          </div>
        </div>

        {/* Desktop Table View (>= 768px) */}
        <div className="history-desktop-table-wrap bg-[#FEF9F1] border border-[#DCD7CE] shadow-sm overflow-x-auto">
          {paginated.length === 0 ? (
            <div className="p-12 text-center text-[#5C584E]">
              <MS name="inventory" style={{ fontSize: 36, opacity: 0.4 }} />
              <p className="font-serif-display text-lg mt-2">No audit records match the current filter</p>
            </div>
          ) : (
            <table className="history-desktop-table">
              <thead>
                <tr>
                  <th>Scan ID</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>MRP</th>
                  <th>Net Qty</th>
                  <th>Consumer Care</th>
                  <th>Overall Verdict</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((rec, i) => {
                  const chk = rec.complianceChecks || {}
                  const ov = overallVerdict(chk)
                  const isDet = rec.isProductNameDetected !== false
                  return (
                    <tr key={rec._id || rec.scanId || i}>
                      <td className="font-mono-tech text-xs font-bold text-[#14130F]">{rec.scanId || 'SCAN'}</td>
                      <td>
                        <span className="font-medium text-[#14130F]">{rec.productName || 'Unnamed Product'}</span>
                        {isDet && (
                          <span className="ml-2 font-mono-tech text-[9px] uppercase bg-[#ECE8DE] text-[#5C584E] px-1.5 py-0.5 border border-[#DCD7CE]">
                            Detected
                          </span>
                        )}
                      </td>
                      <td className="font-mono-tech text-xs uppercase text-[#5C584E]">{rec.productCategory || 'GENERAL'}</td>
                      <td><span className={`stamp-badge ${verdictClass(chk.mrp?.verdict)} text-[10px]`}>{verdictLabel(chk.mrp?.verdict)}</span></td>
                      <td><span className={`stamp-badge ${verdictClass(chk['net-quantity']?.verdict)} text-[10px]`}>{verdictLabel(chk['net-quantity']?.verdict)}</span></td>
                      <td><span className={`stamp-badge ${verdictClass(chk['consumer-care']?.verdict)} text-[10px]`}>{verdictLabel(chk['consumer-care']?.verdict)}</span></td>
                      <td><span className={`stamp-badge ${ov} text-[10px]`}>{ov === 'pass' ? '★ PASS' : ov === 'fail' ? '✕ FAIL' : '◈ REVIEW'}</span></td>
                      <td className="font-mono-tech text-xs text-[#5C584E] whitespace-nowrap">{fmtDate(rec.timestamp)}</td>
                      <td>
                        <button onClick={() => viewRecord(rec)} className="btn-secondary !py-1 !px-2.5 text-xs">
                          View →
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Mobile Card List (< 768px) */}
        <div className="history-mobile-cards">
          {paginated.length === 0 ? (
            <div className="p-8 text-center bg-[#FEF9F1] border border-[#DCD7CE] text-[#5C584E]">
              <MS name="inventory" style={{ fontSize: 32, opacity: 0.4 }} />
              <p className="font-serif-display text-base mt-2">No records found</p>
            </div>
          ) : (
            paginated.map((rec, i) => {
              const chk = rec.complianceChecks || {}
              const ov = overallVerdict(chk)
              const isDet = rec.isProductNameDetected !== false
              return (
                <div key={rec._id || rec.scanId || i} className="history-card-item">
                  <div className="flex items-center justify-between">
                    <span className="font-mono-tech text-xs font-bold text-[#14130F]">{rec.scanId || 'SCAN'}</span>
                    <span className={`stamp-badge ${ov} text-[10px]`}>
                      {ov === 'pass' ? '★ PASS' : ov === 'fail' ? '✕ FAIL' : '◈ REVIEW'}
                    </span>
                  </div>

                  <div>
                    <h4 className="font-serif-display text-lg text-[#14130F]">
                      {rec.productName || 'Unnamed Product'}
                    </h4>
                    <div className="flex items-center gap-2 mt-1 font-mono-tech text-[10px] text-[#5C584E] uppercase">
                      <span>{rec.productCategory || 'GENERAL'}</span>
                      {isDet && <span className="bg-[#ECE8DE] px-1 py-0.2 border border-[#DCD7CE]">Detected</span>}
                      <span>·</span>
                      <span>{fmtDate(rec.timestamp)}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[#DCD7CE]">
                    <span className={`stamp-badge ${verdictClass(chk.mrp?.verdict)} text-[9px]`}>MRP: {verdictLabel(chk.mrp?.verdict)}</span>
                    <span className={`stamp-badge ${verdictClass(chk['net-quantity']?.verdict)} text-[9px]`}>QTY: {verdictLabel(chk['net-quantity']?.verdict)}</span>
                    <span className={`stamp-badge ${verdictClass(chk['consumer-care']?.verdict)} text-[9px]`}>CARE: {verdictLabel(chk['consumer-care']?.verdict)}</span>
                  </div>

                  <button
                    onClick={() => viewRecord(rec)}
                    className="btn-secondary !w-full justify-center !min-h-[44px] mt-1"
                  >
                    <span>View Inspection Report →</span>
                  </button>
                </div>
              )
            })
          )}
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#DCD7CE] font-mono-tech text-xs text-[#5C584E]">
            <div>
              Page <strong>{pageIndex}</strong> of <strong>{totalPages}</strong>
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={pageIndex <= 1}
                onClick={() => setPageIndex(p => Math.max(1, p - 1))}
                className="btn-secondary !py-1 !px-3 text-xs"
              >
                Previous
              </button>
              <button
                disabled={pageIndex >= totalPages}
                onClick={() => setPageIndex(p => Math.min(totalPages, p + 1))}
                className="btn-secondary !py-1 !px-3 text-xs"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   SAMPLE REPORT PAGE (HIGH-FIDELITY FICTIONAL A4 SHEET)
══════════════════════════════════════════════════════════ */
function SampleReportPage({ goTo }) {
  return (
    <div className="app-container py-8">
      {/* Alert Banner: Clearly labeled fictional sample */}
      <div className="bg-[#FFF9ED] border border-[#C98A12] p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3">
          <MS name="info" style={{ color: 'var(--stamp-amber)', fontSize: 24 }} />
          <div>
            <div className="font-mono-tech text-xs font-bold text-[#14130F] uppercase">
              Sample Data · Fictional Product Specimen
            </div>
            <div className="font-body-sans text-xs text-[#5C584E]">
              This report demonstrates the standardized single-page A4 statutory audit ledger format under Legal Metrology Rules, 2011.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => window.print()} className="btn-secondary !py-2 !px-3 text-xs">
            <MS name="print" style={{ fontSize: 16 }} />
            <span>Print Report</span>
          </button>
          <button onClick={() => goTo('home')} className="btn-primary !py-2 !px-4 text-xs">
            <span>Back to Overview</span>
          </button>
        </div>
      </div>

      {/* A4 Sheet Container */}
      <div className="bg-white border border-[#D5D0C6] p-8 sm:p-12 shadow-lg max-w-4xl mx-auto text-[#14130F]">
        {/* Report Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between pb-6 mb-6 border-b-2 border-[#14130F] gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <img src="/logo.png" alt="LabelGuard" className="w-8 h-8 object-contain" />
              <h1 className="font-serif-display text-3xl font-bold tracking-tight">LabelGuard Inspection Report</h1>
            </div>
            <p className="font-mono-tech text-xs text-[#5C584E] mt-1">
              AI-Assisted Legal Metrology (Packaged Commodities) Rules, 2011 Evaluation
            </p>
          </div>
          <div className="font-mono-tech text-xs sm:text-right text-[#5C584E]">
            <div>REPORT REF: <strong className="text-[#14130F]">LG-SAMPLE-2026</strong></div>
            <div>STATUS: <strong className="text-[#1F7A5A]">★ AUDIT PASSED</strong></div>
            <div>DATE: {new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}</div>
          </div>
        </div>

        {/* Specimen Particulars */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-[#F4F1EA] border border-[#DCD7CE] mb-8 font-mono-tech text-xs">
          <div>
            <span className="text-[#5C584E] block">Product Commodity</span>
            <strong className="text-sm text-[#14130F]">Whole Wheat Flour (5 kg)</strong>
          </div>
          <div>
            <span className="text-[#5C584E] block">Declared Quantity</span>
            <strong className="text-sm text-[#14130F]">5 kg (Net Mass)</strong>
          </div>
          <div>
            <span className="text-[#5C584E] block">Maximum Retail Price</span>
            <strong className="text-sm text-[#14130F]">₹ 240.00 (Incl. of all taxes)</strong>
          </div>
          <div>
            <span className="text-[#5C584E] block">Packaging Date</span>
            <strong className="text-sm text-[#14130F]">10/2026 (Mon/Year)</strong>
          </div>
        </div>

        {/* Compliance Ledger Table */}
        <div className="mb-8">
          <h2 className="font-mono-tech text-xs uppercase tracking-wider font-bold text-[#14130F] mb-3">
            Schedule II Compliance Ledger
          </h2>
          <table className="w-full border-collapse font-body-sans text-xs">
            <thead>
              <tr className="bg-[#ECE8DE] border-b border-[#DCD7CE] font-mono-tech text-[11px] text-[#14130F]">
                <th className="p-3 text-left">Statutory Requirement</th>
                <th className="p-3 text-left">Observed Value</th>
                <th className="p-3 text-left">Legal Clause</th>
                <th className="p-3 text-center">Verdict</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCD7CE]">
              <tr>
                <td className="p-3 font-semibold">Maximum Retail Price (MRP)</td>
                <td className="p-3 font-mono-tech text-xs">₹ 240.00 (Incl. of all taxes)</td>
                <td className="p-3 font-mono-tech text-xs text-[#5C584E]">Rule 6(1)(e)</td>
                <td className="p-3 text-center"><span className="stamp-badge pass text-[10px]">★ PASS</span></td>
              </tr>
              <tr>
                <td className="p-3 font-semibold">Net Quantity & Unit</td>
                <td className="p-3 font-mono-tech text-xs">5 kg (Standard Metric Mass)</td>
                <td className="p-3 font-mono-tech text-xs text-[#5C584E]">Rule 6(1)(c)</td>
                <td className="p-3 text-center"><span className="stamp-badge pass text-[10px]">★ PASS</span></td>
              </tr>
              <tr>
                <td className="p-3 font-semibold">Date of Manufacture / Packing</td>
                <td className="p-3 font-mono-tech text-xs">10/2026 (Valid MM/YYYY notation)</td>
                <td className="p-3 font-mono-tech text-xs text-[#5C584E]">Rule 6(1)(d)</td>
                <td className="p-3 text-center"><span className="stamp-badge pass text-[10px]">★ PASS</span></td>
              </tr>
              <tr>
                <td className="p-3 font-semibold">Manufacturer Name & Address</td>
                <td className="p-3 font-mono-tech text-xs">Aarav Foods Pvt Ltd, Raipur, PIN 492001</td>
                <td className="p-3 font-mono-tech text-xs text-[#5C584E]">Rule 6(1)(a)</td>
                <td className="p-3 text-center"><span className="stamp-badge pass text-[10px]">★ PASS</span></td>
              </tr>
              <tr>
                <td className="p-3 font-semibold">Consumer Care Contact Desk</td>
                <td className="p-3 font-mono-tech text-xs">1800-266-0422 · care@aaravfoods.in</td>
                <td className="p-3 font-mono-tech text-xs text-[#5C584E]">Rule 6(2)</td>
                <td className="p-3 text-center"><span className="stamp-badge pass text-[10px]">★ PASS</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Verification Sign-Off Lines */}
        <div className="pt-8 border-t border-[#DCD7CE] grid grid-cols-2 gap-8 font-mono-tech text-xs">
          <div>
            <span className="text-[#5C584E] block mb-6">Reviewing Officer / Inspector Signature:</span>
            <div className="border-b border-[#14130F] w-48 mb-1" />
            <span>Officer Sharma (DESK-01A)</span>
          </div>
          <div>
            <span className="text-[#5C584E] block mb-6">Verification Date:</span>
            <div className="border-b border-[#14130F] w-48 mb-1" />
            <span>{new Date().toLocaleDateString('en-IN')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   AUTH PAGE (JWT + BCRYPT AUTHENTICATION, EMPTY PLACEHOLDERS)
══════════════════════════════════════════════════════════ */
function AuthPage({ user, setUser, goTo, showToast }) {
  const [mode, setMode] = useState('signin') // 'signin' | 'register'
  const [role, setRole] = useState('inspector')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) {
      showToast('Please enter both email and password.', 'error')
      return
    }

    setLoading(true)
    const endpoint = mode === 'signin' ? '/api/auth/login' : '/api/auth/register'
    const payload = mode === 'signin'
      ? { email, password }
      : { email, password, name, role }

    try {
      const res = await axios.post(endpoint, payload)
      const data = res.data
      if (data.token) {
        localStorage.setItem('labelguard_token', data.token)
        localStorage.setItem('labelguard_user', JSON.stringify(data.user))
        axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`
        setUser(data.user)
        showToast(mode === 'signin' ? 'Signed in successfully.' : 'Account created successfully.', 'success')
        goTo('scanner')
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Authentication failed. Please verify credentials.'
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center py-12 px-4">
      <div className="w-full max-w-[960px] bg-[#FEF9F1] border border-[#DCD7CE] shadow-xl overflow-hidden flex flex-col md:flex-row">
        {/* Left Decorative Panel (Hidden on Small Screens) */}
        <div className="hidden md:flex md:w-5/12 bg-[#14130F] text-[#FEF9F1] p-8 flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-6">
              <img src="/logo.png" alt="LabelGuard" className="w-7 h-7 object-contain" />
              <span className="font-serif-display text-2xl">LabelGuard AI</span>
            </div>
            <h2 className="font-serif-display text-3xl font-normal leading-tight mb-4">
              Read the label. <br />
              <span className="italic text-[#D6372A]">Respect the rule.</span>
            </h2>
            <p className="font-body-sans text-xs text-[#8C867A] leading-relaxed">
              Statutory verification tool for pre-packaged commodities under the Legal Metrology Act, 2009.
            </p>
          </div>

          <div className="font-mono-tech text-[11px] text-[#8C867A] pt-4 border-t border-white/10">
            <span>METROLOGY COMPLIANCE ENGINE · PCR 2011</span>
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="w-full md:w-7/12 p-8 sm:p-10 flex flex-col justify-between">
          <div>
            {/* Mode Tabs */}
            <div className="flex items-center gap-4 mb-6 border-b border-[#DCD7CE] pb-3">
              <button
                type="button"
                onClick={() => setMode('signin')}
                className={`font-mono-tech text-xs uppercase tracking-wider font-bold bg-transparent border-none cursor-pointer pb-1 ${
                  mode === 'signin' ? 'text-[#B2230B] border-b-2 border-[#B2230B]' : 'text-[#5C584E]'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`font-mono-tech text-xs uppercase tracking-wider font-bold bg-transparent border-none cursor-pointer pb-1 ${
                  mode === 'register' ? 'text-[#B2230B] border-b-2 border-[#B2230B]' : 'text-[#5C584E]'
                }`}
              >
                Register
              </button>
            </div>

            <h3 className="font-serif-display text-2xl text-[#14130F] mb-1">
              {mode === 'signin' ? "Access the Inspector's Desk" : "Create Operator Account"}
            </h3>
            <p className="font-body-sans text-xs text-[#5C584E] mb-6">
              {mode === 'signin' ? "Enter your official credentials to access the inspection ledger." : "Sign up to track and audit packaged commodity labels."}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <>
                  <div>
                    <label className="font-mono-tech text-xs uppercase font-bold text-[#14130F] block mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Inspector Sharma"
                      className="w-full p-2.5 bg-[#FEF9F1] border border-[#DCD7CE] font-mono-tech text-xs text-[#14130F] focus:outline-none focus:border-[#14130F]"
                    />
                  </div>
                  <div>
                    <label className="font-mono-tech text-xs uppercase font-bold text-[#14130F] block mb-1">
                      Account Role
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'inspector', label: 'Inspector' },
                        { id: 'business',  label: 'Brand' },
                        { id: 'admin',     label: 'Admin' }
                      ].map(r => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setRole(r.id)}
                          className={`p-2 font-mono-tech text-xs border uppercase ${role === r.id ? 'border-[#14130F] bg-[#ECE8DE] font-bold' : 'border-[#DCD7CE] bg-[#FEF9F1]'}`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="font-mono-tech text-xs uppercase font-bold text-[#14130F] block mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full p-2.5 bg-[#FEF9F1] border border-[#DCD7CE] font-mono-tech text-xs text-[#14130F] focus:outline-none focus:border-[#14130F]"
                />
              </div>

              <div>
                <label className="font-mono-tech text-xs uppercase font-bold text-[#14130F] block mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full p-2.5 bg-[#FEF9F1] border border-[#DCD7CE] font-mono-tech text-xs text-[#14130F] focus:outline-none focus:border-[#14130F]"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary !w-full !py-3 mt-4"
              >
                {loading ? (
                  <span>Authenticating...</span>
                ) : (
                  <span>{mode === 'signin' ? 'Sign In to Workstation' : 'Complete Registration'}</span>
                )}
              </button>
            </form>
          </div>

          <div className="pt-6 mt-6 border-t border-[#DCD7CE] text-center font-mono-tech text-[11px] text-[#5C584E]">
            Legal Metrology Act, 2009 & Packaged Commodities Rules, 2011
          </div>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   NOT FOUND PAGE
══════════════════════════════════════════════════════════ */
function NotFoundPage({ goTo }) {
  return (
    <div className="app-container py-20 text-center">
      <h1 className="font-serif-display text-5xl text-[#14130F] mb-3">404</h1>
      <p className="font-body-sans text-base text-[#5C584E] mb-6">The statutory register page you requested was not found.</p>
      <button onClick={() => goTo('home')} className="btn-primary">
        <span>Back to Overview</span>
      </button>
    </div>
  )
}
