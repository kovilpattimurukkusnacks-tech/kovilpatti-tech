// Shops type special labels freehand ("Elite,laddu,Noodles", "  soup  powder").
// Normalise for display only: one space after each comma, collapsed runs
// of whitespace, trimmed ends, no trailing comma. The stored value is untouched.
export function formatSpecialLabel(label: string | null | undefined): string {
  if (!label) return ''
  return label
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/,$/, '')
}
