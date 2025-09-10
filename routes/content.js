import express from 'express';
import ContentAccess from '../models/ContentAccess.js';
import AuditLog from '../models/AuditLog.js';
import { authenticate, authenticateAdmin, requirePermission, optionalAuth } from '../middleware/auth.js';
import { validateContentAccess, validatePagination } from '../middleware/validation.js';

const router = express.Router();

// Check content access
router.get('/access/:contentType/:contentId', 
  optionalAuth,
  validateContentAccess,
  async (req, res) => {
    try {
      const { contentType, contentId } = req.params;
      
      if (!req.user) {
        return res.json({
          success: true,
          data: { hasAccess: false, reason: 'not_authenticated' }
        });
      }

      const hasAccess = await ContentAccess.checkAccess(
        req.user._id, 
        contentType, 
        contentId
      );

      // Log content access check
      await AuditLog.logEvent({
        userId: req.user._id,
        action: 'content_access_checked',
        resourceType: 'content',
        resourceId: contentId,
        details: { 
          contentType, 
          contentId, 
          hasAccess,
          subscriptionTier: req.user.subscriptionTier,
          subscriptionStatus: req.user.subscriptionStatus
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'low'
      });

      res.json({
        success: true,
        data: { 
          hasAccess,
          userTier: req.user.subscriptionTier,
          userStatus: req.user.subscriptionStatus
        }
      });
    } catch (error) {
      console.error('Check content access error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check content access'
      });
    }
  }
);

// Get user's content access list
router.get('/my-access', authenticate, async (req, res) => {
  try {
    const { contentType } = req.query;
    const query = { userId: req.user._id };
    
    if (contentType) {
      query.contentType = contentType;
    }

    const contentAccess = await ContentAccess.find(query)
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { contentAccess }
    });
  } catch (error) {
    console.error('Get content access error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch content access'
    });
  }
});

// Admin: Grant content access
router.post('/admin/grant-access', 
  authenticateAdmin, 
  requirePermission('content_management'),
  async (req, res) => {
    try {
      const { userId, contentType, contentId, expiresAt, accessReason } = req.body;

      const access = await ContentAccess.grantAccess(userId, contentType, contentId, {
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        grantedBy: req.user._id,
        accessReason: accessReason || 'manual_grant'
      });

      // Log admin action
      await AuditLog.logEvent({
        userId: req.user._id,
        action: 'content_access_granted',
        resourceType: 'content',
        resourceId: contentId,
        details: { 
          targetUserId: userId,
          contentType,
          contentId,
          expiresAt,
          grantedBy: req.user.email
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'medium'
      });

      res.json({
        success: true,
        message: 'Content access granted successfully',
        data: { access }
      });
    } catch (error) {
      console.error('Grant content access error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to grant content access'
      });
    }
  }
);

// Admin: Revoke content access
router.post('/admin/revoke-access', 
  authenticateAdmin, 
  requirePermission('content_management'),
  async (req, res) => {
    try {
      const { userId, contentType, contentId } = req.body;

      const access = await ContentAccess.revokeAccess(userId, contentType, contentId);

      // Log admin action
      await AuditLog.logEvent({
        userId: req.user._id,
        action: 'content_access_revoked',
        resourceType: 'content',
        resourceId: contentId,
        details: { 
          targetUserId: userId,
          contentType,
          contentId,
          revokedBy: req.user.email
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'medium'
      });

      res.json({
        success: true,
        message: 'Content access revoked successfully',
        data: { access }
      });
    } catch (error) {
      console.error('Revoke content access error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to revoke content access'
      });
    }
  }
);

// Admin: Get all content access records
router.get('/admin/all-access', 
  authenticateAdmin, 
  requirePermission('content_management'),
  validatePagination,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        userId,
        contentType,
        contentId,
        accessGranted
      } = req.query;

      const skip = (page - 1) * limit;
      const query = {};

      if (userId) query.userId = userId;
      if (contentType) query.contentType = contentType;
      if (contentId) query.contentId = contentId;
      if (accessGranted !== undefined) query.accessGranted = accessGranted === 'true';

      const contentAccess = await ContentAccess.find(query)
        .populate('userId', 'email fullName')
        .populate('grantedBy', 'email fullName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await ContentAccess.countDocuments(query);

      res.json({
        success: true,
        data: {
          contentAccess,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      console.error('Get all content access error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch content access records'
      });
    }
  }
);

// Get content statistics
router.get('/admin/stats', 
  authenticateAdmin, 
  requirePermission('analytics_view'),
  async (req, res) => {
    try {
      const totalAccess = await ContentAccess.countDocuments();
      const activeAccess = await ContentAccess.countDocuments({ accessGranted: true });
      
      // Content type distribution
      const contentTypeStats = await ContentAccess.aggregate([
        {
          $group: {
            _id: '$contentType',
            total: { $sum: 1 },
            active: {
              $sum: {
                $cond: [{ $eq: ['$accessGranted', true] }, 1, 0]
              }
            }
          }
        }
      ]);

      // Access reason distribution
      const accessReasonStats = await ContentAccess.aggregate([
        { $match: { accessGranted: true } },
        {
          $group: {
            _id: '$accessReason',
            count: { $sum: 1 }
          }
        }
      ]);

      res.json({
        success: true,
        data: {
          totalAccess,
          activeAccess,
          contentTypeStats,
          accessReasonStats
        }
      });
    } catch (error) {
      console.error('Get content stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch content statistics'
      });
    }
  }
);

export default router;
