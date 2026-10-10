// Bug reports and suggestions. The page has no server to send them through,
// so a report is written as an email for the reader to send from their own
// mail: a mailto link, with the same text on offer to copy.

export type ReportKind = "bug" | "idea";

export interface Report {
  to: string;
  subject: string;
  body: string;
  /** A link that opens the reader's mail program with the report filled in. */
  href: string;
  /** The whole report as plain text, for pasting into webmail. */
  text: string;
}

const KIND_NAME: Record<ReportKind, string> = { bug: "Bug", idea: "Suggestion" };

/**
 * Writes a report. `details` are lines about the app and the browser, added
 * under what the reader typed so a problem can be found again.
 */
export function composeReport(to: string, kind: ReportKind, typed: string, details: string[]): Report {
  const said = typed.trim().replace(/\r\n?/g, "\n");
  // The subject is the start of the first line, so reports can be told apart in an inbox.
  const first = said.split("\n")[0].trim();
  const gist = first.length > 60 ? `${first.slice(0, 57).trimEnd()}...` : first;
  const subject = `${KIND_NAME[kind]}: ${gist || "Mech Sketch"}`;
  const body = `${said}\n\n--\n${details.join("\n")}\n`;
  // Mail programs expect CRLF line ends in a mailto body.
  const enc = (s: string) => encodeURIComponent(s.replace(/\n/g, "\r\n"));
  return {
    to, subject, body,
    href: `mailto:${to}?subject=${enc(subject)}&body=${enc(body)}`,
    text: `To: ${to}\nSubject: ${subject}\n\n${body}`,
  };
}
