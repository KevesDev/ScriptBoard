import '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    screenplayShortcuts: {
      setNode: (type: string) => ReturnType;
    };
    screenplayTabCycle: {
      cycleScreenplayNode: () => ReturnType;
    };
    screenplayPagination: {
      repaginateScript: () => ReturnType;
      stripScriptPageBreaks: () => ReturnType;
    };
  }
}