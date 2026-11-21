const { randomUUID } = require('node:crypto')
const defaultRules = require('../config/complianceRules.json')

const STATUS = {
  COMPLIANT: 'COMPLIANT',
  NON_COMPLIANT: 'NON-COMPLIANT',
  MANUAL: 'NEEDS MANUAL VERIFICATION'
}

function minimumConfidence(lines) {
  if (!lines.length) return null
  return Math.min(...lines.map((line) => line.confidence))
}

function patternFromKeywords(keywords) {
  const alternatives = (Array.isArray(keywords) ? keywords : [])
    .filter((keyword) => typeof keyword === 'string' && keyword.trim())
    .map((keyword) => keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
  return alternatives.length ? new RegExp(alternatives.join('|'), 'i') : /$a/
}

function getLines(ocr) {
  return (Array.isArray(ocr.results) ? ocr.results : [])
    .filter((line) => typeof line.text === 'string' && line.text.trim())
    .map((line) => ({
      text: line.text.trim(),
      confidence: Number.isFinite(Number(line.confidence)) ? Number(line.confidence) : 0,
      pageNumber: Number.isInteger(line.page_number) ? line.page_number : 1
    }))
}

function findContexts(lines, pattern, before = 0, after = 2) {
  const indexes = new Set()
  lines.forEach((line, index) => {
    if (!pattern.test(line.text)) return
    for (let position = Math.max(0, index - before); position <= Math.min(lines.length - 1, index + after); position += 1) {
      if (lines[position].pageNumber === line.pageNumber) indexes.add(position)
    }
  })
  return [...indexes].sort((left, right) => left - right).map((index) => lines[index])
}

function hasLabeledValue(contexts, labelPattern) {
  return contexts.some((line, index) => {
    const match = line.text.match(labelPattern)
    if (!match) return false
    const value = line.text.slice(match.index + match[0].length).replace(/^[\s:=\-–]+/, '').trim()
    if (value.length >= 3 && /[A-Za-z0-9]/.test(value) && !/^(?:n\/?a|none|nil|tbd|unknown)$/i.test(value)) return true

    const nextLine = contexts[index + 1]
    return Boolean(
      nextLine
      && !/\b(?:name|address|telephone|phone|email|e-mail)\s*[:\-]/i.test(nextLine.text)
      && nextLine.text.trim().length >= 3
      && !/^(?:n\/?a|none|nil|tbd|unknown)$/i.test(nextLine.text.trim())
    )
  })
}

function normalizedAmountToPaise(value) {
  const normalized = value.replace(/,/g, '')
  const [whole, fraction = ''] = normalized.split('.')
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction)) return null
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

function buildCheck(rule, detectedValue, confidence, status, reason, correctiveAction, evidence) {
  return {
    ruleId: rule.ruleId,
    declarationName: rule.declarationName,
    detectedValue,
    confidence: confidence === null ? null : Number(confidence.toFixed(4)),
    status,
    reason,
    correctiveAction,
    regulation: {
      source: rule.regulatorySource,
      clause: rule.applicableClause,
      effectiveDate: rule.effectiveDate,
      version: rule.regulationVersion,
      sourceUrl: rule.sourceUrl,
      amendmentSources: rule.amendmentSources,
      applicabilityConditions: rule.applicabilityConditions,
      applicabilityExemptions: rule.applicabilityExemptions
    },
    evidence
  }
}

function evaluateMissing(rule, detectedValue, confidence, reportContext, evidence, missingReason) {
  const sufficientlyReadable = reportContext.minimumConfidence >= (rule.validationConditions.minimumOcrConfidence || 0.8)
    && reportContext.qualityWarnings.length === 0
  if (!reportContext.ruleApplicabilityConfirmed || !reportContext.completeLabelConfirmed || !sufficientlyReadable) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.MANUAL,
      `${missingReason} OCR cannot establish absence unless the relevant package panels are complete, readable, and confirmed applicable.`,
      'Review the complete package label and confirm the applicable rule and any exemptions.',
      evidence
    )
  }
  return buildCheck(
    rule,
    detectedValue,
    confidence,
    STATUS.NON_COMPLIANT,
    missingReason,
    'Add the required declaration in a clear, legible form and recheck the complete label.',
    evidence
  )
}

