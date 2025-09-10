import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  subscriptionTier: {
    type: String,
    enum: ['free', 'premium', 'enterprise'],
    default: 'free'
  },
  subscriptionStatus: {
    type: String,
    enum: ['inactive', 'active', 'cancelled', 'expired'],
    default: 'inactive'
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  passwordResetToken: String,
  passwordResetExpires: Date,
  lastLogin: Date,
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: Date
}, {
  timestamps: true
});

// Indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ subscriptionStatus: 1 });
userSchema.index({ subscriptionTier: 1 });

// Virtual for checking if account is locked
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (this.isLocked) {
    throw new Error('Account is temporarily locked due to too many failed login attempts');
  }
  
  const isMatch = await bcrypt.compare(candidatePassword, this.password);
  
  if (!isMatch) {
    this.loginAttempts += 1;
    
    // Lock account after 5 failed attempts for 2 hours
    if (this.loginAttempts >= 5) {
      this.lockUntil = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
    }
    
    await this.save();
    return false;
  }
  
  // Reset login attempts on successful login
  if (this.loginAttempts > 0) {
    this.loginAttempts = 0;
    this.lockUntil = undefined;
    this.lastLogin = new Date();
    await this.save();
  }
  
  return true;
};

// Method to check if user has active subscription
userSchema.methods.hasActiveSubscription = function() {
  return this.subscriptionStatus === 'active' && 
         ['premium', 'enterprise'].includes(this.subscriptionTier);
};

// Method to get user profile (without sensitive data)
userSchema.methods.getPublicProfile = function() {
  return {
    id: this._id,
    email: this.email,
    fullName: this.fullName,
    subscriptionTier: this.subscriptionTier,
    subscriptionStatus: this.subscriptionStatus,
    isEmailVerified: this.isEmailVerified,
    createdAt: this.createdAt,
    lastLogin: this.lastLogin
  };
};

export default mongoose.model('User', userSchema);
