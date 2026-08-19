/**
 * Scroll-driven rocket & meteor field.
 *
 * The signature behaviour: rockets travel while you scroll, and when you
 * reverse scroll direction they *turn around* and fly back. Nothing moves on
 * its own — every pixel of travel is paid for with a pixel of scroll, so the
 * field is a direct read-out of the reader's scrolling.
 *
 * Extracted from the home page so the hidden /to-the-moon playground and the
 * home page share one implementation rather than drifting apart.
 * Deliberately framework-agnostic (plain DOM + math, no Angular) so it can be
 * driven from anywhere and unit-tested without a TestBed.
 */

export interface RocketFieldOptions {
  /** Number of small glowing meteors with motion trails. */
  meteors?: number;
  /** Number of SVG rocket ships with exhaust plumes. */
  rockets?: number;
  /** Dark theme uses bright trails; light theme uses ink-toned ones. */
  isDark: boolean;
}

interface Craft {
  el: HTMLElement;
  /** Base travel angle, in radians, as flown while scrolling *down*. */
  angle: number;
  speed: number;
  x: number;
  y: number;
  /** Actual rendered angle; eased toward the target so reversals arc rather than snap. */
  displayAngle: number;
  isSvg: boolean;
}

const ROCKET_SVG = (body: string, bodyOp: string, finOp: string) => `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
  <path d="M12 2C12 2 8 6 8 12C8 14.5 9 17 10 19L12 22L14 19C15 17 16 14.5 16 12C16 6 12 2 12 2Z" fill="${body}" opacity="${bodyOp}"/>
  <path d="M8 12C6 13 5 14 5 15L8 14V12Z" fill="${body}" opacity="${finOp}"/>
  <path d="M16 12C18 13 19 14 19 15L16 14V12Z" fill="${body}" opacity="${finOp}"/>
  <circle cx="12" cy="10" r="2" fill="rgba(255,124,0,0.8)"/>
  <path d="M10 19L12 22L14 19C13.5 19.5 12.8 20 12 20C11.2 20 10.5 19.5 10 19Z" fill="rgba(255,124,0,0.9)"/>
</svg>`;

export class RocketField {
  private craft: Craft[] = [];
  private container: HTMLElement | null = null;

  /** Builds the craft and attaches them to `container`. Safe to call once per view. */
  init(container: HTMLElement, opts: RocketFieldOptions): void {
    this.container = container;
    const { isDark } = opts;
    const meteorCount = opts.meteors ?? 6;
    const rocketCount = opts.rockets ?? 4;

    const trailColors = isDark
      ? ['rgba(255,255,255,0.7)', 'rgba(255,124,0,0.6)', 'rgba(255,0,102,0.5)', 'rgba(123,63,248,0.5)']
      : ['rgba(0,0,0,0.3)', 'rgba(255,124,0,0.4)', 'rgba(255,0,102,0.35)', 'rgba(123,63,248,0.35)'];
    const meteorDot = isDark ? '#fff' : '#333';
    const trailFade = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.05)';

    for (let i = 0; i < meteorCount; i++) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.width = '4px';
      el.style.height = '4px';
      el.style.borderRadius = '50%';
      el.style.background = meteorDot;
      el.style.willChange = 'transform';
      el.style.opacity = '0';
      const tc = trailColors[i % trailColors.length];
      el.style.boxShadow = `0 0 6px 2px ${tc}, 0 0 12px 4px ${tc}`;

      const trail = document.createElement('div');
      trail.style.position = 'absolute';
      trail.style.top = '50%';
      trail.style.right = '100%';
      trail.style.width = `${50 + Math.random() * 40}px`;
      trail.style.height = '2px';
      trail.style.transform = 'translateY(-50%)';
      trail.style.background = `linear-gradient(to left, ${tc}, ${trailFade}, transparent)`;
      trail.style.borderRadius = '1px';
      el.appendChild(trail);

