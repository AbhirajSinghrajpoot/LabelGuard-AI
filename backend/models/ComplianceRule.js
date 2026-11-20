const mongoose = require('mongoose')

const complianceRuleSchema = new mongoose.Schema({
  ruleId: { type: String, required: true, unique: true },
  declarationName: { type: String, required: true },
  regulatorySource: { type: String, required: true },
  applicableClause: { type: String, required: true },
  effectiveDate: { type: String, required: true },
  regulationVersion: { type: String, required: true },
  sourceUrl: { type: String, required: true },
  amendmentSources: { type: [String], default: [] },
  validationConditions: { type: mongoose.Schema.Types.Mixed, required: true },
  applicabilityConditions: { type: [String], default: [] },
  applicabilityExemptions: { type: [String], default: [] }
}, { timestamps: true })

module.exports = mongoose.models.ComplianceRule
  || mongoose.model('ComplianceRule', complianceRuleSchema)
