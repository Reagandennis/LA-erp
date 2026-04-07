import { z } from 'zod';

export const userStatusSchema = z.enum(['active', 'inactive', 'suspended']);

export const emailSchema = z
  .string()
  .trim()
  .email('Enter a valid email address')
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const managedUserSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  password: passwordSchema,
  status: userStatusSchema.default('active'),
  roleIds: z.array(z.number().int().positive()).min(1, 'Select at least one role'),
  moduleIds: z.array(z.number().int().positive()).default([]),
});

export const managedUserUpdateSchema = z
  .object({
    status: userStatusSchema.optional(),
    roleIds: z.array(z.number().int().positive()).min(1).optional(),
    moduleIds: z.array(z.number().int().positive()).optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.roleIds !== undefined ||
      value.moduleIds !== undefined,
    {
    message: 'At least one field must be updated',
    },
  );

export const personalTodoPrioritySchema = z.enum(['low', 'medium', 'high']);
export const personalTodoStatusSchema = z.enum(['Backlog', 'In progress', 'In review']);

export const personalTodoCreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(160, 'Title is too long'),
  description: z
    .string()
    .trim()
    .max(1000, 'Description is too long')
    .optional()
    .nullable(),
  priority: personalTodoPrioritySchema.default('medium'),
  status: personalTodoStatusSchema.default('Backlog'),
  dueDate: z.string().trim().optional().nullable(),
  completed: z.boolean().optional(),
});

export const personalTodoUpdateSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(160, 'Title is too long').optional(),
    description: z
      .string()
      .trim()
      .max(1000, 'Description is too long')
      .optional()
      .nullable(),
    priority: personalTodoPrioritySchema.optional(),
    status: personalTodoStatusSchema.optional(),
    dueDate: z.string().trim().optional().nullable(),
    completed: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.priority !== undefined ||
      value.status !== undefined ||
      value.dueDate !== undefined ||
      value.completed !== undefined,
    {
      message: 'At least one field must be updated',
    },
  );
