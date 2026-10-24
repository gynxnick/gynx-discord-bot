/** Pure helpers for the template form (unit tested). */

export interface TemplateDraft {
  name: string;
  type: string;
  title: string;
  body: string;
}

/** Client-side mirror of the service's template schema. Keys match API issue paths. */
export function templateErrors(d: TemplateDraft): Record<string, string> {
  const errs: Record<string, string> = {};
  const name = d.name.trim();
  if (!name) errs.name = 'Add a name.';
  else if (name.length > 64) errs.name = 'At most 64 characters.';
  if (!d.title.trim()) errs.title = 'Add a title.';
  else if (d.title.trim().length > 256) errs.title = 'At most 256 characters.';
  if (!d.body.trim()) errs.body = 'Write the template text.';
  else if (d.body.trim().length > 4000) errs.body = 'At most 4,000 characters.';
  return errs;
}
