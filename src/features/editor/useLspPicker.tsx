import { useState } from "react";
import type { OpenTarget } from "./editor-types";
import { SymbolPicker, type PickItem } from "./SymbolPicker";

export type Picker = {
  title: string;
  empty: string;
  /** Undefined while the server is still answering. */
  items?: PickItem[];
};

/** The list the language server's answers pop up, and a pick that opens its place. */
export function useLspPicker(onOpen: (target: OpenTarget) => void) {
  const [picker, setPicker] = useState<Picker>();
  const jump = (item: PickItem) => {
    setPicker(undefined);
    onOpen({
      path: item.path,
      line: item.line,
      column: item.column,
      outside: item.outside,
    });
  };
  const view = picker && (
    <SymbolPicker
      title={picker.title}
      items={picker.items}
      loading={!picker.items}
      empty={picker.empty}
      onPick={jump}
      onClose={() => setPicker(undefined)}
    />
  );
  return { show: setPicker, jump, view };
}
