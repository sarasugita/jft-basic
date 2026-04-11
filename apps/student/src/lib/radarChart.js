import { escapeHtml } from "./escapeHtml";

export function getSectionLabelLines(label) {
  if (label === "Script and Vocabulary") return ["Script and", "Vocabulary"];
  if (label === "Reading Comprehension") return ["Reading", "Comprehension"];
  if (label === "Listening Comprehension") return ["Listening", "Comprehension"];
  if (label === "Conversation and Expression") return ["Conversation and", "Expression"];
  return String(label || "")
    .split(/\s+/)
    .filter(Boolean);
}

export function buildRadarSvg(data) {
  if (!data.length) return "";
  const size = 220;
  const center = size / 2;
  const maxR = 80;
  const steps = 4;
  const points = data
    .map((d, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / data.length;
      const r = maxR * (d.value ?? 0);
      const x = center + Math.cos(angle) * r;
      const y = center + Math.sin(angle) * r;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const grid = Array.from({ length: steps }, (_, idx) => {
    const r = (maxR * (idx + 1)) / steps;
    return `<circle cx="${center}" cy="${center}" r="${r.toFixed(1)}" class="radar-grid" />`;
  }).join("");
  const axes = data
    .map((_, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / data.length;
      const x = center + Math.cos(angle) * maxR;
      const y = center + Math.sin(angle) * maxR;
      return `<line x1="${center}" y1="${center}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="radar-axis" />`;
    })
    .join("");
  const getRadarLabelPosition = (label, angle) => {
    let radius = maxR + 18;
    let xOffset = 0;
    if (label === "Reading Comprehension") {
      radius = maxR + 4;
      xOffset = 18;
    } else if (label === "Conversation and Expression") {
      radius = maxR + 4;
      xOffset = -18;
    }
    return {
      x: center + Math.cos(angle) * radius + xOffset,
      y: center + Math.sin(angle) * radius,
    };
  };
  const labels = data
    .map((d, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / data.length;
      const { x, y } = getRadarLabelPosition(d.label, angle);
      const lines = getSectionLabelLines(d.label);
      return `
        <text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="radar-label">
          ${lines
            .map(
              (line, idx) =>
                `<tspan x="${x.toFixed(1)}" dy="${idx === 0 ? "0" : "1.1em"}">${escapeHtml(line)}</tspan>`
            )
            .join("")}
        </text>
      `;
    })
    .join("");
  return `
    <svg viewBox="0 0 ${size} ${size}" class="attendance-radar" role="img" aria-label="Section score radar chart">
      ${grid}
      ${axes}
      <polygon points="${points}" class="radar-shape"></polygon>
      ${labels}
    </svg>
  `;
}
