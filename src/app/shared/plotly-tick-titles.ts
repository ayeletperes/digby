/** Native tooltips on Plotly tick labels. */
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
