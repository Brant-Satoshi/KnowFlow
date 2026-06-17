import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 8;

export const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH),
});

export type Credentials = z.infer<typeof credentialsSchema>;
