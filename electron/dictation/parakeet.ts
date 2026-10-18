import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type * as Ort from "onnxruntime-node";
import { featureBands, logMel } from "./features";

/** Tokens one encoder frame may emit before decoding moves on regardless. */
const maxPerFrame = 10;

/**
 * NVIDIA Parakeet TDT on onnxruntime: the encoder hears the whole clip, then
 * greedy decoding walks its frames, the joiner answering each step with a
 * token and how many frames to skip.
 */
export async function loadParakeet(
  ort: typeof Ort,
  dir: string,
  threads: number,
) {
  const open = (name: string, threads: number) =>
    ort.InferenceSession.create(join(dir, name), {
      intraOpNumThreads: threads,
      interOpNumThreads: 1,
      executionMode: "sequential",
      graphOptimizationLevel: "all",
    });
  // The decoder and joiner run once per token on a handful of numbers; more threads only cost.
  const [encoder, decoder, joiner, vocabulary] = await Promise.all([
    open("encoder.int8.onnx", threads),
    open("decoder.int8.onnx", 1),
    open("joiner.int8.onnx", 1),
    readFile(join(dir, "tokens.txt"), "utf8"),
  ]);
  // "▁fix 1234" per line, the blank last.
  const tokens = vocabulary
    .trimEnd()
    .split("\n")
    .map((line) => line.slice(0, line.lastIndexOf(" ")));
  const blank = tokens.length - 1;

  // NeMo's export names the prediction network's LSTM state oddly; by position they're h and c.
  const [targetsIn, lengthIn, hIn, cIn] = decoder.inputNames as [
    string,
    string,
    string,
    string,
  ];
  const [decoderOut, , hOut, cOut] = decoder.outputNames as [
    string,
    string,
    string,
    string,
  ];
  // [layers, batch, hidden]; the batch is left open in the export.
  const [layers, , hidden] = (
    decoder.inputMetadata[2] as Ort.InferenceSession.TensorValueMetadata
  ).shape as [number, unknown, number];
  const [audioIn, audioLengthIn] = encoder.inputNames as [string, string];
  const [encodedOut, encodedLengthOut] = encoder.outputNames as [
    string,
    string,
  ];
  const [joinerEncoderIn, joinerDecoderIn] = joiner.inputNames as [
    string,
    string,
  ];
  const one = new ort.Tensor("int32", Int32Array.of(1), [1]);

  type Prediction = { out: Ort.Tensor; h: Ort.Tensor; c: Ort.Tensor };
  const predict = async (
    token: number,
    h: Ort.Tensor,
    c: Ort.Tensor,
  ): Promise<Prediction> => {
    const result = await decoder.run({
      [targetsIn]: new ort.Tensor("int32", Int32Array.of(token), [1, 1]),
      [lengthIn]: one,
      [hIn]: h,
      [cIn]: c,
    });
    return { out: result[decoderOut]!, h: result[hOut]!, c: result[cOut]! };
  };

  return {
    /** Transcribes one phrase of 16 kHz samples. */
    async decode(samples: Float32Array) {
      const features = logMel(samples);
      const encoded = await encoder.run({
        [audioIn]: new ort.Tensor("float32", features.data, [
          1,
          featureBands,
          features.frames,
        ]),
        [audioLengthIn]: new ort.Tensor(
          "int64",
          BigInt64Array.of(BigInt(features.frames)),
          [1],
        ),
      });
      const frames = encoded[encodedOut]!,
        [, width, stride] = frames.dims as [number, number, number],
        data = frames.data as Float32Array,
        length = Number((encoded[encodedLengthOut]!.data as BigInt64Array)[0]);

      const zero = () =>
        new ort.Tensor("float32", new Float32Array(layers * hidden), [
          layers,
          1,
          hidden,
        ]);
      let prediction = await predict(blank, zero(), zero());
      const said: number[] = [];
      const frame = new Float32Array(width);
      for (let t = 0, emitted = 0; t < length;) {
        for (let i = 0; i < width; i++) frame[i] = data[i * stride + t]!;
        const logits = (
          await joiner.run({
            [joinerEncoderIn]: new ort.Tensor("float32", frame, [1, width, 1]),
            [joinerDecoderIn]: prediction.out,
          })
        )[joiner.outputNames[0]!]!.data as Float32Array;
        // Token scores first, then one score per duration: 0, 1, 2… frames.
        let token = 0;
        for (let i = 1; i <= blank; i++)
          if (logits[i]! > logits[token]!) token = i;
        let skip = 0;
        for (let i = 1; blank + 1 + i < logits.length; i++)
          if (logits[blank + 1 + i]! > logits[blank + 1 + skip]!) skip = i;
        if (token !== blank) {
          said.push(token);
          emitted++;
          prediction = await predict(token, prediction.h, prediction.c);
        }
        if (skip > 0) {
          t += skip;
          emitted = 0;
        } else if (token === blank || emitted >= maxPerFrame) {
          t++;
          emitted = 0;
        }
      }
      return said
        .map((token) => tokens[token])
        .join("")
        .replace(/▁/g, " ")
        .trim();
    },
  };
}
