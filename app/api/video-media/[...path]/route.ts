import { relayVideoMedia } from "@/lib/video-media-relay";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  return relayVideoMedia(request, path, process.env.NEXT_PUBLIC_API_BASE_URL);
}
