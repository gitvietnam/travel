import pg from 'pg';

// Interface for common DB operations
export interface DBAdapter {
  getPosts(): Promise<any[]>;
  createPost(post: any): Promise<number>;
  getTrackingPoints(): Promise<any[]>;
  createTrackingPoint(point: any): Promise<void>;
  init(): Promise<void>;
}

// SQLite Implementation (Local)
class SQLiteAdapter implements DBAdapter {
  private db: any;

  constructor() {}

  async init() {
    const { default: Database } = await import('better-sqlite3');
    this.db = new Database('travel.db');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        caption TEXT,
        timestamp TEXT NOT NULL,
        image_paths TEXT,
        transportMode TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tracking_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        timestamp TEXT NOT NULL,
        device_id TEXT
      )
    `);

    try {
      this.db.exec('ALTER TABLE posts ADD COLUMN transportMode TEXT');
    } catch (error) {
      // Column exists
    }
  }

  async getPosts() {
    return this.db.prepare('SELECT * FROM posts ORDER BY timestamp DESC').all();
  }

  async createPost(post: any) {
    const stmt = this.db.prepare(`
      INSERT INTO posts (latitude, longitude, caption, timestamp, image_paths, transportMode)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      post.latitude,
      post.longitude,
      post.caption,
      post.timestamp,
      post.image_paths,
      post.transportMode
    );
    return info.lastInsertRowid;
  }

  async getTrackingPoints() {
    return this.db.prepare('SELECT latitude, longitude, timestamp, device_id FROM tracking_points ORDER BY timestamp ASC LIMIT 2000').all();
  }

  async createTrackingPoint(point: any) {
    const stmt = this.db.prepare(`
      INSERT INTO tracking_points (latitude, longitude, timestamp, device_id)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(point.latitude, point.longitude, point.timestamp, point.device_id);
  }
}

// Postgres Implementation (Vercel)
class PostgresAdapter implements DBAdapter {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });
  }

  async init() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS posts (
          id SERIAL PRIMARY KEY,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          caption TEXT,
          timestamp TEXT NOT NULL,
          image_paths TEXT,
          transportMode TEXT
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS tracking_points (
          id SERIAL PRIMARY KEY,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          timestamp TEXT NOT NULL,
          device_id TEXT
        )
      `);
      
      // Column migration check would go here, but for simplicity in Vercel we assume fresh or managed schema
    } finally {
      client.release();
    }
  }

  async getPosts() {
    const res = await this.pool.query('SELECT * FROM posts ORDER BY timestamp DESC');
    return res.rows;
  }

  async createPost(post: any) {
    const res = await this.pool.query(`
      INSERT INTO posts (latitude, longitude, caption, timestamp, image_paths, transportMode)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [
      post.latitude,
      post.longitude,
      post.caption,
      post.timestamp,
      post.image_paths,
      post.transportMode
    ]);
    return res.rows[0].id;
  }

  async getTrackingPoints() {
    const res = await this.pool.query('SELECT latitude, longitude, timestamp, device_id FROM tracking_points ORDER BY timestamp ASC LIMIT 2000');
    return res.rows;
  }

  async createTrackingPoint(point: any) {
    await this.pool.query(`
      INSERT INTO tracking_points (latitude, longitude, timestamp, device_id)
      VALUES ($1, $2, $3, $4)
    `, [point.latitude, point.longitude, point.timestamp, point.device_id]);
  }
}

// Factory
export function getDB(): DBAdapter {
  // Log environment status (without exposing secrets)
  console.log('Checking DB configuration...');
  console.log('POSTGRES_URL exists:', !!process.env.POSTGRES_URL);
  console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
  console.log('NODE_ENV:', process.env.NODE_ENV);

  if (process.env.POSTGRES_URL || process.env.DATABASE_URL) {
    console.log('Using PostgreSQL database adapter');
    return new PostgresAdapter(process.env.POSTGRES_URL || process.env.DATABASE_URL!);
  } else {
    // If we are in production (Vercel) but no Postgres URL, this is likely an error
    if (process.env.NODE_ENV === 'production') {
      console.error('ERROR: Running in production but no POSTGRES_URL or DATABASE_URL found.');
      console.error('Please ensure you have connected a database in Vercel Storage settings.');
    }
    console.log('Using SQLite database adapter (fallback)');
    return new SQLiteAdapter();
  }
}
