const test = require('node:test')
const assert = require('node:assert/strict')
const { STATUS, generateComplianceReport, extractCandidateProductName } = require('../services/complianceEngine')

function makeOcr(linesWithConfidence, qualityWarnings = []) {
  const results = linesWithConfidence.map((item, index) => {
    const text = typeof item === 'string' ? item : item.text
    const confidence = typeof item === 'object' && item.confidence !== undefined ? item.confidence : 0.98
    return {
      text,
      confidence,
      bounding_box: [],
      page_number: 1
    }
  })
  return {
    filename: 'test-specimen.png',
    extracted_text: results.map(r => r.text).join('\n'),
    results,
    quality_warnings: qualityWarnings
  }
}

const cleanCompliantLines = [
  'AARAV CHAKKI ATTA',
  '100% Whole Wheat Premium Flour',
  'MRP Rs. 240.00 (INCL. OF ALL TAXES)',
  'NET WEIGHT: 5 kg',
  'MFD. DATE: 10/2026',
  'MANUFACTURED BY: Aarav Foods Private Limited',
  'Plot 14-B, Industrial Area, Raipur, C.G. - PIN 492001',
  'CONSUMER CARE CELL:',
  'Consumer Grievance Officer, Aarav Foods Desk',
  'Address: Plot 14-B, Industrial Area, Raipur - 492001',
  'Toll Free: 1800-266-0422',
  'Email: care@aaravfoods.in'
]

const confirmedComplete = {
  ruleApplicabilityConfirmed: true,
  completeLabelConfirmed: true,
  productCategory: 'food'
}

test('Test Fixture 1: Clean, fully-compliant label produces 5 COMPLIANT checks (PASS)', () => {
  const report = generateComplianceReport(makeOcr(cleanCompliantLines), confirmedComplete)

  assert.equal(report.summary.totalChecks, 5)
  assert.equal(report.summary.compliantCount, 5)
  assert.equal(report.summary.nonCompliantCount, 0)
  assert.equal(report.summary.manualVerificationCount, 0)

  assert.equal(report.checks[0].status, STATUS.COMPLIANT) // mrp
  assert.equal(report.checks[1].status, STATUS.COMPLIANT) // net-quantity
  assert.equal(report.checks[2].status, STATUS.COMPLIANT) // manufacturer
  assert.equal(report.checks[3].status, STATUS.COMPLIANT) // date
  assert.equal(report.checks[4].status, STATUS.COMPLIANT) // consumer-care

  assert.equal(report.productName, 'AARAV CHAKKI ATTA')
  assert.equal(report.isProductNameDetected, true)
})

test('Test Fixture 2: Unclear text / low confidence routes to REVIEW (MANUAL), never false PASS or false FAIL', () => {
  const blurryLines = cleanCompliantLines.map((text, i) => ({
    text,
    confidence: i === 2 ? 0.55 : 0.95 // blurry MRP
  }))
  const report = generateComplianceReport(makeOcr(blurryLines), confirmedComplete)

  assert.equal(report.checks[0].status, STATUS.MANUAL) // MRP must be reviewed
  assert.equal(report.summary.compliantCount, 4)
  assert.equal(report.summary.manualVerificationCount, 1)
})

test('Test Fixture 3: Missing declarations on complete label correctly route to NON-COMPLIANT (FAIL)', () => {
  const missingMrpAndNetQty = cleanCompliantLines.filter(
    l => !l.includes('MRP') && !l.includes('NET WEIGHT')
  )
  const report = generateComplianceReport(makeOcr(missingMrpAndNetQty), confirmedComplete)

  assert.equal(report.checks[0].status, STATUS.NON_COMPLIANT) // mrp missing -> FAIL
  assert.equal(report.checks[1].status, STATUS.NON_COMPLIANT) // net-qty missing -> FAIL
  assert.ok(report.summary.nonCompliantCount >= 2)
})

test('Test Fixture 4: Non-50-paise rounding returns NON-COMPLIANT on MRP', () => {
  const unroundedLines = cleanCompliantLines.map(l => (
    l.includes('MRP') ? 'MRP Rs. 240.35 (INCL. OF ALL TAXES)' : l
  ))
  const report = generateComplianceReport(makeOcr(unroundedLines), confirmedComplete)

  assert.equal(report.checks[0].status, STATUS.NON_COMPLIANT)
  assert.equal(report.checks[0].evidence.roundedAsRequired, false)
})

