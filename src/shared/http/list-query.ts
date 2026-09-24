import { z } from 'zod';

export const listQuerySchema = z.strictObject({
  userId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
