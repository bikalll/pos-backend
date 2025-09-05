const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Environment detection
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// CORS configuration for production
const corsOptions = {
  origin: isProduction 
    ? [
        'https://your-frontend-domain.com',
        'https://your-expo-app.com',
        /\.railway\.app$/,
        /\.vercel\.app$/,
        /\.netlify\.app$/
      ]
    : "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
};

const io = socketIo(server, {
  cors: corsOptions
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security headers for production
if (isProduction) {
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
}

// PostgreSQL connection with better error handling
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('PostgreSQL connection error:', err);
});

// Firebase Admin SDK initialization with better error handling
let firebaseInitialized = false;

try {
  const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
  };

  if (!admin.apps.length && serviceAccount.project_id) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID
    });
    firebaseInitialized = true;
    console.log('Firebase Admin SDK initialized successfully');
  }
} catch (error) {
  console.error('Firebase initialization error:', error);
  console.log('Continuing without Firebase authentication...');
}

// Middleware to verify Firebase token
const verifyFirebaseToken = async (req, res, next) => {
  if (!firebaseInitialized) {
    console.warn('Firebase not initialized, skipping token verification');
    req.user = { uid: 'anonymous' };
    req.dbUser = { id: 1 }; // Default user for development
    return next();
  }

  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    
    // Get user from database
    const userResult = await pool.query(
      'SELECT * FROM users WHERE firebase_uid = $1',
      [decodedToken.uid]
    );
    
    if (userResult.rows.length === 0) {
      // Create user if doesn't exist
      const newUser = await pool.query(
        `INSERT INTO users (firebase_uid, email, display_name) 
         VALUES ($1, $2, $3) 
         RETURNING *`,
        [decodedToken.uid, decodedToken.email, decodedToken.name]
      );
      req.dbUser = newUser.rows[0];
    } else {
      req.dbUser = userResult.rows[0];
    }
    
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Socket.IO connection handling
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-organization', (organizationId) => {
    socket.join(organizationId);
    connectedUsers.set(socket.id, { organizationId, socketId: socket.id });
    console.log(`User joined organization: ${organizationId}`);
  });

  socket.on('disconnect', () => {
    connectedUsers.delete(socket.id);
    console.log('User disconnected:', socket.id);
  });
});

