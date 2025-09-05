const { body, validationResult } = require('express-validator');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors:', { errors: errors.array(), ip: req.ip });
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// User registration validation
const validateUserRegistration = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('displayName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Display name must be between 2 and 50 characters'),
  handleValidationErrors
];

// Organization creation validation
const validateOrganization = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Organization name must be between 2 and 100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description must not exceed 500 characters'),
  body('settings')
    .optional()
    .isObject()
    .withMessage('Settings must be a valid object'),
  handleValidationErrors
];

// Menu item validation
const validateMenuItem = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Item name is required and must not exceed 100 characters'),
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description must not exceed 500 characters'),
  body('category_id')
    .isUUID()
    .withMessage('Valid category ID is required'),
  handleValidationErrors
];

// Order validation
const validateOrder = [
  body('table_id')
    .optional()
    .isUUID()
    .withMessage('Table ID must be a valid UUID'),
  body('items')
    .isArray({ min: 1 })
    .withMessage('Order must contain at least one item'),
  body('items.*.menu_item_id')
    .isUUID()
    .withMessage('Menu item ID must be a valid UUID'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer'),
  body('items.*.price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  handleValidationErrors
];

// Table validation
const validateTable = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Table name is required and must not exceed 50 characters'),
  body('seats')
    .isInt({ min: 1, max: 20 })
    .withMessage('Seats must be between 1 and 20'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Description must not exceed 200 characters'),
  handleValidationErrors
];

module.exports = {
  validateUserRegistration,
  validateOrganization,
  validateMenuItem,
  validateOrder,
  validateTable,
  handleValidationErrors
};
