// Use field paths and validation messages, never submitted values or raw errors.
export function validationMessage(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}) {
  const issue = error.issues[0];
  if (!issue) return 'Check the required fields in this form.';
  const field = issue.path
    .map((part) =>
      typeof part === 'number'
        ? `item ${part + 1}`
        : String(part)
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replaceAll('_', ' '),
    )
    .join(' → ');
  return `${field ? field.charAt(0).toUpperCase() + field.slice(1) : 'Form details'}: ${issue.message}`;
}
