import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Optional: Add any logic before generating the upload token
        return {
          allowedContentTypes: [
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
          ],
          maximumSizeInBytes: 10 * 1024 * 1024, // 10MB limit
          addRandomSuffix: true, // Generate unique filenames to avoid conflicts
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Optional: Add any logic after the upload is completed
        console.log('Blob upload completed:', blob.url);
      },
    });

    return Response.json(jsonResponse);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
