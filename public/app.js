// === FILENAME: public/app.js ===

// Core Application Client State
const state = {
  token: localStorage.getItem('token') || null,
  user: null,
  currentRoute: '#/dashboard',
  projects: [],
  workspaceUsers: []
};

// Initialize Current User State from LocalStorage
try {
  const cachedUser = localStorage.getItem('user');
  if (cachedUser) {
    state.user = JSON.parse(cachedUser);
  }
} catch (e) {
  console.error('Failed to parse cached user identity:', e);
}

// Global API Fetch Proxy with Automatic Authorization Headers and 401 Expiry Interceptors
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(state.token && { 'Authorization': `Bearer ${state.token}` }),
    ...options.headers
  };

  try {
    const res = await fetch(endpoint, { ...options, headers });
    
    // Auto-intercept Token Expiry / Unauthorized Access
    if (res.status === 401) {
      // Clear compromised/expired sessions
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      state.token = null;
      state.user = null;
      
      // Do not double toast if loading guest signup/login views
      if (!window.location.hash.includes('login') && !window.location.hash.includes('signup')) {
        showToast('Your session has expired. Please sign in to resume.', 'error');
        window.location.hash = '#/login';
      }
      updateSidebarAndNavbar();
      return null;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Server request execution failed');
    }
    return data;
  } catch (err) {
    showToast(err.message || 'Server communication offline. Check your connectivity.', 'error');
    console.error(`Communications fault encountered on [${endpoint}]:`, err);
    throw err;
  }
}

// Toast Notifier Helper (Slides in, Auto-Dismisses after 3s)
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `animate-toast-in pointer-events-auto flex items-center gap-3 p-4 rounded-xl shadow-lg border text-sm max-w-sm w-full bg-white transition-all duration-300 transform`;
  
  let leftBorderColor = 'border-slate-200';
  let iconHtml = '';

  if (type === 'success') {
    leftBorderColor = 'border-l-4 border-l-green-500 border-slate-100';
    iconHtml = `
      <div class="h-6 w-6 rounded-full bg-green-50 flex items-center justify-center text-green-500 font-bold flex-shrink-0">
        ✓
      </div>
    `;
  } else if (type === 'error') {
    leftBorderColor = 'border-l-4 border-l-rose-500 border-slate-100';
    iconHtml = `
      <div class="h-6 w-6 rounded-full bg-rose-50 flex items-center justify-center text-rose-500 font-bold flex-shrink-0">
        ✕
      </div>
    `;
  } else {
    leftBorderColor = 'border-l-4 border-l-amber-500 border-slate-100';
    iconHtml = `
      <div class="h-6 w-6 rounded-full bg-amber-50 flex items-center justify-center text-amber-500 font-bold flex-shrink-0">
        ⚠️
      </div>
    `;
  }

  toast.innerHTML = `
    ${iconHtml}
    <div class="flex-1 font-medium text-slate-700 pr-2">${message}</div>
    <button class="text-slate-405 hover:text-slate-700 font-bold text-xs" onclick="this.parentElement.remove()">✕</button>
  `;

  // Prepend border attributes
  leftBorderColor.split(' ').forEach(cls => toast.classList.add(cls));

  container.appendChild(toast);

  // Auto remove after 3.2 seconds
  setTimeout(() => {
    toast.classList.add('opacity-0');
    toast.classList.add('translate-x-full');
    setTimeout(() => toast.remove(), 320);
  }, 3200);
}

// Global Loading Indicator Manager
function setLoading(isLoading) {
  const loader = document.getElementById('global-loader');
  if (!loader) return;
  if (isLoading) {
    loader.classList.remove('hidden');
  } else {
    loader.classList.add('hidden');
  }
}

// Format Dates cleanly (eg: "May 24, 2026" or "Overdue")
function formatDate(dateStr, isWithAlert = false) {
  if (!dateStr) return 'No due date';
  
  const dateObj = new Date(dateStr);
  if (isNaN(dateObj.getTime())) return dateStr;

  const todayStr = new Date().toISOString().split('T')[0];
  const isOverdue = dateStr < todayStr;

  const formatted = dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });

  if (isOverdue && isWithAlert) {
    return `<span class="text-red-500 font-semibold cursor-help flex items-center gap-1" title="Deadline was reached!">${formatted} (Overdue)</span>`;
  }
  return formatted;
}

// Format UTC Date for form fields (returns "YYYY-MM-DD")
function formatFormDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.split('T')[0];
}

// Refresh dynamic visual metrics on Top Nav or User Profile Footer
function updateSidebarAndNavbar() {
  const sidebar = document.getElementById('sidebar');
  const topNavbar = document.getElementById('top-navbar');

  if (state.token && state.user) {
    // Show system elements
    sidebar.classList.remove('hidden');
    sidebar.classList.add('flex');
    topNavbar.classList.remove('hidden');
    topNavbar.classList.add('flex');

    // Populate user profile footer details
    const uname = document.getElementById('username-display');
    const urole = document.getElementById('role-badge');
    const uinitials = document.getElementById('user-avatar-initials');

    if (uname) uname.textContent = state.user.name;
    if (urole) {
      urole.textContent = state.user.role;
      if (state.user.role === 'admin') {
        urole.className = "px-1.5 py-0.2 bg-slate-100 text-[10px] uppercase font-bold tracking-wider rounded text-slate-800 border border-slate-200 shadow-xs";
      } else {
        urole.className = "px-1.5 py-0.2 bg-slate-800 text-[10px] uppercase font-bold tracking-wider rounded text-slate-450 border border-slate-750";
      }
    }
    if (uinitials) {
      const parts = state.user.name.split(' ');
      uinitials.textContent = parts.map(p => p[0]).slice(0, 2).join('').toUpperCase();
    }
  } else {
    // Hide system elements
    sidebar.classList.add('hidden');
    sidebar.classList.remove('flex');
    topNavbar.classList.add('hidden');
    topNavbar.classList.remove('flex');
  }

  // Update dynamic clock in Header with live session time
  updateLiveClock();
}

