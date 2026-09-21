import type { Api } from "../../shared/types";
declare global {
  interface Window {
    relay: Api;
  }
}
export const api = window.relay;
