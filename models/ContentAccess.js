import mongoose from 'mongoose';

const contentAccessSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  contentType: {
    type: String,
    required: true,
    enum: ['magazine', 'article', 'video', 'document']
  },
  contentId: {
    type: String,
    required: true
  },
  accessGranted: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date
  },
  grantedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  accessReason: {
    type: String,
    enum: ['subscription', 'manual_grant', 'trial', 'promotion'],
    default: 'subscription'
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Indexes for better performance
contentAccessSchema.index({ userId: 1, contentType: 1, contentId: 1 });
contentAccessSchema.index({ userId: 1 });
contentAccessSchema.index({ contentType: 1, contentId: 1 });
contentAccessSchema.index({ expiresAt: 1 });

// Virtual to check if access is currently valid
contentAccessSchema.virtual('isValid').get(function() {
  if (!this.accessGranted) return false;
  if (!this.expiresAt) return true;
  return this.expiresAt > new Date();
});

// Static method to check user access to content
contentAccessSchema.statics.checkAccess = async function(userId, contentType, contentId) {
  const User = mongoose.model('User');
  const user = await User.findById(userId);
  
  if (!user) return false;
  
  // If user has active subscription, they have access to all content
  if (user.hasActiveSubscription()) {
    return true;
  }
  
  // Check for specific content access
  const access = await this.findOne({
    userId,
    contentType,
    contentId,
    accessGranted: true,
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ]
  });
  
  return !!access;
};

// Static method to grant access to content
contentAccessSchema.statics.grantAccess = async function(userId, contentType, contentId, options = {}) {
  const {
    expiresAt,
    grantedBy,
    accessReason = 'manual_grant',
    metadata = {}
  } = options;
  
  const access = await this.findOneAndUpdate(
    { userId, contentType, contentId },
    {
      accessGranted: true,
      expiresAt,
      grantedBy,
      accessReason,
      metadata
    },
    { upsert: true, new: true }
  );
  
  return access;
};

// Static method to revoke access to content
contentAccessSchema.statics.revokeAccess = async function(userId, contentType, contentId) {
  return await this.findOneAndUpdate(
    { userId, contentType, contentId },
    { accessGranted: false },
    { new: true }
  );
};

export default mongoose.model('ContentAccess', contentAccessSchema);
