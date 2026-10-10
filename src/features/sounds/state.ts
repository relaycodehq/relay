import { api } from "../../lib/api";

export const soundSettingsQuery = {
  queryKey: ["sound-settings"],
  queryFn: () => api.soundSettings(),
  staleTime: Infinity,
};

export const customSoundsQuery = {
  queryKey: ["custom-sounds"],
  queryFn: () => api.customSounds(),
  staleTime: Infinity,
};
