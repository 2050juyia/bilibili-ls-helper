const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../extension/playlist-indicator.js'), 'utf8');
async function harness(initial = true) {
  const observers = [], pending = new Set(), listeners = new Map(); let change, textWrites = 0;
  function notify(target, type, attributeName) {
    for (const observer of observers) for (const [node, options] of observer.targets) {
      let descendant = target;
      while (descendant && descendant !== node) descendant = descendant.parentNode;
      if (target !== node && !(options.subtree && descendant === node)) continue;
      if (!options[type] || (type === 'attributes' && options.attributeFilter && !options.attributeFilter.includes(attributeName))) continue;
      pending.add(observer);
    }
  }
  class Node {
    constructor(tagName) { this.tagName = tagName.toUpperCase(); this.children = []; this.parentNode = null; this.attributes = new Map(); this.text = ''; this.sheet = { disabled: false }; }
    append(node) {
      if (node.parentNode) node.remove();
      node.parentNode = this; this.children.push(node); notify(this, 'childList');
    }
    remove() {
      const parent = this.parentNode; if (!parent) return;
      parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; notify(parent, 'childList');
    }
    get textContent() { return this.text; }
    set textContent(value) { this.text = value; textWrites++; notify(this, 'childList'); }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { this.attributes.set(name, value); notify(this, 'attributes', name); }
    removeAttribute(name) { this.attributes.delete(name); notify(this, 'attributes', name); }
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.targets = new Map(); observers.push(this); }
    observe(node, options) { this.targets.set(node, options); }
    disconnect() { this.targets.clear(); pending.delete(this); }
  }
  const root = new Node('html'), head = new Node('head'); root.append(head);
  const all = node => [node, ...node.children.flatMap(all)];
  const document = { documentElement: root, createElement: tagName => new Node(tagName),
    getElementById: id => all(root).find(node => node.id === id) || null,
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); } };
  const chrome = { storage: { local: { get: async () => ({ bfdSettings: { hidePlaylistIndicator: initial } }) },
    onChanged: { addListener(callback) { change = callback; } } } };
  const forbidden = () => { throw new Error('Animation suppression must not poll or request animation frames'); };
  const context = vm.createContext({ document, chrome, MutationObserver,
    setInterval: forbidden, setTimeout: forbidden, requestAnimationFrame: forbidden });
  vm.runInContext(source, context); await Promise.resolve();
  function flush() {
    let turns = 0;
    while (pending.size) {
      assert(++turns < 20, 'self-repair must converge without a mutation loop');
      const batch = [...pending]; pending.clear(); for (const observer of batch) observer.callback([]);
    }
  }
  flush();
  return { context, document, root, head, observers, pending, flush,
    style: () => document.getElementById('bfd-playlist-indicator-style'), writes: () => textWrites,
    emit: name => { for (const callback of listeners.get(name) || []) callback({ type: name }); flush(); },
    enable(value) { change({ bfdSettings: { newValue: { hidePlaylistIndicator: value } } }, 'local'); flush(); } };
}
test('removed or moved playlist stylesheet repairs itself using only root-direct and own-style observation', async () => {
  const h = await harness(), original = h.style(), css = original.textContent;
  assert.match(css, /\.right-container \.playing-gif/); assert.match(css, /\.loc-moveclip \.loc-mc-box/);
  original.remove(); h.flush();
  assert(h.style()); assert.notEqual(h.style(), original); assert.equal(h.style().parentNode, h.root);
  assert.equal(h.style().textContent, css);
  const current = h.style(); h.head.append(current); h.flush();
  assert.equal(h.style(), current); assert.equal(current.parentNode, h.root);
  for (const observer of h.observers) for (const [node, options] of observer.targets) {
    if (node === h.root) assert.equal(options.subtree, undefined);
    else assert.equal(node, current, 'subtree observation must be confined to the owned style');
  }
});
test('text and disabled-attribute tampering is repaired, and repeated lifecycle checks do not rewrite stable CSS', async () => {
  const h = await harness(), style = h.style(), css = style.textContent;
  style.textContent = ''; h.flush(); assert.equal(style.textContent, css);
  style.setAttribute('disabled', ''); style.disabled = true; style.sheet.disabled = true;
  h.flush(); assert.equal(style.hasAttribute('disabled'), false);
  assert.equal(style.disabled, false); assert.equal(style.sheet.disabled, false);
  const writes = h.writes();
  for (const name of ['play', 'fullscreenchange', 'play']) h.emit(name);
  assert.equal(h.writes(), writes); assert.equal(h.pending.size, 0);
});
test('play and fullscreenchange repair sheet.disabled even without any DOM mutation', async () => {
  const h = await harness();
  for (const name of ['play', 'fullscreenchange']) {
    const style = h.style(); style.sheet.disabled = true;
    assert.equal(h.pending.size, 0); h.emit(name); assert.equal(style.sheet.disabled, false);
  }
});
test('disabling removes the stylesheet and observers do not resurrect it; re-enabling restores repair', async () => {
  const h = await harness(); h.style().textContent = 'changed before disable';
  h.enable(false); assert.equal(h.style(), null);
  assert(h.observers.every(observer => observer.targets.size === 0));
  h.emit('play'); h.emit('fullscreenchange'); assert.equal(h.style(), null);
  h.enable(true); assert(h.style());
  h.style().remove(); h.flush(); assert(h.style());
});
test('an initially disabled setting does not install a stylesheet or start observers', async () => {
  const h = await harness(false); assert.equal(h.style(), null); assert.equal(h.observers.length, 0);
  h.emit('play'); assert.equal(h.style(), null);
  h.enable(true); assert(h.style()); assert(h.observers.length > 0);
});
