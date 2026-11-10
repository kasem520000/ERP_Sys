// PHASE-021 T10 · Windows print implementation (the `windows` crate 0.62):
//   - RAW spooler printing: OpenPrinterW → StartDocPrinterW(datatype "RAW")
//     → WritePrinter → EndDocPrinter → ClosePrinter (Winspool.drv).
//   - HTML printing: temp .html file + ShellExecuteW with the "print" verb
//     (the registered handler — Edge — prints the document; this is the
//     shell-mode counterpart of the browser window.print fallback).
// The default printer is used — printer selection is a TS-layer concern that
// rides a future bridge surface; documented in agent-ctx/T-P21-2c.md.
//
// HONEST COMPILE NOTE (source-only shell): exact windows-rs 0.62 binding
// shapes (Option/PWSTR/*const-parameter forms) are verified by the Windows CI
// compile (desktop-release.yml) — the dev sandbox has no Rust toolchain (the
// k6 precedent); scripts/check-desktop-shell.ts validates structure, not rustc.

use std::ffi::OsStr;
use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, GetDefaultPrinterW, OpenPrinterW, StartDocPrinterW,
    StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_DEFAULTSW,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

fn wide(text: &str) -> Vec<u16> {
    OsStr::new(text).encode_wide().chain(std::iter::once(0)).collect()
}

fn default_printer_name() -> windows::core::Result<String> {
    // GetDefaultPrinterW (Winspool): buffer-growth loop, standard pattern.
    let mut size: u32 = 0;
    unsafe {
        let _ = GetDefaultPrinterW(None, &mut size);
    }
    let mut buffer = vec![0u16; size as usize];
    unsafe { GetDefaultPrinterW(Some(PWSTR(buffer.as_mut_ptr())), &mut size) }
        .map_err(|error| format!("no default printer: {error}"))?;
    let end = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
    Ok(String::from_utf16_lossy(&buffer[..end]))
}

/// Raw bytes → the default printer's RAW spooler job (the ESC-POS path).
pub fn print_raw_to_spooler(bytes: &[u8]) -> Result<(), String> {
    let printer = wide(&default_printer_name().map_err(|error| format!("print_raw: {error}"))?);
    let mut handle = HANDLE::default();
    let defaults = PRINTER_DEFAULTSW::default();
    unsafe {
        OpenPrinterW(
            PCWSTR(printer.as_ptr()),
            Some(&mut handle),
            Some(&defaults),
        )
        .map_err(|error| format!("print_raw: OpenPrinterW: {error}"))?;
    }
    let doc_name = wide("ERP Desktop receipt");
    let datatype = wide("RAW");
    let doc = DOC_INFO_1W {
        pDocName: PCWSTR(doc_name.as_ptr()),
        pOutputFile: PCWSTR::null(),
        pDatatype: PCWSTR(datatype.as_ptr()),
    };
    let result = (|| -> windows::core::Result<()> {
        unsafe {
            if StartDocPrinterW(
                handle,
                1,
                &doc as *const DOC_INFO_1W as *const core::ffi::c_void,
            ) == 0
            {
                return Err(windows::core::Error::from_win32());
            }
            StartPagePrinter(handle)?;
            let mut written: u32 = 0;
            if !bytes.is_empty() {
                WritePrinter(
                    handle,
                    bytes.as_ptr() as *const core::ffi::c_void,
                    bytes.len() as u32,
                    &mut written,
                )?;
            }
            EndPagePrinter(handle)?;
            EndDocPrinter(handle)?;
        }
        Ok(())
    })();
    unsafe {
        let _ = ClosePrinter(handle);
    }
    result.map_err(|error| format!("print_raw: {error}"))
}

/// HTML → temp file → ShellExecuteW "print" verb (the registered handler
/// prints the document to the default printer).
pub fn print_html_to_default_handler(html: &str) -> Result<(), String> {
    let mut path: PathBuf = std::env::temp_dir();
    path.push(format!("erp-desktop-print-{}.html", std::process::id()));
    std::fs::File::create(&path)
        .and_then(|mut file| file.write_all(html.as_bytes()))
        .map_err(|error| format!("print_html: temp file: {error}"))?;
    let verb = wide("print");
    let file = wide(
        path.to_str()
            .ok_or("print_html: temp path is not valid Unicode")?,
    );
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_HIDE,
        )
    };
    if result.0 as isize <= 32 {
        return Err(format!(
            "print_html: ShellExecuteW print verb failed (code {})",
            result.0 as isize
        ));
    }
    // The handler reads the document promptly; remove our copy afterwards on
    // a best-effort delay (a held handle loses the race silently).
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(60));
        let _ = std::fs::remove_file(path);
    });
    Ok(())
}
