// Builds the profile artwork in assets/, in a dark and a light variant.
// The header reads the real contribution calendar from the GitHub API, so the
// numbers on the profile are always the live ones (refreshed daily by CI).
//
//   GITHUB_TOKEN=... node scripts/build.mjs        (falls back to `gh auth token`)

import { execSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOGIN = "vitorpelegrini";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

const FONT = `'Segoe UI Variable Display','Segoe UI',-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',Arial,sans-serif`;
const MONO = `'Cascadia Code','JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;

const THEMES = {
  dark: {
    card: "#1c1c1c", tile: "#262626", line: "#333333", track: "#3a3a3a",
    text: "#ffffff", soft: "#d4d4d4", muted: "#9a9a9a",
    cyan: "#4cc2ff", green: "#4ade80", amber: "#fbbf24", coral: "#f87171", pink: "#f472b6", teal: "#2dd4bf",
  },
  light: {
    card: "#fbfbfb", tile: "#ffffff", line: "#e3e3e3", track: "#e6e6e6",
    text: "#141414", soft: "#3b3b3b", muted: "#6b6b6b",
    cyan: "#0078d4", green: "#16a34a", amber: "#c27803", coral: "#dc2626", pink: "#db2777", teal: "#0d9488",
  },
};

// ---------- data ----------

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return execSync("gh auth token", { encoding: "utf8" }).trim();
}

async function calendar() {
  const query = `{ user(login: "${LOGIN}") { contributionsCollection { contributionCalendar {
    totalContributions weeks { contributionDays { date contributionCount } } } } } }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token()}`, "Content-Type": "application/json", "User-Agent": LOGIN },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user.contributionsCollection.contributionCalendar;
}

function stats(cal) {
  const days = cal.weeks.flatMap((w) => w.contributionDays);
  const weeks = cal.weeks.map((w) => w.contributionDays.reduce((s, d) => s + d.contributionCount, 0));
  const year = days.at(-1).date.slice(0, 4);

  // Runs of consecutive active days. Today still counts as open: an empty today
  // does not break the current streak.
  let best = 0, run = 0;
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) current++;
    else if (i === days.length - 1) continue;
    else break;
  }

  return {
    total: cal.totalContributions,
    yearTotal: days.filter((d) => d.date.startsWith(year)).reduce((s, d) => s + d.contributionCount, 0),
    year,
    activeDays: days.filter((d) => d.contributionCount > 0).length,
    dayCount: days.length,
    current,
    best,
    weeks,
    peakWeek: Math.max(...weeks),
    busiestDay: Math.max(...days.map((d) => d.contributionCount)),
  };
}

// ---------- helpers ----------

const fmt = (n) => n.toLocaleString("en-US");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Static on purpose: GitHub's mobile app and some readers rasterize the first frame of an SVG,
// so anything that animates in from invisible would stay invisible there.
// Rough advance width, generous on purpose so chips never clip on wider system fonts.
const textWidth = (s, size, weight = 400) => s.length * size * (weight >= 600 ? 0.6 : 0.56);

function svg(width, height, title, body, extraCss = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>
  text { font-family: ${FONT}; }
  .mono { font-family: ${MONO}; }
  .num { font-variant-numeric: tabular-nums; }
  ${extraCss}
</style>
${body}
</svg>
`;
}

function save(name, content) {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, name);
  writeFileSync(`${file}.tmp`, content);
  renameSync(`${file}.tmp`, file);
}

// ---------- header ----------

function sparkline(values, x, y, w, h) {
  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [x + i * step, y + h - (v / max) * h]);
  // Catmull-Rom to cubic Bézier: a smooth line that still passes through every week.
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${Math.min(c1[1], y + h).toFixed(1)} ${c2[0].toFixed(1)},${Math.min(c2[1], y + h).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return { line: d, area: `${d} L${x + w},${y + h} L${x},${y + h} Z`, end: pts.at(-1) };
}

