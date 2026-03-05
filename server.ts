import express from 'express';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleDriveService } from './src/services/drive.js';
import { getDB } from './src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure uploads directory exists (only for local fallback)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Initialize Services
const driveService = new GoogleDriveService();
const db = getDB();

// Initialize DB tables and start server
const startServer = async () => {
  try {
    await db.init();
    console.log('Database initialized');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to init DB:', err);
    process.exit(1);
  }
};

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Multer setup for file uploads (use /tmp for Vercel/Serverless compatibility)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use /tmp directory if in production/vercel environment to avoid read-only errors
    const dest = process.env.NODE_ENV === 'production' ? '/tmp' : uploadDir;
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Serve uploaded files statically (only works for local storage)
app.use('/uploads', express.static(uploadDir));
app.use(express.json());
// Allow URL-encoded bodies for simple GET/POST trackers
app.use(express.urlencoded({ extended: true }));

// API Routes

// Get all posts
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await db.getPosts();
    // Parse image_paths JSON string back to array
    const parsedPosts = posts.map((post: any) => ({
      ...post,
      image_paths: JSON.parse(post.image_paths || '[]')
    }));
    res.json(parsedPosts);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Get tracking points
app.get('/api/track', async (req, res) => {
  try {
    const points = await db.getTrackingPoints();
    res.json(points);
  } catch (error) {
    console.error('Error fetching tracking points:', error);
    res.status(500).json({ error: 'Failed to fetch tracking points' });
  }
});

// Receive tracking point
const handleTrackingUpdate = async (req: express.Request, res: express.Response) => {
  try {
    const lat = req.query.lat || req.query.latitude || req.body.lat || req.body.latitude;
    const lon = req.query.lon || req.query.lng || req.query.longitude || req.body.lon || req.body.lng || req.body.longitude;
    const timestamp = req.query.timestamp || req.query.time || req.body.timestamp || req.body.time || new Date().toISOString();
    const deviceId = req.query.deviceId || req.query.id || req.body.deviceId || req.body.id || 'unknown';

    if (!lat || !lon) {
      res.status(400).json({ error: 'Missing latitude or longitude' });
      return;
    }

    await db.createTrackingPoint({
      latitude: parseFloat(lat as string),
      longitude: parseFloat(lon as string),
      timestamp,
      device_id: deviceId
    });

    console.log(`Tracking update received: ${lat}, ${lon}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving tracking point:', error);
    res.status(500).json({ error: 'Failed to save tracking point' });
  }
};

app.get('/api/track/update', handleTrackingUpdate);
app.post('/api/track/update', handleTrackingUpdate);

// Create a new post
app.post('/api/posts', upload.array('photos', 5), async (req, res) => {
  try {
    const { latitude, longitude, caption, timestamp, transportMode } = req.body;
    const files = req.files as Express.Multer.File[];
    let imagePaths: string[] = [];

    if (driveService.isConfigured()) {
      console.log('Uploading photos to Google Drive...');
      for (const file of files) {
        try {
          const driveUrl = await driveService.uploadFile(file.path, file.filename, file.mimetype);
          imagePaths.push(driveUrl);
          // Delete temp file
          try { fs.unlinkSync(file.path); } catch (e) {}
        } catch (uploadError) {
          console.error(`Failed to upload ${file.filename} to Drive:`, uploadError);
          // If drive fails on Vercel, we can't really fallback to local storage permanently
          // But we can try to serve from temp? No, temp is ephemeral.
          // We just log error.
        }
      }
    } else {
      // Local storage (only works reliably on persistent servers)
      imagePaths = files.map(file => `/uploads/${file.filename}`);
    }

    const newPostId = await db.createPost({
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      caption,
      timestamp: timestamp || new Date().toISOString(),
      image_paths: JSON.stringify(imagePaths),
      transportMode: transportMode || 'other'
    });

    res.json({ success: true, id: newPostId });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Vite middleware for development
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  // Serve static files in production
  const distPath = path.join(__dirname, 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

startServer();
