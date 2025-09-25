import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  planId: {
    type: String,
    required: true,
    enum: ['premium_monthly', 'premium_yearly', 'enterprise_monthly', 'enterprise_yearly']
  },
  status: {
    type: String,
    required: true,
    enum: ['active', 'cancelled', 'expired', 'past_due'],
    default: 'active'
  },
  stripeSubscriptionId: {
    type: String,
    unique: true,
    sparse: true
  },
  stripeCustomerId: {
    type: String,
    sparse: true
  },
  currentPeriodStart: {
    type: Date,
    required: true
  },
  currentPeriodEnd: {
    type: Date,
    required: true
  },
  cancelAtPeriodEnd: {
    type: Boolean,
    default: false
  },
  cancelledAt: Date,
  trialStart: Date,
  trialEnd: Date,
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'usd'
  },
  interval: {
    type: String,
    enum: ['month', 'year'],
    required: true
  },
  metadata: {
    type: Map,
    of: String
  }
}, {
  timestamps: true
});

// Indexes for better performance (stripeSubscriptionId index is automatically created by unique: true)
subscriptionSchema.index({ userId: 1 });
subscriptionSchema.index({ status: 1 });
subscriptionSchema.index({ currentPeriodEnd: 1 });

// Virtual to check if subscription is active
subscriptionSchema.virtual('isActive').get(function() {
  return this.status === 'active' && this.currentPeriodEnd > new Date();
});

// Virtual to get subscription tier
subscriptionSchema.virtual('tier').get(function() {
  if (this.planId.includes('premium')) return 'premium';
  if (this.planId.includes('enterprise')) return 'enterprise';
  return 'free';
});

// Method to check if subscription is in trial
subscriptionSchema.methods.isInTrial = function() {
  const now = new Date();
  return this.trialStart && this.trialEnd && 
         now >= this.trialStart && now <= this.trialEnd;
};

// Method to get days until expiry
subscriptionSchema.methods.getDaysUntilExpiry = function() {
  const now = new Date();
  const diffTime = this.currentPeriodEnd - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Pre-save middleware to update user subscription status
subscriptionSchema.pre('save', async function(next) {
  if (this.isModified('status') || this.isNew) {
    try {
      const User = mongoose.model('User');
      const user = await User.findById(this.userId);
      
      if (user) {
        if (this.status === 'active') {
          user.subscriptionTier = this.tier;
          user.subscriptionStatus = 'active';
        } else if (['cancelled', 'expired'].includes(this.status)) {
          // Check if user has any other active subscriptions
          const activeSubscriptions = await mongoose.model('Subscription').find({
            userId: this.userId,
            status: 'active',
            _id: { $ne: this._id }
          });
          
          if (activeSubscriptions.length === 0) {
            user.subscriptionTier = 'free';
            user.subscriptionStatus = 'inactive';
          }
        }
        
        await user.save();
      }
    } catch (error) {
      console.error('Error updating user subscription status:', error);
    }
  }
  next();
});

export default mongoose.model('Subscription', subscriptionSchema);
