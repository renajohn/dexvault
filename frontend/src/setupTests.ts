// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

/**
 * jsdom implements neither observer API, and Node 26 ships an experimental
 * localStorage that shadows jsdom's and is undefined unless
 * --localstorage-file is passed. Components that lay themselves out or lazily
 * load on scroll would otherwise crash on render rather than be tested.
 */
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] { return []; }
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as Record<string, unknown>).ResizeObserver = NoopObserver;
}

if (!('IntersectionObserver' in globalThis)) {
  (globalThis as Record<string, unknown>).IntersectionObserver = NoopObserver;
}

// Nor does it scroll: a component that brings an element into view (a score's bookmarks) would throw on a click.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
