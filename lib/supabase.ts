// === FILENAME: lib/supabase.ts ===

import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

let poolInstance: pg.Pool | null = null;
let initPromise: Promise<void> | null = null;

export function getPool(): pg.Pool {
  if (!poolInstance) {
    let connectionString = process.env.DATABASE_URL || process.env.SUPABASE_URL;
    
    // Fallback directly to the user's Supabase PostgreSQL endpoint if unspecified or a placeholder REST URL
    if (!connectionString || (!connectionString.startsWith('postgres://') && !connectionString.startsWith('postgresql://'))) {
      connectionString = process.env.DATABASE_URL || '';
    }

    poolInstance = new pg.Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      }
    });

    // Auto-setup database schemas and dummy accounts safely
    initPromise = initDb(poolInstance).catch(err => {
      console.error('Database self-healing initialization failed:', err);
    });
  }
  return poolInstance;
}

export function getSupabase(): any {
  return {
    from(table: string) {
      return new QueryBuilder(table);
    }
  };
}

async function attachRelations(pool: pg.Pool, table: string, rows: any[]) {
  if (!rows || rows.length === 0) return;

  // 1. Fetch Users if any of the target ID lists are populated
  const creatorIds = table === 'projects' || table === 'tasks' ? [...new Set(rows.map(r => r.created_by).filter(Boolean))] : [];
  const assigneeIds = table === 'tasks' ? [...new Set(rows.map(r => r.assigned_to).filter(Boolean))] : [];
  const memberUserIds = table === 'project_members' ? [...new Set(rows.map(r => r.user_id).filter(Boolean))] : [];
  
  const allUserIds = [...new Set([...creatorIds, ...assigneeIds, ...memberUserIds])];
  let userMap = new Map<number, any>();

  if (allUserIds.length > 0) {
    try {
      const usersRes = await pool.query(
        `SELECT id, name, email, role, created_at FROM users WHERE id IN (${allUserIds.map((_, i) => `$${i + 1}`).join(', ')})`,
        allUserIds.map(Number)
      );
      userMap = new Map(usersRes.rows.map(u => [Number(u.id), u]));
    } catch (e) {
      console.error('Failed to load related users in attachRelations:', e);
    }
  }

  // 2. Fetch Projects if needed
  const projectIds = table === 'tasks' || table === 'project_members' ? [...new Set(rows.map(r => r.project_id).filter(Boolean))] : [];
  let projectMap = new Map<number, any>();

  if (projectIds.length > 0) {
    try {
      const projectsRes = await pool.query(
        `SELECT id, name, description, created_by, created_at FROM projects WHERE id IN (${projectIds.map((_, i) => `$${i + 1}`).join(', ')})`,
        projectIds.map(Number)
      );
      
      const rawProjects = projectsRes.rows;
      
      // We should populate creator for these projects too!
      const projCreatorIds = [...new Set(rawProjects.map(p => p.created_by).filter(Boolean))];
      if (projCreatorIds.length > 0) {
        const creatorsRes = await pool.query(
          `SELECT id, name, email, role FROM users WHERE id IN (${projCreatorIds.map((_, i) => `$${i + 1}`).join(', ')})`,
          projCreatorIds.map(Number)
        );
        const creatorMap = new Map(creatorsRes.rows.map(u => [Number(u.id), u]));
        for (const p of rawProjects) {
          p.creator = creatorMap.get(Number(p.created_by)) || null;
        }
      } else {
        for (const p of rawProjects) {
          p.creator = null;
        }
      }

      projectMap = new Map(rawProjects.map(p => [Number(p.id), p]));
    } catch (e) {
      console.error('Failed to load related projects in attachRelations:', e);
    }
  }

  // 3. Attach properties to the rows
  for (const row of rows) {
    if (table === 'projects') {
      row.creator = userMap.get(Number(row.created_by)) || null;
    } else if (table === 'project_members') {
      row.user = userMap.get(Number(row.user_id)) || null;
      row.projects = projectMap.get(Number(row.project_id)) || null;
    } else if (table === 'tasks') {
      row.project = projectMap.get(Number(row.project_id)) || null;
      row.assignee = userMap.get(Number(row.assigned_to)) || null;
      row.creator = userMap.get(Number(row.created_by)) || null;
    }
  }
}