function header(s, t) {
  const W = 1200, H = 500;

  // Activity tile, in the language of the sys-bar hover card.
  const tx = 708, ty = 56, tw = 436, th = 236;
  const sp = sparkline(s.weeks, tx + 24, ty + 116, tw - 48, 88);
  const tile = `
  <g>
    <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="14" fill="${t.tile}" stroke="${t.line}"/>
    <circle cx="${tx + 30}" cy="${ty + 37}" r="5" fill="${t.cyan}"/>
    <text x="${tx + 44}" y="${ty + 43}" font-size="18" font-weight="600" fill="${t.text}">Contributions</text>
    <text x="${tx + tw - 24}" y="${ty + 45}" font-size="30" font-weight="600" fill="${t.text}" text-anchor="end" class="num">${fmt(s.total)}</text>
    <text x="${tx + 44}" y="${ty + 70}" font-size="14" fill="${t.muted}">last 12 months, every repository</text>
    <text x="${tx + tw - 24}" y="${ty + 70}" font-size="14" fill="${t.muted}" text-anchor="end" class="num">▲ peak week ${fmt(s.peakWeek)}</text>
    <rect x="${tx + 16}" y="${ty + 100}" width="${tw - 32}" height="112" rx="8" fill="${t.card}"/>
    <line x1="${tx + 24}" x2="${tx + tw - 24}" y1="${ty + 160}" y2="${ty + 160}" stroke="${t.line}" stroke-dasharray="2 4"/>
    <defs>
      <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${t.cyan}" stop-opacity=".32"/>
        <stop offset="1" stop-color="${t.cyan}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${sp.area}" fill="url(#area)"/>
    <path pathLength="1" d="${sp.line}" fill="none" stroke="${t.cyan}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${sp.end[0].toFixed(1)}" cy="${sp.end[1].toFixed(1)}" r="4.5" fill="${t.cyan}" stroke="${t.tile}" stroke-width="2"/>
  </g>`;

  // Taskbar strip with live numbers, exactly how sys-bar draws its columns.
  const cols = [
    { label: `${s.year}`, value: fmt(s.yearTotal), unit: "contributions", frac: null, color: t.cyan },
    { label: "ACTIVE DAYS", value: fmt(s.activeDays), unit: `/ ${s.dayCount}`, frac: s.activeDays / s.dayCount, color: t.green },
    { label: "STREAK", value: fmt(s.current), unit: `days / best ${s.best}`, frac: s.best ? s.current / s.best : 0, color: t.amber },
    { label: "BUSIEST DAY", value: fmt(s.busiestDay), unit: "contributions", frac: null, color: t.pink },
  ];
  const sy = 348, sh = 96;
  let cx = 150;
  const colW = [190, 190, 210, 200];
  const strip = cols.map((c, i) => {
    const x = cx;
    cx += colW[i];
    const barW = colW[i] - 40;
    const bar = c.frac === null
      ? `<circle cx="${x + 4}" cy="${sy + 74}" r="4" fill="${c.color}"/>`
      : `<rect x="${x}" y="${sy + 71}" width="${barW}" height="6" rx="3" fill="${t.track}"/>
         <rect x="${x}" y="${sy + 71}" width="${Math.max(6, barW * c.frac).toFixed(1)}" height="6" rx="3" fill="${c.color}"/>`;
    return `
    <text x="${x}" y="${sy + 30}" font-size="13" font-weight="600" letter-spacing=".6" fill="${t.muted}">${esc(c.label)}</text>
    <text x="${x}" y="${sy + 58}" class="num" fill="${t.text}"><tspan font-size="24" font-weight="600">${c.value}</tspan><tspan font-size="14" fill="${t.muted}" dx="6">${esc(c.unit)}</tspan></text>
    ${bar}`;
  }).join("");

  const winLogo = [0, 1].flatMap((r) => [0, 1].map((c) =>
    `<rect x="${80 + c * 15}" y="${sy + 33 + r * 15}" width="13" height="13" rx="2.5" fill="${t.cyan}"/>`)).join("");

  return svg(W, H, `Vitor Pelegrini, software engineer and founder of VSync Lab. ${fmt(s.total)} contributions in the last 12 months.`, `
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="22" fill="${t.card}" stroke="${t.line}"/>

  <g>
    <text x="56" y="92" font-size="14" font-weight="600" letter-spacing="2.2" fill="${t.cyan}">SOFTWARE ENGINEER  /  FOUNDER OF VSYNC LAB</text>
    <text x="52" y="168" font-size="68" font-weight="700" letter-spacing="-1.5" fill="${t.text}">Vitor Pelegrini</text>
    <text x="56" y="214" font-size="24" fill="${t.soft}">Full-stack and native software,</text>
    <text x="56" y="246" font-size="24" fill="${t.soft}">from the database to the taskbar.</text>
    <text x="56" y="296" font-size="15" fill="${t.muted}" class="mono">~/guarapuava-pr/brasil $ <tspan fill="${t.green}">ship --with-tests</tspan></text>
  </g>
  ${tile}

  <g>
    <rect x="40" y="${sy}" width="${W - 80}" height="${sh}" rx="14" fill="${t.tile}" stroke="${t.line}"/>
    ${winLogo}
    <line x1="128" x2="128" y1="${sy + 26}" y2="${sy + sh - 26}" stroke="${t.line}" stroke-width="1.5"/>
    ${strip}
    <line x1="${W - 236}" x2="${W - 236}" y1="${sy + 26}" y2="${sy + sh - 26}" stroke="${t.line}" stroke-width="1.5"/>
    <text x="${W - 70}" y="${sy + 44}" font-size="15" fill="${t.text}" text-anchor="end">Guarapuava, PR</text>
    <text x="${W - 70}" y="${sy + 68}" font-size="15" fill="${t.muted}" text-anchor="end">Brasil</text>
  </g>`);
}

