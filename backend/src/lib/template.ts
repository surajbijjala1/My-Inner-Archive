/**
 * template.ts
 * Fills {{SLOT}} placeholders in a prompt template with untrusted text.
 *
 * The classifiers used chained `template.replace("{{A}}", a).replace("{{B}}", b)`,
 * which is unsafe when the values come from a user or a model:
 *
 * - The second replace scans text the first one just inserted. A user turn
 *   containing the literal "{{REPLY}}" (or "{{MESSAGE}}") captured the value
 *   meant for the real slot, leaving the slot the classifier actually judges
 *   empty — the boundary audit and the crisis gate then graded a blank.
 * - A string replacement interprets `$&`, `` $` `` and `$'`, so a message
 *   containing those spliced pieces of the prompt into itself.
 *
 * This fills every slot in ONE pass over the template only, and inserts values
 * literally, so nothing a value contains is ever treated as a slot or pattern.
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (slot: string, name: string) =>
    Object.hasOwn(values, name) ? values[name] : slot
  );
}
