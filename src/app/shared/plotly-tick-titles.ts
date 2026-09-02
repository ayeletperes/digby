/**
 * Native tooltips on Plotly tick labels.
 *
 * An axis tick can only carry the shortened allele label, and the tick is where
 * a reader looks first. Plotly has no hover for tick text, so this hangs an SVG
 * <title> on each one after the draw and the browser does the rest: no overlay,
 * no library, and it survives a redraw because the caller runs it on afterPlot.
 *
 * Two things make it work at all, both learned the hard way:
 *
 * - Plotly sets `pointer-events: none` on its svg and its axis layers, so a
 *   tick cannot receive a pointer and the title can never fire. The ticks opt
 *   back in; pointer-events is inherited and a descendant may override it.
 * - The label has to be read from the tick's own text nodes. Once a <title> is
 *   attached, `textContent` returns the label with the full name glued to the
 *   end, so a second pass would miss the lookup and strip the title again.
 */
export function attachTickTitles(host: Element, fullByLabel: Map<string, string>): void {
  const ticks = host.querySelectorAll('.yaxislayer-above text');

  ticks.forEach(tick => {
    const label = Array.from(tick.childNodes)
      .filter(node => node.nodeType === 3)          // text nodes, not the <title>
      .map(node => node.nodeValue ?? '')
      .join('')
      .trim();

    const full = fullByLabel.get(label);
    const existing = tick.querySelector('title');

    // nothing to add where the tick already is the full name
    if (!full || full === label) {
      existing?.remove();
      (tick as SVGElement).style.removeProperty('cursor');
      return;
    }

    const title = existing
      ?? tick.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = full;
    if (!existing) {
      tick.appendChild(title);
    }
    (tick as SVGElement).style.pointerEvents = 'all';
    (tick as SVGElement).style.cursor = 'help';
  });
}