// ---------- VSync Lab ----------

function vsync(t) {
  const W = 1200, H = 444;
  const legs = [
    { x: 40, color: t.cyan, name: "Software", items: [
      ["Websites and online stores", "integrated with stock, payments and support"],
      ["Custom systems", "CRM, apps and dashboards built around the process"],
      ["Performance and SEO", "fast to open, easy to find on Google"],
      ["AI assistants", "on WhatsApp and the website, trained on the business"],
    ] },
    { x: 616, color: t.green, name: "Hardware", items: [
      ["Builds and upgrades", "each part chosen for the job, tested under load"],
      ["Clean installs", "backup, system, drivers and programs back in place"],
      ["Cleaning and maintenance", "cooler, quieter, performance restored"],
      ["Business infrastructure", "network, Wi-Fi, servers and backup, documented"],
    ] },
  ];
  const body = legs.map((leg, li) => `
  <g>
    <rect x="${leg.x}" y="104" width="544" height="300" rx="14" fill="${t.tile}" stroke="${t.line}"/>
    <rect x="${leg.x}" y="104" width="4" height="300" rx="2" fill="${leg.color}"/>
    <text x="${leg.x + 28}" y="140" font-size="14" font-weight="600" letter-spacing="1.8" fill="${leg.color}">${leg.name.toUpperCase()}</text>
    ${leg.items.map(([title, desc], i) => `
    <text x="${leg.x + 28}" y="${180 + i * 60}" font-size="20" font-weight="600" fill="${t.text}">${esc(title)}</text>
    <text x="${leg.x + 28}" y="${204 + i * 60}" font-size="17" fill="${t.muted}">${esc(desc)}</text>`).join("")}
  </g>`).join("");

  return svg(W, H, "VSync Lab: software, websites and automations, plus complete hardware services.", `
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="22" fill="${t.card}" stroke="${t.line}"/>
  <g>
    <text x="40" y="58" font-size="30" font-weight="700" letter-spacing="-.5" fill="${t.text}">VSync Lab</text>
    <text x="196" y="58" font-size="18" fill="${t.muted}">Software, websites and automations, plus complete hardware services.</text>
    <text x="${W - 40}" y="58" font-size="15" font-weight="600" fill="${t.cyan}" text-anchor="end">vsynclab.org  →</text>
  </g>
  ${body}`);
}

// ---------- stack ----------

const STACK = [
  { group: "Languages", color: "cyan", items: ["TypeScript", "JavaScript", "C++20", "SQL / PL/pgSQL", "Python", "Bash"] },
  { group: "Web", color: "green", items: ["Vue 3", "React", "Next.js", "Tailwind CSS", "GSAP", "Vite"] },
  { group: "Mobile", color: "teal", items: ["React Native", "Expo", "EAS", "iOS", "Android"] },
  { group: "Backend and data", color: "amber", items: ["Supabase", "PostgreSQL", "Edge Functions (Deno)", "Node.js", "Webhooks"] },
  { group: "Native Windows", color: "cyan", items: ["Win32", "Direct2D", "DirectWrite", "PDH", "D3DKMT", "UI Automation", "CMake"] },
  { group: "Integrations", color: "pink", items: ["WhatsApp Cloud API", "Pix, boleto and card billing", "ERP sync", "Digital signatures"] },
  { group: "AI engineering", color: "green", items: ["Claude Code", "Anthropic API", "Multi-agent workflows", "Local LLMs (Ollama)"] },
  { group: "Infra and hardware", color: "amber", items: ["Vercel", "GitHub Actions", "Networks and servers", "PC builds"] },
];

function stack(t) {
  const W = 1200, rowH = 58, top = 96;
  const H = top + STACK.length * rowH + 28;
  const rows = STACK.map((row, ri) => {
    const y = top + ri * rowH;
    let x = 268;
    const chips = row.items.map((item) => {
      const w = textWidth(item, 17) + 32;
      const chip = `<rect x="${x}" y="${y}" width="${w.toFixed(0)}" height="42" rx="21" fill="${t.tile}" stroke="${t.line}"/>
      <text x="${(x + w / 2).toFixed(0)}" y="${y + 27}" font-size="17" fill="${t.soft}" text-anchor="middle">${esc(item)}</text>`;
      x += w + 10;
      return chip;
    }).join("");
    return `
    <g>
      <circle cx="46" cy="${y + 21}" r="5" fill="${t[row.color]}"/>
      <text x="62" y="${y + 27}" font-size="18" font-weight="600" fill="${t.text}">${esc(row.group)}</text>
      ${chips}
    </g>`;
  }).join("");

  return svg(W, H, `Tech stack: ${STACK.map((r) => `${r.group}: ${r.items.join(", ")}`).join(". ")}.`, `
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="22" fill="${t.card}" stroke="${t.line}"/>
  <text x="40" y="58" font-size="30" font-weight="700" letter-spacing="-.5" fill="${t.text}">Stack</text>
  <text x="138" y="58" font-size="18" fill="${t.muted}">What I ship with, every day.</text>
  ${rows}`);
}

