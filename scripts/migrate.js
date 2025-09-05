const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`
});

// SQLite connection (adjust path as needed)
const sqlitePath = process.argv[2] || './pos.db';
const db = new sqlite3.Database(sqlitePath);

async function migrateData() {
  console.log('Starting data migration from SQLite to PostgreSQL...');
  
  try {
    // Create a default organization if none exists
    const orgResult = await pool.query(
      `INSERT INTO organizations (name, settings) 
       VALUES ($1, $2) 
       ON CONFLICT DO NOTHING 
       RETURNING id`,
      ['Default Restaurant', '{}']
    );
    
    let organizationId;
    if (orgResult.rows.length > 0) {
      organizationId = orgResult.rows[0].id;
      console.log('Created default organization:', organizationId);
    } else {
      // Get existing organization
      const existingOrg = await pool.query('SELECT id FROM organizations LIMIT 1');
      organizationId = existingOrg.rows[0].id;
      console.log('Using existing organization:', organizationId);
    }

    // Migrate customers
    await migrateCustomers(organizationId);
    
    // Migrate inventory items
    await migrateInventory(organizationId);
    
    // Migrate orders
    await migrateOrders(organizationId);
    
    // Migrate receipts
    await migrateReceipts(organizationId);
    
    console.log('Migration completed successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    db.close();
    await pool.end();
  }
}

async function migrateCustomers(organizationId) {
  return new Promise((resolve, reject) => {
    console.log('Migrating customers...');
    
    db.all('SELECT * FROM customers', async (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      
      try {
        for (const row of rows) {
          await pool.query(
            `INSERT INTO customers (id, organization_id, name, phone, email, loyalty_points, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7/1000), to_timestamp($7/1000))
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               phone = EXCLUDED.phone,
               email = EXCLUDED.email,
               loyalty_points = EXCLUDED.loyalty_points,
               updated_at = NOW()`,
            [
              row.id,
              organizationId,
              row.name,
              row.phone,
              row.email,
              row.loyaltyPoints || 0,
              Date.now()
            ]
          );
        }
        console.log(`Migrated ${rows.length} customers`);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function migrateInventory(organizationId) {
  return new Promise((resolve, reject) => {
    console.log('Migrating inventory items...');
    
    db.all('SELECT * FROM inventory', async (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      
      try {
        // Create a default category
        const categoryResult = await pool.query(
          `INSERT INTO menu_categories (organization_id, name, description)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [organizationId, 'General', 'Default category for migrated items']
        );
        
        let categoryId;
        if (categoryResult.rows.length > 0) {
          categoryId = categoryResult.rows[0].id;
        } else {
          const existingCategory = await pool.query(
            'SELECT id FROM menu_categories WHERE organization_id = $1 LIMIT 1',
            [organizationId]
          );
          categoryId = existingCategory.rows[0].id;
        }
        
        for (const row of rows) {
          await pool.query(
            `INSERT INTO menu_items (id, organization_id, category_id, name, price, stock_quantity, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8/1000), to_timestamp($8/1000))
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               price = EXCLUDED.price,
               stock_quantity = EXCLUDED.stock_quantity,
               is_active = EXCLUDED.is_active,
               updated_at = NOW()`,
            [
              row.id,
              organizationId,
              categoryId,
              row.name,
              row.price,
              row.stockQuantity || 0,
              row.isActive === 1,
              Date.now()
            ]
          );
        }
        console.log(`Migrated ${rows.length} inventory items`);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function migrateOrders(organizationId) {
  return new Promise((resolve, reject) => {
    console.log('Migrating orders...');
    
    db.all('SELECT * FROM orders', async (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      
      try {
        // Create default tables if they don't exist
        const tableResult = await pool.query(
          `INSERT INTO tables (organization_id, name, seats, description)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [organizationId, 'Table 1', 4, 'Default table for migrated orders']
        );
        
        let defaultTableId;
        if (tableResult.rows.length > 0) {
          defaultTableId = tableResult.rows[0].id;
        } else {
          const existingTable = await pool.query(
            'SELECT id FROM tables WHERE organization_id = $1 LIMIT 1',
            [organizationId]
          );
          defaultTableId = existingTable.rows[0].id;
        }
        
        for (const row of rows) {
          // Insert order
          await pool.query(
            `INSERT INTO orders (id, organization_id, table_id, status, discount_percentage, service_charge_percentage, tax_percentage, payment_method, amount_paid, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10/1000), to_timestamp($10/1000))
             ON CONFLICT (id) DO UPDATE SET
               status = EXCLUDED.status,
               discount_percentage = EXCLUDED.discount_percentage,
               service_charge_percentage = EXCLUDED.service_charge_percentage,
               tax_percentage = EXCLUDED.tax_percentage,
               payment_method = EXCLUDED.payment_method,
               amount_paid = EXCLUDED.amount_paid,
               updated_at = NOW()`,
            [
              row.id,
              organizationId,
              row.tableId || defaultTableId,
              row.status || 'completed',
              row.discountPercentage || 0,
              row.serviceChargePercentage || 0,
              row.taxPercentage || 0,
              row.paymentMethod,
              row.amountPaid,
              row.createdAt || Date.now()
            ]
          );
          
          // Migrate order items
          await migrateOrderItems(row.id);
        }
        console.log(`Migrated ${rows.length} orders`);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function migrateOrderItems(orderId) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM order_items WHERE orderId = ?', [orderId], async (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      
      try {
        for (const row of rows) {
          await pool.query(
            `INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, modifiers, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
             ON CONFLICT DO NOTHING`,
            [
              orderId,
              row.menuItemId,
              row.name,
              row.price,
              row.quantity,
              row.modifiers
            ]
          );
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function migrateReceipts(organizationId) {
  return new Promise((resolve, reject) => {
    console.log('Migrating receipts...');
    
    db.all('SELECT * FROM receipts', async (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      
      try {
        for (const row of rows) {
          await pool.query(
            `INSERT INTO receipts (id, organization_id, order_id, content, created_at, updated_at)
             VALUES ($1, $2, $3, $4, to_timestamp($5/1000), to_timestamp($5/1000))
             ON CONFLICT (id) DO UPDATE SET
               content = EXCLUDED.content,
               updated_at = NOW()`,
            [
              row.id,
              organizationId,
              row.orderId,
              row.content,
              row.createdAt || Date.now()
            ]
          );
        }
        console.log(`Migrated ${rows.length} receipts`);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

// Run migration
if (require.main === module) {
  migrateData();
}

module.exports = { migrateData };
