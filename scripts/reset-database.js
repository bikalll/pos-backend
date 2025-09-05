const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`
});

async function resetDatabase() {
  console.log('Resetting database with correct UUID schema...');
  
  try {
    // Drop all tables in correct order (reverse of dependencies)
    await pool.query('DROP TABLE IF EXISTS sync_log CASCADE');
    await pool.query('DROP TABLE IF EXISTS receipts CASCADE');
    await pool.query('DROP TABLE IF EXISTS order_items CASCADE');
    await pool.query('DROP TABLE IF EXISTS orders CASCADE');
    await pool.query('DROP TABLE IF EXISTS menu_items CASCADE');
    await pool.query('DROP TABLE IF EXISTS menu_categories CASCADE');
    await pool.query('DROP TABLE IF EXISTS customers CASCADE');
    await pool.query('DROP TABLE IF EXISTS tables CASCADE');
    await pool.query('DROP TABLE IF EXISTS user_organizations CASCADE');
    await pool.query('DROP TABLE IF EXISTS organizations CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    
    console.log('Dropped existing tables');

    // Create users table
    await pool.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        firebase_uid VARCHAR(128) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        display_name VARCHAR(255),
        role VARCHAR(50) DEFAULT 'waiter' CHECK (role IN ('manager', 'cashier', 'waiter')),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create organizations table
    await pool.query(`
      CREATE TABLE organizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        owner_id UUID REFERENCES users(id),
        settings JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create user_organizations table
    await pool.query(`
      CREATE TABLE user_organizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        organization_id UUID REFERENCES organizations(id),
        role VARCHAR(50) DEFAULT 'waiter' CHECK (role IN ('manager', 'cashier', 'waiter')),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, organization_id)
      )
    `);

    // Create tables table
    await pool.query(`
      CREATE TABLE tables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id),
        name VARCHAR(100) NOT NULL,
        seats INTEGER DEFAULT 4,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        is_merged BOOLEAN DEFAULT false,
        merged_tables UUID[],
        merged_table_names TEXT[],
        total_seats INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create menu_categories table
    await pool.query(`
      CREATE TABLE menu_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create menu_items table
    await pool.query(`
      CREATE TABLE menu_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id),
        category_id UUID REFERENCES menu_categories(id),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        stock_quantity INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create orders table
    await pool.query(`
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id),
        table_id UUID REFERENCES tables(id),
        user_id UUID REFERENCES users(id),
        customer_name VARCHAR(255),
        customer_phone VARCHAR(50),
        status VARCHAR(50) DEFAULT 'pending',
        discount_percentage DECIMAL(5,2) DEFAULT 0,
        service_charge_percentage DECIMAL(5,2) DEFAULT 0,
        tax_percentage DECIMAL(5,2) DEFAULT 0,
        subtotal DECIMAL(10,2) DEFAULT 0,
        total_amount DECIMAL(10,2) DEFAULT 0,
        payment_method VARCHAR(50),
        amount_paid DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create order_items table
    await pool.query(`
      CREATE TABLE order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id),
        menu_item_id UUID REFERENCES menu_items(id),
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        quantity INTEGER NOT NULL,
        modifiers JSONB DEFAULT '[]',
        subtotal DECIMAL(10,2) GENERATED ALWAYS AS (price * quantity) STORED,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create customers table
    await pool.query(`
      CREATE TABLE customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id),
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        email VARCHAR(255),
        loyalty_points INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create receipts table
    await pool.query(`
      CREATE TABLE receipts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id),
        order_id UUID REFERENCES orders(id),
        content TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create sync_log table
    await pool.query(`
      CREATE TABLE sync_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id),
        table_name VARCHAR(255) NOT NULL,
        record_id UUID NOT NULL,
        operation VARCHAR(50) NOT NULL,
        user_id UUID REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create indexes
    await pool.query(`CREATE INDEX idx_orders_organization_id ON orders(organization_id)`);
    await pool.query(`CREATE INDEX idx_orders_table_id ON orders(table_id)`);
    await pool.query(`CREATE INDEX idx_orders_status ON orders(status)`);
    await pool.query(`CREATE INDEX idx_order_items_order_id ON order_items(order_id)`);
    await pool.query(`CREATE INDEX idx_tables_organization_id ON tables(organization_id)`);
    await pool.query(`CREATE INDEX idx_menu_items_organization_id ON menu_items(organization_id)`);
    await pool.query(`CREATE INDEX idx_customers_organization_id ON customers(organization_id)`);
    await pool.query(`CREATE INDEX idx_sync_log_organization_id ON sync_log(organization_id)`);

    console.log('Database schema recreated successfully with UUID primary keys!');
    
  } catch (error) {
    console.error('Database reset failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run reset
if (require.main === module) {
  resetDatabase();
}

module.exports = { resetDatabase };