// Live Session UTC Clock Counter
function updateLiveClock() {
  const clock = document.getElementById('dashboard-clock');
  const headerTime = document.getElementById('header-time');
  const now = new Date();
  
  // Create beautiful UTC date string (e.g. "2026-05-24 12:23:02")
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = String(now.getUTCHours()).padStart(2, '0');
  const min = String(now.getUTCMinutes()).padStart(2, '0');
  const sec = String(now.getUTCSeconds()).padStart(2, '0');

  const currentUTCStr = `${year}-${month}-${day} ${hour}:${min}:${sec}`;
  
  if (clock) clock.textContent = `${hour}:${min}:${sec}`;
  if (headerTime) headerTime.textContent = `${year}-${month}-${day} ${hour}:${min}`;
}
setInterval(updateLiveClock, 1000);

// Populate Teammate Selection Boxes automatically
async function loadWorkspaceUsers() {
  if (!state.token) return;
  try {
    const users = await apiFetch('/api/users');
    if (users) {
      state.workspaceUsers = users;
    }
  } catch (e) {
    console.error('Failed to retrieve teammates workspace list:', e);
  }
}

// =================================================================
// ==================== SCREEN ROUTING RENDERERS ====================
// =================================================================

async function renderScreen(route) {
  state.currentRoute = route;

  // Global Auth Gate checking
  const isGuestRoute = route === '#/login' || route === '#/signup';
  
  if (!state.token && !isGuestRoute) {
    // Attempting to visit secure views without validation
    state.currentRoute = '#/login';
    window.location.hash = '#/login';
    return;
  }

  if (state.token && isGuestRoute) {
    // Secure user accessing login pages
    state.currentRoute = '#/dashboard';
    window.location.hash = '#/dashboard';
    return;
  }

  // Hide all screens
  document.querySelectorAll('#screens > section').forEach(sec => sec.classList.add('hidden'));

  // Update navbar layout
  updateSidebarAndNavbar();

  // Highlight active sidebar navigation indicators
  document.querySelectorAll('.nav-item').forEach(link => {
    if (link.getAttribute('href') === route) {
      link.classList.add('nav-item-active');
    } else {
      link.classList.remove('nav-item-active');
    }
  });

  // Render target screen specifically
  const parts = route.split('/');
  const baseRoute = parts[1] || '';
  const paramId = parts[2] || null;

  setLoading(true);

  try {
    if (state.token && state.workspaceUsers.length === 0) {
      await loadWorkspaceUsers();
    }

    switch (baseRoute) {
      case 'login':
        document.getElementById('screen-login').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Workspace Authentication';
        break;
      
      case 'signup':
        document.getElementById('screen-signup').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Workspace Onboarding';
        break;

      case 'dashboard':
        await loadDashboardView();
        document.getElementById('screen-dashboard').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Teammate Analytics Panel';
        break;

      case 'projects':
        if (paramId) {
          await loadProjectDetailView(paramId);
          document.getElementById('screen-project-detail').classList.remove('hidden');
        } else {
          await loadProjectsView();
          document.getElementById('screen-projects').classList.remove('hidden');
          document.getElementById('page-title').textContent = 'Workspace Folders';
        }
        break;

      case 'tasks':
        await loadTasksView();
        document.getElementById('screen-tasks').classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Task Registry Logs';
        break;

      default:
        // Fallback fallback
        window.location.hash = '#/dashboard';
        break;
    }
  } catch (err) {
    console.error('Core rendering failure on route ' + route, err);
  } finally {
    setLoading(false);
  }
}

// ---------------------- 1. DASHBOARD CONTROLLER ----------------------
async function loadDashboardView() {
  const data = await apiFetch('/api/dashboard');
  if (!data) return;

  // Render stats
  document.getElementById('stat-total-tasks').textContent = data.totalTasks;
  document.getElementById('stat-my-tasks').textContent = data.myTasks;
  document.getElementById('stat-todo-tasks').textContent = data.byStatus.todo || 0;
  document.getElementById('stat-progress-tasks').textContent = data.byStatus.in_progress || 0;
  document.getElementById('stat-done-tasks').textContent = data.byStatus.done || 0;
  document.getElementById('stat-overdue-tasks').textContent = data.overdue;
  document.getElementById('stat-project-count').textContent = `${data.projects} Active Projects`;

  // Welcome user banner
  document.getElementById('dashboard-welcome-heading').textContent = `Hello, ${state.user.name.split(' ')[0]}!`;

  // Highlight overdue in crimson red if count exceeds zero
  const overdueCard = document.getElementById('card-stat-overdue');
  const overdueLabel = document.getElementById('label-stat-overdue');
  const overdueStat = document.getElementById('stat-overdue-tasks');
  if (data.overdue > 0) {
    overdueCard.className = "bg-rose-50 p-5 rounded-2xl shadow-xs border border-rose-200 flex flex-col justify-between animate-pulse";
    overdueLabel.className = "text-xs font-semibold text-rose-500 uppercase tracking-wider";
    overdueStat.className = "font-display font-bold text-3xl text-rose-600";
  } else {
    overdueCard.className = "bg-white p-5 rounded-2xl shadow-xs border border-slate-200 flex flex-col justify-between";
    overdueLabel.className = "text-xs font-semibold text-slate-400 uppercase tracking-wider";
    overdueStat.className = "font-display font-bold text-3xl text-slate-900";
  }

  // Dashboard Action buttons for admins
  const actionContainer = document.getElementById('dashboard-actions');
  actionContainer.innerHTML = '';
  if (state.user.role === 'admin') {
    actionContainer.innerHTML = `
      <button class="bg-slate-950 text-white rounded-xl px-4 py-2.5 text-xs font-bold shadow-xs hover:bg-slate-850 transition" onclick="openProjectModal()">
        + Create Project
      </button>
    `;
  }

  // Render recent tasks inside table
  const tableBody = document.getElementById('dashboard-recent-tasks-body');
  const emptyState = document.getElementById('recent-tasks-empty');
  tableBody.innerHTML = '';

  if (!data.recentTasks || data.recentTasks.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    data.recentTasks.forEach(task => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50/50 transition cursor-pointer';
      tr.onclick = () => openTaskDetailsView(task.id);

      const statusBadge = getStatusBadge(task.status);
      const priorityBadge = getPriorityBadge(task.priority);
      const taskAssignee = task.assignee ? task.assignee.name : '<span class="text-slate-400 italic">Unassigned</span>';

      tr.innerHTML = `
        <td class="px-6 py-4.5">
          <div class="font-semibold text-slate-850 tracking-tight leading-snug">${task.title}</div>
          <div class="text-[10px] text-slate-400 font-mono mt-1 uppercase max-w-xs truncate">${task.project?.name || 'Workspace'}</div>
        </td>
        <td class="px-6 py-4.5 font-medium text-slate-600">${taskAssignee}</td>
        <td class="px-4 py-4.5">${priorityBadge}</td>
        <td class="px-4 py-4.5">${statusBadge}</td>
        <td class="px-6 py-4.5 text-right">
          <button class="text-xs font-medium text-slate-600 hover:text-slate-950 border border-slate-250 py-1.5 px-3 rounded-lg hover:bg-white transition" onclick="event.stopPropagation(); openTaskDetailsView(${task.id})">
            Details
          </button>
        </td>
      `;
      tableBody.appendChild(tr);
    });
  }
}

