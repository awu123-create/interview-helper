function skipCsi(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    index += 1;
    if (code >= 0x40 && code <= 0x7e) break;
  }
  return index;
}

function skipStringSequence(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x07 || code === 0x9c) return index + 1;
    if (code === 0x1b && text[index + 1] === "\\") return index + 2;
    index += 1;
  }
  return index;
}

function skipEscape(text: string, start: number): number {
  const introducer = text[start];
  if (introducer === "[") return skipCsi(text, start + 1);
  if (introducer === "]" || introducer === "P" || introducer === "X" || introducer === "^" || introducer === "_") {
    return skipStringSequence(text, start + 1);
  }
  let index = start + 1;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code > 0x2f) break;
    index += 1;
  }
  return Math.min(index + 1, text.length);
}

export function sanitizeTerminalText(text: string): string {
  let output = "";
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x0a) {
      output += "\n";
      index += 1;
    } else if (code === 0x1b) {
      index = skipEscape(text, index + 1);
    } else if (code === 0x9b) {
      index = skipCsi(text, index + 1);
    } else if (code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f) {
      index = skipStringSequence(text, index + 1);
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      output += " ";
      index += 1;
    } else {
      output += text[index];
      index += 1;
    }
  }
  return output;
}