function evaluateMrp(rule, lines, reportContext) {
  const contexts = findContexts(lines, patternFromKeywords(rule.validationConditions.contextKeywords), 0, 3)
  const contextText = contexts.map((line) => line.text).join(' ')
  const currencyAmountMatch = contextText.match(/(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:\/-)?|([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:₹|rs\.?|inr)(?![a-z])/i)
  const amountOnlyMatch = rule.validationConditions.requiresCurrency
    ? null
    : contextText.match(/\b([0-9][0-9,]*(?:\.\d{1,2})?)\b/)
  const amountMatch = currencyAmountMatch || amountOnlyMatch
  const amount = amountMatch ? (amountMatch[1] || amountMatch[2]) : null
  const hasCurrency = Boolean(currencyAmountMatch)
  const taxInclusive = /\b(?:inclusive|incl\.?|ind\.?|inl\.?|inc\.?|inclof|inclall)\s*(?:of\s*)?all\s+tax(?:es)?\b|\b(?:incl|inclusive|inc)\s*of\s*all\s*taxes?\b|inl\.\s*of\s*all|inc\.\s*of\s*all|ind\s*of\s*all|inclusive\s+all\s+tax/i.test(contextText)
  const paise = amount ? normalizedAmountToPaise(amount) : null
  const increment = Number(rule.validationConditions.roundingIncrementPaise || 50)
  const roundedAsRequired = paise !== null && paise % increment === 0
  const evidence = {
    price: amount,
    currency: hasCurrency ? 'INR' : null,
    taxInclusive,
    roundedAsRequired
  }
  const detectedValue = contexts.length ? contextText : null
  const confidence = minimumConfidence(contexts)
  const requiredConfidence = rule.validationConditions.minimumOcrConfidence || 0.8

  if (!contexts.length) {
    return evaluateMissing(
      rule,
      null,
      null,
      reportContext,
      evidence,
      'No MRP declaration was recognized.'
    )
  }
  if (!reportContext.ruleApplicabilityConfirmed || confidence < requiredConfidence) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.MANUAL,
      'An MRP-like label was found, but rule applicability or OCR confidence is insufficient for an automatic decision.',
      'Verify the price declaration against the full label and check for alcohol, authority-fixed-price, and other applicable exemptions.',
      evidence
    )
  }

  const conditionsMet = amount !== null
    && (!rule.validationConditions.requiresCurrency || hasCurrency)
    && (!rule.validationConditions.requiresTaxInclusivePhrase || taxInclusive)
    && roundedAsRequired
  if (conditionsMet) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.COMPLIANT,
      'A context-linked MRP, INR amount, tax-inclusive phrase, and 50-paise/rupee increment were recognized.',
      'No correction suggested by this limited automated check; verify the text against the physical package.',
      evidence
    )
  }
  if (!reportContext.completeLabelConfirmed) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.MANUAL,
      'The MRP context was recognized, but one or more Rule 6(1)(e) components could not be verified automatically; complete package coverage was not confirmed.',
      'Review the full label and verify the MRP format, currency symbol, and tax-inclusive wording.',
      evidence
    )
  }
  return buildCheck(
    rule,
    detectedValue,
    confidence,
    STATUS.NON_COMPLIANT,
    'The clearly recognized MRP context does not show all tested Rule 6(1)(e) elements: INR denomination, inclusive-of-all-taxes wording, and rounding to the nearest rupee or 50 paise.',
    'Correct the MRP declaration to meet the visible Rule 6(1)(e) requirements, subject to any applicable proviso.',
    evidence
  )
}

