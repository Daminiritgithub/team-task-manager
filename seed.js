// === FILENAME: seed.js ===

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('your-project')) {
  console.error('CRITICAL: Set valid SUPABASE_URL and SUPABASE_ANON_KEY env variables to run seed.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runSeed() {
  console.log('🚀 Starting Team Task Manager database seeding...');

  try {
    // 1. Create or verify accounts
    const adminEmail = 'admin@demo.com';
    const memberEmail = 'member@demo.com';

    // Hash passwords with 10 salt rounds
    const adminPasswordHash = await bcrypt.hash('Admin@123', 10);
    const memberPasswordHash = await bcrypt.hash('Member@123', 10);

    // Drop previous mock records to prevent conflicts and ensure a clean slate
    console.log('🧹 Cleaning existing demo records...');
    const { data: oldUsers } = await supabase
      .from('users')
      .select('id')
      .in('email', [adminEmail, memberEmail]);

    if (oldUsers && oldUsers.length > 0) {
      const oldUserIds = oldUsers.map(u => u.id);
      await supabase.from('tasks').delete().in('assigned_to', oldUserIds);
      await supabase.from('project_members').delete().in('user_id', oldUserIds);
      await supabase.from('projects').delete().in('created_by', oldUserIds);
      await supabase.from('users').delete().in('id', oldUserIds);
    }

    console.log('👥 Registering demo users...');
    const { data: insertedUsers, error: usersError } = await supabase
      .from('users')
      .insert([
        {
          name: 'Jane Admin',
          email: adminEmail,
          password: adminPasswordHash,
          role: 'admin',
        },
        {
          name: 'John Member',
          email: memberEmail,
          password: memberPasswordHash,
          role: 'member',
        },
      ])
      .select();

    if (usersError || !insertedUsers) {
      throw new Error(`Failed to seed users: ${usersError?.message}`);
    }

    const adminUser = insertedUsers.find(u => u.email === adminEmail);
    const memberUser = insertedUsers.find(u => u.email === memberEmail);

    console.log(`✅ Users created: ${adminUser.name} (${adminUser.id}), ${memberUser.name} (${memberUser.id})`);

    // 2. Create sample project
    console.log('📁 Creating sample project...');
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        name: 'Website Redesign',
        description: 'Complete overhaul of corporate digital presence including a modern responsive UI/UX and microservice backend architecture integrations.',
        created_by: adminUser.id,
      })
      .select()
      .single();

    if (projectError || !project) {
      throw new Error(`Failed to seed projects: ${projectError?.message}`);
    }

    console.log(`✅ Project created: "${project.name}" (ID: ${project.id})`);

    // 3. Add members to sample project
    console.log('🔗 Attaching project member roles...');
    const { error: membersError } = await supabase
      .from('project_members')
      .insert([
        {
          project_id: project.id,
          user_id: adminUser.id,
          role: 'admin',
        },
        {
          project_id: project.id,
          user_id: memberUser.id,
          role: 'member',
        },
      ]);

    if (membersError) {
      throw new Error(`Failed to seed project members: ${membersError.message}`);
    }
    console.log('✅ Members linked.');

    // 4. Create three sample tasks (including one OVERDUE task)
    console.log('📝 Initializing task items...');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const overdueDateStr = yesterday.toISOString().split('T')[0];

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 5);
    const futureDateStr = nextWeek.toISOString().split('T')[0];

    const { error: tasksError } = await supabase.from('tasks').insert([
      {
        title: 'Design Brand Identity and Styleguides',
        description: 'Establish typography scale, color pallets, and asset components using Figma guidelines.',
        status: 'done',
        priority: 'high',
        project_id: project.id,
        assigned_to: adminUser.id,
        created_by: adminUser.id,
        due_date: overdueDateStr, // completed successfully, so date is past but fine
      },
      {
        title: 'Implement API Gateways and Routers',
        description: 'Integrates token middleware with rate limiting for robust backend communication checks.',
        status: 'in_progress',
        priority: 'medium',
        project_id: project.id,
        assigned_to: memberUser.id,
        created_by: adminUser.id,
        due_date: futureDateStr,
      },
      {
        title: 'Perform System Security Audits',
        description: 'Confirm SQL parameterization checks and CORS settings are validated correctly.',
        status: 'todo',
        priority: 'high',
        project_id: project.id,
        assigned_to: memberUser.id,
        created_by: adminUser.id,
        due_date: overdueDateStr, // Uncompleted! Will highlight as OVERDUE red!
      },
    ]);

    if (tasksError) {
      throw new Error(`Failed to seed tasks: ${tasksError.message}`);
    }

    console.log('🎉 Seeding finished successfully! Preconfigured credentials:');
    console.log(`👉 ADMIN:  email: "${adminEmail}"  password: "Admin@123"`);
    console.log(`👉 MEMBER: email: "${memberEmail}" password: "Member@123"`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding process failed:', err);
    process.exit(1);
  }
}

runSeed();
