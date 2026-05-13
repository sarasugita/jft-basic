function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderBlankBoxHtml() {
  return '<span style="display:inline-block;width:3.6em;height:0.82lh;border:0.14em solid #ef4444;box-sizing:border-box;vertical-align:-0.02em;margin:0 0.25em;"></span>';
}

export function renderUnderlinesHtml(text) {
  const escaped = escapeHtml(text ?? "");
  return escaped
    .replace(/【(.*?)】/g, (_, inner) => (String(inner ?? "").replace(/[\s\u3000]/g, "").length
      ? `<span class="u">${inner}</span>`
      : renderBlankBoxHtml()));
}
