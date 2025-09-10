import express from 'express';
import Subscription from '../models/Subscription.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { authenticate, authenticateAdmin, requirePermission } from '../middleware/auth.js';
import { validateSubscriptionCreate, validatePagination } from '../middleware/validation.js';

const router = express.Router();

// Get user's subscriptions
router.get('/my-subscriptions', authenticate, async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ userId: req.user._id })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { subscriptions }
    });
  } catch (error) {
    console.error('Get subscriptions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscriptions'
    });
  }
});

// Create new subscription
router.post('/', authenticate, validateSubscriptionCreate, async (req, res) => {
  try {
    const { planId, paymentMethodId } = req.body;

    // Check if user already has active subscription
    const existingSubscription = await Subscription.findOne({
      userId: req.user._id,
      status: 'active'
    });

    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        message: 'User already has an active subscription'
      });
    }

    // Calculate subscription details based on plan
    const planDetails = {
      premium_monthly: { amount: 999, interval: 'month', tier: 'premium' },
      premium_yearly: { amount: 9999, interval: 'year', tier: 'premium' },
      enterprise_monthly: { amount: 2999, interval: 'month', tier: 'enterprise' },
      enterprise_yearly: { amount: 29999, interval: 'year', tier: 'enterprise' }
    };

    const plan = planDetails[planId];
    if (!plan) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan ID'
      });
    }

    // Calculate period dates
    const currentPeriodStart = new Date();
    const currentPeriodEnd = new Date();
    
    if (plan.interval === 'month') {
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    } else {
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
    }

    // Create subscription
    const subscription = new Subscription({
      userId: req.user._id,
      planId,
      status: 'active',
      currentPeriodStart,
      currentPeriodEnd,
      amount: plan.amount,
      interval: plan.interval,
      metadata: {
        paymentMethodId,
        createdVia: 'api'
      }
    });

    await subscription.save();

    // Log subscription creation
    await AuditLog.logEvent({
      userId: req.user._id,
      action: 'subscription_created',
      resourceType: 'subscription',
      resourceId: subscription._id.toString(),
      details: { planId, amount: plan.amount },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      severity: 'medium'
    });

    res.status(201).json({
      success: true,
      message: 'Subscription created successfully',
      data: { subscription }
    });
  } catch (error) {
    console.error('Create subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create subscription'
    });
  }
});

// Cancel subscription
router.put('/:id/cancel', authenticate, async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    if (subscription.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Subscription is not active'
      });
    }

    subscription.status = 'cancelled';
    subscription.cancelledAt = new Date();
    subscription.cancelAtPeriodEnd = true;
    await subscription.save();

    // Log subscription cancellation
    await AuditLog.logEvent({
      userId: req.user._id,
      action: 'subscription_cancelled',
      resourceType: 'subscription',
      resourceId: subscription._id.toString(),
      details: { planId: subscription.planId },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      severity: 'medium'
    });

    res.json({
      success: true,
      message: 'Subscription cancelled successfully',
      data: { subscription }
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel subscription'
    });
  }
});

// Admin: Get all subscriptions
router.get('/admin/all', 
  authenticateAdmin, 
  requirePermission('subscription_management'),
  validatePagination,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        planId,
        userId
      } = req.query;

      const skip = (page - 1) * limit;
      const query = {};

      if (status) query.status = status;
      if (planId) query.planId = planId;
      if (userId) query.userId = userId;

      const subscriptions = await Subscription.find(query)
        .populate('userId', 'email fullName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Subscription.countDocuments(query);

      res.json({
        success: true,
        data: {
          subscriptions,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      console.error('Get all subscriptions error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subscriptions'
      });
    }
  }
);

// Admin: Update subscription
router.put('/admin/:id', 
  authenticateAdmin, 
  requirePermission('subscription_management'),
  async (req, res) => {
    try {
      const { status, currentPeriodEnd } = req.body;
      
      const subscription = await Subscription.findById(req.params.id);
      if (!subscription) {
        return res.status(404).json({
          success: false,
          message: 'Subscription not found'
        });
      }

      const oldData = {
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd
      };

      if (status) subscription.status = status;
      if (currentPeriodEnd) subscription.currentPeriodEnd = new Date(currentPeriodEnd);

      await subscription.save();

      // Log admin action
      await AuditLog.logEvent({
        userId: req.user._id,
        action: 'subscription_updated_by_admin',
        resourceType: 'subscription',
        resourceId: subscription._id.toString(),
        details: { 
          oldData, 
          newData: { status, currentPeriodEnd },
          updatedBy: req.user.email
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'medium'
      });

      res.json({
        success: true,
        message: 'Subscription updated successfully',
        data: { subscription }
      });
    } catch (error) {
      console.error('Update subscription error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update subscription'
      });
    }
  }
);

// Get subscription statistics
router.get('/admin/stats', 
  authenticateAdmin, 
  requirePermission('analytics_view'),
  async (req, res) => {
    try {
      const totalSubscriptions = await Subscription.countDocuments();
      const activeSubscriptions = await Subscription.countDocuments({ status: 'active' });
      const cancelledSubscriptions = await Subscription.countDocuments({ status: 'cancelled' });
      
      // Revenue calculation (in cents)
      const revenueData = await Subscription.aggregate([
        { $match: { status: 'active' } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$amount' },
            avgRevenue: { $avg: '$amount' }
          }
        }
      ]);

      // Plan distribution
      const planStats = await Subscription.aggregate([
        {
          $group: {
            _id: '$planId',
            count: { $sum: 1 },
            revenue: { $sum: '$amount' }
          }
        }
      ]);

      // Monthly growth
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      
      const newSubscriptionsThisMonth = await Subscription.countDocuments({
        createdAt: { $gte: startOfMonth }
      });

      res.json({
        success: true,
        data: {
          totalSubscriptions,
          activeSubscriptions,
          cancelledSubscriptions,
          newSubscriptionsThisMonth,
          revenue: revenueData[0] || { totalRevenue: 0, avgRevenue: 0 },
          planStats
        }
      });
    } catch (error) {
      console.error('Get subscription stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subscription statistics'
      });
    }
  }
);

export default router;
