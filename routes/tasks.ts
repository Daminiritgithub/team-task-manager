// === FILENAME: routes/tasks.ts ===

import express, { Response } from 'express';
import { getSupabase } from '../lib/supabase';
import { validateTask } from '../middleware/validate';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

// GET /api/tasks -> All tasks across user's projects (with filters: ?status=, ?priority=, ?assigned_to=, ?project_id=)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const db = getSupabase();
    let query = db.from('tasks').select(`
      *,
      project:projects (id, name),
      assignee:users!tasks_assigned_to_fkey (id, name, email),
      creator:users!tasks_created_by_fkey (id, name)
    `);

    // 1. Filter by Project memberships if not global admin
    if (req.user.role !== 'admin') {
      const { data: memberships, error: memError } = await db
        .from('project_members')
        .select('project_id')
        .eq('user_id', req.user.id);

      if (memError) {
        return res.status(500).json({ error: 'Failed to fetch project memberships', details: memError.message });
      }

      if (!memberships || memberships.length === 0) {
        // User belongs to no projects -> immediately return empty array
        return res.status(200).json([]);
      }

      const activeProjectIds = memberships.map(m => m.project_id);
      query = query.in('project_id', activeProjectIds);
    }

    // 2. Apply optional filters
    const { status, priority, assigned_to, project_id, projectId } = req.query;

    if (status) {
      query = query.eq('status', status);
    }

    if (priority) {
      query = query.eq('priority', priority);
    }

    if (assigned_to) {
      const parsedAssigned = parseInt(assigned_to as string, 10);
      if (!isNaN(parsedAssigned)) {
        query = query.eq('assigned_to', parsedAssigned);
      }
    }

    const targetProjId = project_id || projectId;
    if (targetProjId) {
      const parsedProjIdx = parseInt(targetProjId as string, 10);
      if (!isNaN(parsedProjIdx)) {
        query = query.eq('project_id', parsedProjIdx);
      }
    }

    const { data: tasks, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to retrieve tasks', details: error.message });
    }

    return res.status(200).json(tasks);
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error retrieving tasks', details: err.message });
  }
});

