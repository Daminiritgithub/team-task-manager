// === FILENAME: server.ts ===

import express from 'express';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import taskRoutes from './routes/tasks';
import dashboardRoutes from './routes/dashboard';
import { getSupabase } from './lib/supabase';
import { authenticateToken } from './middleware/auth';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable trust proxy so Express correctly handles standard proxy headers (like X-Forwarded-For)
app.set('trust proxy', 1);

// Set up security CORS headers
app.use(cors());
app.use(express.json());

// Express rate limit setup for Auth routes (max 10 requests per 15 minutes per IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false, // Disables internal validation checks for standard / non-standard proxy headers
});

// Serve frontend assets statically from public/
const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));

// REST API endpoints
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Bind auth routers with the requested limiting policy
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Helper endpoint: retrieve users in the system (e.g., for task assignments / member addition list)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const db = getSupabase();
    const { data: users, error } = await db
      .from('users')
      .select('id, name, email, role')
      .order('name', { ascending: true });

    if (error) {
      return res.status(500).json({ error: 'Failed to retrieve teammates', details: error.message });
    }
    return res.status(200).json(users);
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error retrieving workspace users', details: err.message });
  }
});

// Fallback: route any unregistered URLs to SPA index.html so frontend hash or client routers work
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Global Express error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Core server exception:', err);
  res.status(500).json({
    error: 'An unexpected error occurred during server execution.',
    details: err.message || String(err)
  });
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Team Task Manager server running on http://0.0.0.0:${PORT}`);
});
