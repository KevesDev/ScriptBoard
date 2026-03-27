import '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    repaginateScript: () => ReturnType;
    stripScriptPageBreaks: () => ReturnType;
  }
}
