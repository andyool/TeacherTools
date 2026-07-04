import { useEffect } from 'react';
import { clampNumber } from './utils';

export const STABLE_BUTTON_LIFT_SELECTOR = [
  '.icon-button',
  '.widget-icon-button',
  '.toolbar-link',
  '.primary-link',
  '.secondary-link',
  '.danger-link',
  '.text-toggle',
  '.widget-card__collapse',
  '.picker-select__trigger',
  '.picker-select__option',
  '.builder-list__button',
  '.stepper__button',
  '.stepper__value',
  '.note-row__delete'
].join(',');

export const STABLE_BUTTON_STRONG_LIFT_SELECTOR =
  '.window-spawn-button,[data-window-spawn-button="true"],.tracker-date-field__button';

export const STABLE_BUTTON_LIFT_CLASS = 'button-lift-stable';

export const REFLECTIVE_SURFACE_SELECTOR = '.panel--main .dashboard-shell .widget-card';

export function useStableButtonLift() {
  useEffect(() => {
    let activeButton: HTMLElement | null = null;
    let activeZone: DOMRect | null = null;

    const clearActiveButton = () => {
      activeButton?.classList.remove(STABLE_BUTTON_LIFT_CLASS);
      activeButton = null;
      activeZone = null;
    };

    const getLiftButton = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return null;
      }

      const button = target.closest<HTMLElement>(STABLE_BUTTON_LIFT_SELECTOR);
      if (!button || !button.matches('button, [role="button"]')) {
        return null;
      }

      if (button instanceof HTMLButtonElement && button.disabled) {
        return null;
      }

      return button;
    };

    const getStableZone = (button: HTMLElement, rect = button.getBoundingClientRect()) => {
      const isStrongLift = button.matches(STABLE_BUTTON_STRONG_LIFT_SELECTOR);
      const lift = isStrongLift ? 10 : 3;
      const horizontalGutter = isStrongLift ? 18 : 12;
      const topGutter = 10;
      const bottomGutter = isStrongLift ? 22 : 14;

      return new DOMRect(
        rect.left - horizontalGutter,
        rect.top - lift - topGutter,
        rect.width + horizontalGutter * 2,
        rect.height + lift + topGutter + bottomGutter
      );
    };

    const isPointInsideRect = (event: PointerEvent, rect: DOMRect | null) => {
      if (!rect) {
        return false;
      }

      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    };

    const setActiveButton = (button: HTMLElement) => {
      if (button === activeButton) {
        return;
      }

      const zone = getStableZone(button);
      clearActiveButton();
      activeButton = button;
      activeZone = zone;
      button.classList.add(STABLE_BUTTON_LIFT_CLASS);
    };

    const getEventButton = (event: PointerEvent) => getLiftButton(event.target);

    const handlePointerOver = (event: PointerEvent) => {
      const button = getLiftButton(event.target);

      if (activeButton && isPointInsideRect(event, activeZone) && (!button || button === activeButton)) {
        return;
      }

      if (!button || button === activeButton) {
        return;
      }

      setActiveButton(button);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!activeButton) {
        const button = getEventButton(event);

        if (button) {
          setActiveButton(button);
        }

        return;
      }

      const button = getEventButton(event);
      if (button && button !== activeButton) {
        setActiveButton(button);
        return;
      }

      if (!isPointInsideRect(event, activeZone)) {
        if (button) {
          setActiveButton(button);
        } else {
          clearActiveButton();
        }
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (activeButton?.contains(event.target as Node)) {
        return;
      }

      if (activeButton && isPointInsideRect(event, activeZone)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      clearActiveButton();
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!activeButton || activeButton.contains(event.target as Node)) {
        return;
      }

      if (!isPointInsideRect(event, activeZone)) {
        clearActiveButton();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      activeButton.click();
      clearActiveButton();
    };

    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('blur', clearActiveButton);

    return () => {
      clearActiveButton();
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('blur', clearActiveButton);
    };
  }, []);
}

