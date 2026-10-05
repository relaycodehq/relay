import type { DictationModelFile } from "../../../shared/dictation";
import type { ReadAloudEngine } from "../engine";
import { loadPocket, modelFiles, voiceFile } from "./pocket/model";

const onnx =
  "https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/58a6d00cf13d239b6748cb0769f35c580a8f606c/onnx/english_2026-04";
const embeddings =
  "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/1e08e6a23401048648a9fdcfde2f89348215c2a7/languages/english_2026-04/embeddings";

const model: Record<keyof typeof modelFiles, [size: number, sha256: string]> = {
  bundle: [
    24381,
    "bab643150f437f37df080a710520ff39ed9ebd9a339f8ebdc739f7eddfc28b3f",
  ],
  tokenizer: [
    59339,
    "d461765ae179566678c93091c5fa6f2984c31bbe990bf1aa62d92c64d91bc3f6",
  ],
  conditioner: [
    16388344,
    "4ecee995fb69f85c7a7493d11f7b5ee15d9950facc7ab3f5c9c49ef1e03847bb",
  ],
  flowLm: [
    76341079,
    "f9bd8106b79a0192c1c43399ab938fb24900a95c1c599870d75a884e99000116",
  ],
  flow: [
    9962530,
    "3dd781ee5abee9e195320bf0106bebd6372a852b3b36352524ee78b40554635d",
  ],
  decoder: [
    41471926,
    "86f038caa02a96a0ff9c25526a0ff43a4906c418197ed72d3e30f720ac7ce802",
  ],
};

// Kyutai's English voices whose recordings allow it (kyutai/tts-voices): Alba
// MacKenna and VCTK are CC BY 4.0, Voice-Zero (LibriVox) and the Unmute
// donations (javert, marius) CC0. Left out: cosette (Expresso) and jean (EARS)
// are CC BY-NC, and the folder's other six speak other languages.
const voices: [id: string, name: string, size: number, sha256: string][] = [
  [
    "alba",
    "Alba",
    6194424,
    "69c32db63ca56843d994f81f343f62e0bf2d73f7e4c9bc73e44bb1110b1d8845",
  ],
  [
    "anna",
    "Anna",
    7816440,
    "5ea82f78db006c9fd34e32ddd5aae82674b5b32646097977436458d00af80dfa",
  ],
  [
    "azelma",
    "Azelma",
    7963896,
    "9f3e69f29075f991fd47774566865ef0e0e637cb5a35992c9919761b5b84b1de",
  ],
  [
    "bill_boerst",
    "Bill",
    6735096,
    "75610127d44e0b05b442154f80f89f993df235aecc6cad7070f11000d006c188",
  ],
  [
    "caro_davy",
    "Caro",
    5260536,
    "a5961b63a2e7a5cfd7edc383aa9042fb70fd14a9dee6310cdc633881a7f2449a",
  ],
  [
    "charles",
    "Charles",
    6194424,
    "299edc20182eeccfbf94e308626f259da4fbf339daa8d5905218f2b1774639b8",
  ],
  [
    "eponine",
    "Eponine",
    6931704,
    "bda3b76a384ff355fe0350736387765946304ae8ca16e59f60ea3296a1c99cc6",
  ],
  [
    "eve",
    "Eve",
    6538488,
    "ea9c2faf862a6c9d2cb61910fdf02842ae56940382cc8c1000fdb1b43269692b",
  ],
  [
    "fantine",
    "Fantine",
    6538488,
    "51a8a4355d7f912d4959e4b1918314fda85ad47eba0a33a1d78a4a505d3465f5",
  ],
  [
    "george",
    "George",
    6243576,
    "0c1c6c57c55a98d81254b33728150c7776f40647fe95258d1a6c1a02780b5d02",
  ],
  [
    "jane",
    "Jane",
    7374072,
    "37386227ca8ec5bf1b8e516c13d132ce5ff5437a304fe90129a1c62f41d9a008",
  ],
  [
    "javert",
    "Javert",
    6194424,
    "0ae88e03ca4e76a0e16cbf321a807428febda9d9e9bc0358c02e7f9c9e2c263b",
  ],
  [
    "marius",
    "Marius",
    6194424,
    "04f84efcb77a0547ba582c058db496f7ff4920891d49d37b9950d128422582a8",
  ],
  [
    "mary",
    "Mary",
    6194424,
    "a8f2adf260cab966fe0a113d6b549d6efdeaa79de544ae0ff34b5b6a41445a59",
  ],
  [
    "michael",
    "Michael",
    7275768,
    "8937f724ac4719b9aa51ea0ba1f18f9de0af7a663ad6263558266c1a53c9722d",
  ],
  [
    "paul",
    "Paul",
    6980856,
    "ed7a019168f94dfe77009f1b0de59387abc6fbb0db954d38ce722ecb77da61aa",
  ],
  [
    "peter_yearsley",
    "Peter",
    3736816,
    "dd977a6e15591e347c9a23fa7cc09e35a65b462917f5eeb162baff6dc9e3f685",
  ],
  [
    "stuart_bell",
    "Stuart",
    5260536,
    "5a49da7ca5df05d02587ec4a0981c0d318e045f68e24423c4203ce474d9b33dc",
  ],
  [
    "vera",
    "Vera",
    6735096,
    "4bf50ddd957b5d218b264fdcf18efbbc7384d12da3eca98ca19b9e8dd6976acc",
  ],
];

/** Kyutai's Pocket TTS (english_2026-04), 100M parameters, through KevinAHM's ONNX export. */
export const pocketTts: ReadAloudEngine = {
  id: "pocket-tts",
  name: "Pocket TTS",
  credit:
    "Kyutai, CC BY 4.0; ONNX export by KevinAHM. Voices: Alba MacKenna and the VCTK corpus (University of Edinburgh), CC BY 4.0; LibriVox readers and Unmute donors, CC0.",
  license: "https://creativecommons.org/licenses/by/4.0/",
  files: [
    ...Object.entries(model).map(([key, [size, sha256]]) => {
      const name = modelFiles[key as keyof typeof modelFiles];
      return { name, url: `${onnx}/${name}`, size, sha256 };
    }),
    ...voices.map(([id, , size, sha256]) => ({
      name: voiceFile(id),
      url: `${embeddings}/${id}.safetensors`,
      size,
      sha256,
    })),
  ] satisfies DictationModelFile[],
  voices: voices.map(([id, name]) => ({ id, name, language: "en" })),
  load: (ort, dir, threads) => loadPocket(ort, dir, threads),
};
