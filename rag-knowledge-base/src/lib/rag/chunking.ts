export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 200;

const SEPARATORS = ["\n\n", "\n", ". ", " ", ""] as const;

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const chunkSize = opts.chunkSize ?? CHUNK_SIZE;
  const chunkOverlap = opts.chunkOverlap ?? CHUNK_OVERLAP;
  if (chunkOverlap >= chunkSize) {
    throw new Error(
      `chunkOverlap (${chunkOverlap}) must be less than chunkSize (${chunkSize})`,
    );
  }
  const pieces = splitRecursively(text, [...SEPARATORS], chunkSize);
  return mergeWithOverlap(pieces, chunkSize, chunkOverlap);
}

function splitRecursively(
  text: string,
  separators: string[],
  chunkSize: number,
): string[] {
  if (text.length === 0) return [];
  if (text.length <= chunkSize) return [text];

  const separator = separators[0];
  const remaining = separators.slice(1);

  if (separator === "") {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      out.push(text.slice(i, i + chunkSize));
    }
    return out;
  }

  return text.split(separator).flatMap((piece) =>
    piece.length === 0
      ? []
      : piece.length <= chunkSize
        ? [piece]
        : splitRecursively(piece, remaining, chunkSize),
  );
}

function mergeWithOverlap(
  pieces: string[],
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    const sep = current.length > 0 ? " " : "";
    if (current.length + sep.length + piece.length <= chunkSize) {
      current += sep + piece;
      continue;
    }
    if (current.length > 0) chunks.push(current);
    const maxOverlap = Math.max(
      0,
      Math.min(chunkOverlap, chunkSize - piece.length - 1),
    );
    const tail = maxOverlap > 0 ? current.slice(-maxOverlap) : "";
    current = tail + (tail ? " " : "") + piece;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