// ---------------------- 2. PROJECTS LIST VIEW CONTROLLER ----------------------
async function loadProjectsView() {
  const projects = await apiFetch('/api/projects');
  if (!projects) return;

  state.projects = projects;

  const grid = document.getElementById('projects-grid');
  const empty = document.getElementById('projects-empty');
  grid.innerHTML = '';

  // Setup Admin actions based on RBAC rules
  const actionContainer = document.getElementById('project-actions-container');
  actionContainer.innerHTML = '';
  
  if (state.user.role === 'admin') {
    actionContainer.innerHTML = `
      <button class="bg-slate-900 text-white rounded-xl px-4 py-2.5 text-xs font-bold shadow-xs hover:bg-slate-850 transition" onclick="openProjectModal()">
        + Create Project
      </button>
    `;
    document.getElementById('project-empty-detail').innerHTML = `Launch active folders by clicking the <strong>Create Project</strong> button. Project configuration assigns creator as moderator automatically.`;
  } else {
    document.getElementById('project-empty-detail').textContent = `As a team member, ask your system administrator to allocate folder slots. Folder logs will display here once invited by email.`;
  }

  if (projects.length === 0) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    projects.forEach(proj => {
      const card = document.createElement('div');
      card.className = 'bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between';
      
      const adminBadge = proj.user_role === 'admin' 
        ? `<span class="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider bg-slate-100 text-slate-750 border border-slate-200 rounded">Mod</span>`
        : `<span class="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider bg-slate-50 text-slate-450 border border-slate-150 rounded">Guest</span>`;

      card.innerHTML = `
        <div class="p-6 space-y-4">
          <div class="flex items-start justify-between gap-4">
            <h3 class="font-display font-bold text-slate-900 text-lg leading-tight hover:underline cursor-pointer" onclick="window.location.hash = '#/projects/${proj.id}'">
              ${proj.name}
            </h3>
            ${adminBadge}
          </div>
          <p class="text-xs text-slate-500 leading-relaxed max-w-sm line-clamp-3">
            ${proj.description || '<span class="italic text-slate-400">No project description compiled.</span>'}
          </p>
        </div>
        <div class="px-6 py-4.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <div class="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Owner: <span class="text-slate-600 font-semibold">${proj.creator?.name || 'System Admin'}</span>
          </div>
          <a href="#/projects/${proj.id}" class="text-xs font-semibold text-slate-705 sm:text-slate-900 hover:underline">
            Manage Hub &rarr;
          </a>
        </div>
      `;
      grid.appendChild(card);
    });
  }
}

