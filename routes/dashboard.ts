// === FILENAME: routes/dashboard.ts ===

import express, { Response } from 'express';
import { getSupabase } from '../lib/supabase';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

// GET /api/dashboard -> Return dashboard metric JSON
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const db = getSupabase();
    
    let projectsCount = 0;
    let targetProjectIds: number[] = [];

    // 1. Gather relevant project IDs
    if (req.user.role === 'admin') {
      const { data: allProjects, error: pError } = await db
        .from('projects')
        .select('id');

      if (pError) {
        return res.status(500).json({ error: 'Failed to compute dashboard metrics', details: pError.message });
      }

      projectsCount = allProjects?.length || 0;
      targetProjectIds = (allProjects || []).map(p => p.id);
    } else {
      const { data: memberships, error: mError } = await db
        .from('project_members')
        .select('project_id')
        .eq('user_id', req.user.id);

      if (mError) {
        return res.status(500).json({ error: 'Failed to compute dashboard memberships', details: mError.message });
      }

      projectsCount = memberships?.length || 0;
      targetProjectIds = (memberships || []).map(m => m.project_id);
    }

    // Default response if no projects are joined/managed and not system admin
    if (targetProjectIds.length === 0) {
      return res.status(200).json({
        totalTasks: 0,
        byStatus: { todo: 0, in_progress: 0, done: 0 },
        overdue: 0,
        myTasks: 0,
        recentTasks: [],
        projects: 0
      });
    }

    // 2. Fetch all matching tasks to compile metrics
    const { data: tasks, error: tError } = await db
      .from('tasks')
      .select(`
        *,
        project:projects (id, name)
      `)
      .in('project_id', targetProjectIds);

    if (tError) {
      return res.status(500).json({ error: 'Failed to fetch tasks for statistics', details: tError.message });
    }

    const totalTasks = tasks?.length || 0;

    // Status breakdowns
    const byStatus = { todo: 0, in_progress: 0, done: 0 };
    let overdueCount = 0;
    let myTasksCount = 0;

    const todayStr = new Date().toISOString().split('T')[0];

    if (tasks) {
      tasks.forEach(task => {
        // Status tallies
        if (task.status === 'todo') byStatus.todo++;
        else if (task.status === 'in_progress') byStatus.in_progress++;
        else if (task.status === 'done') byStatus.done++;

        // Overdue tracker: due_date < today and not done
        if (task.due_date && task.status !== 'done') {
          if (task.due_date < todayStr) {
            overdueCount++;
          }
        }

        // My tasks tally
        if (task.assigned_to === req?.user?.id) {
          myTasksCount++;
        }
      });
    }

    // Fetch the 5 most recent tasks
    const { data: recentTasks, error: recentError } = await db
      .from('tasks')
      .select(`
        *,
        project:projects (id, name),
        assignee:users!tasks_assigned_to_fkey (id, name, email)
      `)
      .in('project_id', targetProjectIds)
      .order('created_at', { ascending: false })
      .limit(5);

    if (recentError) {
      return res.status(500).json({ error: 'Failed to compile recent tasks timeline', details: recentError.message });
    }

    return res.status(200).json({
      totalTasks,
      byStatus,
      overdue: overdueCount,
      myTasks: myTasksCount,
      recentTasks: recentTasks || [],
      projects: projectsCount
    });

  } catch (err: any) {
    return res.status(500).json({ error: 'Server exception compiling analytics dashboard', details: err.message });
  }
});

export default router;
