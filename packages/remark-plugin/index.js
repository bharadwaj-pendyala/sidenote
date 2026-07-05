import { visit } from 'unist-util-visit';

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'listItem']);

/**
 * Stamps each block-level node's rendered HTML with its source byte range so
 * the sidenote overlay can map a selection back to an exact span in the file.
 *
 * @param {{ file: string }} options  source path, stored on every stamped block
 */
export default function sidenoteOffsets({ file } = {}) {
  return (tree) => {
    visit(tree, (node) => {
      if (!BLOCK_TYPES.has(node.type) || !node.position) return;

      const { start, end } = node.position;
      if (start.offset == null || end.offset == null) return;

      const data = (node.data ??= {});
      data.hProperties = {
        ...data.hProperties,
        'data-sn-file': file,
        'data-sn-start': start.offset,
        'data-sn-end': end.offset,
      };
    });
  };
}
