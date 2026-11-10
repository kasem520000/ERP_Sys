// PHASE-021 T10 · print glue — OS printing behind the DesktopBridge `print`
// surface (MASTER-PLAN §1 item 9: ESC-POS bytes are rendered in TypeScript,
// apps/desktop/src/print/escpos.ts — ADR-0013 keeps ALL logic in TS; the
// shell only transports ready bytes to the OS print path).
//
// print_print_raw(bytes): raw byte stream → Windows print spooler with the
//   RAW datatype (OpenPrinterW/StartDocPrinterW/WritePrinter/EndDocPrinter,
//   the `windows` crate 0.62 Win32_Graphics_Printing APIs) on the default
//   printer — the ESC-POS path for 80/58 mm receipt printers.
// print_print_html(html): the HTML document → a temp file printed through
//   the shell "print" verb (ShellExecuteW, Win32_UI_Shell) which hands the
//   document to the registered print handler (Edge/WebView2 HTML printing)
//   — the browser-mode fallback uses window.print, this is the shell mode.
//
// printpdf is deliberately NOT a dependency: PDF composition, if ever needed,
// belongs to the TS print layer (the 013/016 print templates) — recorded in
// agent-ctx/T-P21-2c.md. Reprint-from-cache (matrix row 32) is orchestrated
// in TS (print/reprint.ts) and arrives here as plain bytes/HTML.

#[cfg(windows)]
mod windows_impl;

#[cfg(windows)]
use windows_impl::{print_html_to_default_handler, print_raw_to_spooler};

/// DesktopBridge `print.printRaw(bytes: number[] | Uint8Array)` — raw bytes to
/// the spooler (ESC-POS printers honor the byte stream verbatim).
#[tauri::command]
pub fn print_print_raw(bytes: Vec<u8>) -> Result<(), String> {
    #[cfg(windows)]
    return print_raw_to_spooler(&bytes);
    #[cfg(not(windows))]
    Err("print_print_raw: only the Windows shell is shipped this phase (ADR-0013)".into())
}

/// DesktopBridge `print.printHtml(html)` — HTML document to the OS print
/// handler (the shell mode of the browser window.print fallback).
#[tauri::command]
pub fn print_print_html(html: String) -> Result<(), String> {
    #[cfg(windows)]
    return print_html_to_default_handler(&html);
    #[cfg(not(windows))]
    Err("print_print_html: only the Windows shell is shipped this phase (ADR-0013)".into())
}
