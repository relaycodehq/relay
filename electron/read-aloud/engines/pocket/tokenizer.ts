/**
 * SentencePiece unigram tokenizer, read straight from a `tokenizer.model`.
 *
 * Covers what Pocket TTS's tokenizer uses: the identity normalizer, a dummy
 * prefix, spaces escaped as "▁" and byte fallback for characters with no
 * piece. Encoding is SentencePiece's Viterbi search, ties included, so the
 * ids match the reference implementation.
 */

const space = "▁";
// SentencePiece scores an unknown character this far below the worst piece.
const unknownPenalty = 10;

enum PieceType {
  Normal = 1,
  Unknown = 2,
  Control = 3,
  UserDefined = 4,
  Unused = 5,
  Byte = 6,
}

interface Piece {
  text: string;
  score: number;
  type: PieceType;
}

export class SentencePiece {
  private readonly pieces: Piece[];
  private readonly ids = new Map<string, number>();
  private readonly byteIds: number[] = [];
  private readonly longest: number;
  private readonly unknownId: number;
  private readonly unknownScore: number;
  private readonly addDummyPrefix: boolean;

  constructor(model: Uint8Array) {
    const { pieces, normalizer } = readModel(model);
    if (normalizer.name !== "identity")
      throw new Error(
        `The tokenizer's "${normalizer.name}" normalizer isn't supported.`,
      );
    if (normalizer.removeExtraWhitespaces || !normalizer.escapeWhitespaces)
      throw new Error("The tokenizer's whitespace handling isn't supported.");
    this.pieces = pieces;
    this.addDummyPrefix = normalizer.addDummyPrefix;
    let longest = 1;
    let minScore = Infinity;
    let unknownId = 0;
    pieces.forEach((piece, id) => {
      if (
        piece.type === PieceType.Normal ||
        piece.type === PieceType.UserDefined
      ) {
        this.ids.set(piece.text, id);
        longest = Math.max(longest, [...piece.text].length);
      }
      if (piece.type === PieceType.Normal)
        minScore = Math.min(minScore, piece.score);
      if (piece.type === PieceType.Unknown) unknownId = id;
      const byte = /^<0x([0-9A-F]{2})>$/.exec(piece.text);
      if (piece.type === PieceType.Byte && byte)
        this.byteIds[parseInt(byte[1], 16)] = id;
    });
    this.longest = longest;
    this.unknownId = unknownId;
    this.unknownScore = minScore - unknownPenalty;
  }

  get size() {
    return this.pieces.length;
  }

  /** The piece's text with "▁" for spaces, for telling where words start; empty for bytes and control pieces. */
  piece(id: number) {
    const piece = this.pieces[id];
    return piece?.type === PieceType.Normal ||
      piece?.type === PieceType.UserDefined
      ? piece.text
      : "";
  }

  encode(text: string): number[] {
    const chars = [
      ...((this.addDummyPrefix ? " " : "") + text).replaceAll(" ", space),
    ];
    const n = chars.length;
    const best = new Float64Array(n + 1).fill(-Infinity);
    // For each end position: where the last piece starts, and its id (-1 for an unknown character).
    const from = new Int32Array(n + 1).fill(-1);
    const via = new Int32Array(n + 1);
    best[0] = 0;
    for (let start = 0; start < n; start++) {
      let single = false;
      let candidate = "";
      for (
        let length = 1;
        length <= this.longest && start + length <= n;
        length++
      ) {
        candidate += chars[start + length - 1];
        const id = this.ids.get(candidate);
        if (id === undefined) continue;
        if (length === 1) single = true;
        const score = best[start] + this.pieces[id].score;
        const end = start + length;
        if (from[end] < 0 || score > best[end]) {
          best[end] = score;
          from[end] = start;
          via[end] = id;
        }
      }
      if (!single) {
        const score = best[start] + this.unknownScore;
        if (from[start + 1] < 0 || score > best[start + 1]) {
          best[start + 1] = score;
          from[start + 1] = start;
          via[start + 1] = -1;
        }
      }
    }
    const ids: number[] = [];
    for (let end = n; end > 0; end = from[end]) {
      if (via[end] >= 0) {
        ids.push(via[end]);
        continue;
      }
      const bytes = new TextEncoder().encode(chars[from[end]]);
      if (this.byteIds.length === 256)
        for (let i = bytes.length - 1; i >= 0; i--)
          ids.push(this.byteIds[bytes[i]]);
      else ids.push(this.unknownId);
    }
    return ids.reverse();
  }

