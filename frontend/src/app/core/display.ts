import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';

/**
 * Chooses the page layout for the current screen and exposes it as classes on <html>:
 * - `wide`: landscape laptop/desktop/TV — sky scene and today's salah side by side.
 * - `tv`: kiosk mode (`?tv` or `?mode=tv`) — one fixed screen, no scrolling, no controls.
 * On wide screens the root font size scales with the viewport, so everything (sized in rem)
 * grows proportionally on large displays.
 */
@Injectable({ providedIn: 'root' })
export class Display {
  private readonly size = signal({ w: innerWidth, h: innerHeight });

  readonly tv = (() => {
    const params = new URLSearchParams(location.search);
    return params.has('tv') || params.get('mode') === 'tv';
  })();

  readonly wide = computed(() => {
    const { w, h } = this.size();
    return this.tv || (w >= 1200 && w / h >= 1.3);
  });

  constructor() {
    const onResize = () => this.size.set({ w: innerWidth, h: innerHeight });
    addEventListener('resize', onResize);
    inject(DestroyRef).onDestroy(() => removeEventListener('resize', onResize));

    effect(() => {
      const root = document.documentElement.classList;
      root.toggle('wide', this.wide());
      root.toggle('tv', this.tv);
    });
  }
}