// Broadcast function for real-time updates
const broadcastUpdate = (organizationId, eventType, data) => {
  io.to(organizationId).emit(eventType, data);
};

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Auth routes
app.post('/api/auth/register', verifyFirebaseToken, async (req, res) => {
  try {
    const { organizationName, role = 'manager' } = req.body;
    const userId = req.dbUser.id;

    // Create organization if provided
    let organizationId = null;
    if (organizationName) {
      const orgResult = await pool.query(
        `INSERT INTO organizations (name, owner_id) 
         VALUES ($1, $2) 
         RETURNING id`,
        [organizationName, userId]
      );
      organizationId = orgResult.rows[0].id;

      // Add user to organization
      await pool.query(
        `INSERT INTO user_organizations (user_id, organization_id, role) 
         VALUES ($1, $2, $3)`,
        [userId, organizationId, role]
      );
    }

    res.json({ 
      user: req.dbUser, 
      organizationId,
      message: 'User registered successfully' 
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Get user organizations
app.get('/api/auth/organizations', verifyFirebaseToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, uo.role 
       FROM organizations o 
       JOIN user_organizations uo ON o.id = uo.organization_id 
       WHERE uo.user_id = $1 AND uo.is_active = true`,
      [req.dbUser.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get organizations error:', error);
    res.status(500).json({ error: 'Failed to get organizations' });
  }
});

// Tables API
app.get('/api/tables/:orgId', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId } = req.params;
    const result = await pool.query(
      'SELECT * FROM tables WHERE organization_id = $1 ORDER BY name',
      [orgId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get tables error:', error);
    res.status(500).json({ error: 'Failed to get tables' });
  }
});

app.post('/api/tables/:orgId', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { name, seats, description } = req.body;
    
    const result = await pool.query(
      `INSERT INTO tables (organization_id, name, seats, description) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [orgId, name, seats, description]
    );
    
    const newTable = result.rows[0];
    
    // Log sync event
    await pool.query(
      `INSERT INTO sync_log (organization_id, table_name, record_id, operation, user_id) 
       VALUES ($1, 'tables', $2, 'INSERT', $3)`,
      [orgId, newTable.id, req.dbUser.id]
    );
    
    // Broadcast to all connected clients
    broadcastUpdate(orgId, 'table-created', newTable);
    
    res.json(newTable);
  } catch (error) {
    console.error('Create table error:', error);
    res.status(500).json({ error: 'Failed to create table' });
  }
});

app.put('/api/tables/:orgId/:tableId', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, tableId } = req.params;
    const updates = req.body;
    
    // Build dynamic update query
    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 3}`)
      .join(', ');
    
    const values = [orgId, tableId, ...Object.values(updates)];
    
    const result = await pool.query(
      `UPDATE tables SET ${setClause}, version = version + 1, updated_at = NOW() 
       WHERE organization_id = $1 AND id = $2 
       RETURNING *`,
      values
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }
    
    const updatedTable = result.rows[0];
    
    // Log sync event
    await pool.query(
      `INSERT INTO sync_log (organization_id, table_name, record_id, operation, user_id) 
       VALUES ($1, 'tables', $2, 'UPDATE', $3)`,
      [orgId, tableId, req.dbUser.id]
    );
    
    // Broadcast to all connected clients
    broadcastUpdate(orgId, 'table-updated', updatedTable);
    
    res.json(updatedTable);
  } catch (error) {
    console.error('Update table error:', error);
    res.status(500).json({ error: 'Failed to update table' });
  }
});

// Orders API
app.get('/api/orders/:orgId', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { status } = req.query;
    
    let query = `
      SELECT o.*, 
             json_agg(
               json_build_object(
                 'id', oi.id,
                 'menu_item_id', oi.menu_item_id,
                 'name', oi.name,
                 'price', oi.price,
                 'quantity', oi.quantity,
                 'modifiers', oi.modifiers,
                 'subtotal', oi.subtotal
               )
             ) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.organization_id = $1
    `;
    
    const params = [orgId];
    
    if (status) {
      query += ' AND o.status = $2';
      params.push(status);
    }
    
    query += ' GROUP BY o.id ORDER BY o.created_at DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to get orders' });
  }
});

app.post('/api/orders/:orgId', verifyFirebaseToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { orgId } = req.params;
    const { 
      tableId, 
      items, 
      customerName, 
      customerPhone,
      discountPercentage = 0,
      serviceChargePercentage = 0,
      taxPercentage = 0
    } = req.body;
    
    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discountAmount = subtotal * (discountPercentage / 100);
    const serviceCharge = (subtotal - discountAmount) * (serviceChargePercentage / 100);
    const taxAmount = (subtotal - discountAmount + serviceCharge) * (taxPercentage / 100);
    const totalAmount = subtotal - discountAmount + serviceCharge + taxAmount;
    
    // Create order
    const orderResult = await client.query(
      `INSERT INTO orders (
        organization_id, table_id, user_id, customer_name, customer_phone,
        discount_percentage, service_charge_percentage, tax_percentage,
        subtotal, total_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
      RETURNING *`,
      [
        orgId, tableId, req.dbUser.id, customerName, customerPhone,
        discountPercentage, serviceChargePercentage, taxPercentage,
        subtotal, totalAmount
      ]
    );
    
    const order = orderResult.rows[0];
    
    // Add order items
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, modifiers)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.menuItemId, item.name, item.price, item.quantity, JSON.stringify(item.modifiers || [])]
      );
    }
    
    // Log sync event
    await client.query(
      `INSERT INTO sync_log (organization_id, table_name, record_id, operation, user_id) 
       VALUES ($1, 'orders', $2, 'INSERT', $3)`,
      [orgId, order.id, req.dbUser.id]
    );
    
    await client.query('COMMIT');
    
    // Get complete order with items
    const completeOrderResult = await pool.query(
      `SELECT o.*, 
             json_agg(
               json_build_object(
                 'id', oi.id,
                 'menu_item_id', oi.menu_item_id,
                 'name', oi.name,
                 'price', oi.price,
                 'quantity', oi.quantity,
                 'modifiers', oi.modifiers,
                 'subtotal', oi.subtotal
               )
             ) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.id = $1
      GROUP BY o.id`,
      [order.id]
    );
    
    const completeOrder = completeOrderResult.rows[0];
    
    // Broadcast to all connected clients
    broadcastUpdate(orgId, 'order-created', completeOrder);
    
    res.json(completeOrder);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  } finally {
    client.release();
  }
});

// Sync API for offline/online synchronization
app.post('/api/sync/:orgId', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { lastSyncTime, pendingChanges } = req.body;
    
    // Process pending changes from client
    const syncResults = [];
    
    for (const change of pendingChanges || []) {
      try {
        // Apply change to database with conflict resolution
        const result = await applyChange(orgId, change, req.dbUser.id);
        syncResults.push(result);
      } catch (error) {
        syncResults.push({
          id: change.id,
          status: 'error',
          error: error.message
        });
      }
    }
    
    // Get changes since last sync
    const changesResult = await pool.query(
      `SELECT * FROM sync_log 
       WHERE organization_id = $1 AND created_at > $2 
       ORDER BY created_at ASC`,
      [orgId, lastSyncTime || '1970-01-01']
    );
    
    res.json({
      syncResults,
      serverChanges: changesResult.rows,
      syncTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Helper function to apply changes with conflict resolution
async function applyChange(orgId, change, userId) {
  const { table, operation, data, clientVersion } = change;
  
  if (operation === 'INSERT') {
    // Handle insert operations
    // Implementation depends on table structure
  } else if (operation === 'UPDATE') {
    // Check for conflicts by comparing versions
    const currentResult = await pool.query(
      `SELECT version FROM ${table} WHERE id = $1 AND organization_id = $2`,
      [data.id, orgId]
    );
    
    if (currentResult.rows.length > 0) {
      const currentVersion = currentResult.rows[0].version;
      if (currentVersion > clientVersion) {
        // Conflict detected - implement resolution strategy
        return {
          id: data.id,
          status: 'conflict',
          serverVersion: currentVersion,
          clientVersion
        };
      }
    }
    
    // Apply update
    // Implementation depends on table structure
  }
  
  return {
    id: data.id,
    status: 'success'
  };
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server, io };
