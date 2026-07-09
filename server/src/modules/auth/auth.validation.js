import { z } from 'zod';
import { ROLE_VALUES, DEPARTMENT_VALUES } from '../../core/constants/index.js';

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120),
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    role: z.enum(ROLE_VALUES).optional(),
    department: z.enum(DEPARTMENT_VALUES).optional(),
    title: z.string().max(120).optional(),
  }),
});

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
  }),
});
