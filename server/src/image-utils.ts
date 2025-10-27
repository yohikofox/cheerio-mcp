import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { existsSync } from 'fs';

export interface DownloadImageResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  size?: number;
  mimeType?: string;
  error?: string;
}

export interface ImageToBase64Result {
  success: boolean;
  base64?: string;
  mimeType?: string;
  size?: number;
  error?: string;
}

/**
 * Download file from URL using native fetch API
 */
async function downloadFromUrl(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = response.headers.get('content-type') || 'application/octet-stream';

  return { buffer, mimeType };
}

/**
 * Download an image from a URL and save it to the file system
 * @param url - The URL of the image to download
 * @param outputPath - Optional custom output path. If not provided, saves to ./downloads/{random-name}
 * @returns Download result with file path and metadata
 */
export async function downloadImage(url: string, outputPath?: string): Promise<DownloadImageResult> {
  try {
    console.log(`[ImageUtils] Downloading image from: ${url}`);

    // Download the image
    const { buffer, mimeType } = await downloadFromUrl(url);

    // Determine file extension from MIME type
    const extension = mimeType.split('/')[1]?.split(';')[0] || 'bin';

    // Generate output path if not provided
    let finalOutputPath: string;
    if (outputPath) {
      finalOutputPath = outputPath;
    } else {
      // Create downloads directory if it doesn't exist
      const downloadsDir = path.join(process.cwd(), 'downloads');
      if (!existsSync(downloadsDir)) {
        await fs.mkdir(downloadsDir, { recursive: true });
      }

      // Generate a unique filename
      const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
      const timestamp = Date.now();
      const fileName = `image_${timestamp}_${hash}.${extension}`;
      finalOutputPath = path.join(downloadsDir, fileName);
    }

    // Save the image
    await fs.writeFile(finalOutputPath, buffer);

    const stats = await fs.stat(finalOutputPath);

    console.log(`[ImageUtils] Image saved successfully: ${finalOutputPath} (${stats.size} bytes)`);

    return {
      success: true,
      filePath: finalOutputPath,
      fileName: path.basename(finalOutputPath),
      size: stats.size,
      mimeType,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ImageUtils] Failed to download image: ${errorMessage}`);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Convert an image to base64 format
 * @param input - Either a URL (http/https) or a local file path
 * @returns Base64 encoded image with metadata
 */
export async function imageToBase64(input: string): Promise<ImageToBase64Result> {
  try {
    console.log(`[ImageUtils] Converting image to base64: ${input}`);

    let buffer: Buffer;
    let mimeType: string;

    // Check if input is a URL
    if (input.startsWith('http://') || input.startsWith('https://')) {
      // Download the image first
      const result = await downloadFromUrl(input);
      buffer = result.buffer;
      mimeType = result.mimeType;
    } else {
      // Read from local file
      if (!existsSync(input)) {
        throw new Error(`File not found: ${input}`);
      }

      buffer = await fs.readFile(input);

      // Detect MIME type from file extension
      const ext = path.extname(input).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
      };

      mimeType = mimeTypes[ext] || 'application/octet-stream';
    }

    // Convert to base64
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    console.log(`[ImageUtils] Image converted successfully (${buffer.length} bytes)`);

    return {
      success: true,
      base64: dataUrl,
      mimeType,
      size: buffer.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ImageUtils] Failed to convert image to base64: ${errorMessage}`);

    return {
      success: false,
      error: errorMessage,
    };
  }
}
