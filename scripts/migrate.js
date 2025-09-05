const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`
});

async function createSchema() {
  console.log('Creating database schema...');
  
  try {
    // Create users table first (organizations references it)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
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
      CREATE TABLE IF NOT EXISTS organizations (
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
      CREATE TABLE IF NOT EXISTS user_organizations (
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
      CREATE TABLE IF NOT EXISTS tables (
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
      CREATE TABLE IF NOT EXISTS menu_categories (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create menu_items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        category_id INTEGER REFERENCES menu_categories(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        stock_quantity INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create orders table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        table_id INTEGER REFERENCES tables(id) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
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
        version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create order_items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        quantity INTEGER NOT NULL,
        modifiers JSONB DEFAULT '[]',
        subtotal DECIMAL(10,2) GENERATED ALWAYS AS (price * quantity) STORED,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create customers table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        email VARCHAR(255),
        loyalty_points INTEGER DEFAULT 0,
        version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create receipts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS receipts (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        content TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create sync_log table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        table_name VARCHAR(255) NOT NULL,
        record_id INTEGER NOT NULL,
        operation VARCHAR(50) NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for better performance
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_organization_id ON orders(organization_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_table_id ON orders(table_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tables_organization_id ON tables(organization_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_menu_items_organization_id ON menu_items(organization_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_customers_organization_id ON customers(organization_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sync_log_organization_id ON sync_log(organization_id)`);

    console.log('Database schema created successfully!');
    
    // Create default organization if none exists
    const orgResult = await pool.query(
      `INSERT INTO organizations (name, settings) 
       VALUES ($1, $2) 
       ON CONFLICT DO NOTHING 
       RETURNING id`,
      ['Default Restaurant', '{}']
    );
    
    if (orgResult.rows.length > 0) {
      const organizationId = orgResult.rows[0].id;
      console.log('Created default organization:', organizationId);
      
      // Create default category
      await pool.query(
        `INSERT INTO menu_categories (organization_id, name, description)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [organizationId, 'General', 'Default category']
      );
      
      // Create default table
      await pool.query(
        `INSERT INTO tables (organization_id, name, seats, description)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [organizationId, 'Table 1', 4, 'Default table']
      );
      
      console.log('Created default data');
    }
    
  } catch (error) {
    console.error('Schema creation failed:', error);
    throw error;
  }
}

async function migrateData() {
  console.log('Starting database setup...');
  
  try {
    await createSchema();
    console.log('Database setup completed successfully!');
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration
if (require.main === module) {
  migrateData();
}

module.exports = { migrateData, createSchema };
