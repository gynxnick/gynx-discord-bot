import { apiRoute } from '@/server/api';

export const dynamic = 'force-dynamic';

/** The signed-in user's identity and effective permissions (for client components). */
export const GET = apiRoute({}, async ({ session }) => ({
  user: { id: session.userId, username: session.username, avatar: session.avatar },
  permissions: [...session.permissions].sort(),
  expiresAt: session.expiresAt.toISOString(),
}));
