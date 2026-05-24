// === FILENAME: routes/projects.ts ===

import express, { Response } from 'express';
import { getSupabase } from '../lib/supabase';
import { validateProject, validateMember } from '../middleware/validate';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

// GET /api/projects -> List all projects the logged-in user belongs to (or all if global admin)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const db = getSupabase();

    if (req.user.role === 'admin') {
      // Global Admin views all projects
      const { data: projects, error } = await db
        .from('projects')
        .select(`
          *,
          creator:users!projects_created_by_fkey (id, name, email)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: 'Failed to retrieve projects', details: error.message });
      }

      // Format to include member status (e.g. they are global admin so let's mark role as admin)
      const formattedProjects = projects.map(p => ({
        ...p,
        user_role: 'admin'
      }));

      return res.status(200).json(formattedProjects);
    } else {
      // Regular user gets only projects they belong to
      const { data: memberships, error } = await db
        .from('project_members')
        .select(`
          role,
          projects (
            *,
            creator:users!projects_created_by_fkey (id, name, email)
          )
        `)
        .eq('user_id', req.user.id);

      if (error) {
        return res.status(500).json({ error: 'Failed to retrieve your projects', details: error.message });
      }

      const formattedProjects = memberships
        .filter(m => m.projects !== null)
        .map(m => {
          const proj: any = m.projects;
          return {
            ...proj,
            user_role: m.role
          };
        });

      return res.status(200).json(formattedProjects);
    }
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error retrieving projects', details: err.message });
  }
});

// POST /api/projects -> Create project (global admin only per RBAC, auto-add creator as project admin)
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  // Only global admin can create projects
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only global system administrators can create projects' });
  }

  const { name, description } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const db = getSupabase();

    // 1. Create the project
    const { data: newProject, error: projectError } = await db
      .from('projects')
      .insert({
        name,
        description,
        created_by: req.user.id
      })
      .select()
      .single();

    if (projectError || !newProject) {
      return res.status(500).json({ error: 'Failed to create project', details: projectError?.message });
    }

    // 2. Auto-add creator as project admin
    const { error: memberError } = await db
      .from('project_members')
      .insert({
        project_id: newProject.id,
        user_id: req.user.id,
        role: 'admin'
      });

    if (memberError) {
      // Cleanup project if member insert failed
      await db.from('projects').delete().eq('id', newProject.id);
      return res.status(500).json({ error: 'Failed to self-assign as project administrator', details: memberError.message });
    }

    return res.status(201).json({
      message: 'Project created successfully',
      project: {
        ...newProject,
        user_role: 'admin'
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error creating project', details: err.message });
  }
});

// GET /api/projects/:id -> Project details + members list (accessible to project members or global admin)
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) {
    return res.status(400).json({ error: 'Invalid project ID format' });
  }

  try {
    const db = getSupabase();

    // 1. Access verification: satisfy either global admin or project member
    let userRoleInProject = 'member';
    if (req.user.role !== 'admin') {
      const { data: memberRecord, error: checkError } = await db
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', req.user.id)
        .maybeSingle();

      if (checkError) {
        return res.status(500).json({ error: 'Access check failed', details: checkError.message });
      }

      if (!memberRecord) {
        return res.status(403).json({ error: 'Forbidden: You do not have access to this project space' });
      }
      userRoleInProject = memberRecord.role;
    } else {
      userRoleInProject = 'admin';
    }

    // 2. Retrieve project details
    const { data: project, error: projectError } = await db
      .from('projects')
      .select(`
        *,
        creator:users!projects_created_by_fkey (id, name, email)
      `)
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // 3. Retrieve all members associated with this project
    const { data: members, error: membersError } = await db
      .from('project_members')
      .select(`
        id,
        role,
        user_id,
        user:users!project_members_user_id_fkey (id, name, email)
      `)
      .eq('project_id', projectId);

    if (membersError) {
      return res.status(500).json({ error: 'Failed to retrieve project members', details: membersError.message });
    }

    // Format member entries nicely
    const formattedMembers = members.map(m => ({
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      name: (m.user as any)?.name || 'Unknown',
      email: (m.user as any)?.email || 'Unknown'
    }));

    return res.status(200).json({
      project: {
        ...project,
        user_role: userRoleInProject
      },
      members: formattedMembers
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error retrieving project details', details: err.message });
  }
});

// PUT /api/projects/:id -> Update project name/description (project admin or global admin only)
router.put('/:id', authenticateToken, requireAdmin, validateProject, async (req: AuthenticatedRequest, res: Response) => {
  const projectId = parseInt(req.params.id, 10);
  const { name, description } = req.body;

  try {
    const db = getSupabase();

    const { data: updatedProject, error } = await db
      .from('projects')
      .update({ name, description })
      .eq('id', projectId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to update project details', details: error.message });
    }

    return res.status(200).json({
      message: 'Project updated successfully',
      project: updatedProject
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error updating project space', details: err.message });
  }
});

// DELETE /api/projects/:id -> Delete project + cascade (project admin or global admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const projectId = parseInt(req.params.id, 10);

  try {
    const db = getSupabase();

    const { error } = await db
      .from('projects')
      .delete()
      .eq('id', projectId);

    if (error) {
      return res.status(500).json({ error: 'Failed to delete project', details: error.message });
    }

    return res.status(200).json({ message: 'Project space and associated objects deleted successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error deleting project space', details: err.message });
  }
});

// POST /api/projects/:id/members -> Add a user to project by email (project admin or global admin only)
router.post('/:id/members', authenticateToken, requireAdmin, validateMember, async (req: AuthenticatedRequest, res: Response) => {
  const projectId = parseInt(req.params.id, 10);
  const { email, role } = req.body; // role can be 'admin' or 'member', defaults to 'member'

  const targetRole = role || 'member';
  if (!['admin', 'member'].includes(targetRole)) {
    return res.status(400).json({ error: 'Invalid project-level member role specified' });
  }

  try {
    const db = getSupabase();

    // 1. Locate user in the system by email address
    const { data: targetUser, error: findError } = await db
      .from('users')
      .select('id, name, email')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (findError) {
      return res.status(500).json({ error: 'Database verification failed', details: findError.message });
    }

    if (!targetUser) {
      return res.status(404).json({ error: `No Team Member account registered with the email "${email}"` });
    }

    // 2. Check if already a member of this project
    const { data: existingMember, error: checkError } = await db
      .from('project_members')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', targetUser.id)
      .maybeSingle();

    if (checkError) {
      return res.status(500).json({ error: 'Database membership query failed', details: checkError.message });
    }

    if (existingMember) {
      return res.status(400).json({ error: 'User is already a registered member of this project space' });
    }

    // 3. Add to project
    const { data: newMember, error: insertError } = await db
      .from('project_members')
      .insert({
        project_id: projectId,
        user_id: targetUser.id,
        role: targetRole
      })
      .select()
      .single();

    if (insertError) {
      return res.status(500).json({ error: 'Failed to add member to the project', details: insertError.message });
    }

    return res.status(201).json({
      message: 'Member invitation completed successfully',
      member: {
        id: newMember.id,
        user_id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        role: targetRole
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error processing member invitation', details: err.message });
  }
});

// DELETE /api/projects/:id/members/:userId -> Remove member (project admin or global admin only)
router.delete('/:id/members/:userId', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const projectId = parseInt(req.params.id, 10);
  const targetUserId = parseInt(req.params.userId, 10);

  if (isNaN(projectId) || isNaN(targetUserId)) {
    return res.status(400).json({ error: 'Invalid project or User ID parameters' });
  }

  try {
    const db = getSupabase();

    // Optional safety: Prevent removing the last admin unless other admins are present?
    // Let's check how many members exist or simply compile deletion
    const { error } = await db
      .from('project_members')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', targetUserId);

    if (error) {
      return res.status(500).json({ error: 'Failed to remove user from project', details: error.message });
    }

    return res.status(200).json({ message: 'Member successfully removed from the project workspace' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Server error removing project member', details: err.message });
  }
});

export default router;
