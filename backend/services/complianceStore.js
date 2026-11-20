const mongoose = require('mongoose')
const path = require('node:path')
const defaultRules = require('../config/complianceRules.json')
const ComplianceRule = require('../models/ComplianceRule')
const ComplianceReport = require('../models/ComplianceReport')

let databaseStatus = 'not_configured'

async function initializeDatabase() {
  const uri = process.env.MONGO_URI
  if (!uri || uri === 'your_mongodb_connection_string_here') {
    console.warn('MongoDB is not configured; compliance reports will not be persisted.')
    return
  }

  databaseStatus = 'connecting'
  try {
    await mongoose.connect(uri)
    await Promise.all(defaultRules.map((rule) => ComplianceRule.updateOne(
      { ruleId: rule.ruleId },
      { $setOnInsert: rule },
      { upsert: true }
    )))
    databaseStatus = 'online'
    console.log('MongoDB connected; compliance rules are ready.')
  } catch (error) {
    databaseStatus = 'offline'
    console.error('MongoDB connection or compliance-rule initialization failed:', error.message)
  }
}

mongoose.connection.on('disconnected', () => {
  databaseStatus = process.env.MONGO_URI ? 'offline' : 'not_configured'
  console.error('MongoDB connection was lost; new reports will not be persisted.')
})

async function getComplianceRules() {
  if (databaseStatus !== 'online' || mongoose.connection.readyState !== 1) return defaultRules
  const rules = await ComplianceRule.find({
    ruleId: { $in: defaultRules.map((rule) => rule.ruleId) }
  }).lean()
  if (rules.length !== defaultRules.length) {
    throw new Error('The database compliance rule set is incomplete.')
  }
  return rules
}

async function persistComplianceReport(report, ocr, file, user = null) {
  if (databaseStatus !== 'online' || mongoose.connection.readyState !== 1) {
    return {
      persisted: false,
      message: databaseStatus === 'not_configured'
        ? 'MongoDB is not configured. This report is available for this response only.'
        : 'MongoDB is unavailable. This report is available for this response only.'
    }
  }

  try {
    await ComplianceReport.create({
      _id: report.id,
      userId: user?._id || null,
      userEmail: user?.email || null,
      productName: report.productName || 'Unnamed Product',
      isProductNameDetected: report.isProductNameDetected !== false,
      productCategory: report.applicability?.productCategory || 'general',
      filename: path.basename(file.originalname),
      mimeType: file.mimetype,
      ocr,
      report
    })
    return { persisted: true, reportId: report.id }
  } catch (error) {
    console.error(`Compliance report ${report.id} could not be persisted:`, error.message)
    return {
      persisted: false,
      message: 'The report was generated but could not be saved to MongoDB.'
    }
  }
}

async function findComplianceReport(reportId, user = null) {
  if (databaseStatus !== 'online' || mongoose.connection.readyState !== 1) return null
  const query = { _id: reportId }
  if (user && user.role !== 'admin') {
    // Non-admin users can access their own reports or unassigned legacy reports
    query.$or = [{ userId: user._id }, { userId: null }, { userEmail: user.email }]
  }
  return ComplianceReport.findOne(query).lean()
}

function getDatabaseStatus() {
  return databaseStatus
}

module.exports = {
  findComplianceReport,
  getComplianceRules,
  getDatabaseStatus,
  initializeDatabase,
  persistComplianceReport
}
