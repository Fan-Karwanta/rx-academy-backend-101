import express from 'express';
import AdminUser from '../models/AdminUser.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { authenticateAdmin, requirePermission } from '../middleware/auth.js';
import { validateAdminCreate, validatePagination, validateUserRegistration } from '../middleware/validation.js';

const router = express.Router();

// Get all admin users
router.get('/', 
  authenticateAdmin, 
  requirePermission('admin_management'),
  validatePagination,
  async (req, res) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const skip = (page - 1) * limit;

      const admins = await AdminUser.find({ isActive: true })
        .populate('userId', 'email fullName createdAt lastLogin')
        .populate('createdBy', 'email fullName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await AdminUser.countDocuments({ isActive: true });

      res.json({
        success: true,
        data: {
          admins,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      console.error('Get admins error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch admin users'
      });
    }
  }
);

// Create new admin user
router.post('/', 
  authenticateAdmin, 
  requirePermission('admin_management'),
  validateAdminCreate,
  async (req, res) => {
    try {
      const { userId, role, permissions } = req.body;

      // Check if user exists
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check if user is already an admin
      const existingAdmin = await AdminUser.findOne({ userId });
      if (existingAdmin) {
        return res.status(400).json({
          success: false,
          message: 'User is already an admin'
        });
      }

      // Create admin user
      const adminUser = new AdminUser({
        userId,
        role: role || 'admin',
        permissions,
        createdBy: req.user._id
      });

      await adminUser.save();

      // Log admin creation
      await AuditLog.logEvent({
        userId: req.user._id,
        action: 'admin_user_created',
        resourceType: 'admin',
        resourceId: adminUser._id.toString(),
        details: { 
          targetUserId: userId,
          targetUserEmail: user.email,
          role: adminUser.role,
          permissions: adminUser.permissions,
          createdBy: req.user.email
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'high'
      });

      const populatedAdmin = await AdminUser.findById(adminUser._id)
        .populate('userId', 'email fullName');

      res.status(201).json({
        success: true,
        message: 'Admin user created successfully',
        data: { admin: populatedAdmin }
      });
    } catch (error) {
      console.error('Create admin error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create admin user'
      });
    }
  }
);

// Update admin user
router.put('/:id', 
  authenticateAdmin, 
  requirePermission('admin_management'),
  async (req, res) => {
    try {
      const { role, permissions, isActive } = req.body;
      
      const adminUser = await AdminUser.findById(req.params.id);
      if (!adminUser) {
        return res.status(404).json({
          success: false,
          message: 'Admin user not found'
        });
      }

      const oldData = {
        role: adminUser.role,
        permissions: adminUser.permissions,
        isActive: adminUser.isActive
      };

      // Update fields
      if (role) adminUser.role = role;
      if (permissions) adminUser.permissions = permissions;
      if (isActive !== undefined) adminUser.isActive = isActive;

      await adminUser.save();

      // Log admin update
      await AuditLog.logEvent({
        userId: req.user._id,
        action: 'admin_user_updated',
        resourceType: 'admin',
        resourceId: adminUser._id.toString(),
        details: { 
          oldData,
          newData: { role, permissions, isActive },
          updatedBy: req.user.email
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'high'
      });

      const populatedAdmin = await AdminUser.findById(adminUser._id)
        .populate('userId', 'email fullName');

      res.json({
        success: true,
        message: 'Admin user updated successfully',
        data: { admin: populatedAdmin }
      });
    } catch (error) {
      console.error('Update admin error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update admin user'
      });
    }
  }
);

// Deactivate admin user
router.delete('/:id', 
  authenticateAdmin, 
  requirePermission('admin_management'),
  async (req, res) => {
    try {
      const adminUser = await AdminUser.findById(req.params.id);
      if (!adminUser) {
        return res.status(404).json({
          success: false,
          message: 'Admin user not found'
        });
      }

      // Prevent self-deactivation
      if (adminUser.userId.toString() === req.user._id.toString()) {
        return res.status(400).json({
          success: false,
          message: 'Cannot deactivate your own admin account'
        });
      }

      adminUser.isActive = false;
      await adminUser.save();

      // Log admin deactivation
      await AuditLog.logEvent({
        userId: req.user._id,
        action: 'admin_user_deactivated',
        resourceType: 'admin',
        resourceId: adminUser._id.toString(),
        details: { 
          deactivatedBy: req.user.email
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'high'
      });

      res.json({
        success: true,
        message: 'Admin user deactivated successfully'
      });
    } catch (error) {
      console.error('Deactivate admin error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to deactivate admin user'
      });
    }
  }
);

// Get admin dashboard stats
router.get('/dashboard/stats', 
  authenticateAdmin, 
  async (req, res) => {
    try {
      // Get basic counts
      const totalUsers = await User.countDocuments();
      const activeSubscriptions = await User.countDocuments({ subscriptionStatus: 'active' });
      const totalAdmins = await AdminUser.countDocuments({ isActive: true });
      
      // Get recent activity (last 24 hours)
      const last24Hours = new Date();
      last24Hours.setHours(last24Hours.getHours() - 24);
      
      const recentActivity = await AuditLog.countDocuments({
        createdAt: { $gte: last24Hours }
      });

      // Get new users this week
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - 7);
      
      const newUsersThisWeek = await User.countDocuments({
        createdAt: { $gte: startOfWeek }
      });

      // Get subscription revenue (mock calculation)
      const subscriptionRevenue = await User.aggregate([
        { $match: { subscriptionStatus: 'active' } },
        {
          $group: {
            _id: '$subscriptionTier',
            count: { $sum: 1 }
          }
        }
      ]);

      let estimatedRevenue = 0;
      subscriptionRevenue.forEach(tier => {
        if (tier._id === 'premium') estimatedRevenue += tier.count * 999;
        if (tier._id === 'enterprise') estimatedRevenue += tier.count * 2999;
      });

      res.json({
        success: true,
        data: {
          totalUsers,
          activeSubscriptions,
          totalAdmins,
          recentActivity,
          newUsersThisWeek,
          estimatedRevenue,
          subscriptionBreakdown: subscriptionRevenue
        }
      });
    } catch (error) {
      console.error('Get dashboard stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch dashboard statistics'
      });
    }
  }
);

