import { visit } from 'unist-util-visit';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'listItem']);

// The daemon resolves `file` against the project root, so a path the framework
// hands us (often absolute) is made relative to `root`, with forward slashes.
function sourcePath(vfile, root) {
  const path = vfile?.path || vfile?.history?.[vfile.history.length - 1];
  if (!path) return undefined;
  const rel = isAbsolute(path) ? relative(root, path) : path;
  return rel.split(sep).join('/');
}

// Some frameworks (Astro content collections, Docusaurus) strip frontmatter
// before remark parses the file, so node offsets count from the body, not the
// file. The daemon slices the file on disk, so shift offsets by where the body
// starts in it. Returns 0 when the file is what was parsed or cannot be read.
function bodyShift(vfile) {
  const parsed = vfile?.value == null ? '' : String(vfile.value);
  if (!vfile?.path || !parsed) return 0;
  let disk;
  try {
    disk = readFileSync(vfile.path, 'utf8');
  } catch {
    return 0;
  }
  if (disk === parsed) return 0;
  if (disk.endsWith(parsed)) return disk.length - parsed.length;
  const at = disk.indexOf(parsed);
  return at > 0 ? at : 0;
}

/**
 * Stamps each block-level node's rendered HTML with its source offset range so
 * the sidenote overlay can map a selection back to an exact span in the file.
 * Offsets are mdast string indices (used consistently with String.slice on the
 * daemon side), not raw byte counts.
 *
 * Frameworks that configure remark once for every page (Astro, Docusaurus,
 * Next.js MDX) pass the file being compiled on the vfile, so `file` can be left
 * out there. Pass it explicitly when you call remark() by hand on a string.
 *
 * @param {{ file?: string, root?: string }} options
 *   file: source path relative to the project root, stored on every stamped block.
 *   root: project root used to relativize the vfile path (default: process.cwd()).
 */
export default function sidenoteOffsets({ file, root = process.cwd() } = {}) {
  return (tree, vfile) => {
    const target = file ?? sourcePath(vfile, root);
    if (!target) return; // nothing to point the overlay at; render unchanged
    const shift = file ? 0 : bodyShift(vfile);

    visit(tree, (node) => {
      if (!BLOCK_TYPES.has(node.type) || !node.position) return;

      const { start, end } = node.position;
      if (start.offset == null || end.offset == null) return;

      const data = (node.data ??= {});
      data.hProperties = {
        ...data.hProperties,
        'data-sn-file': target,
        'data-sn-start': start.offset + shift,
        'data-sn-end': end.offset + shift,
      };
    });
  };
}
