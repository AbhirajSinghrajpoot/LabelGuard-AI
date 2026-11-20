const { generateComplianceReport, STATUS } = require('./services/complianceEngine');

// Complete mock label that conforms 100% to Legal Metrology Rules
const cleanCompliantLabel = {
  results: [
    { text: 'AARAV CHAKKI ATTA', confidence: 0.98 },
    { text: '100% Whole Wheat Flour', confidence: 0.95 },
    { text: 'MRP Rs. 240.00 (INCL. OF ALL TAXES)', confidence: 0.99 },
    { text: 'NET WEIGHT: 5 kg', confidence: 0.98 },
    { text: 'MFD. DATE: 10/2026', confidence: 0.96 },
    { text: 'MANUFACTURED BY: Aarav Foods Private Limited', confidence: 0.97 },
    { text: 'Plot 14-B, Industrial Area, Raipur, C.G. - PIN 492001', confidence: 0.96 },
    { text: 'CONSUMER CARE CELL:', confidence: 0.97 },
    { text: 'Consumer Grievance Officer, Aarav Foods Desk', confidence: 0.95 },
    { text: 'Address: Plot 14-B, Industrial Area, Raipur - 492001', confidence: 0.96 },
    { text: 'Toll Free: 1800-266-0422', confidence: 0.98 },
    { text: 'Email: care@aaravfoods.in', confidence: 0.99 }
  ]
};

const report = generateComplianceReport(cleanCompliantLabel, {
  ruleApplicabilityConfirmed: true,
  completeLabelConfirmed: true,
  productCategory: 'food'
});

console.log('=== CLEAN COMPLIANT LABEL AUDIT ===');
console.log('Summary:', report.summary);
report.checks.forEach(c => {
  console.log(`[${c.ruleId}]: ${c.status} (${c.confidence})`);
  console.log(`  Extracted: ${c.detectedValue}`);
  console.log(`  Reason: ${c.reason}`);
});
