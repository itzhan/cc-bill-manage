// Cross-context clipboard helper.
//
// `navigator.clipboard.writeText` is gated to **secure contexts** (HTTPS,
// localhost, file://). When the app is served over plain HTTP — which is
// our case behind the IP — modern browsers either return a permission
// error or silently no-op. We fall back to the legacy
// `document.execCommand('copy')` path with a hidden textarea, which still
// works everywhere as long as the call is inside a user-initiated event
// handler (click / keypress).
export async function copyToClipboard(text: string): Promise<boolean> {
  // Secure-context fast path.
  if (
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    window.isSecureContext &&
    navigator.clipboard?.writeText
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy
    }
  }
  // Legacy fallback. Works on http://; needs to run synchronously inside
  // the originating user gesture, which the await above preserves because
  // the secure-context branch only resolves microtasks.
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Off-screen but selectable. `position: fixed` avoids viewport jump.
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.padding = "0";
    ta.style.border = "none";
    ta.style.outline = "none";
    ta.style.boxShadow = "none";
    ta.style.background = "transparent";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    // iOS Safari needs explicit selection range.
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
