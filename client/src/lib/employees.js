/**
 * Mock employee roster for the Mystery Rooms PMS.
 * Department keys must match DEPT_META keys in ui.js.
 *
 * Shape: { id, name, role, department, initials, avatarColor, isAvailable, availability }
 * availability: { status: 'available' | 'busy' | 'on_leave', reason?: string }
 */
export const EMPLOYEES = [
  // Expansion
  { id: 'emp-exp-001', name: 'Arjun Mehta',       role: 'Expansion Manager',        department: 'expansion',    initials: 'AM', avatarColor: '#e0a13a', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-exp-002', name: 'Sneha Kapoor',       role: 'Site Analyst',             department: 'expansion',    initials: 'SK', avatarColor: '#f59e0b', isAvailable: false, availability: { status: 'busy', reason: 'Busy on Pune Site' } },
  { id: 'emp-exp-003', name: 'Rohan Verma',        role: 'Business Development',     department: 'expansion',    initials: 'RV', avatarColor: '#d97706', isAvailable: true, availability: { status: 'available' } },
  // Legal
  { id: 'emp-leg-001', name: 'Priya Sharma',       role: 'Legal Head',               department: 'legal',        initials: 'PS', avatarColor: '#6366f1', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-leg-002', name: 'Vikram Nair',        role: 'Contract Specialist',      department: 'legal',        initials: 'VN', avatarColor: '#818cf8', isAvailable: false, availability: { status: 'on_leave', reason: 'Medical Leave' } },
  { id: 'emp-leg-003', name: 'Ananya Rao',         role: 'Compliance Officer',       department: 'legal',        initials: 'AR', avatarColor: '#a5b4fc', isAvailable: true, availability: { status: 'available' } },
  // Projects
  { id: 'emp-prj-001', name: 'Karan Joshi',        role: 'Project Manager',          department: 'projects',     initials: 'KJ', avatarColor: '#f43f5e', isAvailable: false, availability: { status: 'busy', reason: 'Overloaded (4 projects)' } },
  { id: 'emp-prj-002', name: 'Meera Pillai',       role: 'Project Coordinator',      department: 'projects',     initials: 'MP', avatarColor: '#fb7185', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-prj-003', name: 'Suresh Iyer',        role: 'Program Lead',             department: 'projects',     initials: 'SI', avatarColor: '#fda4af', isAvailable: true, availability: { status: 'available' } },
  // HR
  { id: 'emp-hr-001',  name: 'Divya Menon',        role: 'HR Manager',               department: 'hr',           initials: 'DM', avatarColor: '#ec4899', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-hr-002',  name: 'Rahul Gupta',        role: 'Recruiter',                department: 'hr',           initials: 'RG', avatarColor: '#f472b6', isAvailable: false, availability: { status: 'busy', reason: 'Hiring drive active' } },
  { id: 'emp-hr-003',  name: 'Aisha Siddiqui',     role: 'L&D Specialist',           department: 'hr',           initials: 'AS', avatarColor: '#fbcfe8', isAvailable: true, availability: { status: 'available' } },
  // Marketing
  { id: 'emp-mkt-001', name: 'Neha Tiwari',        role: 'Marketing Manager',        department: 'marketing',    initials: 'NT', avatarColor: '#16a79a', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-mkt-002', name: 'Sameer Khan',        role: 'Brand Strategist',         department: 'marketing',    initials: 'SK2', avatarColor: '#0d9488', isAvailable: false, availability: { status: 'on_leave', reason: 'On Vacation' } },
  { id: 'emp-mkt-003', name: 'Pooja Desai',        role: 'Content Lead',             department: 'marketing',    initials: 'PD', avatarColor: '#2dd4bf', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-mkt-004', name: 'Raj Patel',          role: 'Social Media Manager',     department: 'marketing',    initials: 'RP', avatarColor: '#5eead4', isAvailable: true, availability: { status: 'available' } },
  // Finance
  { id: 'emp-fin-001', name: 'Anjali Krishnan',    role: 'CFO',                      department: 'finance',      initials: 'AK', avatarColor: '#10b981', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-fin-002', name: 'Deepak Choudhary',   role: 'Senior Accountant',        department: 'finance',      initials: 'DC', avatarColor: '#34d399', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-fin-003', name: 'Kavita Bhatt',       role: 'Budget Analyst',           department: 'finance',      initials: 'KB', avatarColor: '#6ee7b7', isAvailable: false, availability: { status: 'on_leave', reason: 'Personal Leave' } },
  // Operations
  { id: 'emp-ops-001', name: 'Ravi Shankar',       role: 'Operations Head',          department: 'operations',   initials: 'RS', avatarColor: '#38bdf8', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-ops-002', name: 'Sunita Mishra',      role: 'Store Operations Manager', department: 'operations',   initials: 'SM', avatarColor: '#7dd3fc', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-ops-003', name: 'Vishal Agarwal',     role: 'Area Manager',             department: 'operations',   initials: 'VA', avatarColor: '#bae6fd', isAvailable: false, availability: { status: 'busy', reason: 'Opening 2 stores' } },
  // Construction
  { id: 'emp-con-001', name: 'Hardik Shah',        role: 'Site Engineer',            department: 'construction', initials: 'HS', avatarColor: '#8b5cf6', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-con-002', name: 'Pallavi Jain',       role: 'Civil Supervisor',         department: 'construction', initials: 'PJ', avatarColor: '#a78bfa', isAvailable: false, availability: { status: 'busy', reason: 'Onsite in Jaipur' } },
  { id: 'emp-con-003', name: 'Tarun Malhotra',     role: 'Structural Consultant',    department: 'construction', initials: 'TM', avatarColor: '#c4b5fd', isAvailable: true, availability: { status: 'available' } },
  // Interior
  { id: 'emp-int-001', name: 'Shruti Saxena',      role: 'Interior Design Head',     department: 'interior',     initials: 'SS', avatarColor: '#f97316', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-int-002', name: 'Amit Kulkarni',      role: '3D Visualizer',            department: 'interior',     initials: 'AK2', avatarColor: '#fb923c', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-int-003', name: 'Nidhi Bose',         role: 'FF&E Coordinator',         department: 'interior',     initials: 'NB', avatarColor: '#fdba74', isAvailable: false, availability: { status: 'on_leave', reason: 'Sabbatical' } },
  // Procurement
  { id: 'emp-pro-001', name: 'Gaurav Pathak',      role: 'Procurement Manager',      department: 'procurement',  initials: 'GP', avatarColor: '#84cc16', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-pro-002', name: 'Lakshmi Reddy',      role: 'Vendor Relations',         department: 'procurement',  initials: 'LR', avatarColor: '#a3e635', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-pro-003', name: 'Manish Tripathi',    role: 'Supply Chain Analyst',     department: 'procurement',  initials: 'MT', avatarColor: '#d9f99d', isAvailable: true, availability: { status: 'available' } },
  // Automation
  { id: 'emp-aut-001', name: 'Siddharth Roy',      role: 'Automation Engineer',      department: 'automation',   initials: 'SR', avatarColor: '#e11d48', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-aut-002', name: 'Preethi Nambiar',    role: 'Systems Integrator',       department: 'automation',   initials: 'PN', avatarColor: '#fb7185', isAvailable: false, availability: { status: 'busy', reason: 'Commissioning Delhi' } },
  // IT
  { id: 'emp-it-001',  name: 'Rahul Das',          role: 'IT Manager',               department: 'it',           initials: 'RD', avatarColor: '#0ea5e9', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-it-002',  name: 'Faisal Ahmed',       role: 'Network Engineer',         department: 'it',           initials: 'FA', avatarColor: '#38bdf8', isAvailable: true, availability: { status: 'available' } },
  { id: 'emp-it-003',  name: 'Tanvi Goyal',        role: 'Systems Administrator',    department: 'it',           initials: 'TG', avatarColor: '#7dd3fc', isAvailable: true, availability: { status: 'available' } },
];

/**
 * Index employees by department for O(1) filtered lookups.
 */
export const EMPLOYEES_BY_DEPT = EMPLOYEES.reduce((acc, emp) => {
  if (!acc[emp.department]) acc[emp.department] = [];
  acc[emp.department].push(emp);
  return acc;
}, {});

/** Look up a single employee by id. */
export const getEmployeeById = (id) => EMPLOYEES.find((e) => e.id === id);