// ---------------------- 3. PROJECT DETAIL & KANBAN CONTROLLER ----------------------
async function loadProjectDetailView(projectId) {
  const data = await apiFetch(`/api/projects/${projectId}`);
  if (!data) return;

  const project = data.project;
  const members = data.members;

  // Assert user level role for this context (crucial for inline modals and edit operations!)
  project.user_role = project.user_role || 'member';

  // 1. Breadcrumb & Info Fields
  document.getElementById('breadcrumb-project-name').textContent = project.name;
  document.getElementById('detail-project-title').textContent = project.name;
  document.getElementById('detail-project-desc').textContent = project.description || 'No description allocated to folder.';
  document.getElementById('detail-project-owner').textContent = `${project.creator?.name || 'Jane Admin'} (${project.creator?.email || 'admin@demo.com'})`;

  // 2. Load member list sidebar
  const membersContainer = document.getElementById('project-members-list');
  const inviteBtnContainer = document.getElementById('member-invite-btn-container');
  membersContainer.innerHTML = '';
  inviteBtnContainer.innerHTML = '';

  const isModerator = state.user.role === 'admin' || project.user_role === 'admin';

  if (isModerator) {
    inviteBtnContainer.innerHTML = `
      <button class="p-1 px-2.5 text-xs font-bold border border-slate-205 rounded-xl hover:bg-slate-50 text-slate-850 flex items-center gap-1.5 transition" onclick="openMemberInviteModal(${projectId})">
        💡 Invite
      </button>
    `;
  }

  members.forEach(member => {
    const li = document.createElement('li');
    li.className = 'px-5 py-4 flex items-center justify-between gap-3 text-sm';

    const isTargetGlobalAdmin = member.role === 'admin' && state.user.id === member.user_id;
    const isMeLabel = state.user.id === member.user_id ? ' (You)' : '';

    const roleString = member.role === 'admin'
      ? `<span class="text-[9px] uppercase font-bold tracking-widest text-indigo-700 bg-indigo-50 px-1.5 rounded">Mod</span>`
      : `<span class="text-[9px] uppercase font-bold tracking-widest text-slate-450 bg-slate-50 px-1.5 rounded">Guest</span>`;

    let actionBtn = '';
    // Let moderators revoke memberships (but prevent self-revoke is optional or allowed with checks)
    if (isModerator && state.user.id !== member.user_id) {
      actionBtn = `
        <button class="text-[10px] text-red-500 hover:text-red-700 hover:bg-rose-50 px-2 py-1 rounded transition" onclick="removeProjectMember(${projectId}, ${member.user_id})">
          Revoke
        </button>
      `;
    }

    li.innerHTML = `
      <div class="min-w-0">
        <div class="font-semibold text-slate-900 flex items-center gap-1.5 leading-snug">
          ${member.name}${isMeLabel}
          ${roleString}
        </div>
        <div class="text-xs text-slate-400 font-mono mt-0.5 truncate">${member.email}</div>
      </div>
      <div>${actionBtn}</div>
    `;
    membersContainer.appendChild(li);
  });

  // 3. Project Admin Actions Header
  const projectControls = document.getElementById('detail-project-controls');
  projectControls.innerHTML = '';

  if (isModerator) {
    projectControls.innerHTML = `
      <button class="p-2 border border-slate-250 bg-white hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-650 flex items-center gap-1.5 transition" onclick="openProjectModal(${project.id})">
        Configure Details
      </button>
      <button class="p-2 border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition" onclick="deleteProject(${project.id})">
        🗑 Remove
      </button>
    `;
  }

  // 4. Kanban Action triggers
  const taskActions = document.getElementById('project-task-actions');
  taskActions.innerHTML = '';
  if (isModerator) {
    taskActions.innerHTML = `
      <button class="bg-slate-900 text-white rounded-xl px-4 py-2 text-xs font-bold hover:bg-slate-850 transition shadow-xs flex items-center gap-1" onclick="openTaskModal(null, ${projectId})">
        + Publish Task
      </button>
    `;
  }

  // 5. Fetch and compile Project Tasks
  const tasks = await apiFetch(`/api/tasks/project/${projectId}`);
  if (!tasks) return;

  const lists = {
    todo: document.getElementById('col-list-todo'),
    in_progress: document.getElementById('col-list-progress'),
    done: document.getElementById('col-list-done')
  };

  const counts = {
    todo: document.getElementById('col-count-todo'),
    in_progress: document.getElementById('col-count-progress'),
    done: document.getElementById('col-count-done')
  };

  // Safe sweeps
  Object.keys(lists).forEach(k => {
    lists[k].innerHTML = '';
    counts[k].textContent = '0';
  });

  const columnCounters = { todo: 0, in_progress: 0, done: 0 };

  tasks.forEach(task => {
    const listContainer = lists[task.status];
    if (!listContainer) return;

    columnCounters[task.status]++;

    const card = document.createElement('div');
    card.className = 'bg-white p-4 rounded-xl shadow-xs border border-slate-200 hover:border-slate-400 transition-all cursor-pointer space-y-3';
    card.onclick = () => openTaskDetailsView(task.id, project);

    const priorityBadge = getPriorityBadge(task.priority);
    const dateFormatted = task.due_date ? formatDate(task.due_date) : '';
    const todayStr = new Date().toISOString().split('T')[0];
    const isOverdueAlert = task.due_date && task.due_date < todayStr && task.status !== 'done';
    
    let dueHtml = '';
    if (task.due_date) {
      if (isOverdueAlert) {
         dueHtml = `
           <div class="flex items-center gap-1 text-[10px] font-mono text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded border border-red-150 w-max cursor-help" title="Deadlines missed!">
             ⏰ ${dateFormatted}
           </div>
         `;
      } else {
        dueHtml = `
           <div class="text-[10px] font-mono text-slate-450">
             📅 ${dateFormatted}
           </div>
         `;
      }
    }

    const assigneeName = task.assignee 
      ? `<span class="font-semibold text-slate-700">${task.assignee.name}</span>`
      : `<span class="italic text-slate-400">Unassigned</span>`;

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div class="font-semibold text-slate-850 text-sm tracking-tight leading-snug line-clamp-2">${task.title}</div>
        ${priorityBadge}
      </div>
      <p class="text-[11px] text-slate-450 line-clamp-2 leading-relaxed">
        ${task.description || 'No description provided.'}
      </p>
      <div class="pt-3 border-t border-slate-50 flex items-center justify-between text-[10px] leading-none">
        <div class="flex items-center gap-1 text-slate-450 h-max">
          👤 ${assigneeName}
        </div>
        ${dueHtml}
      </div>
    `;

    listContainer.appendChild(card);
  });

  // Assign counters
  Object.keys(columnCounters).forEach(k => {
    counts[k].textContent = columnCounters[k];
  });

  // Column empty states compilation
  Object.keys(lists).forEach(k => {
    if (lists[k].children.length === 0) {
      lists[k].innerHTML = `
        <div class="h-28 border border-dashed border-slate-300 rounded-xl flex items-center justify-center text-slate-400 text-xs text-center p-4 select-none">
          No tasks listed.
        </div>
      `;
    }
  });
}

// ---------------------- 4. TASKS MASTER LOG CONTROLLER ----------------------
async function loadTasksView() {
  // Populate projects filter selector dropdown
  const filterProjSel = document.getElementById('filter-project');
  const currentSelectedProj = filterProjSel.value;
  filterProjSel.innerHTML = '<option value="">All Workspaces</option>';
  
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (String(p.id) === currentSelectedProj) {
      opt.selected = true;
    }
    filterProjSel.appendChild(opt);
  });

  // Compile active parameters values
  const projectIdVal = filterProjSel.value;
  const statusVal = document.getElementById('filter-status').value;
  const priorityVal = document.getElementById('filter-priority').value;
  const onlyMeVal = document.getElementById('filter-assigned-me').checked;

  let queryUrl = `/api/tasks?`;
  if (projectIdVal) queryUrl += `projectId=${projectIdVal}&`;
  if (statusVal) queryUrl += `status=${statusVal}&`;
  if (priorityVal) queryUrl += `priority=${priorityVal}&`;
  if (onlyMeVal && state.user) queryUrl += `assigned_to=${state.user.id}&`;

  const tasks = await apiFetch(queryUrl);
  if (!tasks) return;

  const tableBody = document.getElementById('tasks-list-body');
  const emptyState = document.getElementById('tasks-empty');
  tableBody.innerHTML = '';

  if (tasks.length === 0) {
    emptyState.classList.remove('hidden');
    document.getElementById('tasks-table-card').classList.add('hidden');
  } else {
    emptyState.classList.add('hidden');
    document.getElementById('tasks-table-card').classList.remove('hidden');

    tasks.forEach(task => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50/50 transition cursor-pointer';
      tr.onclick = () => openTaskDetailsView(task.id);

      const statusBadge = getStatusBadge(task.status);
      const priorityBadge = getPriorityBadge(task.priority);
      const taskAssignee = task.assignee ? task.assignee.name : '<span class="text-slate-400 italic">Unassigned</span>';
      
      const dueFormatted = task.due_date ? formatDate(task.due_date, true) : '<span class="text-slate-400">None</span>';

      tr.innerHTML = `
        <td class="px-6 py-4">
          <div class="font-semibold text-slate-850 text-sm leading-snug tracking-tight">${task.title}</div>
          <div class="text-[10px] text-slate-400 max-w-xs truncate leading-relaxed mt-1">${task.description || 'No description detailed.'}</div>
        </td>
        <td class="px-6 py-4 font-medium text-slate-500 text-xs">${task.project?.name || 'Workspace'}</td>
        <td class="px-6 py-4 font-semibold text-slate-650 text-xs">${taskAssignee}</td>
        <td class="px-6 py-4 font-mono text-xs text-slate-600">${dueFormatted}</td>
        <td class="px-6 py-4">${priorityBadge}</td>
        <td class="px-6 py-4">${statusBadge}</td>
        <td class="px-6 py-4 text-right">
          <button class="text-xs font-semibold text-slate-650 hover:text-slate-900 py-1.5 px-3 border border-slate-200 rounded-lg hover:bg-neutral-50 transition" onclick="event.stopPropagation(); openTaskDetailsView(${task.id})">
            Details
          </button>
        </td>
      `;
      tableBody.appendChild(tr);
    });
  }
}

// ----------------- BADGE AUXILIARY BUILDERS -----------------
function getPriorityBadge(priority) {
  if (priority === 'high') {
    return `<span class="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 text-[10px] uppercase font-bold tracking-wider rounded">High</span>`;
  } else if (priority === 'medium') {
    return `<span class="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-[10px] uppercase font-bold tracking-wider rounded">Medium</span>`;
  } else {
    return `<span class="px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 text-[10px] uppercase font-bold tracking-wider rounded">Low</span>`;
  }
}

function getStatusBadge(status) {
  if (status === 'done') {
    return `<span class="px-2 py-0.5 bg-green-100 text-green-800 border border-green-200 text-[10px] font-mono uppercase font-bold tracking-widest rounded-sm">Done</span>`;
  } else if (status === 'in_progress') {
    return `<span class="px-2 py-0.5 bg-blue-105 bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-mono uppercase font-bold tracking-widest rounded-sm">In Prog</span>`;
  } else {
    return `<span class="px-2 py-0.5 bg-gray-100 text-gray-600 border border-gray-200 text-[10px] font-mono uppercase font-bold tracking-widest rounded-sm">Todo</span>`;
  }
}

// =================================================================
// ==================== ADMINISTRATIVE ACTIONS ====================
// =================================================================

// --- PROJECTS CREATE/EDIT CONFIG ---
function openProjectModal(projectId = null) {
  const modal = document.getElementById('modal-project');
  const box = document.getElementById('project-modal-box');
  const modalTitle = document.getElementById('project-modal-title');
  const submitBtn = document.getElementById('project-modal-submit');

  const nameField = document.getElementById('project-name');
  const descField = document.getElementById('project-description');
  const editingIdField = document.getElementById('project-editing-id');

  // Reset
  document.getElementById('form-project').reset();
  editingIdField.value = '';

  if (projectId) {
    // Edit existing project details
    const proj = state.projects.find(p => p.id === projectId);
    if (!proj) return;

    modalTitle.textContent = 'Edit Project Details';
    submitBtn.textContent = 'Apply Configuration';
    editingIdField.value = proj.id;
    nameField.value = proj.name;
    descField.value = proj.description || '';
  } else {
    // Create new project details
    modalTitle.textContent = 'Create New Project Folder';
    submitBtn.textContent = 'Create Project';
  }

  modal.classList.remove('hidden');
  setTimeout(() => box.classList.remove('scale-95'), 20);
}

// --- TASKS PUBLISH & ASIGNMENT ---
async function openTaskModal(taskId = null, defaultProjectId = null) {
  const modal = document.getElementById('modal-task');
  const box = document.getElementById('task-modal-box');
  const modalTitle = document.getElementById('task-modal-title');
  const submitBtn = document.getElementById('task-modal-submit');

  const titleField = document.getElementById('task-title');
  const descField = document.getElementById('task-description');
  const selectionProj = document.getElementById('task-project');
  const selectionProjWrapper = document.getElementById('task-project-selection-wrapper');
  const selectionAssignee = document.getElementById('task-assignee');
  
  const statusField = document.getElementById('task-status');
  const priorityField = document.getElementById('task-priority');
  const dueField = document.getElementById('task-due-date');
  const editingIdField = document.getElementById('task-editing-id');
  const defaultProjIdField = document.getElementById('task-default-project-id');

  // Reset fields
  document.getElementById('form-task').reset();
  editingIdField.value = '';
  defaultProjIdField.value = '';

  // Populating active Projects selector choices
  selectionProj.innerHTML = '';
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    selectionProj.appendChild(opt);
  });

  // Assignee: Retrieve users assigned to this project context
  async function populateAssigneeDropdown(pId) {
    selectionAssignee.innerHTML = '<option value="">Unassigned</option>';
    if (!pId) return;

    try {
      // Get member accounts for this project specifically
      const projectData = await apiFetch(`/api/projects/${pId}`);
      if (projectData && projectData.members) {
        projectData.members.forEach(member => {
          const opt = document.createElement('option');
          opt.value = member.user_id;
          opt.textContent = `${member.name} (${member.email})`;
          selectionAssignee.appendChild(opt);
        });
      }
    } catch (e) {
      // Gracefully fall back to overall workspace list on error
      state.workspaceUsers.forEach(user => {
         const opt = document.createElement('option');
         opt.value = user.id;
         opt.textContent = `${user.name} (${user.email})`;
         selectionAssignee.appendChild(opt);
      });
    }
  }

  // Handle Projects selections dynamically to change potential user assignment dropdowns
  selectionProj.onchange = (e) => populateAssigneeDropdown(e.target.value);

  if (taskId) {
    // Edit flow
    setLoading(true);
    const task = await apiFetch(`/api/tasks/${taskId}`);
    setLoading(false);
    if (!task) return;

    modalTitle.textContent = 'Modify Task Parameters';
    submitBtn.textContent = 'Update Task';
    editingIdField.value = task.id;

    titleField.value = task.title;
    descField.value = task.description || '';
    
    // Select project space and lock it
    selectionProj.value = task.project_id;
    selectionProjWrapper.classList.add('hidden'); // Hide during individual task editing
    
    await populateAssigneeDropdown(task.project_id);
    selectionAssignee.value = task.assigned_to || '';

    statusField.value = task.status;
    priorityField.value = task.priority;
    dueField.value = formatFormDate(task.due_date);
  } else {
    // Create Mode flow
    modalTitle.textContent = 'Publish New Task';
    submitBtn.textContent = 'Publish Directive';
    selectionProjWrapper.classList.remove('hidden');

    if (defaultProjectId) {
      defaultProjIdField.value = defaultProjectId;
      selectionProj.value = defaultProjectId;
      selectionProjWrapper.classList.add('hidden'); // Hide so user knows it's tied automatically
      await populateAssigneeDropdown(defaultProjectId);
    } else {
      if (state.projects.length > 0) {
        const firstId = state.projects[0].id;
        selectionProj.value = firstId;
        await populateAssigneeDropdown(firstId);
      }
    }
  }

  modal.classList.remove('hidden');
  setTimeout(() => box.classList.remove('scale-95'), 20);
}

// --- DETAIL VIEW OR PROGRESS STATUS CHANGES MODAL (MEMBERS OR GENERAL DIRECTIVES) ---
async function openTaskDetailsView(taskId, passedProject = null) {
  setLoading(true);
  const task = await apiFetch(`/api/tasks/${taskId}`);
  setLoading(false);
  if (!task) return;

  const modal = document.getElementById('modal-task-view');
  const box = document.getElementById('task-view-modal-box');

  const viewProject = document.getElementById('task-view-project');
  const viewTitle = document.getElementById('task-view-title');
  const viewDesc = document.getElementById('task-view-description');
  const viewAssignee = document.getElementById('task-view-assignee');
  const viewDue = document.getElementById('task-view-due');
  const viewPriority = document.getElementById('task-view-priority');
  const viewId = document.getElementById('task-view-id');
  const statusSelect = document.getElementById('task-view-status-select');
  const warningText = document.getElementById('task-view-member-warning');

  // Fill detail
  viewId.value = task.id;
  viewProject.textContent = task.project?.name || 'Workspace';
  viewTitle.textContent = task.title;
  viewDesc.textContent = task.description || 'No detailed instructions assigned.';
  
  viewAssignee.innerHTML = task.assignee
    ? `<span class="bg-slate-100 text-slate-800 border border-slate-150 px-2.5 py-1 rounded font-medium">${task.assignee.name}</span>`
    : '<span class="text-slate-400 italic">Unassigned</span>';

  viewDue.textContent = task.due_date ? formatDate(task.due_date) : 'None designated';
  viewPriority.innerHTML = getPriorityBadge(task.priority);
  statusSelect.value = task.status;

  // Evaluate project-level admin context
  let projectContext = passedProject;
  if (!projectContext && state.projects.length > 0) {
     projectContext = state.projects.find(p => p.id === task.project_id);
  }

  const isModerator = state.user.role === 'admin' || (projectContext && projectContext.user_role === 'admin');

  if (isModerator) {
    // Modify status dropdown and hide warning text since user have overall admin dashboard
    warningText.classList.add('hidden');
    
    // Add edit options in Header or control
    const footerControls = document.getElementById('form-task-view-status').querySelector('.flex');
    footerControls.innerHTML = `
      <button type="button" class="px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg border border-transparent transition" onclick="deleteTask(${task.id})">🗑 Delete</button>
      <button type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 border border-slate-200 rounded-lg transition" onclick="closeAllModals(); openTaskModal(${task.id})">Modify Params</button>
      <button type="submit" class="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-850 rounded-lg transition">Apply</button>
    `;
    statusSelect.disabled = false;
  } else {
    // Normal Member updates status only on targets assigned to them specifically!
    const isAssignedToMe = task.assigned_to === state.user.id;
    if (isAssignedToMe) {
       warningText.classList.remove('hidden');
       statusSelect.disabled = false;
       const footerControls = document.getElementById('form-task-view-status').querySelector('.flex');
       footerControls.innerHTML = `
         <button type="button" class="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 rounded-lg" onclick="closeAllModals()">Close</button>
         <button type="submit" class="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-850 rounded-lg transition">Commit Status</button>
       `;
    } else {
       warningText.classList.add('hidden');
       statusSelect.disabled = true; // Lock completely since it's not yours!
       const footerControls = document.getElementById('form-task-view-status').querySelector('.flex');
       footerControls.innerHTML = `
         <div class="text-[10px] text-slate-400 italic font-mono flex-1 leading-snug">🔒 This task is allocated to another teammate. Normal members can only configure status updates on tasks dedicated to themselves.</div>
         <button type="button" class="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-150 rounded-lg" onclick="closeAllModals()">Close</button>
       `;
    }
  }

  modal.classList.remove('hidden');
  setTimeout(() => box.classList.remove('scale-95'), 20);
}

// --- MEMBERS ATTACHMENTS TRIGGER ---
function openMemberInviteModal(projectId) {
  const modal = document.getElementById('modal-member');
  const box = document.getElementById('member-modal-box');
  const idField = document.getElementById('member-project-id');

  document.getElementById('form-member').reset();
  idField.value = projectId;

  modal.classList.remove('hidden');
  setTimeout(() => box.classList.remove('scale-95'), 20);
}

// Close and clear all active screens overlay modals
function closeAllModals() {
  document.querySelectorAll('#app ~ div:not(#global-loader)').forEach(modal => {
    modal.classList.add('hidden');
    const box = modal.querySelector('div[id]');
    if (box) box.classList.add('scale-95');
  });
}

// Remove project members
async function removeProjectMember(projectId, userId) {
  if (!confirm('Are you absolutely sure you want to revoke this user’s project access? All assignments tasks for them inside this project will remain as unallocated.')) return;
  
  setLoading(true);
  try {
    const data = await apiFetch(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' });
    if (data) {
      showToast(data.message || 'Member access revoked successfully.', 'success');
      await loadProjectDetailView(projectId);
    }
  } catch (err) {
    // Errors handled by proxy
  } finally {
    setLoading(false);
  }
}

// Remove / Delete actual Project 
async function deleteProject(projectId) {
  if (!confirm('🛑 WARNING: Deleting this project folder is cascade-permanent! This will erase all tasks and assignments grouped in this project space. Proceed?')) return;

  setLoading(true);
  try {
    const data = await apiFetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    if (data) {
      showToast(data.message || 'Project workspace deleted.', 'success');
      closeAllModals();
      window.location.hash = '#/projects';
    }
  } catch (e) {
    // Handled
  } finally {
    setLoading(false);
  }
}

// Delete actual Task
async function deleteTask(taskId) {
  if (!confirm('Confirm task publication withdrawal? All metrics, summaries, and completion logs will be permanently erased.')) return;

  setLoading(true);
  try {
    const data = await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    if (data) {
      showToast(data.message || 'Task registry slot cleaned.', 'success');
      closeAllModals();
      
      // Smart routing refresh
      if (window.location.hash.includes('projects/')) {
        const parts = window.location.hash.split('/');
        await loadProjectDetailView(parts[2]);
      } else {
        await loadTasksView();
      }
    }
  } catch (e) {
    // Handled
  } finally {
    setLoading(false);
  }
}

// =================================================================
// ==================== SUBMISSIONS & REGISTRATION ====================
// =================================================================

document.addEventListener('DOMContentLoaded', () => {

  // --- Login handler ---
  const formLogin = document.getElementById('form-login');
  if (formLogin) {
    formLogin.ondubmit = null; // Prevent standard triggers
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;

      setLoading(true);
      try {
        const data = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });

        if (data && data.token) {
          state.token = data.token;
          state.user = data.user;
          localStorage.setItem('token', data.token);
          localStorage.setItem('user', JSON.stringify(data.user));
          
          showToast(data.message || 'Authentication successful! Welcome.', 'success');
          
          // Clear form fields
          formLogin.reset();
          
          // Redirect safely
          window.location.hash = '#/dashboard';
        }
      } catch (err) {
        // Error displayed by wrapper
      } finally {
        setLoading(false);
      }
    });
  }

  // --- Signup handler ---
  const formSignup = document.getElementById('form-signup');
  if (formSignup) {
    formSignup.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('signup-name').value;
      const email = document.getElementById('signup-email').value;
      const password = document.getElementById('signup-password').value;
      const role = document.getElementById('signup-role').value;

      setLoading(true);
      try {
        const data = await apiFetch('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ name, email, password, role })
        });

        if (data && data.token) {
          state.token = data.token;
          state.user = data.user;
          localStorage.setItem('token', data.token);
          localStorage.setItem('user', JSON.stringify(data.user));

          showToast('Account registered successfully!', 'success');
          formSignup.reset();
          window.location.hash = '#/dashboard';
        }
      } catch (err) {
        // Handled
      } finally {
        setLoading(false);
      }
    });
  }

  // --- Project submissions (Create/Edit) ---
  const formProject = document.getElementById('form-project');
  if (formProject) {
    formProject.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('project-editing-id').value;
      const name = document.getElementById('project-name').value;
      const description = document.getElementById('project-description').value;

      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/projects/${id}` : '/api/projects';

      setLoading(true);
      try {
        const data = await apiFetch(url, {
          method,
          body: JSON.stringify({ name, description })
        });

        if (data) {
          showToast(data.message || 'Workspace folder committed.', 'success');
          closeAllModals();
          
          // Refresh screen state
          if (id) {
             await loadProjectDetailView(id);
          } else {
             await loadProjectsView();
          }
        }
      } catch (err) {
         // Error handled
      } finally {
        setLoading(false);
      }
    });
  }

  // --- Task submissions (Create/Edit) ---
  const formTask = document.getElementById('form-task');
  if (formTask) {
    formTask.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('task-editing-id').value;
      const defaultProjId = document.getElementById('task-default-project-id').value;

      const title = document.getElementById('task-title').value;
      const description = document.getElementById('task-description').value;
      const project_id = document.getElementById('task-project').value || defaultProjId;
      const assigned_to = document.getElementById('task-assignee').value || null;
      const status = document.getElementById('task-status').value;
      const priority = document.getElementById('task-priority').value;
      const due_date = document.getElementById('task-due-date').value || null;

      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/tasks/${id}` : '/api/tasks';

      setLoading(true);
      try {
        const data = await apiFetch(url, {
          method,
          body: JSON.stringify({ 
            title, description, project_id, assigned_to, status, priority, due_date 
          })
        });

        if (data) {
          showToast(data.message || 'Task registry parameters committed.', 'success');
          closeAllModals();

          // Evaluate context routes for target refresh
          if (window.location.hash.includes('projects/')) {
            const parts = window.location.hash.split('/');
            await loadProjectDetailView(parts[2]);
          } else {
            await loadTasksView();
          }
        }
      } catch (err) {
         // Handled
      } finally {
        setLoading(false);
      }
    });
  }

  // --- Member submissions (Invitation link) ---
  const formMember = document.getElementById('form-member');
  if (formMember) {
    formMember.addEventListener('submit', async (e) => {
      e.preventDefault();
      const projectId = document.getElementById('member-project-id').value;
      const email = document.getElementById('member-email').value;
      const role = document.getElementById('member-role').value;

      setLoading(true);
      try {
        const data = await apiFetch(`/api/projects/${projectId}/members`, {
          method: 'POST',
          body: JSON.stringify({ email, role })
        });

        if (data) {
          showToast(data.message || 'Teammate space granted invitation access.', 'success');
          closeAllModals();
          await loadProjectDetailView(projectId);
        }
      } catch (err) {
         // Handled
      } finally {
        setLoading(false);
      }
    });
  }

  // --- Member inline task status compiler ---
  const formTaskViewStatus = document.getElementById('form-task-view-status');
  if (formTaskViewStatus) {
    formTaskViewStatus.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('task-view-id').value;
      const status = document.getElementById('task-view-status-select').value;

      setLoading(true);
      try {
        const data = await apiFetch(`/api/tasks/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ status })
        });

        if (data) {
          showToast('Status update verified and completed successfully.', 'success');
          closeAllModals();

          // Refresh current router view
          if (window.location.hash.includes('projects/')) {
             const parts = window.location.hash.split('/');
             await loadProjectDetailView(parts[2]);
          } else if (window.location.hash.includes('tasks')) {
             await loadTasksView();
          } else {
             await loadDashboardView();
          }
        }
      } catch (err) {
         // proxy
      } finally {
        setLoading(false);
      }
    });
  }

  // --- Event: Logout trigger ---
  const logoutBtn = document.getElementById('logout-button');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      state.token = null;
      state.user = null;

      showToast('You have been logged out of the workspace.', 'success');
      window.location.hash = '#/login';
      updateSidebarAndNavbar();
    });
  }

  // --- Filter Bar Selectors Event Listeners ---
  const filterProj = document.getElementById('filter-project');
  const filterStat = document.getElementById('filter-status');
  const filterPrio = document.getElementById('filter-priority');
  const filterMe = document.getElementById('filter-assigned-me');
  const clearFiltersBtn = document.getElementById('clear-filters-btn');

  if (filterProj) filterProj.addEventListener('change', loadTasksView);
  if (filterStat) filterStat.addEventListener('change', loadTasksView);
  if (filterPrio) filterPrio.addEventListener('change', loadTasksView);
  if (filterMe) filterMe.addEventListener('change', loadTasksView);
  
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      filterProj.value = '';
      filterStat.value = '';
      filterPrio.value = '';
      filterMe.checked = false;
      loadTasksView();
      showToast('Task filters cleared.', 'success');
    });
  }

  // --- Modal close click triggers ---
  document.querySelectorAll('.modal-close-trigger').forEach(trigger => {
    trigger.addEventListener('click', closeAllModals);
  });

  // Close modals on clicking backdrop background overlay
  document.querySelectorAll('#app ~ div').forEach(modal => {
    modal.addEventListener('mousedown', (e) => {
      if (e.target === modal) {
        closeAllModals();
      }
    });
  });

  // ESC Key to close modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });

  // --- Mobile Sidebar drawers ---
  const btnOpenMobile = document.getElementById('open-sidebar-mobile');
  const btnCloseMobile = document.getElementById('close-sidebar-mobile');
  const sidebar = document.getElementById('sidebar');

  if (btnOpenMobile) {
    btnOpenMobile.addEventListener('click', () => {
      sidebar.classList.remove('hidden');
      sidebar.classList.add('fixed', 'inset-y-0', 'left-0', 'z-30');
    });
  }

  if (btnCloseMobile) {
    btnCloseMobile.addEventListener('click', () => {
      sidebar.classList.add('hidden');
      sidebar.classList.remove('fixed', 'inset-y-0', 'left-0', 'z-30');
    });
  }

  // Handle closing drawer on clicking links
  document.querySelectorAll('.nav-item').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth < 768) {
         sidebar.classList.add('hidden');
         sidebar.classList.remove('fixed', 'inset-y-0', 'left-0', 'z-30');
      }
    });
  });

  // Window resize resets mobile parameters
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) {
       sidebar.classList.remove('fixed', 'inset-y-0', 'left-0', 'z-30');
       if (state.token) {
          sidebar.classList.remove('hidden');
       }
    } else {
       if (!sidebar.classList.contains('fixed')) {
          sidebar.classList.add('hidden');
       }
    }
  });

  // --- Router initializers ---
  function handleLocationHashChange() {
    const route = window.location.hash || '#/dashboard';
    renderScreen(route);
  }

  window.addEventListener('hashchange', handleLocationHashChange);

  // Run immediately on boot
  handleLocationHashChange();
});
