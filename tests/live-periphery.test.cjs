const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../extension/live-periphery.js'), 'utf8');
async function harness(options = {}) {
  const observers = [], pending = new Set(), storageListeners = new Set(), writes = [];
  const emitter = () => {
    const listeners = new Map();
    return { listeners, addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
      removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }, emit(name) { for (const fn of [...(listeners.get(name) || [])]) fn({ type: name }); } };
  };
  function notify(target) { for (const observer of observers) if (observer.targets.has(target)) pending.add(observer); }
  class Node {
    constructor(tag = 'div', classes = '', id = '') {
      this.tagName = tag.toUpperCase(); this.classes = new Set(classes.split(/\s+/).filter(Boolean)); this.id = id; this.children = []; this.parentElement = null;
      const styles = new Map(); this.style = {
        getPropertyValue: name => styles.get(name)?.value || '', getPropertyPriority: name => styles.get(name)?.priority || '',
        setProperty: (name, value, priority = '') => { styles.set(name, { value, priority }); writes.push({ node: this, name, value, priority }); },
        removeProperty: name => { styles.delete(name); writes.push({ node: this, name, value: '', priority: '' }); }
      };
    }
    get isConnected() { return this === root || !!this.parentElement?.isConnected; }
    append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parentElement = this; notify(this); } }
    remove() { const parent = this.parentElement; if (parent) { parent.children.splice(parent.children.indexOf(this), 1); this.parentElement = null; notify(parent); } }
    contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; }
    matches(selector) {
      return selector.split(',').some(part => {
        part = part.trim(); const space = part.lastIndexOf(' ');
        if (space >= 0) { if (!this.matches(part.slice(space + 1))) return false; for (let p = this.parentElement; p; p = p.parentElement) if (p.matches(part.slice(0, space))) return true; return false; }
        const id = part.match(/#([\w-]+)/)?.[1], tag = part.match(/^[a-z]+/i)?.[0], classes = [...part.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
        return (!id || this.id === id) && (!tag || this.tagName === tag.toUpperCase()) && classes.every(name => this.classes.has(name));
      });
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(child => selector === '*' || child.matches(selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  class MutationObserver {
    constructor(fn) { this.fn = fn; this.targets = new Map(); observers.push(this); }
    observe(node, settings) { this.targets.set(node, settings); }
    disconnect() { this.targets.clear(); pending.delete(this); }
  }
  const root = new Node('html'), head = new Node('head'), body = new Node('body'); root.append(head, body);
  const app = new Node('div', 'live-room-app'), shell = new Node(), main = new Node(), fullscreen = new Node('div', 'player-fullscreen-wrap');
  const player = new Node('div', '', 'live-player'), video = new Node('video'), controls = new Node('div', 'web-player-controller');
  const header = new Node('div', 'head-info-vm'), aside = new Node('div', 'aside-area-vm'), sidebar = new Node('div', 'sidebar-vm'), footer = new Node('footer', 'link-footer');
  const bodyNative = new Node('div', 'guard-store-vm'), unknown = new Node('div', 'foreign-widget'), iframe = new Node('iframe');
  const codex = new Node('div', '', 'codex-agent-overlay-root'), translate = new Node('div', '', 'immersive-translate-browser-popup');
  body.append(app, bodyNative, unknown, iframe, codex, translate); app.append(header, shell, footer); shell.append(main, aside); main.append(fullscreen, sidebar); fullscreen.append(player, controls); player.append(video);
  const document = { ...emitter(), documentElement: root, head, body, fullscreenElement: options.fullscreen === false ? null : fullscreen };
  let finishInitial;
  const initial = options.initial ?? true;
  const chrome = { storage: { local: { get: () => options.delayedStorage ? new Promise(resolve => { finishInitial = resolve; }) : Promise.resolve({ bfdSettings: { hidePlaylistIndicator: initial, enabled: false } }) },
    onChanged: { addListener: fn => storageListeners.add(fn), removeListener: fn => storageListeners.delete(fn) } } };
  const forbidden = () => { throw new Error('periphery isolation must not poll or request animation frames'); };
  const context = vm.createContext({ ...emitter(), document, chrome, MutationObserver, URL,
    location: { href: options.href || 'https://live.bilibili.com/12345?private=unused' },
    setTimeout: forbidden, setInterval: forbidden, requestAnimationFrame: forbidden });
  if (options.before) options.before({ root, body, app, shell, main, fullscreen, player, video, controls, header, aside, sidebar, footer, bodyNative, unknown, iframe, codex, translate, Node });
  vm.runInContext(source, context); await Promise.resolve();
  function flush() {
    let count = 0;
    while (pending.size) { assert(++count < 20, 'observation must converge'); const batch = [...pending]; pending.clear(); for (const observer of batch) if (observer.targets.size) observer.fn([]); }
  }
  flush();
  function event(name, target = document) { target.emit(name); flush(); }
  return { context, document, root, head, body, app, shell, main, fullscreen, player, video, controls, header, aside, sidebar, footer, bodyNative, unknown, iframe, codex, translate,
    Node, observers, writes, storageListeners, flush, event, api: context.BFDLivePeriphery,
    enter(node = fullscreen) { document.fullscreenElement = node; event('fullscreenchange'); },
    exit() { document.fullscreenElement = null; event('fullscreenchange'); },
    storage(value, area = 'local') { for (const fn of [...storageListeners]) fn({ bfdSettings: { newValue: value } }, area); flush(); },
    resolveInitial(value = initial) { finishInitial({ bfdSettings: { hidePlaylistIndicator: value } }); },
    listenerCount: () => [document, context].reduce((sum, item) => sum + [...item.listeners.values()].reduce((n, listeners) => n + listeners.size, 0), 0) };
}
const hidden = node => node.style.getPropertyValue('display') === 'none' && node.style.getPropertyPriority('display') === 'important';

test('fullscreen isolates recognized native sibling branches while keeping the player, controls and foreign roots intact', async () => {
  const h = await harness();
  for (const node of [h.header, h.aside, h.sidebar, h.footer, h.bodyNative]) assert(hidden(node));
  for (const node of [h.app, h.shell, h.main, h.fullscreen, h.player, h.video, h.controls, h.unknown, h.iframe, h.codex, h.translate]) assert(!hidden(node));
  assert.equal(h.api.readStatus().active, true); assert.equal(h.api.readStatus().hiddenBranches, 5);
  assert(!h.writes.some(write => write.node === h.video || write.node === h.player || write.node === h.controls));
});
test('only exact HTTPS live-room routes and fullscreen containers containing a native app player are eligible', async () => {
  for (const href of ['https://live.bilibili.com/', 'https://live.bilibili.com/0', 'https://live.bilibili.com/0123', 'https://live.bilibili.com/activity/123', 'https://www.bilibili.com/video/BV1test', 'https://example.com/123', 'http://live.bilibili.com/123']) {
    const h = await harness({ href }); assert.equal(h.api.readStatus().active, false, href); assert.equal(h.writes.length, 0); assert.equal(h.observers.length, 0);
  }
  const blanc = await harness({ href: 'https://live.bilibili.com/blanc/123/?from=test' }); assert(hidden(blanc.header));
  const normal = await harness({ fullscreen: false }); assert.equal(normal.writes.length, 0); normal.enter(normal.unknown); assert.equal(normal.writes.length, 0);
  normal.body.append(normal.fullscreen); normal.enter(); assert.equal(normal.api.readStatus().active, false); assert.equal(normal.writes.length, 0);
});
test('animation setting is independent from the main helper setting and asynchronous old storage values cannot override it', async () => {
  const h = await harness({ initial: false }); assert.equal(h.writes.length, 0);
  h.storage({ enabled: false, hidePlaylistIndicator: true }); assert(hidden(h.header));
  h.storage({ enabled: true, hidePlaylistIndicator: false }); assert(!hidden(h.header));
  h.storage({ hidePlaylistIndicator: true }, 'sync'); assert(!hidden(h.header));
  const delayed = await harness({ delayedStorage: true }); delayed.api.set(false); delayed.resolveInitial(true); await Promise.resolve(); assert.equal(delayed.writes.length, 0);
  const changed = await harness({ delayedStorage: true }); changed.storage({ enabled: false, hidePlaylistIndicator: true }); changed.resolveInitial(false); await Promise.resolve(); assert(hidden(changed.header));
});
test('exit restores original inline display values and priorities and stable checks perform no extra writes', async () => {
  const h = await harness({ before({ aside, footer, bodyNative }) { aside.style.setProperty('display', 'flex', 'important'); footer.style.setProperty('display', 'block'); bodyNative.style.setProperty('display', 'none', 'important'); } });
  const count = h.writes.length;
  for (let i = 0; i < 30; i++) { h.api.set(true); h.event('fullscreenchange'); h.api.readStatus(); }
  assert.equal(h.writes.length, count);
  h.exit(); assert.equal(h.aside.style.getPropertyValue('display'), 'flex'); assert.equal(h.aside.style.getPropertyPriority('display'), 'important');
  assert.equal(h.footer.style.getPropertyValue('display'), 'block'); assert.equal(h.footer.style.getPropertyPriority('display'), '');
  assert(hidden(h.bodyNative), 'a preexisting hidden native root is never owned or unhidden');
  assert.equal(h.header.style.getPropertyValue('display'), ''); assert(h.observers.every(observer => observer.targets.size === 0));
});
test('native nodes added to local ancestor branches and body are isolated without observing all-page or per-frame changes', async () => {
  const h = await harness(), added = new h.Node('div', 'sections-vm'), bodyAdded = new h.Node('div', '', 'player-animation-vm'), foreign = new h.Node('iframe', 'foreign-frame');
  h.main.append(added); h.body.append(bodyAdded, foreign); h.flush(); assert(hidden(added)); assert(hidden(bodyAdded)); assert(!hidden(foreign));
  for (const observer of h.observers) for (const settings of observer.targets.values()) { assert.equal(settings.childList, true); assert.equal(settings.subtree, undefined); assert.equal(settings.attributes, undefined); }
  const count = h.writes.length; const layer = new h.Node('div', 'web-player-danmaku'); h.player.append(layer); h.flush();
  for (let i = 0; i < 100; i++) layer.append(new h.Node('div', 'bili-danmaku-x-dm')); h.flush(); assert.equal(h.writes.length, count);
});
test('reparenting the fullscreen branch restores its new ancestors before isolating the previous path', async () => {
  const h = await harness(); h.aside.style.getPropertyValue('display');
  h.aside.append(h.fullscreen); h.flush();
  assert(!hidden(h.aside), 'the newly active path must become visible'); assert(!hidden(h.fullscreen)); assert(!hidden(h.player)); assert(!hidden(h.video));
  assert(hidden(h.sidebar)); assert(hidden(h.header));
  const activeTargets = new Set(h.observers.flatMap(observer => [...observer.targets.keys()])); assert(activeTargets.has(h.aside));
  h.body.append(h.fullscreen); h.flush(); assert.equal(h.api.readStatus().active, false); assert(!hidden(h.header)); assert(!hidden(h.sidebar)); assert(!hidden(h.bodyNative));
});
test('unknown wrappers remain visible while only recognized nested native roots are isolated', async () => {
  const h = await harness(), wrapper = new h.Node(), nested = new h.Node(), native = new h.Node('div', 'live-charge-vm'), foreign = new h.Node('div', 'extension-toolbar');
  nested.append(native, foreign); wrapper.append(nested); h.shell.append(wrapper); h.flush();
  assert(!hidden(wrapper)); assert(!hidden(nested)); assert(hidden(native)); assert(!hidden(foreign));
  const added = new h.Node('div', 'limit-boomman'); nested.append(added); h.flush(); assert(hidden(added));
});
test('known extension UI protects containing native branches, including UI inserted into a previously isolated root', async () => {
  const h = await harness({ before({ aside, Node }) { aside.append(new Node('div', '', 'immersive-translate-browser-popup')); } });
  assert(!hidden(h.aside)); assert(hidden(h.header));
  const tool = new h.Node('div', '', 'codex-agent-overlay-root'); h.sidebar.append(tool); h.flush(); assert(!hidden(h.sidebar)); assert(!hidden(tool));
  h.exit(); assert(!hidden(h.aside)); assert(!hidden(h.sidebar));
});
test('external display changes are preserved during isolation and exit instead of being repeatedly overwritten', async () => {
  const h = await harness(); h.aside.style.setProperty('display', 'grid', 'important'); h.header.style.setProperty('display', 'none');
  h.event('fullscreenchange'); assert.equal(h.aside.style.getPropertyValue('display'), 'grid'); assert.equal(h.header.style.getPropertyPriority('display'), '');
  h.api.set(true); assert.equal(h.aside.style.getPropertyValue('display'), 'grid'); h.exit();
  assert.equal(h.aside.style.getPropertyValue('display'), 'grid'); assert.equal(h.aside.style.getPropertyPriority('display'), 'important'); assert.equal(h.header.style.getPropertyValue('display'), 'none'); assert.equal(h.header.style.getPropertyPriority('display'), '');
  h.enter(); assert(hidden(h.aside)); h.exit(); assert.equal(h.aside.style.getPropertyValue('display'), 'grid');
});
test('pagehide restores all owned styles and disconnects; pageshow can reapply the retained setting', async () => {
  const h = await harness(); h.event('pagehide', h.context); assert(!hidden(h.header)); assert(!hidden(h.bodyNative)); assert(h.observers.every(observer => !observer.targets.size));
  h.event('fullscreenchange'); assert(!hidden(h.header)); h.event('pageshow', h.context); assert(hidden(h.header));
  h.context.location.href = 'https://live.bilibili.com/activity/test'; h.event('popstate', h.context); assert(!hidden(h.header)); assert.equal(h.api.readStatus().active, false);
});
test('replacement and disconnection release old branches without hiding a replacement video', async () => {
  const h = await harness(); const replacement = new h.Node('div', 'live-room-app'), wrap = new h.Node(), player = new h.Node('div', '', 'live-player'), video = new h.Node('video'), aside = new h.Node('div', 'aside-area-vm');
  wrap.append(player); player.append(video); replacement.append(wrap, aside); h.body.append(replacement); h.app.remove(); h.flush(); assert(!hidden(h.header)); assert.equal(h.api.readStatus().active, false);
  h.enter(wrap); assert(hidden(aside)); assert(!hidden(wrap)); assert(!hidden(player)); assert(!hidden(video)); h.exit(); assert(!hidden(aside));
});
test('destroy removes every owned listener and observer and blocks pending settings or future events from reactivating isolation', async () => {
  const h = await harness(); assert(h.listenerCount() > 0); assert.equal(h.storageListeners.size, 1);
  h.api.destroy(); h.api.destroy(); assert.equal(h.listenerCount(), 0); assert.equal(h.storageListeners.size, 0); assert(!hidden(h.header)); assert(h.observers.every(observer => !observer.targets.size));
  h.api.set(true); h.event('fullscreenchange'); h.storage({ hidePlaylistIndicator: true }); assert(!hidden(h.header)); assert.equal(h.api.readStatus().destroyed, true);
  const delayed = await harness({ delayedStorage: true }); delayed.api.destroy(); delayed.resolveInitial(true); await Promise.resolve(); assert.equal(delayed.writes.length, 0);
});
