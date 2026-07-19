import { z } from 'zod';
import { ROLE_VALUES, DEPARTMENT_VALUES } from '../../core/constants/index.js';

const password = z.string().min(8, 'Password must be at least 8 characters');
const objectId = z.string().length(24, 'Invalid employee id');

/** Fields an admin may set on an employee account. */
const employeeFields = {
  name: z.string().min(2).max(120),
  email: z.string().email(),
  role: z.enum(ROLE_VALUES).optional(),
  department: z.enum(DEPARTMENT_VALUES).optional(),
  employeeId: z.string().max(40).optional(),
  title: z.string().max(120).optional(),
  phone: z.string().max(20).optional(),
  avatarColor: z.string().max(9).optional(),
};

export const createUserSchema = z.object({
  body: z.object({ ...employeeFields, password }),
});

export const updateUserSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    ...employeeFields,
    name: employeeFields.name.optional(),
    email: employeeFields.email.optional(),
    // Optional on edit: an empty field means "leave the password alone".
    password: password.optional(),
  }),
});

export const resetPasswordSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ password }),
});

export const setUserStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ isActive: z.boolean() }),
});

export const userIdSchema = z.object({ params: z.object({ id: objectId }) });

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const listUsersSchema = z.object({
  query: z.object({
    role: z.enum(ROLE_VALUES).optional(),
    department: z.enum(DEPARTMENT_VALUES).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    search: z.string().optional(),
  }),
});
