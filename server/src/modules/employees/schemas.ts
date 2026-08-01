import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listEmployeesQuerySchema = z.object({
  search: z.string().trim().optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME']).optional(),
  // Replaces the old isActive boolean. Status is derived from the employment record, so this
  // filters structurally rather than reading a column.
  status: z.enum(['ACTIVE', 'TERMINATED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

const employeeFields = z.object({
  fullName: z.string().trim().min(1),
  nickname: z.string().trim().nullish(),
  joinDate: z.coerce.date(),
  position: z.string().trim().min(1),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME']),
  // Accrual anchor. Omit it and the service derives it from the employmentType transition;
  // supply it to correct a conversion that was recorded late, which would otherwise cost the
  // employee the accrual months between the effective date and the date it was entered.
  fullTimeSince: z.coerce.date().nullish(),
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
  // No isActive: employment status is not a field anyone sets. Ending an employment goes
  // through POST /employees/:id/terminate, which requires a date and a reason.
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

// Ending an employment. The date is required and overridable in both directions: a
// termination can be recorded late (a past date) or served as notice (a future one), and it
// need not match contractEndDate — people leave early and people stay on.
export const terminateSchema = z.object({
  endDate: z.coerce.date(),
  endReason: z.enum(['CONTRACT_END', 'RESIGNATION', 'DISMISSAL', 'OTHER']),
  endNote: z.string().trim().max(500).nullish(),
});

// Rehiring opens a new employment. fullTimeSince defaults to the rehire date; supplying it
// only makes sense to correct a conversion recorded late, exactly as on the employee form.
export const rehireSchema = z.object({
  startDate: z.coerce.date(),
  contractStartDate: z.coerce.date().nullish(),
  contractEndDate: z.coerce.date().nullish(),
  fullTimeSince: z.coerce.date().nullish(),
});

export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
export type EmployeeInput = z.infer<typeof createEmployeeSchema>;
export type TerminateInput = z.infer<typeof terminateSchema>;
export type RehireInput = z.infer<typeof rehireSchema>;
