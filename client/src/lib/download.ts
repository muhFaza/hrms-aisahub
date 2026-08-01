import { apiClient } from '../api/client';

// Auth is a bearer header rather than a cookie, so a plain <a href download> would hit the
// export endpoints unauthenticated. Every download goes through the axios instance, which
// attaches the token, and is handed to the browser as an object URL.

export interface DownloadResult {
  filename: string;
  included?: number;
  excluded?: number;
}

function filenameFrom(header: unknown, fallback: string): string {
  if (typeof header !== 'string') return fallback;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1] ?? fallback;
}

// The server reports how many rows a payout file left out; surfaced so the UI can say so.
function countHeader(value: unknown): number | undefined {
  const parsed = Number(value);
  return value === undefined || Number.isNaN(parsed) ? undefined : parsed;
}

export async function downloadFile(url: string, fallbackName: string): Promise<DownloadResult> {
  const response = await apiClient.get<Blob>(url, { responseType: 'blob' });
  const filename = filenameFrom(response.headers['content-disposition'], fallbackName);

  const objectUrl = URL.createObjectURL(response.data);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoking synchronously can cancel the download in some browsers; one tick is enough for
    // the click to have been handed off.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  return {
    filename,
    included: countHeader(response.headers['x-export-included']),
    excluded: countHeader(response.headers['x-export-excluded']),
  };
}

// An error body from these endpoints arrives as a Blob because responseType is 'blob', so the
// usual `error.response.data.error` read yields nothing. This unwraps it back to a message.
export async function downloadErrorMessage(err: unknown, fallback: string): Promise<string> {
  const data = (err as { response?: { data?: unknown } }).response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text()) as { error?: string };
      return parsed.error ?? fallback;
    } catch {
      return fallback;
    }
  }
  if (typeof data === 'object' && data !== null && 'error' in data) {
    return String((data as { error: unknown }).error);
  }
  return fallback;
}
