// === FILENAME: routes/auth.ts ===

import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSupabase } from '../lib/supabase';
import { validateSignup, validateLogin } from '../middleware/validate';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

// POST /api/auth/signup -> Register user, hash password, return JWT
router.post('/signup', validateSignup, async (req: express.Request, res: Response) => {
  const { name, email, password, role } = req.body;

  try {
    const db = getSupabase();

    // 1. Check if user already exists
    const { data: existingUser, error: checkError } = await db
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (checkError) {
      return res.status(500).json({ error: 'Database verification failed', details: checkError.message });
    }

    if (existingUser) {
      return res.status(400).json({ error: 'A user with this email address already exists' });
    }

    // 2. Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 3. Create user
    const userRole = role || 'member';
    const { data: newUser, error: insertError } = await db
      .from('users')
      .insert({
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        role: userRole,
      })
      .select('id, name, email, role, created_at')
      .single();

    if (insertError || !newUser) {
      return res.status(500).json({ error: 'Failed to create user account', details: insertError?.message });
    }

    // 4. Generate JWT
    const jwtSecret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';
    const token = jwt.sign(
      { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
      jwtSecret,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: newUser
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error during registration', details: err.message });
  }
});

// POST /api/auth/login -> Verify credentials, return JWT
router.post('/login', validateLogin, async (req: express.Request, res: Response) => {
  const { email, password } = req.body;

  try {
    const db = getSupabase();

    // 1. Fetch user by email (we need the password hash here)
    const { data: user, error: fetchError } = await db
      .from('users')
      .select('id, name, email, password, role, created_at')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: 'Database verification failed', details: fetchError.message });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email address or password' });
    }

    // 2. Match password
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      return res.status(401).json({ error: 'Invalid email address or password' });
    }

    // 3. Generate JWT
    const jwtSecret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      jwtSecret,
      { expiresIn: '7d' }
    );

    // 4. Clean password from user object
    const { password: _, ...userSafe } = user;

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: userSafe
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error during login', details: err.message });
  }
});

// GET /api/auth/me -> Return current user details
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const { data: user, error } = await db
      .from('users')
      .select('id, name, email, role, created_at')
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      // Token is valid but user might be deleted from database
      return res.status(404).json({ error: 'User does not exist' });
    }

    return res.status(200).json({ user });
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error retrieving identity', details: err.message });
  }
});

export default router;
