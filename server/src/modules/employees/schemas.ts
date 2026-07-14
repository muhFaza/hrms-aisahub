import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listEmployeesQuerySchema = z.object({
  search: z.string().trim().optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME']).optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

const employeeFields = z.object({
  fullName: z.string().trim().min(1),
  nickname: z.string().trim().nullish(),
  joinDate: z.coerce.date(),
  position: z.string().trim().min(1),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME']),
  contractStartDate: z.coerce.date().nullish(),
  contractEndDate: z.coerce.date().nullish(),
  monthlySalary: z.coerce.number().nonnegative().nullish(),
  hourlyRate: z.coerce.number().nonnegative().nullish(),
  email: z.string().email().nullish(),
  university: z.string().trim().nullish(),
  major: z.string().trim().nullish(),
  graduationYear: z.coerce.number().int().min(1950).max(2100).nullish(),
  linkedinUrl: z.string().url().nullish(),
  religion: z.string().trim().nullish(),
  thrEligible: z.boolean().optional().default(false),
  bankName: z.string().trim().nullish(),
  bankAccountNumber: z.string().trim().nullish(),
  ktpNumber: z
    .string()
    .regex(/^\d{16}$/, 'KTP number must be exactly 16 digits')
    .nullish(),
  phoneNumber: z.string().trim().nullish(),
  isActive: z.boolean().optional(),
});

// Full-time requires a monthly salary; part-time requires an hourly rate (design §3).
function withEmploymentRule<T extends typeof employeeFields>(schema: T) {
  return schema.superRefine((data, ctx) => {
    if (data.employmentType === 'FULL_TIME' && data.monthlySalary == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['monthlySalary'],
        message: 'monthlySalary is required for full-time employees',
      });
    }
    if (data.employmentType === 'PART_TIME' && data.hourlyRate == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hourlyRate'],
        message: 'hourlyRate is required for part-time employees',
      });
    }
  });
}

export const createEmployeeSchema = withEmploymentRule(employeeFields);
export const updateEmployeeSchema = withEmploymentRule(employeeFields);

export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
export type EmployeeInput = z.infer<typeof createEmployeeSchema>;