class QueryBuilder {
  private table: string;
  private action: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private selectFields: string = '*';
  private filterEq: Record<string, any> = {};
  private filterIn: Record<string, any[]> = {};
  private orderByCol: string | null = null;
  private orderAscending: boolean = false;
  private insertData: any = null;
  private updateData: any = null;
  private isSingle: boolean = false;
  private isMaybeSingle: boolean = false;
  private limitCount: number | null = null;

  constructor(table: string) {
    this.table = table;
  }

  select(fields: string = '*') {
    this.selectFields = fields;
    return this;
  }

  eq(column: string, value: any) {
    this.filterEq[column] = value;
    return this;
  }

  in(column: string, values: any[]) {
    this.filterIn[column] = values;
    return this;
  }

  insert(data: any) {
    this.action = 'insert';
    this.insertData = data;
    return this;
  }

  update(data: any) {
    this.action = 'update';
    this.updateData = data;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderByCol = column;
    this.orderAscending = options?.ascending ?? true;
    return this;
  }

  limit(n: number) {
    this.limitCount = n;
    return this;
  }

  single() {
    this.isSingle = true;
    this.isMaybeSingle = false;
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    this.isSingle = false;
    return this;
  }

  async then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    try {
      const res = await this.execute();
      if (onfulfilled) return onfulfilled(res);
      return res;
    } catch (err) {
      if (onrejected) return onrejected(err);
      throw err;
    }
  }

  private async execute() {
    const pool = getPool();
    if (initPromise) {
      await initPromise;
    }

    let sql = '';
    const boundParams: any[] = [];
    let paramIndex = 1;

    // Helper to build where clause constraints & push their bound params in order
    const buildWhereClause = () => {
      let whereClauses: string[] = [];

      for (const [col, val] of Object.entries(this.filterEq)) {
        if (val === null) {
          whereClauses.push(`${col} IS NULL`);
        } else {
          whereClauses.push(`${col} = $${paramIndex++}`);
          if (col === 'id' || col === 'project_id' || col === 'user_id' || col === 'assigned_to' || col === 'created_by') {
            boundParams.push(val === 'undefined' ? null : Number(val));
          } else {
            boundParams.push(val);
          }
        }
      }

      for (const [col, vals] of Object.entries(this.filterIn)) {
        if (!vals || vals.length === 0) {
          whereClauses.push('FALSE');
        } else {
          const mappedVals = vals.map(v => {
            if (col === 'id' || col === 'project_id' || col === 'user_id' || col === 'assigned_to' || col === 'created_by') {
              return Number(v);
            }
            return v;
          });
          const placeholders = mappedVals.map(() => `$${paramIndex++}`).join(', ');
          whereClauses.push(`${col} IN (${placeholders})`);
          boundParams.push(...mappedVals);
        }
      }

      return whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    };

    try {
      let rows: any[] = [];

      if (this.action === 'select') {
        const whereSql = buildWhereClause();
        sql = `SELECT * FROM ${this.table} ${whereSql}`;
        if (this.orderByCol) {
          sql += ` ORDER BY ${this.orderByCol} ${this.orderAscending ? 'ASC' : 'DESC'}`;
        }
        const res = await pool.query(sql, boundParams);
        rows = res.rows;
        await attachRelations(pool, this.table, rows);

      } else if (this.action === 'insert') {
        // No WHERE clauses in insert
        const keys = Object.keys(this.insertData);
        const vals = Object.values(this.insertData);
        const placeholders = keys.map(() => `$${paramIndex++}`).join(', ');
        
        const coercedVals = vals.map((v, idx) => {
          const key = keys[idx];
          if (key === 'id' || key === 'project_id' || key === 'assigned_to' || key === 'created_by' || key === 'user_id') {
            return v === null ? null : Number(v);
          }
          return v;
        });

        sql = `INSERT INTO ${this.table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`;
        const res = await pool.query(sql, coercedVals);
        rows = res.rows;
        await attachRelations(pool, this.table, rows);

      } else if (this.action === 'update') {
        // In UPDATE, build SET clause first so that UPDATE params have lower parameter indices (e.g. $1)
        const keys = Object.keys(this.updateData);
        const vals = Object.values(this.updateData);

        const coercedVals = vals.map((v, idx) => {
          const key = keys[idx];
          if (key === 'id' || key === 'project_id' || key === 'assigned_to' || key === 'created_by' || key === 'user_id') {
            return v === null ? null : Number(v);
          }
          return v;
        });

        const setClauses = keys.map((k) => `${k} = $${paramIndex++}`).join(', ');
        boundParams.push(...coercedVals);

        // Build WHERE clause, values will get subsequent indices
        const whereSql = buildWhereClause();

        sql = `UPDATE ${this.table} SET ${setClauses} ${whereSql} RETURNING *`;
        const res = await pool.query(sql, boundParams);
        rows = res.rows;
        await attachRelations(pool, this.table, rows);

      } else if (this.action === 'delete') {
        const whereSql = buildWhereClause();
        sql = `DELETE FROM ${this.table} ${whereSql} RETURNING *`;
        const res = await pool.query(sql, boundParams);
        rows = res.rows;
      }

      if (this.limitCount !== null) {
        rows = rows.slice(0, this.limitCount);
      }

      // Handle single or maybe single result requests
      if (this.isSingle || this.isMaybeSingle) {
        return { data: rows[0] || null, error: null };
      }

      return { data: rows, error: null };
    } catch (err: any) {
      console.error(`Postgres execution error on table ${this.table}:`, err);
      return { data: null, error: { message: err.message || String(err) } };
    }
  }
}

