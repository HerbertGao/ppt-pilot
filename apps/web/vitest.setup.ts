import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount trees between tests so module-level state (discovery-session Map) is the
// only thing that carries over — mirrors real SPA navigation vs. hard refresh.
afterEach(() => {
  cleanup();
});

// jsdom is missing a handful of DOM APIs that Radix UI primitives touch. These
// no-op shims keep component rendering from throwing; tests never open menus, so
// their behaviour is irrelevant beyond "exists".
type Shimmable = Element & {
  scrollIntoView?: () => void;
  hasPointerCapture?: () => boolean;
  setPointerCapture?: () => void;
  releasePointerCapture?: () => void;
};
const proto = Element.prototype as Shimmable;
proto.scrollIntoView ??= () => {};
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};

if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
