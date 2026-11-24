/**
 * The `//` line-comment scan shared by the C++ and C# lexers.
 *
 * A free function rather than a `BaseAdapter` method: the base class sits at the
 * god-class ceiling (15 methods), and adding one more to share two lines of loop
 * would have traded a duplication warning for a class-size warning. The scan does not
 * touch adapter state beyond the content it is given, so it does not belong on the
 * class in the first place.
 *
 * @param content the file being lexed
 * @param start index of the first `/`
 * @returns the number of characters consumed, not counting the newline
 */
export function skipLineComment(content: string, start: number): number {
  let i = start;
  while (i < content.length && content[i] !== '\n') i++;
  return i - start;
}