      container.appendChild(el);
      this.craft.push(this.createCraft(el));
    }

    const rocketBody = isDark ? 'white' : '#444';
    const svg = ROCKET_SVG(rocketBody, isDark ? '0.9' : '0.7', isDark ? '0.6' : '0.5');

    for (let i = 0; i < rocketCount; i++) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.width = '20px';
      el.style.height = '20px';
      el.style.willChange = 'transform';
      el.style.opacity = '0';
      el.style.filter = 'drop-shadow(0 0 3px rgba(255,124,0,0.5))';
      el.innerHTML = svg;

      const exhaust = document.createElement('div');
      exhaust.style.position = 'absolute';
      exhaust.style.top = '100%';
      exhaust.style.left = '50%';
      exhaust.style.width = '4px';
      exhaust.style.height = '22px';
      exhaust.style.transform = 'translateX(-50%)';
      exhaust.style.background =
        'linear-gradient(to bottom, rgba(255,124,0,0.6), rgba(255,0,102,0.3), transparent)';
      exhaust.style.borderRadius = '2px';
      el.appendChild(exhaust);

      container.appendChild(el);
      this.craft.push(this.createCraft(el));
    }
  }

  /**
   * Advances the field. Call from a scroll handler (inside rAF).
   *
   * @param scrollDelta Absolute pixels scrolled since the last update.
   * @param direction   1 while scrolling down, -1 while scrolling up.
   */
  update(scrollDelta: number, direction: number): void {
    if (scrollDelta <= 0) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    for (const c of this.craft) {
      // Scrolling up flips the target heading a half-turn...
      const targetAngle = direction > 0 ? c.angle : c.angle + Math.PI;

      // ...and the display angle eases toward it, so the craft banks through
      // the turn instead of teleporting to the new heading.
      let diff = targetAngle - c.displayAngle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      c.displayAngle += diff * 0.15;

      const dist = scrollDelta * c.speed;
      c.x += Math.cos(c.displayAngle) * dist;
      c.y += Math.sin(c.displayAngle) * dist;

      const margin = 60;
      if (c.x < -margin || c.x > vw + margin || c.y < -margin || c.y > vh + margin) {
        this.reset(c, direction);
      }

      // The rocket artwork points up, so add 90° to put its nose on the heading.
      const deg = c.displayAngle * (180 / Math.PI);
      c.el.style.transform = `translate(${c.x}px, ${c.y}px) rotate(${deg + (c.isSvg ? 90 : 0)}deg)`;
      c.el.style.opacity = '1';
    }
  }

  /** Removes every craft from the DOM. */
  destroy(): void {
    for (const c of this.craft) c.el.remove();
    this.craft = [];
    this.container = null;
  }

  private createCraft(el: HTMLElement): Craft {
    const angleBase = 15 + Math.random() * 50;
    const angle = (Math.random() > 0.5 ? angleBase : 180 - angleBase) * (Math.PI / 180);
    const { x, y } = this.edgePoint(window.innerWidth, window.innerHeight, angle);
    return {
      el,
      angle,
      speed: 0.5 + Math.random() * 1.0,
      x,
      y,
      displayAngle: angle,
      isSvg: el.querySelector('svg') !== null,
    };
  }

  private reset(c: Craft, direction: number): void {
    const angleBase = 15 + Math.random() * 50;
    c.angle = (Math.random() > 0.5 ? angleBase : 180 - angleBase) * (Math.PI / 180);
    c.speed = 0.5 + Math.random() * 1.0;
    const effective = direction > 0 ? c.angle : c.angle + Math.PI;
    c.displayAngle = effective;
    const { x, y } = this.edgePoint(window.innerWidth, window.innerHeight, effective);
    c.x = x;
    c.y = y;
  }

  /** Re-enters from whichever edge the craft is flying away from. */
  private edgePoint(vw: number, vh: number, angle: number): { x: number; y: number } {
    return { x: Math.cos(angle) > 0 ? -20 : vw + 20, y: Math.random() * vh };
  }
}

/**
 * Sprinkles parallax star layers into each target element. Returns the created
 * layers so the caller can translate them at different rates while scrolling.
 */
export function createStarLayers(targets: ArrayLike<Element>, isDark: boolean): HTMLElement[] {
  const counts = [60, 30, 15];
  const sizes = [1, 1.5, 2.5];
  const colors = isDark
    ? ['rgba(255,255,255,0.45)', 'rgba(255,255,255,0.65)', 'rgba(255,255,255,0.85)']
    : ['rgba(71,85,120,0.28)', 'rgba(71,85,120,0.42)', 'rgba(71,85,120,0.58)'];

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const layers: HTMLElement[] = [];

  Array.from(targets).forEach((section) => {
    for (let li = 0; li < 3; li++) {
      const layer = document.createElement('div');
      layer.style.position = 'absolute';
      layer.style.top = '0';
      layer.style.left = '0';
      layer.style.width = '1px';
      layer.style.height = '1px';
      layer.style.zIndex = '1';
      layer.style.pointerEvents = 'none';
      layer.style.willChange = 'transform';
      layer.style.overflow = 'visible';

      const shadows: string[] = [];
      for (let i = 0; i < counts[li]; i++) {
        const x = Math.round(Math.random() * vw);
        const y = Math.round(Math.random() * vh);
        shadows.push(`${x}px ${y}px 0 ${sizes[li]}px ${colors[li]}`);
      }
      layer.style.boxShadow = shadows.join(',');
      section.appendChild(layer);
      layers.push(layer);
    }
  });

  return layers;
}
