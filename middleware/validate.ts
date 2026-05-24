// === FILENAME: middleware/validate.ts ===

import { Request, Response, NextFunction } from 'express';

export function validateSignup(req: Request, res: Response, next: NextFunction) {
  const { name, email, password, role } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Name is required' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  if (role && role !== 'admin' && role !== 'member') {
    return res.status(400).json({ error: 'Role must be either "admin" or "member"' });
  }

  next();
}

export function validateLogin(req: Request, res: Response, next: NextFunction) {
  const { email, password } = req.body;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  if (!password || typeof password !== 'string' || password.trim() === '') {
    return res.status(400).json({ error: 'Password is required' });
  }

  next();
}

export function validateProject(req: Request, res: Response, next: NextFunction) {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Project name is required' });
  }

  next();
}

export function validateTask(req: Request, res: Response, next: NextFunction) {
  const { title, projectId, project_id, status, priority } = req.body;
  const pId = projectId || project_id;

  if (req.method === 'POST') {
    if (!title || typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ error: 'Task title is required' });
    }

    if (!pId || isNaN(parseInt(pId, 10))) {
      return res.status(400).json({ error: 'A valid project_id is required' });
    }
  }

  if (status && !['todo', 'in_progress', 'done'].includes(status)) {
    return res.status(400).json({ error: 'Status must be one of: todo, in_progress, done' });
  }

  if (priority && !['low', 'medium', 'high'].includes(priority)) {
    return res.status(400).json({ error: 'Priority must be one of: low, medium, high' });
  }

  next();
}

export function validateMember(req: Request, res: Response, next: NextFunction) {
  const { email } = req.body;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  next();
}