// Get audit logs
router.get('/audit-logs', 
  authenticateAdmin, 
  requirePermission('audit_logs'),
  validatePagination,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 50,
        action,
        resourceType,
        severity,
        startDate,
        endDate
      } = req.query;

      const filters = {};
      if (action) filters.action = { $regex: action, $options: 'i' };
      if (resourceType) filters.resourceType = resourceType;
      if (severity) filters.severity = severity;
      
      if (startDate || endDate) {
        filters.createdAt = {};
        if (startDate) filters.createdAt.$gte = new Date(startDate);
        if (endDate) filters.createdAt.$lte = new Date(endDate);
      }

      const result = await AuditLog.getLogs(filters, {
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Get audit logs error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch audit logs'
      });
    }
  }
);

// Create new user (admin only)
router.post('/users', 
  authenticateAdmin, 
  validateUserRegistration,
  async (req, res) => {
    try {
      const { email, password, fullName, subscriptionStatus = 'inactive', subscriptionTier = 'free' } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email'
        });
      }

      // Create new user
      const user = new User({
        email,
        password,
        fullName,
        subscriptionStatus: subscriptionStatus === 'paid' ? 'active' : 'inactive',
        subscriptionTier: subscriptionStatus === 'paid' ? 'premium' : 'free',
        isEmailVerified: true // Admin created users are auto-verified
      });

      await user.save();

      // Log user creation by admin
      await AuditLog.logEvent({
        userId: req.user._id,
        action: 'admin_user_created',
        resourceType: 'user',
        resourceId: user._id.toString(),
        details: { 
          email, 
          fullName, 
          subscriptionStatus,
          createdBy: req.user.email 
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'medium'
      });

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: {
          user: user.getPublicProfile()
        }
      });
    } catch (error) {
      console.error('Admin create user error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create user'
      });
    }
  }
);

