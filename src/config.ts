// Settings of this copy of the app that are not part of any sketch.

/**
 * Where the Support button leads: the page donations are made on. While this
 * is empty there is no Support button.
 */
export const SUPPORT_URL = "https://ko-fi.com/mech_sketch";

/**
 * How long an export waits, in seconds, with the Support button on show,
 * before the file can be saved or the TikZ copied. 0 exports at once. There
 * is no wait while SUPPORT_URL is empty.
 */
export const EXPORT_WAIT_SECONDS = 10;

/**
 * Where bug reports and suggestions are sent. The report form writes an
 * email to this address for the reader to send from their own mail. While
 * this is empty there is no report button.
 */
export const REPORT_EMAIL = "bug.report@mech-sketch.org";

/**
 * True for the copy published for trying new things out, beside the released
 * app at the same address. It says so beside its name and keeps its own
 * autosaved sketch, so that work in one never lands in the other.
 */
export const BETA = import.meta.env.VITE_CHANNEL === "beta";
