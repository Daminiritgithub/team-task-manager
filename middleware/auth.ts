// === FILENAME: middleware/auth.ts ===

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getSupabase } from '../lib/supabase';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    name: string;
    email: string;
    role: 'admin' | 'member';
  };
}

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token is missing' });
  }

  const jwtSecret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

  jwt.verify(token, jwtSecret, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Access token is invalid or expired' });
    }
    req.user = decoded as AuthenticatedRequest['user'];
    next();
  });
}

// Global Admin, or Project Admin for specific resources
export async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: User authentication required' });
  }

  // 1. Global Admin can do everything
  if (req.user.role === 'admin') {
    return next();
  }

  // 2. Otherwise, check if the user is a Project Admin for the targeted project
  const projectIdStr = req.params.id || req.params.projectId || req.body.projectId || req.body.project_id || req.query.projectId;
  let projectId: number | null = null;
  
  if (projectIdStr) {
    projectId = parseInt(projectIdStr as string, 10);
  }

  // If there is an ID parameter on isTaskRoute, retrieve the project_id from the task
  const taskIdStr = req.params.id;
  const isTaskRoute = req.baseUrl.includes('tasks');
  if (isTaskRoute && taskIdStr && !projectId) {
    try {
      const db = getSupabase();
      const { data: task, error } = await db
        .from('tasks')
        .select('project_id')
        .eq('id', parseInt(taskIdStr, 10))
        .single();
      
      if (!error && task) {
        projectId = task.project_id;
      }
    } catch (e) {
      // Handled downstream
    }
  }

  if (projectId && !isNaN(projectId)) {
    try {
      const db = getSupabase();
      // Check if this user is a project member with role 'admin'
      const { data: member, error } = await db
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', req.user.id)
        .single();

      if (!error && member && member.role === 'admin') {
        return next();
      }
    } catch (err: any) {
      return res.status(500).json({ error: 'Database verification failed', details: err.message });
    }
  }

  return res.status(403).json({ error: 'Forbidden: Admin permissions (global or project-level) are required for this action' });
}
