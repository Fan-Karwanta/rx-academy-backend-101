import express from 'express';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import ContentAccess from '../models/ContentAccess.js';
import AuditLog from '../models/AuditLog.js';
import { authenticateAdmin, requirePermission } from '../middleware/auth.js';
import { validatePagination, validateDateRange } from '../middleware/validation.js';

const router = express.Router();

// Get all users (admin only)
router.get('/', 
  authenticateAdmin, 
  requirePermission('user_management'),
  validatePagination,
  validateDateRange,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        subscriptionTier,
        subscriptionStatus,
        startDate,
        endDate
      } = req.query;

      const skip = (page - 1) * limit;
      const query = {};

      // Build search query
      if (search) {
        query.$or = [
          { email: { $regex: search, $options: 'i' } },
          { fullName: { $regex: search, $options: 'i' } }
        ];
      }

      if (subscriptionTier) {
        query.subscriptionTier = subscriptionTier;
      }

      if (subscriptionStatus) {
        query.subscriptionStatus = subscriptionStatus;
      }

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const users = await User.find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await User.countDocuments(query);

      // Log admin action
      await AuditLog.logEvent({
        userId: req.user._id,
        action: 'users_list_viewed',
        resourceType: 'user',
        details: { query, total },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'low'
      });

      res.json({
        success: true,
        data: {
          users,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      console.error('Get users error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch users'
      });
    }
  }
);

// Get user by ID (admin only)
router.get('/:id', 
  authenticateAdmin, 
  requirePermission('user_management'),
  async (req, res) => {
    try {
      const user = await User.findById(req.params.id).select('-password');
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Get user's subscriptions
      const subscriptions = await Subscription.find({ userId: user._id });

      // Get user's content access
      const contentAccess = await ContentAccess.find({ userId: user._id });

      res.json({
        success: true,
        data: {
          user,
          subscriptions,
          contentAccess
        }
      });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch user'
      });
    }
  }
);

// Update user (admin only)
router.put('/:id', 
  authenticateAdmin, 
  requirePermission('user_management'),
  async (req, res) => {
    try {
      const { subscriptionTier, subscriptionStatus, fullName } = req.body;
      
      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const oldData = {
        subscriptionTier: user.subscriptionTier,
        subscriptionStatus: user.subscriptionStatus,
        fullName: user.fullName
      };

      // Update user fields
      if (subscriptionTier) user.subscriptionTier = subscriptionTier;
      if (subscriptionStatus) user.subscriptionStatus = subscriptionStatus;
      if (fullName) user.fullName = fullName;

      await user.save();

      // Log admin action
      await AuditLog.logEvent({
        userId: req.user._id,
        action: 'user_updated',
        resourceType: 'user',
        resourceId: user._id.toString(),
        details: { 
          oldData, 
          newData: { subscriptionTier, subscriptionStatus, fullName },
          updatedBy: req.user.email
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'medium'
      });

      res.json({
        success: true,
        message: 'User updated successfully',
        data: {
          user: user.getPublicProfile()
        }
      });
    } catch (error) {
      console.error('Update user error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update user'
      });
    }
  }
);

// Delete user (admin only)
router.delete('/:id', 
  authenticateAdmin, 
  requirePermission('user_management'),
  async (req, res) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Delete related data
      await Subscription.deleteMany({ userId: user._id });
      await ContentAccess.deleteMany({ userId: user._id });
      
      // Delete user
      await User.findByIdAndDelete(req.params.id);

      // Log admin action
      await AuditLog.logEvent({
        userId: req.user._id,
        action: 'user_deleted',
        resourceType: 'user',
        resourceId: user._id.toString(),
        details: { 
          deletedUser: user.getPublicProfile(),
          deletedBy: req.user.email
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'high'
      });

      res.json({
        success: true,
        message: 'User deleted successfully'
      });
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete user'
      });
    }
  }
);

// Get user statistics (admin only)
router.get('/stats/overview', 
  authenticateAdmin, 
  requirePermission('analytics_view'),
  async (req, res) => {
    try {
      const totalUsers = await User.countDocuments();
      const activeSubscriptions = await User.countDocuments({ subscriptionStatus: 'active' });
      const premiumUsers = await User.countDocuments({ subscriptionTier: 'premium' });
      const enterpriseUsers = await User.countDocuments({ subscriptionTier: 'enterprise' });
      
      // Get new users this month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      
      const newUsersThisMonth = await User.countDocuments({
        createdAt: { $gte: startOfMonth }
      });

      // Get subscription distribution
      const subscriptionStats = await User.aggregate([
        {
          $group: {
            _id: '$subscriptionTier',
            count: { $sum: 1 }
          }
        }
      ]);

      res.json({
        success: true,
        data: {
          totalUsers,
          activeSubscriptions,
          premiumUsers,
          enterpriseUsers,
          newUsersThisMonth,
          subscriptionStats
        }
      });
    } catch (error) {
      console.error('Get user stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch user statistics'
      });
    }
  }
);

export default router;