// ---------- selected work ----------

const WORK = [
  {
    color: "cyan", tag: "In production",
    title: "Health-benefits membership platform",
    lines: ["CRM, member app for iOS and Android, partner portal", "and backend: billing, digital card, WhatsApp", "campaigns and reports for the whole company."],
    chips: ["Vue 3", "Expo", "Supabase", "Deno"],
  },
  {
    color: "green", tag: "Daily driver",
    title: "AI engineering harness",
    lines: ["Long-term memory, guardrails and a live dashboard", "around Claude Code, with adversarial multi-agent", "review before anything ships."],
    chips: ["TypeScript", "Claude Code", "Ollama"],
  },
  {
    color: "amber", tag: "In production",
    title: "Auto parts management system",
    lines: ["Customers, vehicles, parts, stock and quotes for an", "auto parts store, down to the PDF quote the", "customer takes home."],
    chips: ["Next.js", "React", "Supabase", "Tailwind"],
  },
  {
    color: "coral", tag: "Reverse engineering",
    title: "ECU scanner for a 1998 Chevrolet",
    lines: ["Scanner and datalogger for an engine computer that", "predates OBD-II, speaking its native ALDL protocol", "through a serial bridge."],
    chips: ["Expo", "TypeScript", "Serial", "ALDL"],
  },
];

function work(t) {
  const W = 1200, cw = 552, ch = 252, gap = 16, top = 92;
  const H = top + 2 * ch + gap + 40;
  const cards = WORK.map((p, i) => {
    const x = 40 + (i % 2) * (cw + gap), y = top + Math.floor(i / 2) * (ch + gap);
    const c = t[p.color];
    let chipX = x + 28;
    const chips = p.chips.map((chip) => {
      const w = textWidth(chip, 15) + 24;
      const out = `<rect x="${chipX}" y="${y + 196}" width="${w.toFixed(0)}" height="32" rx="6" fill="${t.card}" stroke="${t.line}"/>
      <text x="${(chipX + w / 2).toFixed(0)}" y="${y + 217}" font-size="15" fill="${t.soft}" text-anchor="middle" class="mono">${esc(chip)}</text>`;
      chipX += w + 8;
      return out;
    }).join("");
    const tagW = textWidth(p.tag, 12, 600) + 22;
    return `
    <g>
      <rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="14" fill="${t.tile}" stroke="${t.line}"/>
      <circle cx="${x + 34}" cy="${y + 41}" r="5" fill="${c}"/>
      <text x="${x + 48}" y="${y + 49}" font-size="22" font-weight="600" fill="${t.text}">${esc(p.title)}</text>
      <rect x="${(x + cw - 24 - tagW).toFixed(0)}" y="${y + 199}" width="${tagW.toFixed(0)}" height="26" rx="13" fill="none" stroke="${c}" stroke-opacity=".55"/>
      <text x="${(x + cw - 24 - tagW / 2).toFixed(0)}" y="${y + 216}" font-size="12" font-weight="600" fill="${c}" text-anchor="middle">${esc(p.tag)}</text>
      ${p.lines.map((l, li) => `<text x="${x + 28}" y="${y + 90 + li * 26}" font-size="18" fill="${t.muted}">${esc(l)}</text>`).join("")}
      ${chips}
    </g>`;
  }).join("");

  return svg(W, H, `Selected work: ${WORK.map((p) => `${p.title}. ${p.lines.join(" ")}`).join(" ")}`, `
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="22" fill="${t.card}" stroke="${t.line}"/>
  <text x="40" y="58" font-size="30" font-weight="700" letter-spacing="-.5" fill="${t.text}">Selected work</text>
  <text x="258" y="58" font-size="18" fill="${t.muted}">Private repositories, described without the confidential parts.</text>
  ${cards}`);
}

// ---------- run ----------

const s = stats(await calendar());
for (const [name, t] of Object.entries(THEMES)) {
  save(`header-${name}.svg`, header(s, t));
  save(`vsync-${name}.svg`, vsync(t));
  save(`stack-${name}.svg`, stack(t));
  save(`work-${name}.svg`, work(t));
}
console.log(`ok: ${fmt(s.total)} contributions, ${s.activeDays}/${s.dayCount} active days, streak ${s.current} (best ${s.best}), peak week ${s.peakWeek}, busiest day ${s.busiestDay}`);
