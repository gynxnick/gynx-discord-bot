import { getDeps, getLogger } from '@/server/deps';
import { handleRedirect } from './redirect';

export const dynamic = 'force-dynamic';

/** GET /r/:slug — public tracked-link redirect (no session, no visitor data stored). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  try {
    return await handleRedirect(req, slug, getDeps());
  } catch (err) {
    getLogger().error({ err: { message: (err as Error).message } }, 'tracked link redirect failed');
    return new Response('Something went wrong. Please try again later.', {
      status: 500,
      headers: {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }
}
