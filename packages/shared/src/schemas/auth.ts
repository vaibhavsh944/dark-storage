import { z } from 'zod';
import { ROLES } from '../enums.js';

export const loginRequestSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userDtoSchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  display_name: z.string(),
  role: z.enum(ROLES),
  active: z.number().int()
});

export type UserDto = z.infer<typeof userDtoSchema>;

export interface AuthResponse {
  token: string;
  user: {
    id: number | string;
    username: string;
    display_name: string;
    role: (typeof ROLES)[number];
    zones?: string[];
    shift?: string;
  };
  permissions?: string[];
}
