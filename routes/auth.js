import express from 'express';
import User from '../models/User.js';
import AdminUser from '../models/AdminUser.js';
import AuditLog from '../models/AuditLog.js';
import { generateToken, generateRefreshToken, authenticate } from '../middleware/auth.js';
import { validateUserRegistration, validateUserLogin } from '../middleware/validation.js';
import upload from '../middleware/upload.js';

const router = express.Router();

// Register new user
router.post('/register', validateUserRegistration, async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

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
      fullName
    });

    await user.save();

    // Generate tokens
    const token = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Log registration event
    await AuditLog.logEvent({
      userId: user._id,
      action: 'user_registered',
      resourceType: 'user',
      resourceId: user._id.toString(),
      details: { email, fullName },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      severity: 'low'
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: user.getPublicProfile(),
        token,
        refreshToken
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed'
    });
  }
});

// Register new user with payment proof
router.post('/register-with-payment', upload.single('paymentProof'), async (req, res) => {
  try {
    const { email, password, fullName, mobileNumber } = req.body;

    // Validate required fields
    if (!email || !password || !fullName || !mobileNumber) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, full name, and mobile number are required'
      });
    }

    // Check if payment proof was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Payment proof image is required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Create new user with payment proof
    const user = new User({
      email,
      password,
      fullName,
      mobileNumber,
      paymentProofUrl: req.file.path,
      registrationStatus: 'payment_submitted',
      paymentStatus: 'pending'
    });

    await user.save();

    // Log registration event
    await AuditLog.logEvent({
      userId: user._id,
      action: 'user_registered_with_payment',
      resourceType: 'user',
      resourceId: user._id.toString(),
      details: { 
        email, 
        fullName, 
        mobileNumber,
        paymentProofUrl: req.file.path,
        registrationStatus: 'payment_submitted'
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      severity: 'low'
    });

    res.status(201).json({
      success: true,
      message: 'Registration submitted successfully. Please wait for admin confirmation.',
      data: {
        user: {
          id: user._id,
          email: user.email,
          fullName: user.fullName,
          mobileNumber: user.mobileNumber,
          registrationStatus: user.registrationStatus,
          paymentStatus: user.paymentStatus,
          createdAt: user.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Registration with payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed'
    });
  }
});

// Login user
router.post('/login', validateUserLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user registration is approved
    if (user.registrationStatus !== 'approved') {
      let message = 'Account not yet approved';
      if (user.registrationStatus === 'pending_payment') {
        message = 'Please complete your registration with payment proof';
      } else if (user.registrationStatus === 'payment_submitted') {
        message = 'Your registration is pending admin approval';
      } else if (user.registrationStatus === 'rejected') {
        message = 'Your registration has been rejected. Please contact support.';
      }
      
      return res.status(403).json({
        success: false,
        message: message,
        registrationStatus: user.registrationStatus
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      await AuditLog.logEvent({
        userId: user._id,
        action: 'login_failed',
        resourceType: 'user',
        details: { email, reason: 'invalid_password' },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'medium',
        status: 'failure'
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate tokens
    const token = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Log successful login
    await AuditLog.logEvent({
      userId: user._id,
      action: 'user_login',
      resourceType: 'user',
      details: { email },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      severity: 'low'
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.getPublicProfile(),
        token,
        refreshToken
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});

// Admin login (special endpoint for admin panel)
router.post('/admin/login', validateUserLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check for hardcoded admin credentials
    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
      // Create or find admin user
      let user = await User.findOne({ email });
      if (!user) {
        user = new User({
          email,
          password,
          fullName: 'RX Admin',
          subscriptionTier: 'enterprise',
          subscriptionStatus: 'active'
        });
        await user.save();

        // Create admin record
        const adminUser = new AdminUser({
          userId: user._id,
          role: 'super_admin'
        });
        await adminUser.save();
      }

      // Generate tokens
      const token = generateToken(user._id);
      const refreshToken = generateRefreshToken(user._id);

      // Log admin login
      await AuditLog.logEvent({
        userId: user._id,
        action: 'admin_login',
        resourceType: 'admin',
        details: { email, method: 'hardcoded_credentials' },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'medium'
      });

      return res.json({
        success: true,
        message: 'Admin login successful',
        data: {
          user: user.getPublicProfile(),
          token,
          refreshToken,
          isAdmin: true
        }
      });
    }

    // Regular admin login flow
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials'
      });
    }

    // Check if user is admin
    const isAdmin = await AdminUser.isAdmin(user._id);
    if (!isAdmin) {
      await AuditLog.logEvent({
        userId: user._id,
        action: 'unauthorized_admin_login_attempt',
        resourceType: 'admin',
        details: { email },
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

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Update admin last login
    await AdminUser.findOneAndUpdate(
      { userId: user._id },
      { lastAdminLogin: new Date() }
    );

    // Generate tokens
    const token = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Log successful admin login
    await AuditLog.logEvent({
      userId: user._id,
      action: 'admin_login',
      resourceType: 'admin',
      details: { email },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      severity: 'medium'
    });

    res.json({
      success: true,
      message: 'Admin login successful',
      data: {
        user: user.getPublicProfile(),
        token,
        refreshToken,
        isAdmin: true
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Admin login failed'
    });
  }
});

// Get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: req.user.getPublicProfile()
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user information'
    });
  }
});

// Logout user
router.post('/logout', authenticate, async (req, res) => {
  try {
    // Log logout event
    await AuditLog.logEvent({
      userId: req.user._id,
      action: 'user_logout',
      resourceType: 'user',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      severity: 'low'
    });

    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
});

// Change password
router.put('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    // Get user from database
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      // Log failed password change attempt
      await AuditLog.logEvent({
        userId: user._id,
        action: 'password_change_failed',
        resourceType: 'user',
        details: { reason: 'invalid_current_password' },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        severity: 'medium',
        status: 'failure'
      });

      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password (will be hashed by pre-save middleware)
    user.password = newPassword;
    await user.save();

    // Log successful password change
    await AuditLog.logEvent({
      userId: user._id,
      action: 'password_changed',
      resourceType: 'user',
      details: { method: 'user_initiated' },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      severity: 'medium'
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
});

export default router;
