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

export const managedUserPasswordResetSchema = z.object({
  password: passwordSchema,
});

const uploadLimitMbSchema = z
  .number()
  .int('Limits must be whole megabytes')
  .min(1, 'Limits must be at least 1 MB')
  .max(100, 'Limits cannot exceed 100 MB');

export const uploadLimitsUpdateSchema = z.object({
  fileMb: uploadLimitMbSchema,
  photoMb: uploadLimitMbSchema,
  documentMb: uploadLimitMbSchema,
  audioMb: uploadLimitMbSchema,
  logoMb: uploadLimitMbSchema,
});

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
    deleted: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.priority !== undefined ||
      value.status !== undefined ||
      value.dueDate !== undefined ||
      value.completed !== undefined ||
      value.deleted !== undefined,
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
  // Board-order of task ids across every column; ids missing from the list keep
  // their server-side ordering and sort after the ones listed here.
  taskOrder: z.array(z.string().trim().min(1)).max(2000).optional(),
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
  billingAddress: z.string().trim().max(400).optional().nullable(),
});

export const discountTypeSchema = z.enum(['none', 'percentage', 'fixed']);

const quoteItemSchema = z.object({
  description: z.string().trim().min(1, 'Item description is required').max(280),
  quantity: z
    .number({ invalid_type_error: 'Quantity must be a number' })
    .finite()
    .gt(0, 'Quantity must be greater than zero')
    .max(1_000_000),
  days: z
    .number({ invalid_type_error: 'Days must be a number' })
    .finite()
    .gt(0, 'Days must be greater than zero')
    .max(100_000)
    .optional(),
  unitPrice: z
    .number({ invalid_type_error: 'Unit price must be a number' })
    .finite()
    .gte(0, 'Unit price cannot be negative')
    .max(100_000_000),
  taxable: z.boolean().optional(),
  discountType: discountTypeSchema.optional(),
  discountValue: z
    .number()
    .finite()
    .gte(0, 'Discount cannot be negative')
    .max(100_000_000)
    .optional(),
  productId: z.number().int().positive().optional().nullable(),
});

const isoDateSchema = z
  .string()
  .trim()
  .min(1, 'Date is required')
  .refine((value) => !Number.isNaN(new Date(value).getTime()), 'Invalid date');

const currencySchema = z
  .string()
  .trim()
  .length(3, 'Currency must be a 3-letter ISO code')
  .regex(/^[A-Za-z]{3}$/, 'Currency must be 3 letters')
  .transform((value) => value.toUpperCase());

export const quoteCreateSchema = z.object({
  customerId: z.number().int().positive('Customer is required'),
  approverId: z.number().int().positive('Approver is required').optional().nullable(),
  brandProfileId: z.number().int().positive().optional().nullable(),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  issueDate: isoDateSchema,
  expiryDate: isoDateSchema,
  currency: currencySchema.default('USD'),
  taxRate: z
    .number({ invalid_type_error: 'Tax rate must be a number' })
    .finite()
    .gte(0, 'Tax rate cannot be negative')
    .lte(1, 'Tax rate must be a decimal between 0 and 1'),
  discountType: discountTypeSchema.default('none'),
  discountValue: z
    .number()
    .finite()
    .gte(0, 'Discount cannot be negative')
    .max(100_000_000)
    .default(0),
  notes: z.string().trim().max(2000).optional().nullable(),
  terms: z.string().trim().max(5000).optional().nullable(),
  items: z.array(quoteItemSchema).min(1, 'Add at least one line item').max(100),
});

export const quoteUpdateSchema = quoteCreateSchema.partial().extend({
  items: z.array(quoteItemSchema).min(1, 'Add at least one line item').max(100).optional(),
});

export const quoteDecisionSchema = z.object({
  decision: z.enum(['approved', 'declined']),
  note: z.string().trim().max(1000).optional().nullable(),
});

export const invoiceSubmitSchema = z.object({
  approverId: z
    .number({ invalid_type_error: 'Pick an approver' })
    .int()
    .positive('Pick an approver'),
});

export const invoiceDecisionSchema = z.object({
  decision: z.enum(['approved', 'declined']),
  note: z.string().trim().max(1000).optional().nullable(),
});

export const productCreateSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  sku: z.string().trim().max(80).optional().nullable(),
  defaultUnitPrice: z
    .number()
    .finite()
    .gte(0, 'Unit price cannot be negative')
    .max(100_000_000),
  currency: currencySchema.default('USD'),
  taxable: z.boolean().default(true),
});

export const productUpdateSchema = productCreateSchema.partial().extend({
  archived: z.boolean().optional(),
});