test('Test Fixture 5: Missing tax inclusive phrase returns NON-COMPLIANT on MRP', () => {
  const missingTaxLines = cleanCompliantLines.map(l => (
    l.includes('MRP') ? 'MRP Rs. 240.00' : l
  ))
  const report = generateComplianceReport(makeOcr(missingTaxLines), confirmedComplete)

  assert.equal(report.checks[0].status, STATUS.NON_COMPLIANT)
  assert.equal(report.checks[0].evidence.taxInclusive, false)
})

test('Test Fixture 6: Product name detection and custom override', () => {
  const ocr = makeOcr(cleanCompliantLines)
  const autoReport = generateComplianceReport(ocr, confirmedComplete)
  assert.equal(autoReport.productName, 'AARAV CHAKKI ATTA')
  assert.equal(autoReport.isProductNameDetected, true)

  const manualReport = generateComplianceReport(ocr, {
    ...confirmedComplete,
    productName: 'Custom Premium Atta 5kg'
  })
  assert.equal(manualReport.productName, 'Custom Premium Atta 5kg')
  assert.equal(manualReport.isProductNameDetected, false)
})

test("Test Fixture 7: Only 'Best before X months' without statutory Month/Year of packing returns NON-COMPLIANT", () => {
  const onlyBestBeforeLines = cleanCompliantLines.map(l => (
    l.includes('MFD. DATE') ? 'Best before 6 months from packing' : l
  ))
  const report = generateComplianceReport(makeOcr(onlyBestBeforeLines), confirmedComplete)

  const dateCheck = report.checks.find(c => c.ruleId === 'date-declaration')
  assert.equal(dateCheck.status, STATUS.NON_COMPLIANT)
  assert.equal(report.summary.compliantCount, 4)
  assert.equal(report.summary.nonCompliantCount, 1)
})

test('Test Fixture 8: Consumer Care heading-only (no phone/email/name/address) on complete label returns NON-COMPLIANT', () => {
  // Label has "Consumer Care:" heading but NO actual contact details below it.
  // The manufacturer address (PIN 492001) appears BEFORE the consumer care section.
  // Engine must NOT confuse manufacturer PIN with consumer-care address.
  const headingOnlyLines = [
    'AARAV CHAKKI ATTA',
    'MRP Rs. 240.00 (INCL. OF ALL TAXES)',
    'NET WEIGHT: 5 kg',
    'MFD. DATE: 10/2026',
    'MANUFACTURED BY: Aarav Foods Private Limited',
    'Plot 14-B, Industrial Area, Raipur, C.G. - PIN 492001',
    'Consumer Care:',              // heading present — but nothing after it
    'Product of India',
    'SAMPLE LABEL - FOR TESTING ONLY'
  ]
  const report = generateComplianceReport(makeOcr(headingOnlyLines), confirmedComplete)

  const careCheck = report.checks.find(c => c.ruleId === 'consumer-care')
  assert.equal(careCheck.status, STATUS.NON_COMPLIANT,
    `Expected NON_COMPLIANT but got ${careCheck.status}. Evidence: ${JSON.stringify(careCheck.evidence)}`)
  assert.ok(careCheck.evidence.telephone === null, 'telephone should be null')
  assert.ok(careCheck.evidence.email === null, 'email should be null')
})

test('Test Fixture 9: 12/13-digit barcode must NOT be detected as a phone number in Consumer Care', () => {
  // Barcode 8901030082190 (13 digits) must not satisfy the telephone requirement
  const barcodeAsPhoneTrap = [
    'AARAV CHAKKI ATTA',
    'MRP Rs. 240.00 (INCL. OF ALL TAXES)',
    'NET WEIGHT: 5 kg',
    'MFD. DATE: 10/2026',
    'MANUFACTURED BY: Aarav Foods Private Limited',
    'Plot 14-B, Industrial Area, Raipur, C.G. - PIN 492001',
    'Consumer Care:',
    'Aarav Foods Pvt. Ltd., Raipur - 492001',
    '8901030082190',               // barcode — must NOT be treated as phone
    'care@aaravfoods.in'
  ]
  const report = generateComplianceReport(makeOcr(barcodeAsPhoneTrap), confirmedComplete)

  const careCheck = report.checks.find(c => c.ruleId === 'consumer-care')
  // No valid phone, no name/desk → should be NON-COMPLIANT
  assert.equal(careCheck.evidence.telephone, null,
    `Barcode 8901030082190 must not be detected as phone. Got: ${careCheck.evidence.telephone}`)
  assert.notEqual(careCheck.status, 'COMPLIANT',
    'Label with barcode-only "phone" should not PASS')
})