export function useReflectiveSurfacePointerTracking() {
  useEffect(() => {
    let activeSurface: HTMLElement | null = null;
    let activeSurfaceRect: DOMRect | null = null;
    let pendingEvent: PointerEvent | null = null;
    let animationFrame = 0;

    const getCumulativeCssZoom = (element: HTMLElement) => {
      let zoom = 1;
      let current: HTMLElement | null = element;

      while (current) {
        const value = Number.parseFloat(window.getComputedStyle(current).zoom || '1');

        if (Number.isFinite(value) && value > 0) {
          zoom *= value;
        }

        current = current.parentElement;
      }

      return zoom;
    };

    const getVisualRect = (rect: DOMRect, element: HTMLElement) => {
      const zoom = getCumulativeCssZoom(element);

      return {
        bottom: rect.bottom * zoom,
        height: rect.height * zoom,
        left: rect.left * zoom,
        right: rect.right * zoom,
        top: rect.top * zoom,
        width: rect.width * zoom
      };
    };

    const resetSurface = (surface: HTMLElement | null) => {
      if (!surface) {
        return;
      }

      delete surface.dataset.reflecting;
      surface.style.removeProperty('--reflection-x');
      surface.style.removeProperty('--reflection-y');
      surface.style.removeProperty('--reflection-press-x');
      surface.style.removeProperty('--reflection-press-y');
      surface.style.removeProperty('--reflection-shift-x');
      surface.style.removeProperty('--reflection-shift-y');
      surface.style.removeProperty('--reflection-tilt-x');
      surface.style.removeProperty('--reflection-tilt-y');
      surface.style.removeProperty('--reflection-cone-angle');
      surface.style.removeProperty('--reflection-cone-half-width');
      surface.style.removeProperty('--reflection-cone-length');
      surface.style.removeProperty('--reflection-cone-width');
      surface.style.removeProperty('--bezel-glint-x');
      surface.style.removeProperty('--bezel-glint-y');
      surface.style.removeProperty('--bezel-glint-angle');
      surface.style.removeProperty('--bezel-glint-radius-x');
      surface.style.removeProperty('--bezel-glint-radius-y');
      surface.style.removeProperty('--bezel-glint-mid-radius-x');
      surface.style.removeProperty('--bezel-glint-mid-radius-y');
      surface.style.removeProperty('--bezel-glint-core-radius-x');
      surface.style.removeProperty('--bezel-glint-core-radius-y');
    };

    const setActiveSurface = (surface: HTMLElement | null) => {
      if (activeSurface === surface) {
        return;
      }

      resetSurface(activeSurface);
      activeSurface = surface;
      activeSurfaceRect = surface?.getBoundingClientRect() ?? null;
    };

    const getReflectiveSurface = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return null;
      }

      return target.closest<HTMLElement>(REFLECTIVE_SURFACE_SELECTOR);
    };

    const updateSurface = (event: PointerEvent) => {
      const surface = getReflectiveSurface(event.target);
      setActiveSurface(surface);

      if (!surface) {
        return;
      }

      const rect = getVisualRect(activeSurfaceRect ?? surface.getBoundingClientRect(), surface);
      const layoutWidth = surface.offsetWidth || rect.width;
      const layoutHeight = surface.offsetHeight || rect.height;

      if (layoutWidth <= 0 || layoutHeight <= 0 || rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const anchorX = rect.left + rect.width / 2;
      const anchorY = rect.top + rect.height / 2;
      const pointerDeltaX = event.clientX - anchorX;
      const pointerDeltaY = event.clientY - anchorY;
      const visualHalfWidth = Math.max(1, rect.width / 2);
      const visualHalfHeight = Math.max(1, rect.height / 2);
      const pressX = clampNumber(pointerDeltaX / visualHalfWidth, -1, 1);
      const pressY = clampNumber(pointerDeltaY / visualHalfHeight, -1, 1);
      const directionLength = Math.hypot(pointerDeltaX, pointerDeltaY) || 1;
      const directionX = pointerDeltaX / directionLength;
      const directionY = pointerDeltaY / directionLength;
      const virtualPressX = 50 + pressX * 14;
      const virtualPressY = 50 + pressY * 14;
      const coneAngle = (Math.atan2(pointerDeltaY, pointerDeltaX) * 180) / Math.PI - 90;
      const halfWidth = layoutWidth / 2;
      const halfHeight = layoutHeight / 2;
      const surfaceStyles = window.getComputedStyle(surface);
      const radius = Math.min(
        parseFloat(surfaceStyles.borderTopLeftRadius || '0') || 0,
        halfWidth,
        halfHeight
      );
      const sideX = directionX >= 0 ? 1 : -1;
      const sideY = directionY >= 0 ? 1 : -1;
      const candidates: Array<{
        angle: number;
        distance: number;
        kind: 'corner' | 'horizontal' | 'vertical';
        x: number;
        y: number;
      }> = [];

      if (Math.abs(directionY) > 0.001) {
        const distance = (sideY * halfHeight) / directionY;
        const boundaryX = distance * directionX;

        if (distance > 0 && Math.abs(boundaryX) <= halfWidth - radius) {
          candidates.push({
            angle: 0,
            distance,
            kind: 'horizontal',
            x: boundaryX,
            y: sideY * halfHeight
          });
        }
      }

      if (Math.abs(directionX) > 0.001) {
        const distance = (sideX * halfWidth) / directionX;
        const boundaryY = distance * directionY;

        if (distance > 0 && Math.abs(boundaryY) <= halfHeight - radius) {
          candidates.push({
            angle: 90,
            distance,
            kind: 'vertical',
            x: sideX * halfWidth,
            y: boundaryY
          });
        }
      }

      const cornerCenterX = sideX * (halfWidth - radius);
      const cornerCenterY = sideY * (halfHeight - radius);
      const centerProjection = directionX * cornerCenterX + directionY * cornerCenterY;
      const cornerDistanceSquared = cornerCenterX * cornerCenterX + cornerCenterY * cornerCenterY;
      const discriminant = centerProjection * centerProjection - (cornerDistanceSquared - radius * radius);

      if (discriminant >= 0) {
        const distance = centerProjection + Math.sqrt(discriminant);
        const boundaryX = distance * directionX;
        const boundaryY = distance * directionY;
        const radiusX = boundaryX - cornerCenterX;
        const radiusY = boundaryY - cornerCenterY;

        candidates.push({
          angle: (Math.atan2(radiusY, radiusX) * 180) / Math.PI + 90,
          distance,
          kind: 'corner',
          x: boundaryX,
          y: boundaryY
        });
      }

      const bezelPoint =
        candidates
          .filter((candidate) => Number.isFinite(candidate.distance) && candidate.distance > 0)
          .sort((first, second) => first.distance - second.distance)[0] ?? {
          angle: Math.abs(directionY) > Math.abs(directionX) ? 0 : 90,
          distance: Math.min(halfWidth, halfHeight),
          kind: Math.abs(directionY) > Math.abs(directionX) ? ('horizontal' as const) : ('vertical' as const),
          x: sideX * halfWidth,
          y: sideY * halfHeight
        };
      const bezelX = clampNumber(50 + (bezelPoint.x / layoutWidth) * 100, 0, 100);
      const bezelY = clampNumber(50 + (bezelPoint.y / layoutHeight) * 100, 0, 100);
      const coneHalfWidthBase = clampNumber(
        bezelPoint.distance * 0.24,
        Math.min(24, Math.max(12, Math.min(layoutWidth, layoutHeight) * 0.18)),
        Math.max(26, Math.min(layoutWidth, layoutHeight) * 0.48)
      );
      const coneHalfWidth = coneHalfWidthBase * 2;
      const coneLength = bezelPoint.distance + coneHalfWidth * 1.35;
      const glintRadiusX =
        bezelPoint.kind === 'vertical'
          ? Math.max(radius + 8, coneHalfWidth * 0.34)
          : bezelPoint.kind === 'corner'
            ? coneHalfWidth * 0.92
            : coneHalfWidth;
      const glintRadiusY =
        bezelPoint.kind === 'horizontal'
          ? Math.max(radius + 8, coneHalfWidth * 0.34)
          : bezelPoint.kind === 'corner'
            ? coneHalfWidth * 0.92
            : coneHalfWidth;
      const softGlintRadiusX = glintRadiusX * 1.18;
      const softGlintRadiusY = glintRadiusY * 1.18;
      const midGlintRadiusX = Math.max(10, glintRadiusX * 0.76);
      const midGlintRadiusY = Math.max(6, glintRadiusY * 0.76);
      const coreGlintRadiusX = Math.max(8, glintRadiusX * 0.46);
      const coreGlintRadiusY = Math.max(5, glintRadiusY * 0.46);

      surface.dataset.reflecting = 'true';
      surface.style.setProperty('--reflection-x', `${virtualPressX.toFixed(2)}%`);
      surface.style.setProperty('--reflection-y', `${virtualPressY.toFixed(2)}%`);
      surface.style.setProperty('--reflection-press-x', pressX.toFixed(3));
      surface.style.setProperty('--reflection-press-y', pressY.toFixed(3));
      surface.style.setProperty('--reflection-shift-x', `${pressX.toFixed(3)}px`);
      surface.style.setProperty('--reflection-shift-y', `${pressY.toFixed(3)}px`);
      surface.style.setProperty('--reflection-tilt-x', `${(-pressY * 1.2).toFixed(3)}deg`);
      surface.style.setProperty('--reflection-tilt-y', `${(pressX * 1.2).toFixed(3)}deg`);
      surface.style.setProperty('--reflection-cone-angle', `${coneAngle.toFixed(3)}deg`);
      surface.style.setProperty('--reflection-cone-half-width', `${coneHalfWidth.toFixed(2)}px`);
      surface.style.setProperty('--reflection-cone-length', `${coneLength.toFixed(2)}px`);
      surface.style.setProperty('--reflection-cone-width', `${(coneHalfWidth * 2).toFixed(2)}px`);
      surface.style.setProperty('--bezel-glint-x', `${bezelX.toFixed(2)}%`);
      surface.style.setProperty('--bezel-glint-y', `${bezelY.toFixed(2)}%`);
      surface.style.setProperty('--bezel-glint-angle', `${bezelPoint.angle.toFixed(3)}deg`);
      surface.style.setProperty('--bezel-glint-radius-x', `${softGlintRadiusX.toFixed(2)}px`);
      surface.style.setProperty('--bezel-glint-radius-y', `${softGlintRadiusY.toFixed(2)}px`);
      surface.style.setProperty('--bezel-glint-mid-radius-x', `${midGlintRadiusX.toFixed(2)}px`);
      surface.style.setProperty('--bezel-glint-mid-radius-y', `${midGlintRadiusY.toFixed(2)}px`);
      surface.style.setProperty('--bezel-glint-core-radius-x', `${coreGlintRadiusX.toFixed(2)}px`);
      surface.style.setProperty('--bezel-glint-core-radius-y', `${coreGlintRadiusY.toFixed(2)}px`);
    };

    const handlePointerMove = (event: PointerEvent) => {
      pendingEvent = event;

      if (animationFrame) {
        return;
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;

        if (!pendingEvent) {
          return;
        }

        updateSurface(pendingEvent);
      });
    };

    const clearActiveSurface = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }

      pendingEvent = null;
      resetSurface(activeSurface);
      activeSurface = null;
      activeSurfaceRect = null;
    };

    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerleave', clearActiveSurface, true);
    document.addEventListener('pointercancel', clearActiveSurface, true);
    window.addEventListener('blur', clearActiveSurface);

    return () => {
      clearActiveSurface();
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('pointerleave', clearActiveSurface, true);
      document.removeEventListener('pointercancel', clearActiveSurface, true);
      window.removeEventListener('blur', clearActiveSurface);
    };
  }, []);
}