// GET /api/tasks/project/:projectId -> Tasks for a specific project space
router.get('/project/:projectId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) {
    return res.status(400).json({ error: 'Invalid project ID format' });
  }

  try {
    const db = getSupabase();

    // Verify membership authorization if not a global admin
    if (req.user.role !== 'admin') {
      const { data: isMember, error: checkError } = await db
        .from('project_members')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', req.user.id)
        .maybeSingle();

      if (checkError) {
        return res.status(500).json({ error: 'Access check failed', details: checkError.message });
      }

      if (!isMember) {
        return res.status(403).json({ error: 'Forbidden: You do not have access to this project space' });
      }
    }

    const { data: tasks, error } = await db
      .from('tasks')
      .select(`
        *,
        assignee:users!tasks_assigned_to_fkey (id, name, email),
        creator:users!tasks_created_by_fkey (id, name)
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to retrieve project tasks', details: error.message });
    }

    return res.status(200).json(tasks);
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error retrieving tasks', details: err.message });
  }
});

// POST /api/tasks -> Create task in a project (project administrator or global admin only)
router.post('/', authenticateToken, requireAdmin, validateTask, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const { title, description, status, priority, projectId, project_id, assigned_to, due_date } = req.body;
  const pId = parseInt(projectId || project_id, 10);
  const assignedUserId = assigned_to ? parseInt(assigned_to, 10) : null;

  try {
    const db = getSupabase();

    // If an assigned_to user is provided, verify they belong to this project
    if (assignedUserId) {
      const { data: isMember, error: memberCheckError } = await db
        .from('project_members')
        .select('id')
        .eq('project_id', pId)
        .eq('user_id', assignedUserId)
        .maybeSingle();

      if (memberCheckError) {
        return res.status(500).json({ error: 'Assignee validation failed', details: memberCheckError.message });
      }

      if (!isMember) {
        // Also check if they are a global admin, which allows assignment
        const { data: isGlobalAdmin } = await db
          .from('users')
          .select('role')
          .eq('id', assignedUserId)
          .single();

        if (!isGlobalAdmin || isGlobalAdmin.role !== 'admin') {
          return res.status(400).json({ error: 'Target assignee is not a member of this project space' });
        }
      }
    }

    const { data: newTask, error } = await db
      .from('tasks')
      .insert({
        title,
        description,
        status: status || 'todo',
        priority: priority || 'medium',
        project_id: pId,
        assigned_to: assignedUserId,
        created_by: req.user.id,
        due_date: due_date || null
      })
      .select(`
        *,
        project:projects (id, name),
        assignee:users!tasks_assigned_to_fkey (id, name, email),
        creator:users!tasks_created_by_fkey (id, name)
      `)
      .single();

    if (error) {
       return res.status(500).json({ error: 'Failed to create task', details: error.message });
    }

    return res.status(201).json({
      message: 'Task created successfully',
      task: newTask
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error creating task', details: err.message });
  }
});

// GET /api/tasks/:id -> Task details (accessible to project members or global admin)
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const taskId = parseInt(req.params.id, 10);
  if (isNaN(taskId)) {
    return res.status(400).json({ error: 'Invalid task ID format' });
  }

  try {
    const db = getSupabase();

    const { data: task, error: fetchError } = await db
      .from('tasks')
      .select(`
        *,
        project:projects (id, name),
        assignee:users!tasks_assigned_to_fkey (id, name, email),
        creator:users!tasks_created_by_fkey (id, name)
      `)
      .eq('id', taskId)
      .single();

    if (fetchError || !task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Access authorization check: must be a member of the task's project, or global admin
    if (req.user.role !== 'admin') {
      const { data: memberRecord, error: checkError } = await db
        .from('project_members')
        .select('role')
        .eq('project_id', task.project_id)
        .eq('user_id', req.user.id)
        .maybeSingle();

      if (checkError) {
        return res.status(500).json({ error: 'Database check failed', details: checkError.message });
      }

      if (!memberRecord) {
        return res.status(403).json({ error: 'Forbidden: You do not have access to this task workspace' });
      }
    }

    return res.status(200).json(task);
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error retrieving task details', details: err.message });
  }
});

// PUT /api/tasks/:id -> Update task. 
// Admin or Project Admin can edit ALL fields; Member can edit the status of tasks assigned to them only.
router.put('/:id', authenticateToken, validateTask, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const taskId = parseInt(req.params.id, 10);
  if (isNaN(taskId)) {
    return res.status(400).json({ error: 'Invalid task ID format' });
  }

  const { title, description, status, priority, assigned_to, due_date } = req.body;

  try {
    const db = getSupabase();

    // 1. Fetch current task state
    const { data: task, error: fetchError } = await db
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (fetchError || !task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // 2. Resolve requester authority role inside the project
    let isAuthorizedAdmin = false;

    if (req.user.role === 'admin') {
      isAuthorizedAdmin = true;
    } else {
      const { data: projectMemberRecord } = await db
        .from('project_members')
        .select('role')
        .eq('project_id', task.project_id)
        .eq('user_id', req.user.id)
        .maybeSingle();

      if (!projectMemberRecord) {
        return res.status(403).json({ error: 'Forbidden: You are not a member of this project space' });
      }

      if (projectMemberRecord.role === 'admin') {
        isAuthorizedAdmin = true;
      }
    }

    let updateData: any = {};

    // 3. Apply RBAC rules
    if (isAuthorizedAdmin) {
      // Admin update access -> allowed to update all fields
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (status !== undefined) updateData.status = status;
      if (priority !== undefined) updateData.priority = priority;
      if (due_date !== undefined) updateData.due_date = due_date || null;

      if (assigned_to !== undefined) {
        const assignedUserId = assigned_to ? parseInt(assigned_to, 10) : null;
        if (assignedUserId) {
          // Double check assignee is a member of the project
          const { data: isMember } = await db
            .from('project_members')
            .select('id')
            .eq('project_id', task.project_id)
            .eq('user_id', assignedUserId)
            .maybeSingle();

          if (!isMember) {
            // Check global admin
            const { data: isGlobalAdmin } = await db
              .from('users')
              .select('role')
              .eq('id', assignedUserId)
              .single();

            if (!isGlobalAdmin || isGlobalAdmin.role !== 'admin') {
              return res.status(400).json({ error: 'Target assignee is not a member of this project space' });
            }
          }
        }
        updateData.assigned_to = assignedUserId;
      }
    } else {
      // Member update access -> can only edit status, and only if assigned to them
      if (task.assigned_to !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden: You can only update the status of tasks assigned to you' });
      }

      // If they passed other fields, let's warn or restrict. We only write status!
      if (title !== undefined || description !== undefined || priority !== undefined || assigned_to !== undefined || due_date !== undefined) {
        return res.status(403).json({ error: 'Forbidden: Members are only permitted to update the status of their assigned tasks' });
      }

      if (status === undefined) {
        return res.status(400).json({ error: 'Status is required for update' });
      }

      updateData.status = status;
    }

    // 4. Fire update
    const { data: updatedTask, error: updateError } = await db
      .from('tasks')
      .update(updateData)
      .eq('id', taskId)
      .select(`
        *,
        project:projects (id, name),
        assignee:users!tasks_assigned_to_fkey (id, name, email),
        creator:users!tasks_created_by_fkey (id, name)
      `)
      .single();

    if (updateError) {
      return res.status(500).json({ error: 'Failed to update task state', details: updateError.message });
    }

    return res.status(200).json({
      message: 'Task updated successfully',
      task: updatedTask
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error updating task', details: err.message });
  }
});

// DELETE /api/tasks/:id -> Delete task (project admin or global admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const taskId = parseInt(req.params.id, 10);
  if (isNaN(taskId)) {
    return res.status(400).json({ error: 'Invalid task ID format' });
  }

  try {
    const db = getSupabase();

    const { error } = await db
      .from('tasks')
      .delete()
      .eq('id', taskId);

    if (error) {
      return res.status(500).json({ error: 'Failed to delete task', details: error.message });
    }

    return res.status(200).json({ message: 'Task deleted successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error deleting task', details: err.message });
  }
});

export default router;