  decode(ids: number[]): string {
    let text = "";
    let bytes: number[] = [];
    const flush = () => {
      if (!bytes.length) return;
      text += new TextDecoder().decode(new Uint8Array(bytes));
      bytes = [];
    };
    for (const id of ids) {
      const piece = this.pieces[id];
      if (!piece) continue;
      if (piece.type === PieceType.Byte) {
        bytes.push(parseInt(piece.text.slice(3, 5), 16));
        continue;
      }
      flush();
      if (piece.type === PieceType.Unknown) text += " ⁇ ";
      else if (piece.type !== PieceType.Control) text += piece.text;
    }
    flush();
    text = text.replaceAll(space, " ");
    return this.addDummyPrefix && text.startsWith(" ") ? text.slice(1) : text;
  }
}

interface Normalizer {
  name: string;
  addDummyPrefix: boolean;
  removeExtraWhitespaces: boolean;
  escapeWhitespaces: boolean;
}

/** Reads the parts of SentencePiece's ModelProto the tokenizer needs. */
function readModel(bytes: Uint8Array) {
  const pieces: Piece[] = [];
  const normalizer: Normalizer = {
    name: "",
    addDummyPrefix: true,
    removeExtraWhitespaces: true,
    escapeWhitespaces: true,
  };
  for (const field of fields(bytes)) {
    if (field.number === 1 && field.bytes) {
      const piece: Piece = { text: "", score: 0, type: PieceType.Normal };
      for (const inner of fields(field.bytes)) {
        if (inner.number === 1 && inner.bytes)
          piece.text = new TextDecoder().decode(inner.bytes);
        else if (inner.number === 2 && inner.float !== undefined)
          piece.score = inner.float;
        else if (inner.number === 3) piece.type = Number(inner.varint);
      }
      pieces.push(piece);
    } else if (field.number === 3 && field.bytes) {
      for (const inner of fields(field.bytes)) {
        if (inner.number === 1 && inner.bytes)
          normalizer.name = new TextDecoder().decode(inner.bytes);
        else if (inner.number === 3)
          normalizer.addDummyPrefix = inner.varint !== 0n;
        else if (inner.number === 4)
          normalizer.removeExtraWhitespaces = inner.varint !== 0n;
        else if (inner.number === 5)
          normalizer.escapeWhitespaces = inner.varint !== 0n;
      }
    }
  }
  if (!pieces.length) throw new Error("The tokenizer has no pieces.");
  return { pieces, normalizer };
}

interface Field {
  number: number;
  varint?: bigint;
  float?: number;
  bytes?: Uint8Array;
}

function* fields(bytes: Uint8Array): Generator<Field> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const varint = () => {
    let value = 0n;
    for (let shift = 0n; ; shift += 7n) {
      if (at >= bytes.length) throw new Error("The tokenizer file is cut off.");
      const byte = bytes[at++];
      value |= BigInt(byte & 0x7f) << shift;
      if (byte < 0x80) return value;
    }
  };
  while (at < bytes.length) {
    const key = Number(varint());
    const number = key >>> 3;
    switch (key & 7) {
      case 0:
        yield { number, varint: varint() };
        break;
      case 1:
        at += 8;
        break;
      case 2: {
        const length = Number(varint());
        yield { number, bytes: bytes.subarray(at, at + length) };
        at += length;
        break;
      }
      case 5:
        yield { number, float: view.getFloat32(at, true) };
        at += 4;
        break;
      default:
        throw new Error("The tokenizer file isn't a SentencePiece model.");
    }
  }
}