// Update user subscription status (admin only)
router.put('/users/:id/subscription', 
  authenticateAdmin,
  async (req, res) => {
    try {
      const { subscriptionStatus, subscriptionTier } = req.body;
      
      // Validate input
      if (subscriptionStatus && !['active', 'inactive', 'cancelled', 'expired'].includes(subscriptionStatus)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid subscription status. Must be: active, inactive, cancelled, or expired'
        });
      }
      
      if (subscriptionTier && !['free', 'premium', 'enterprise'].includes(subscriptionTier)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid subscription tier. Must be: free, premium, or enterprise'
        });
      }
      
      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const oldStatus = {
        subscriptionStatus: user.subscriptionStatus,
        subscriptionTier: user.subscriptionTier
      };

      // Update subscription status
      if (subscriptionStatus !== undefined) {
        user.subscriptionStatus = subscriptionStatus;
      }
      if (subscriptionTier !== undefined) {
        user.subscriptionTier = subscriptionTier;
      }
      
      // Ensure consistency: if tier is premium/enterprise, status should be active
      if (['premium', 'enterprise'].includes(user.subscriptionTier) && user.subscriptionStatus === 'inactive') {
        user.subscriptionStatus = 'active';
      }
      
      // If status is inactive, tier should be free
      if (user.subscriptionStatus === 'inactive' && user.subscriptionTier !== 'free') {
        user.subscriptionTier = 'free';
      }

      await user.save();

      // Log subscription update
      await AuditLog.logEvent({
        userId: req.user._id,
        action: 'admin_subscription_updated',
        resourceType: 'user',
        resourceId: user._id.toString(),
        details: { 
          targetUserEmail: user.email,
          oldStatus,
          newStatus: {
            subscriptionStatus: user.subscriptionStatus,
            subscriptionTier: user.subscriptionTier
          },
          updatedBy: req.user.email
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'medium'
      });

      res.json({
        success: true,
        message: 'User subscription updated successfully',
        data: {
          user: user.getPublicProfile()
        }
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

// Get pending registrations (payment verification)
router.get('/pending-registrations', 
  authenticateAdmin,
  validatePagination,
  async (req, res) => {
    try {
      const { page = 1, limit = 20, status = 'payment_submitted' } = req.query;
      const skip = (page - 1) * limit;

      const filters = status === 'all' ? {} : { registrationStatus: status };
      
      const users = await User.find(filters)
        .select('email fullName mobileNumber paymentProofUrl paymentStatus registrationStatus createdAt adminNotes')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await User.countDocuments(filters);

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
      console.error('Get pending registrations error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch pending registrations'
      });
    }
  }
);

// Approve/reject user registration
router.put('/users/:id/registration-status', 
  authenticateAdmin,
  async (req, res) => {
    try {
      const { action, adminNotes } = req.body; // action: 'approve' or 'reject'
      
      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid action. Must be "approve" or "reject"'
        });
      }

      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const oldStatus = {
        registrationStatus: user.registrationStatus,
        paymentStatus: user.paymentStatus,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionTier: user.subscriptionTier
      };

      if (action === 'approve') {
        user.registrationStatus = 'approved';
        user.paymentStatus = 'verified';
        user.paymentVerificationDate = new Date();
        user.subscriptionStatus = 'active';
        user.subscriptionTier = 'premium';
        user.isEmailVerified = true;
      } else {
        user.registrationStatus = 'rejected';
        user.paymentStatus = 'rejected';
      }

      if (adminNotes) {
        user.adminNotes = adminNotes;
      }

      await user.save();

      // Log registration status change
      await AuditLog.logEvent({
        userId: req.user._id,
        action: `registration_${action}d`,
        resourceType: 'user',
        resourceId: user._id.toString(),
        details: { 
          targetUserEmail: user.email,
          targetUserName: user.fullName,
          oldStatus,
          newStatus: {
            registrationStatus: user.registrationStatus,
            paymentStatus: user.paymentStatus,
            subscriptionStatus: user.subscriptionStatus,
            subscriptionTier: user.subscriptionTier
          },
          adminNotes,
          processedBy: req.user.email
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'high'
      });

      res.json({
        success: true,
        message: `Registration ${action}d successfully`,
        data: {
          user: user.getPublicProfile()
        }
      });
    } catch (error) {
      console.error('Update registration status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update registration status'
      });
    }
  }
);

export default router;
