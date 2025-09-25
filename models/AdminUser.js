import mongoose from 'mongoose';

const adminUserSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  role: {
    type: String,
    enum: ['admin', 'super_admin'],
    default: 'admin'
  },
  permissions: [{
    type: String,
    enum: [
      'user_management',
      'content_management',
      'subscription_management',
      'admin_management',
      'system_settings',
      'analytics_view',
      'audit_logs'
    ]
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  lastAdminLogin: Date,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes for better performance (userId index is automatically created by unique: true)
adminUserSchema.index({ role: 1 });
adminUserSchema.index({ isActive: 1 });

// Default permissions based on role
adminUserSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('role')) {
    if (this.role === 'super_admin') {
      this.permissions = [
        'user_management',
        'content_management',
        'subscription_management',
        'admin_management',
        'system_settings',
        'analytics_view',
        'audit_logs'
      ];
    } else if (this.role === 'admin') {
      this.permissions = [
        'user_management',
        'content_management',
        'subscription_management',
        'analytics_view'
      ];
    }
  }
  next();
});

// Method to check if admin has specific permission
adminUserSchema.methods.hasPermission = function(permission) {
  return this.isActive && this.permissions.includes(permission);
};

// Static method to check if user is admin
adminUserSchema.statics.isAdmin = async function(userId) {
  const admin = await this.findOne({ userId, isActive: true });
  return !!admin;
};

// Static method to get admin with permissions
adminUserSchema.statics.getAdminWithPermissions = async function(userId) {
  return await this.findOne({ userId, isActive: true }).populate('userId', 'email fullName');
};

export default mongoose.model('AdminUser', adminUserSchema);
