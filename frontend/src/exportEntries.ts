import type { Entry } from "./types";

/** Download every entry as a plain-text file. */
export function exportEntries(entries: Entry[]): void {
  const lines = entries
    .map((e) => {
      const act = e.activity ? `\nContext: ${e.activity}` : "";
      const moodAi = e.mood ? `\nAI Mood: ${e.mood_label} (${e.mood}/10)` : "";
      const moodU = e.mood_user ? `\nYour Mood: ${e.mood_user_label} (${e.mood_user}/10)` : "";
      return `[${new Date(e.created_at).toLocaleString()}]${act}${moodU}${moodAi}\n${e.text}`;
    })
    .join("\n\n---\n\n");
  const blob = new Blob(
    [`MY INNER ARCHIVE\nExported: ${new Date().toLocaleString()}\nEntries: ${entries.length}\n\n${"═".repeat(40)}\n\n${lines}`],
    { type: "text/plain" }
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "my-inner-archive.txt";
  a.click();
}
