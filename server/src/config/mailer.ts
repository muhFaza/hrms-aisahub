import nodemailer, { type Transporter } from 'nodemailer';
import { env } from './env';

// Factory only — sending logic is added in later phases (leave/payroll notifications).
export function createMailer(): Transporter {
  return nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
}

export const mailer = createMailer();
