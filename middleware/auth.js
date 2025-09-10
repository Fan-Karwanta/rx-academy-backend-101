import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import AdminUser from '../models/AdminUser.js';
import AuditLog from '../models/AuditLog.js';

// Generate JWT token
export const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

// Generate refresh token
export const generateRefreshToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: '30d'
  });
};

// Verify JWT token
export const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

// Authentication middleware
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access token required' 
      });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token - user not found' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired' 
      });
    }
    
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid token' 
    });
  }
};

// Admin authentication middleware
export const authenticateAdmin = async (req, res, next) => {
  try {
    // First check if user is authenticated
    await authenticate(req, res, async () => {
      // Check if user is admin
      const isAdmin = await AdminUser.isAdmin(req.user._id);
      
      if (!isAdmin) {
        await AuditLog.logEvent({
          userId: req.user._id,
          action: 'unauthorized_admin_access_attempt',
          resourceType: 'admin',
          details: { 
            endpoint: req.originalUrl,
            method: req.method 
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          severity: 'high',
          status: 'failure'
        });
        
        return res.status(403).json({ 
          success: false, 
          message: 'Admin access required' 
        });
      }

      // Get admin details with permissions
      const adminUser = await AdminUser.getAdminWithPermissions(req.user._id);
      req.admin = adminUser;
      
      next();
    });
  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      message: 'Authentication error' 
    });
  }
};

// Permission check middleware
export const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.admin || !req.admin.hasPermission(permission)) {
      return res.status(403).json({ 
        success: false, 
        message: `Permission required: ${permission}` 
      });
    }
    next();
  };
};

// Optional authentication (for public endpoints that can benefit from user context)
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.userId).select('-password');
      
      if (user) {
        req.user = user;
      }
    }
  } catch (error) {
    // Silently fail for optional auth
  }
  
  next();
};
