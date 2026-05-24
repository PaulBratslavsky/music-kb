// Pure-browser SVG → PNG export for the instrument-visualizer's fretboard.
//
// The visualizer renders SVG that references CSS variables (`fill="var(--ink)"`,
// `stroke="var(--fret-line)"`, etc.). CSS variables are resolved against the
// `.theory-companion` ancestor at render time. But when the SVG is serialized
// and re-rendered standalone via `<img>` or `URL.createObjectURL`, it loses
// that ancestor context — vars resolve to nothing → defaults (black).
//
// Fix: before serializing, inject a `<style>` block at the top of the SVG that
// defines every CSS variable the SVG might reference, with the concrete value
// resolved from the live DOM. The standalone SVG then carries its own theme
// inline.
//
// The list below is the union of CSS variables the upstream visualizer's
// instrument components reference. Adding a new one in the visualizer? Add it
// here too or the exported PNG will render that property black.
const VAR_NAMES = [
  // music-kb theme tokens (light/dark switch)
  '--ink',
  '--ink-soft',
  '--ink-muted',
  '--ink-faint',
  '--line',
  '--line-strong',
  '--card',
  '--bg',
  '--bg-subtle',
  '--accent',
  // visualizer-intrinsic colors (fixed in both themes)
  '--root',
  '--highlight',
  '--white-key',
  '--black-key',
  '--pad',
  '--pad-on',
  '--pad-on-root',
  '--fret-wood',
  '--fret-line',
  '--string',
  '--focus',
  '--natural',
];

function readCssVars(host: Element): Record<string, string> {
  const cs = window.getComputedStyle(host);
  const out: Record<string, string> = {};
  for (const name of VAR_NAMES) {
    const v = cs.getPropertyValue(name).trim();
    if (v) out[name] = v;
  }
  return out;
}

function buildStyleBlock(vars: Record<string, string>): string {
  const decls = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  // Target both `:root` (so descendants can inherit) AND the SVG element
  // itself (which IS the root inside a standalone SVG document). Belt
  // and suspenders — different browsers honor different targets when SVG
  // is loaded as an Image().
  return `<style><![CDATA[
:root, svg {
${decls}
}
]]></style>`;
}

/** Triggers a programmatic download of a Blob with the given filename. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick — some browsers race the click/download otherwise.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ExportFretboardPngOptions {
  /** The live SVG element to export. */
  svg: SVGSVGElement;
  /** The ancestor whose computed CSS variables should be inlined. Typically
   *  the `.theory-companion` element that defines instrument-intrinsic vars. */
  themeRoot: Element;
  /** Suggested download filename, e.g. "A-minor-shape3.png". */
  filename: string;
  /** Pixel-density multiplier. 2 (default) gives retina-quality output. */
  scale?: number;
  /** Optional explicit background color. Defaults to the themeRoot's
   *  resolved `--card` so the exported PNG looks like the panel does. */
  background?: string;
}

/** Export the supplied SVG as a PNG and trigger a browser download. */
export async function exportFretboardPng({
  svg,
  themeRoot,
  filename,
  scale = 2,
  background,
}: ExportFretboardPngOptions): Promise<void> {
  // 1. Clone so we can mutate without touching the live DOM.
  const clone = svg.cloneNode(true) as SVGSVGElement;

  // 2. Make sure the clone has explicit width/height + xmlns (sometimes
  //    React-rendered SVGs lack the xmlns attribute, which makes the
  //    standalone XML invalid).
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const bbox = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(bbox.width));
  const h = Math.max(1, Math.round(bbox.height));
  // Preserve viewBox if it's set so we don't break aspect ratio. Otherwise
  // synthesize one from the rendered size.
  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));

  // 3. Inject inline CSS-variable definitions so the standalone SVG carries
  //    its theme. Insert as the first child so child fill/stroke references
  //    resolve correctly.
  const vars = readCssVars(themeRoot);
  const styleHtml = buildStyleBlock(vars);
  // Parse the style block into a real Element via a temporary container so
  // we don't have to escape anything by hand. SVG namespace required.
  const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tmp.innerHTML = styleHtml;
  const styleNode = tmp.firstChild;
  if (styleNode) clone.insertBefore(styleNode, clone.firstChild);

  // 4. Serialize and wrap in a data URL. Using a Blob URL would be cleaner
  //    but Safari sometimes won't load Blob-URL'd SVG into an Image() —
  //    data URI is the broadly-compatible path.
  const xml = new XMLSerializer().serializeToString(clone);
  const dataUri =
    'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);

  // 5. Load into an Image, then draw to canvas at the chosen scale.
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('2D canvas context unavailable'));
        return;
      }
      // Background. Without this PNGs are transparent — fine for some uses
      // but most video editors prefer a solid backing matching the page.
      const bg = background ?? vars['--card'] ?? '#ffffff';
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('canvas.toBlob returned null'));
          return;
        }
        downloadBlob(blob, filename);
        resolve();
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Failed to load serialized SVG into Image'));
    img.src = dataUri;
  });
}
