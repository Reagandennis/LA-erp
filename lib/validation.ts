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

export const personalTodoBoardSchema = z.object({
  columns: z
    .array(z.string().trim().min(1, 'Column name is required').max(40, 'Column name is too long'))
    .min(1, 'At least one column is required')
    .max(20, 'Too many columns'),
  columnColors: z.record(z.string().trim()).optional(),
});

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(120),
  email: z
    .string()
    .trim()
    .max(160)
    .email('Enter a valid email address')
    .optional()
    .or(z.literal(''))
    .transform((value) => (value ? value.toLowerCase() : null)),
  phone: z.string().trim().max(40).optional().nullable(),
  company: z.string().trim().max(160).optional().nullable(),
  address: z.string().trim().max(400).optional().nullable(),
});

const quoteItemSchema = z.object({
  description: z.string().trim().min(1, 'Item description is required').max(280),
  quantity: z
    .number({ invalid_type_error: 'Quantity must be a number' })
    .finite()
    .gt(0, 'Quantity must be greater than zero')
    .max(1_000_000),
  unitPrice: z
    .number({ invalid_type_error: 'Unit price must be a number' })
    .finite()
    .gte(0, 'Unit price cannot be negative')
    .max(100_000_000),
});

const isoDateSchema = z
  .string()
  .trim()
  .min(1, 'Date is required')
  .refine((value) => !Number.isNaN(new Date(value).getTime()), 'Invalid date');

export const quoteCreateSchema = z.object({
  customerId: z.number().int().positive('Customer is required'),
  approverId: z.number().int().positive('Approver is required').optional().nullable(),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  issueDate: isoDateSchema,
  expiryDate: isoDateSchema,
  taxRate: z
    .number({ invalid_type_error: 'Tax rate must be a number' })
    .finite()
    .gte(0, 'Tax rate cannot be negative')
    .lte(1, 'Tax rate must be a decimal between 0 and 1'),
  notes: z.string().trim().max(2000).optional().nullable(),
  items: z.array(quoteItemSchema).min(1, 'Add at least one line item').max(100),
});

export const quoteUpdateSchema = quoteCreateSchema.partial().extend({
  items: z.array(quoteItemSchema).min(1, 'Add at least one line item').max(100).optional(),
});

export const quoteDecisionSchema = z.object({
  decision: z.enum(['approved', 'declined']),
  note: z.string().trim().max(1000).optional().nullable(),
});
