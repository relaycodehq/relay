import type { ReadAloudEngine } from "../engine";
import { pocketTts } from "./pocket";
import { supertonic } from "./supertonic";

// Pocket first: with none picked, the first downloaded engine reads, and Pocket
// starts speaking fastest. Supertonic is the one for languages besides English.
export const readAloudEngines: ReadAloudEngine[] = [pocketTts, supertonic];
