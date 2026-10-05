// A stand-in voice engine for the read aloud spec. Its "model" is a file the
// spec serves over http; it speaks a tone, passed through a one-node ONNX
// graph so onnxruntime really runs in the worker. It notes what it does in
// RELAY_TEST_READ_ALOUD_LOG, and "crash now" in the text kills the worker.
const { appendFileSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const log = (line) => {
  if (process.env.RELAY_TEST_READ_ALOUD_LOG)
    appendFileSync(process.env.RELAY_TEST_READ_ALOUD_LOG, `${line}\n`);
};

const rate = 24000;
const frame = rate / 20;

/** Protobuf, just enough of it for an ONNX model. */
const varint = (n) => {
  const out = [];
  while (n > 127) {
    out.push((n & 127) | 128);
    n >>>= 7;
  }
  out.push(n);
  return out;
};
const field = (no, bytes) => [
  ...varint((no << 3) | 2),
  ...varint(bytes.length),
  ...bytes,
];
const number = (no, n) => [...varint(no << 3), ...varint(n)];
const text = (no, s) => field(no, [...Buffer.from(s)]);

/** y = -x over a float vector of any length. */
function negModel() {
  const vector = (name) =>
    field(11 + (name === "y" ? 1 : 0), [
      ...text(1, name),
      // type { tensor_type { elem_type: FLOAT, shape { dim { dim_param: "n" } } } }
      ...field(
        2,
        field(1, [...number(1, 1), ...field(2, field(1, text(2, "n")))]),
      ),
    ]);
  const graph = [
    ...field(1, [...text(1, "x"), ...text(2, "y"), ...text(4, "Neg")]),
    ...text(2, "tone"),
    ...vector("x"),
    ...vector("y"),
  ];
  return Uint8Array.from([
    ...number(1, 8),
    ...field(7, graph),
    ...field(8, number(2, 13)),
  ]);
}

exports.engine = {
  id: "test-tone",
  name: "Test tone",
  credit: "A sine wave by the read aloud spec, no license needed",
  files: JSON.parse(process.env.RELAY_TEST_READ_ALOUD_FILES || "[]"),
  voices: [
    { id: "low", name: "Low hum", language: "en" },
    { id: "high", name: "High hum", language: "en" },
  ],
  async load(ort, dir, threads) {
    const file = readFileSync(join(dir, "tone.bin"));
    if (file.subarray(0, 10).toString() !== "fake model")
      throw new Error("The test model is missing.");
    const session = await ort.InferenceSession.create(negModel(), {
      intraOpNumThreads: threads,
    });
    log("load");
    return {
      sampleRate: rate,
      async speak(words, voice, onAudio, signal) {
        log(`speak ${voice} ${words}`);
        if (words.includes("crash now")) process.abort();
        const hz = voice === "high" ? 660 : 330;
        // A tenth of a second per word, made at twice the speed it plays.
        const total = Math.max(1, words.split(/\s+/).length) * (rate / 10);
        for (let at = 0; at < total && !signal.aborted; at += frame) {
          const x = new Float32Array(frame);
          for (let i = 0; i < frame; i++)
            x[i] = -0.3 * Math.sin((2 * Math.PI * hz * (at + i)) / rate);
          const { y } = await session.run({
            x: new ort.Tensor("float32", x, [frame]),
          });
          onAudio(y.data);
          await new Promise((r) => setTimeout(r, 25));
        }
        if (signal.aborted) log("stopped");
      },
      async release() {
        log("release");
        await session.release();
      },
    };
  },
};
