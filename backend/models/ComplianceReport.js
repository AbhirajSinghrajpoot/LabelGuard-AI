const mongoose = require('mongoose')

const complianceReportSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, default: null },
  userEmail: { type: String, index: true, default: null },
  productName: { type: String, default: 'Unnamed Product' },
  isProductNameDetected: { type: Boolean, default: true },
  productCategory: { type: String, default: 'general' },
  filename: { type: String, required: true },
  mimeType: { type: String, required: true },
  ocr: { type: mongoose.Schema.Types.Mixed, required: true },
  report: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true })

module.exports = mongoose.models.ComplianceReport
  || mongoose.model('ComplianceReport', complianceReportSchema)
