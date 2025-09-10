import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true
  },
  resourceType: {
    type: String,
    enum: ['user', 'subscription', 'content', 'admin', 'system']
  },
  resourceId: {
    type: String
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['success', 'failure', 'warning'],
    default: 'success'
  }
}, {
  timestamps: true
});

// Indexes for better performance
auditLogSchema.index({ userId: 1 });
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1 });
auditLogSchema.index({ severity: 1 });

// Static method to log an event
auditLogSchema.statics.logEvent = async function(eventData) {
  try {
    const log = new this(eventData);
    await log.save();
    return log;
  } catch (error) {
    console.error('Failed to create audit log:', error);
    return null;
  }
};

// Static method to get logs with pagination
auditLogSchema.statics.getLogs = async function(filters = {}, options = {}) {
  const {
    page = 1,
    limit = 50,
    sortBy = 'createdAt',
    sortOrder = -1
  } = options;

  const skip = (page - 1) * limit;
  
  const query = this.find(filters)
    .populate('userId', 'email fullName')
    .sort({ [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit);

  const logs = await query.exec();
  const total = await this.countDocuments(filters);

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

export default mongoose.model('AuditLog', auditLogSchema);