async function initDb(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    // 1. Establish Schema tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_members (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
        CONSTRAINT unique_project_member UNIQUE(project_id, user_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
        priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        due_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. Perform seed checks
    const countRes = await client.query('SELECT COUNT(*) FROM users');
    const userCount = parseInt(countRes.rows[0].count, 10);
    if (userCount === 0) {
      console.log('Seeding default administrator and team member credentials to database...');
      const adminPasswordHash = await bcrypt.hash('Admin@123', 10);
      const memberPasswordHash = await bcrypt.hash('Member@123', 10);

      const insUsers = await client.query(`
        INSERT INTO users (name, email, password, role)
        VALUES 
          ('Jane Admin', 'admin@demo.com', $1, 'admin'),
          ('John Member', 'member@demo.com', $2, 'member')
        RETURNING id, name, email, role
      `, [adminPasswordHash, memberPasswordHash]);

      const adminUser = insUsers.rows.find(u => u.role === 'admin');
      const memberUser = insUsers.rows.find(u => u.role === 'member');

      if (adminUser && memberUser) {
        // Create initial Website Redesign project folder
        const projRes = await client.query(`
          INSERT INTO projects (name, description, created_by)
          VALUES ('Website Redesign', 'Complete overhaul of corporate digital presence including a modern responsive UI/UX and microservice backend architecture integrations.', $1)
          RETURNING id
        `, [adminUser.id]);
        
        const projectId = projRes.rows[0].id;

        // Associate user permissions inside team workspace
        await client.query(`
          INSERT INTO project_members (project_id, user_id, role)
          VALUES 
            ($1, $2, 'admin'),
            ($1, $3, 'member')
        `, [projectId, adminUser.id, memberUser.id]);

        // Mock tasks entries
        const overdueDate = new Date();
        overdueDate.setDate(overdueDate.getDate() - 2);
        const overdueDateStr = overdueDate.toISOString().split('T')[0];

        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 5);
        const futureDateStr = futureDate.toISOString().split('T')[0];

        await client.query(`
          INSERT INTO tasks (title, description, status, priority, project_id, assigned_to, created_by, due_date)
          VALUES 
            ('Design Brand Identity and Styleguides', 'Establish typography scale, color pallets, and asset components using Figma guidelines.', 'done', 'high', $1, $2, $2, $3),
            ('Implement API Gateways and Routers', 'Integrates token middleware with rate limiting for robust backend communication checks.', 'in_progress', 'medium', $1, $4, $2, $5),
            ('Perform System Security Audits', 'Confirm SQL parameterization checks and CORS settings are validated correctly.', 'todo', 'high', $1, $4, $2, $3)
        `, [projectId, adminUser.id, overdueDateStr, memberUser.id, futureDateStr]);

        console.log('✅ Default demo tables seeded successfully.');
      }
    }
  } catch (err) {
    console.error('Core schema or seed validation fault occurred:', err);
  } finally {
    client.release();
  }
}
