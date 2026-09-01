// SnClipper/src/utils/paths.ts
// Shared file-path helpers used by both the background handler (index.js) and the UI
// (App.tsx), so the derivation logic stays in one place.

// Document formats the reader renders (as opposed to editable .note files).
export const DOC_EXTENSIONS = ['.pdf', '.epub', '.txt', '.cbz', '.fb2'];

// Derive a human-readable document title from an absolute file path.
export const deriveArticleName = (filePath?: string | null): string => {
  if (!filePath) return 'Unknown Document';
  return filePath.substring(filePath.lastIndexOf('/') + 1) || 'Unknown Document';
};

// True when the path points at a rendered document (PDF/EPUB/…) rather than a note.
export const isDocFile = (filePath?: string | null): boolean => {
  if (!filePath) return false;
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  return DOC_EXTENSIONS.includes(ext);
};

// True when the path points at an editable note file (.note, .not, or extensionless note).
export const isNoteFile = (filePath?: string | null): boolean => {
  if (!filePath) return false;
  return !isDocFile(filePath);
};
