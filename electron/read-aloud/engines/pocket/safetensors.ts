/** Reads the float32 and int64 tensors of a `.safetensors` file. */

export type StoredTensor =
  | { dtype: "float32"; shape: number[]; data: Float32Array }
  | { dtype: "int64"; shape: number[]; data: BigInt64Array };

export function readSafetensors(file: Uint8Array): Map<string, StoredTensor> {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const headerLength = Number(view.getBigUint64(0, true));
  const header = JSON.parse(
    new TextDecoder().decode(file.subarray(8, 8 + headerLength)),
  ) as Record<
    string,
    { dtype: string; shape: number[]; data_offsets: [number, number] }
  >;
  const tensors = new Map<string, StoredTensor>();
  for (const [name, entry] of Object.entries(header)) {
    if (name === "__metadata__") continue;
    const [start, end] = entry.data_offsets;
    // Copied so the typed array is aligned, which the file's offsets don't promise.
    // (Buffer#slice would share memory, so this slices the ArrayBuffer.)
    const at = file.byteOffset + 8 + headerLength;
    const bytes = file.buffer.slice(at + start, at + end);
    if (entry.dtype === "F32")
      tensors.set(name, {
        dtype: "float32",
        shape: entry.shape,
        data: new Float32Array(bytes),
      });
    else if (entry.dtype === "I64")
      tensors.set(name, {
        dtype: "int64",
        shape: entry.shape,
        data: new BigInt64Array(bytes),
      });
    else throw new Error(`${name} is ${entry.dtype}, which isn't supported.`);
  }
  return tensors;
}