const templateItemSchema = z.object({
  description: z.string().trim().min(1).max(280),
  quantity: z.number().finite().gt(0).max(1_000_000),
  days: z.number().finite().gt(0).max(100_000).optional(),
  unitPrice: z.number().finite().gte(0).max(100_000_000),
  taxable: z.boolean().optional(),
  discountType: discountTypeSchema.optional(),
  discountValue: z.number().finite().gte(0).max(100_000_000).optional(),
  productId: z.number().int().positive().optional().nullable(),
});

export const templateCreateSchema = z.object({
  name: z.string().trim().min(1, 'Template name is required').max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  taxRate: z.number().finite().gte(0).lte(1),
  currency: currencySchema.default('USD'),
  terms: z.string().trim().max(5000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  discountType: discountTypeSchema.default('none'),
  discountValue: z.number().finite().gte(0).max(100_000_000).default(0),
  items: z.array(templateItemSchema).min(1, 'Add at least one line item').max(100),
});

export const templateUpdateSchema = templateCreateSchema.partial();

export const tripStatusSchema = z.enum(['Draft', 'Planned', 'Active', 'Completed', 'Cancelled']);

const REMINDER_MINUTES_OPTIONS = [5, 15, 30, 60, 1440] as const;

export const tripItemTypeSchema = z.enum([
  'flight',
  'car',
  'hotel',
  'location',
  'activity',
]);

const tripItineraryItemDraftSchema = z.object({
  itemType: tripItemTypeSchema.optional(),
  description: z.string().trim().min(1, 'Item description is required').max(280),
  subtitle: z.string().trim().max(1000).optional().nullable(),
  quantity: z.number().finite().gt(0, 'Quantity must be greater than zero').max(1_000_000),
  unitPrice: z.number().finite().gte(0).max(100_000_000).optional().nullable(),
  sourceQuoteItemId: z.number().int().positive().optional().nullable(),
  scheduledAt: z.string().trim().min(1).optional().nullable(),
  endsAt: z.string().trim().min(1).optional().nullable(),
  durationMinutes: z.number().int().gte(0).max(60 * 24 * 30).optional().nullable(),
  reminderMinutesBefore: z
    .number()
    .int()
    .refine((v) => REMINDER_MINUTES_OPTIONS.includes(v as (typeof REMINDER_MINUTES_OPTIONS)[number]), {
      message: 'Reminder must be 5, 15, 30, 60, or 1440 minutes before',
    })
    .optional()
    .nullable(),
  imageUrl: z.string().trim().max(2048).optional().nullable(),
  confirmationCode: z.string().trim().max(100).optional().nullable(),
});

export const tripCreateSchema = z.object({
  customerId: z.number().int().positive('Customer is required'),
  ownerId: z.number().int().positive().optional().nullable(),
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  status: tripStatusSchema.optional(),
  startDate: z.string().trim().optional().nullable(),
  endDate: z.string().trim().optional().nullable(),
  currency: currencySchema.default('USD'),
  notes: z.string().trim().max(2000).optional().nullable(),
  items: z.array(tripItineraryItemDraftSchema).min(0).max(200),
});

export const tripUpdateSchema = z
  .object({
    customerId: z.number().int().positive().optional(),
    ownerId: z.number().int().positive().optional().nullable(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional().nullable(),
    status: tripStatusSchema.optional(),
    startDate: z.string().trim().optional().nullable(),
    endDate: z.string().trim().optional().nullable(),
    currency: currencySchema.optional(),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be updated');

export const tripItineraryItemAddSchema = z.object({
  items: z.array(tripItineraryItemDraftSchema).min(1, 'Add at least one item').max(100),
});

export const tripItineraryItemUpdateSchema = z
  .object({
    itemType: tripItemTypeSchema.optional(),
    description: z.string().trim().min(1).max(280).optional(),
    subtitle: z.string().trim().max(1000).optional().nullable(),
    quantity: z.number().finite().gt(0).max(1_000_000).optional(),
    unitPrice: z.number().finite().gte(0).max(100_000_000).optional().nullable(),
    completed: z.boolean().optional(),
    scheduledAt: z.string().trim().min(1).optional().nullable(),
    endsAt: z.string().trim().min(1).optional().nullable(),
    durationMinutes: z.number().int().gte(0).max(60 * 24 * 30).optional().nullable(),
    reminderMinutesBefore: z
      .number()
      .int()
      .refine(
        (v) => REMINDER_MINUTES_OPTIONS.includes(v as (typeof REMINDER_MINUTES_OPTIONS)[number]),
        { message: 'Reminder must be 5, 15, 30, 60, or 1440 minutes before' },
      )
      .optional()
      .nullable(),
    imageUrl: z.string().trim().max(2048).optional().nullable(),
    confirmationCode: z.string().trim().max(100).optional().nullable(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one field must be updated',
  );

export const tripFromQuoteSchema = z.object({
  ownerId: z.number().int().positive().optional().nullable(),
  title: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  startDate: z.string().trim().optional().nullable(),
  endDate: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const organizationUpdateSchema = z.object({
  companyName: z.string().trim().max(160).optional().nullable(),
  addressLine1: z.string().trim().max(160).optional().nullable(),
  addressLine2: z.string().trim().max(160).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  region: z.string().trim().max(80).optional().nullable(),
  postalCode: z.string().trim().max(40).optional().nullable(),
  country: z.string().trim().max(80).optional().nullable(),
  email: z
    .string()
    .trim()
    .max(160)
    .email('Enter a valid email address')
    .optional()
    .or(z.literal(''))
    .transform((value) => (value ? value.toLowerCase() : null)),
  phone: z.string().trim().max(40).optional().nullable(),
  website: z.string().trim().max(200).optional().nullable(),
  defaultCurrency: currencySchema.optional(),
  defaultTaxRate: z.number().finite().gte(0).lte(1).optional(),
  taxLabel: z.string().trim().min(1).max(40).optional(),
});

const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a 6-digit hex value like #03458f');

export const brandProfileCreateSchema = z.object({
  name: z.string().trim().min(1, 'Profile name is required').max(120),
  companyName: z.string().trim().max(160).optional().nullable(),
  addressLine1: z.string().trim().max(160).optional().nullable(),
  addressLine2: z.string().trim().max(160).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  region: z.string().trim().max(80).optional().nullable(),
  postalCode: z.string().trim().max(40).optional().nullable(),
  country: z.string().trim().max(80).optional().nullable(),
  email: z
    .string()
    .trim()
    .max(160)
    .email('Enter a valid email address')
    .optional()
    .or(z.literal(''))
    .transform((value) => (value ? value.toLowerCase() : null)),
  phone: z.string().trim().max(40).optional().nullable(),
  website: z.string().trim().max(200).optional().nullable(),
  primaryColor: hexColorSchema.default('#03458f'),
  isDefault: z.boolean().optional(),
  accountingProvider: z.enum(['none', 'quickbooks', 'wave']).optional(),
});

export const brandProfileUpdateSchema = brandProfileCreateSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be updated');

const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, 'Item description is required').max(280),
  quantity: z
    .number({ invalid_type_error: 'Days must be a number' })
    .finite()
    .gt(0, 'Days must be greater than zero')
    .max(1_000_000),
  unitPrice: z
    .number({ invalid_type_error: 'Unit price must be a number' })
    .finite()
    .gte(0, 'Unit price cannot be negative')
    .max(100_000_000),
  taxable: z.boolean().optional(),
  discountType: discountTypeSchema.optional(),
  discountValue: z.number().finite().gte(0).max(100_000_000).optional(),
  productId: z.number().int().positive().optional().nullable(),
});

export const invoiceCreateSchema = z.object({
  customerId: z.number().int().positive('Customer is required'),
  brandProfileId: z.number().int().positive().optional().nullable(),
  sourceQuoteId: z.number().int().positive().optional().nullable(),
  issueDate: isoDateSchema,
  dueDate: isoDateSchema,
  currency: currencySchema.default('USD'),
  taxRate: z
    .number({ invalid_type_error: 'Tax rate must be a number' })
    .finite()
    .gte(0, 'Tax rate cannot be negative')
    .lte(1, 'Tax rate must be a decimal between 0 and 1'),
  discountType: discountTypeSchema.default('none'),
  discountValue: z.number().finite().gte(0).max(100_000_000).default(0),
  notes: z.string().trim().max(2000).optional().nullable(),
  terms: z.string().trim().max(5000).optional().nullable(),
  items: z.array(invoiceItemSchema).min(1, 'Add at least one line item').max(100),
});

export const invoiceUpdateSchema = invoiceCreateSchema.partial().extend({
  items: z.array(invoiceItemSchema).min(1, 'Add at least one line item').max(100).optional(),
});

export const invoicePaymentSchema = z.object({
  amount: z
    .number({ invalid_type_error: 'Amount must be a number' })
    .finite()
    .gt(0, 'Amount must be greater than zero')
    .max(100_000_000),
  method: z.string().trim().min(1).max(40).default('Bank transfer'),
  reference: z.string().trim().max(100).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  paidAt: isoDateSchema,
});

export const invoiceFromQuoteSchema = z.object({
  quoteId: z.number().int().positive('Quote is required'),
  dueInDays: z.number().int().gte(0).lte(365).optional(),
});
