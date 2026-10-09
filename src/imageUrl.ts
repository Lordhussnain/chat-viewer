/**
 * The address of a generated image, from the text an export stores for it.
 *
 * Some exports store the link as plain text ("https://…"). Others wrap it in markdown, for example
 * "[https://…](https://…)". The wrapper breaks the image link, so the viewer would show the raw text.
 * This returns the first web address found, which is the image itself. If there is none, the trimmed
 * text is returned unchanged.
 */
export function imageUrl(raw: string): string {
  const text = raw.trim();
  const match = /https?:\/\/[^\s()[\]<>"']+/i.exec(text);
  return match ? match[0] : text;
}