function evaluateNetQuantity(rule, lines, reportContext) {
  const contexts = findContexts(
    lines,
    patternFromKeywords(rule.validationConditions.contextKeywords),
    0,
    3
  )
  const contextText = contexts.map((line) => line.text).join(' ')
  const units = (rule.validationConditions.acceptedUnits || []).join('|')
  const quantityPattern = new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*(${units})\\b`, 'i')
  const quantityMatch = contextText.match(quantityPattern)
  const evidence = {
    quantity: quantityMatch ? quantityMatch[1] : null,
    unit: quantityMatch ? quantityMatch[2] : null
  }
  const confidence = minimumConfidence(contexts)
  const detectedValue = contexts.length ? contextText : null
  const requiredConfidence = rule.validationConditions.minimumOcrConfidence || 0.8

  if (!contexts.length) {
    return evaluateMissing(
      rule,
      null,
      null,
      reportContext,
      evidence,
      'No context-linked net-quantity declaration was recognized.'
    )
  }
  if (!reportContext.ruleApplicabilityConfirmed || confidence < requiredConfidence) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.MANUAL,
      'A net-quantity label was found, but rule applicability or OCR confidence is insufficient for an automatic decision.',
      'Verify the stated quantity and its standard unit against the complete package label.',
      evidence
    )
  }
  if (quantityMatch && Number(quantityMatch[1].replace(',', '.')) > 0) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.COMPLIANT,
      'A positive quantity and a recognized standard weight, measure, or count unit were found beside a net-quantity label.',
      'No correction suggested by this limited automated check; verify the quantity against the physical package.',
      evidence
    )
  }
  if (!reportContext.completeLabelConfirmed) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.MANUAL,
      'The net-quantity context was recognized, but a supported quantity/unit pair was not; complete package coverage was not confirmed.',
      'Review the complete label and verify the declared quantity in a standard unit or by number, as applicable.',
      evidence
    )
  }
  return buildCheck(
    rule,
    detectedValue,
    confidence,
    STATUS.NON_COMPLIANT,
    'The complete, readable label was confirmed, but a positive quantity with a recognized standard unit or count was not found beside the net-quantity declaration.',
    'State the net quantity using the applicable standard unit of weight or measure, or by number where appropriate.',
    evidence
  )
}

function evaluateManufacturer(rule, lines, reportContext) {
  const contexts = findContexts(
    lines,
    patternFromKeywords(rule.validationConditions.contextKeywords),
    0,
    4
  )
  const contextText = contexts.map((line) => line.text).join(' ')
  const confidence = minimumConfidence(contexts)
  const detectedValue = contexts.length ? contextText : null
  const requiredConfidence = rule.validationConditions.minimumOcrConfidence || 0.8

  const pinMatch = contextText.match(/\b(?:pin(?:\s*code)?[:\s-]*)?([1-9]\d{5})\b/i)
  const hasPinCode = Boolean(pinMatch)

  const hasEntityName = /\b(?:pvt\.?\s*ltd\.?|ltd\.?|limited|foods|consumer|industries|laboratories|enterprises|products|india|co\.)\b/i.test(contextText)
    || contexts.some(l => l.text.length > 8 && !patternFromKeywords(rule.validationConditions.contextKeywords).test(l.text))

  const hasAddressContext = hasPinCode
    || /\b(?:plot|road|street|nagar|sector|phase|estate|village|taluk|dist|district|area|baddi|mumbai|delhi|solan|pincode|po\s*bag|industrial)\b/i.test(contextText)

  const evidence = {
    contextRecognized: contexts.length > 0,
    entityNameFound: hasEntityName,
    addressFound: hasAddressContext,
    pinCode: pinMatch ? pinMatch[1] : null
  }

  if (!contexts.length) {
    return evaluateMissing(
      rule,
      null,
      null,
      reportContext,
      evidence,
      'No manufacturer, packer, or importer declaration was recognized.'
    )
  }

  if (!reportContext.ruleApplicabilityConfirmed || confidence < requiredConfidence) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.MANUAL,
      'A manufacturer/packer declaration was found, but rule applicability or OCR confidence is insufficient for an automatic decision.',
      'Verify the manufacturer or packer address on the complete label.',
      evidence
    )
  }

  if (hasEntityName && hasAddressContext) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.COMPLIANT,
      'A context-linked manufacturer/packer name and address details were recognized.',
      'No correction suggested by this limited automated check; verify complete address against physical package.',
      evidence
    )
  }

  if (!reportContext.completeLabelConfirmed) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.MANUAL,
      'Manufacturer declaration context was found, but complete address or postal code could not be verified automatically.',
      'Review the physical package to ensure complete manufacturer name and postal address are present.',
      evidence
    )
  }

  return buildCheck(
    rule,
    detectedValue,
    confidence,
    STATUS.NON_COMPLIANT,
    'Manufacturer declaration lacks complete address or postal code required under Rule 6(1)(a).',
    'Include complete manufacturer/packer name, premise details, and postal PIN code.',
    evidence
  )
}

function evaluateDate(rule, lines, reportContext) {
  const contexts = findContexts(
    lines,
    patternFromKeywords(rule.validationConditions.contextKeywords),
    0,
    3
  )
  const contextText = contexts.map((line) => line.text).join(' ')
  const confidence = minimumConfidence(contexts)
  const detectedValue = contexts.length ? contextText : null
  const requiredConfidence = rule.validationConditions.minimumOcrConfidence || 0.8

  const monthYearPattern = /\b(?:0?[1-9]|1[0-2])[\s\/\-\.](?:20\d{2}|\d{2})\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember))[\s\/\-\.]+(?:20\d{2}|\d{2})\b|\b(?:20\d{2})[\s\/\-\.](?:0?[1-9]|1[0-2])\b/i
  const bestBeforePattern = /\b(?:best\s+before|expiry|exp\.?|use\s+by)\b/i
  const dateMatch = contextText.match(monthYearPattern)
  const hasBestBefore = bestBeforePattern.test(contextText)

  const evidence = {
    contextRecognized: contexts.length > 0,
    dateCandidateRecognized: Boolean(dateMatch),
    matchedDate: dateMatch ? dateMatch[0] : null,
    hasExpiryOrBestBefore: hasBestBefore
  }

  if (!contexts.length) {
    return evaluateMissing(
      rule,
      null,
      null,
      reportContext,
      evidence,
      'No manufacture, pre-packing, or import date declaration was recognized.'
    )
  }

  if (!reportContext.ruleApplicabilityConfirmed || confidence < requiredConfidence) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.MANUAL,
      'A date declaration was found, but rule applicability or OCR confidence is insufficient for an automatic decision.',
      'Verify the declared date of manufacture or packaging on the physical label.',
      evidence
    )
  }

  if (dateMatch) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.COMPLIANT,
      `A valid statutory date of manufacture or packing (${dateMatch[0]}) was recognized.`,
      'No correction suggested by this limited automated check; verify date against physical specimen.',
      evidence
    )
  }

  if (hasBestBefore) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      reportContext.completeLabelConfirmed ? STATUS.NON_COMPLIANT : STATUS.MANUAL,
      "Statutory violation under Rule 6(1)(d): Only an expiry period notation ('Best before') was detected, but the mandatory Month and Year of manufacture or packing is missing from this label.",
      "Print the declared month and year of manufacture or pre-packing (e.g., 'Mfg Date: MM/YYYY') alongside best-before duration.",
      evidence
    )
  }

  if (!reportContext.completeLabelConfirmed) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.MANUAL,
      'Date context was recognized, but statutory month and year format could not be verified automatically.',
      'Verify the month and year of packaging or manufacturing on the physical package.',
      evidence
    )
  }

  return buildCheck(
    rule,
    detectedValue,
    confidence,
    STATUS.NON_COMPLIANT,
    'Date declaration context is present but lacks standard month and year specification required by Rule 6(1)(d).',
    'Declare month and year of manufacture or pre-packing in standard statutory format.',
    evidence
  )
}

function evaluateConsumerCare(rule, lines, reportContext) {
  const contexts = findContexts(
    lines,
    patternFromKeywords(rule.validationConditions.contextKeywords),
    1,
    8
  )
  const contextText = contexts.map((line) => line.text).join('\n')
  const phoneMatch = contextText.match(/(?:1800|1860)[\s-]?\d{3}[\s-]?\d{3,4}\b|(?:\+?91[\s-]?)?(?:0?\d{2,4}[\s-]?)?[2-9]\d(?:[\s-]?\d){6,9}\b/)
  const emailMatch = contextText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  
  const namePresent = hasLabeledValue(contexts, /\b(?:name|contact person|person or office|manager|officer|desk|executive|cell)\s*[:\-]?/i)
    || contexts.some(l => /\b(?:grievance|officer|manager|desk|care cell|consumer)\b/i.test(l.text))

  const pinMatch = contextText.match(/\b[1-9]\d{5}\b/)
  const addressPresent = hasLabeledValue(contexts, /\b(?:address|regd\.?\s*off\.?|office|p\.?o\.?\s*bag)\s*[:\-]?/i)
    || Boolean(pinMatch)

  const confidence = minimumConfidence(contexts)
  const detectedValue = contexts.length ? contextText : null
  const requiredConfidence = rule.validationConditions.minimumOcrConfidence || 0.8

  const evidence = {
    telephone: phoneMatch ? phoneMatch[0].trim() : null,
    email: emailMatch ? emailMatch[0] : null,
    nameExplicitlyLabeled: namePresent,
    addressExplicitlyLabeled: addressPresent,
    requiredComponents: rule.validationConditions.requiredComponents || ['name', 'address', 'telephone', 'email']
  }

  if (!contexts.length) {
    return evaluateMissing(
      rule,
      null,
      null,
      reportContext,
      evidence,
      'No consumer-complaint contact context was recognized.'
    )
  }
  if (!reportContext.ruleApplicabilityConfirmed || confidence < requiredConfidence) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.MANUAL,
      'A consumer-complaint context was found, but rule applicability or OCR confidence is insufficient for an automatic decision.',
      'Verify the contact person/office name, address, telephone number, and email address on the complete label.',
      evidence
    )
  }
  if (phoneMatch && emailMatch && namePresent && addressPresent) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.COMPLIANT,
      'A complaint-contact context with name/desk, address/PIN, telephone number, and email address was recognized.',
      'No correction suggested by this limited automated check; verify each contact detail against the physical package.',
      evidence
    )
  }
  if (phoneMatch || emailMatch) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.MANUAL,
      'Consumer contact was partially recognized (telephone or email present), but required address or designated officer could not be verified automatically.',
      'Manually verify that the consumer-complaint contact includes responsible person/office name and address as well as telephone and email.',
      evidence
    )
  }
  if (!reportContext.completeLabelConfirmed) {
    return buildCheck(
      rule,
      detectedValue,
      confidence,
      STATUS.MANUAL,
      'One or more Rule 6(2) consumer-contact components were not recognized, but complete package coverage was not confirmed.',
      'Review the complete label for the contact person/office name, address, telephone number, and email address.',
      evidence
    )
  }
  return buildCheck(
    rule,
    detectedValue,
    confidence,
    STATUS.NON_COMPLIANT,
    'The complete, readable label was confirmed, but the context-linked consumer-complaint contact does not include required Rule 6(2) components.',
    'Provide the contact person/office name, address, telephone number, and email address for consumer complaints.',
    evidence
  )
}

function extractCandidateProductName(ocr, userProvidedName) {
  if (userProvidedName && typeof userProvidedName === 'string' && userProvidedName.trim()) {
    return { name: userProvidedName.trim(), detected: false }
  }
  const lines = getLines(ocr)
  if (!lines.length) return { name: 'Unnamed Product', detected: true }

  const excludePattern = /\b(?:nutrition|ingredients|mrp|net\s*wt|mfd|mfg|manufactured|packaged|consumer|lic\.?|fssai|batch|lot|call|email|regd|storage|directions|100%|vegetarian|instructions|warning|caution)\b/i

  for (const line of lines) {
    const text = line.text.trim()
    if (text.length >= 3 && text.length <= 45 && line.confidence >= 0.85 && !excludePattern.test(text)) {
      if (/[A-Za-z]{3,}/.test(text)) {
        return { name: text, detected: true }
      }
    }
  }
  return { name: 'Unnamed Product', detected: true }
}

function generateComplianceReport(ocr, confirmations = {}, configuredRules = defaultRules) {
  const lines = getLines(ocr)
  const minimum = minimumConfidence(lines)
  const qualityWarnings = Array.isArray(ocr.quality_warnings) ? ocr.quality_warnings : []
  const ruleApplicabilityConfirmed = confirmations.ruleApplicabilityConfirmed === true
  const completeLabelConfirmed = confirmations.completeLabelConfirmed === true
  const productCategory = confirmations.productCategory || 'food'
  const reportContext = {
    ruleApplicabilityConfirmed,
    completeLabelConfirmed,
    productCategory,
    minimumConfidence: minimum === null ? 0 : minimum,
    qualityWarnings
  }
  const rulesById = new Map(configuredRules.map((rule) => [rule.ruleId, rule]))
  const requiredRuleIds = defaultRules.map((rule) => rule.ruleId)
  const missingRules = requiredRuleIds.filter((ruleId) => !rulesById.has(ruleId))
  if (missingRules.length) {
    throw new Error(`The compliance rule set is incomplete: ${missingRules.join(', ')}`)
  }

  const checks = requiredRuleIds.map((ruleId) => {
    const rule = rulesById.get(ruleId)
    if (ruleId === 'manufacturer-details') return evaluateManufacturer(rule, lines, reportContext)
    if (ruleId === 'date-declaration') return evaluateDate(rule, lines, reportContext)
    if (ruleId === 'mrp') return evaluateMrp(rule, lines, reportContext)
    if (ruleId === 'net-quantity') return evaluateNetQuantity(rule, lines, reportContext)
    return evaluateConsumerCare(rule, lines, reportContext)
  })

  const summary = {
    totalChecks: 5,
    compliantCount: checks.filter((check) => check.status === STATUS.COMPLIANT).length,
    nonCompliantCount: checks.filter((check) => check.status === STATUS.NON_COMPLIANT).length,
    manualVerificationCount: checks.filter((check) => check.status === STATUS.MANUAL).length
  }

  const productInfo = extractCandidateProductName(ocr, confirmations.productName)

  return {
    id: randomUUID(),
    generatedAt: new Date().toISOString(),
    regulationVersion: 'LMPC Rules 2011; reviewed through G.S.R. 826(E), 2026-09-21',
    productName: productInfo.name,
    isProductNameDetected: productInfo.detected,
    applicability: {
      ruleApplicabilityConfirmed,
      completeLabelConfirmed,
      productCategory,
      note: 'This is a statutory assessment under Legal Metrology (Packaged Commodities) Rules, 2011.'
    },
    summary,
    checks
  }
}

module.exports = {
  STATUS,
  generateComplianceReport,
  extractCandidateProductName
}
