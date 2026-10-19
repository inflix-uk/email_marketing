/** "Hi {{first_name | there}}" -> "Hi [first name]": readable subjects in titles and lists. */
export function displaySubject(subject: string): string {
  return subject.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|[^}]*)?\}\}/g, (_m, key: string) => `[${key.replace(/_/g, " ").toLowerCase()}]`);
}
