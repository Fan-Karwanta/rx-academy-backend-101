import { body, param, query, validationResult } from 'express-validator';

// Handle validation errors
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// User validation rules
export const validateUserRegistration = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('fullName')
    .trim()
    .isLength({ min: 2 })
    .withMessage('Full name must be at least 2 characters long'),
  handleValidationErrors
];

export const validateUserLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors
];

export const validatePasswordReset = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  handleValidationErrors
];

export const validatePasswordUpdate = [
  body('token')
    .notEmpty()
    .withMessage('Reset token is required'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  handleValidationErrors
];

// Subscription validation rules
export const validateSubscriptionCreate = [
  body('planId')
    .isIn(['premium_monthly', 'premium_yearly', 'enterprise_monthly', 'enterprise_yearly'])
    .withMessage('Invalid plan ID'),
  body('paymentMethodId')
    .notEmpty()
    .withMessage('Payment method is required'),
  handleValidationErrors
];

// Content access validation rules
export const validateContentAccess = [
  param('contentType')
    .isIn(['magazine', 'article', 'video', 'document'])
    .withMessage('Invalid content type'),
  param('contentId')
    .notEmpty()
    .withMessage('Content ID is required'),
  handleValidationErrors
];

// Admin validation rules
export const validateAdminCreate = [
  body('userId')
    .isMongoId()
    .withMessage('Invalid user ID'),
  body('role')
    .isIn(['admin', 'super_admin'])
    .withMessage('Invalid role'),
  body('permissions')
    .optional()
    .isArray()
    .withMessage('Permissions must be an array'),
  handleValidationErrors
];

// Query validation rules
export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

export const validateDateRange = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  handleValidationErrors
];
