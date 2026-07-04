import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clampNumber } from './utils';

export type TooltipPlacement = 'bottom' | 'top';

export type TooltipAlignment = 'center' | 'end' | 'start';

export type TooltipState = {
  alignment: TooltipAlignment;
  anchorRect: DOMRect;
  text: string;
};

export type TooltipPosition = {
  arrowLeft: number;
  left: number;
  placement: TooltipPlacement;
  top: number;
};

export function GlobalTooltipLayer() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const tooltipMeasureRef = useRef<HTMLDivElement | null>(null);
  const activeElementRef = useRef<HTMLElement | null>(null);

  const measureTooltipPosition = (nextTooltip: TooltipState) => {
    const tooltipMeasureElement = tooltipMeasureRef.current;
    if (!tooltipMeasureElement) {
      return null;
    }

    tooltipMeasureElement.textContent = nextTooltip.text;
    return getTooltipPosition(nextTooltip, tooltipMeasureElement);
  };

  const getTooltipPosition = (nextTooltip: TooltipState, tooltipElement: HTMLDivElement): TooltipPosition => {
    const margin = 12;
    const offset = 12;
    const width = tooltipElement.offsetWidth;
    const height = tooltipElement.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const preferredLeft =
      nextTooltip.alignment === 'start'
        ? nextTooltip.anchorRect.left
        : nextTooltip.alignment === 'end'
          ? nextTooltip.anchorRect.right - width
          : nextTooltip.anchorRect.left + nextTooltip.anchorRect.width / 2 - width / 2;
    const left = clampNumber(preferredLeft, margin, Math.max(margin, viewportWidth - width - margin));
    const arrowLeft = clampNumber(
      nextTooltip.anchorRect.left + nextTooltip.anchorRect.width / 2 - left,
      14,
      Math.max(14, width - 14)
    );
    const topPlacementTop = nextTooltip.anchorRect.top - height - offset;
    const placement: TooltipPlacement = topPlacementTop >= margin ? 'top' : 'bottom';
    const top =
      placement === 'top'
        ? topPlacementTop
        : clampNumber(
            nextTooltip.anchorRect.bottom + offset,
            margin,
            Math.max(margin, viewportHeight - height - margin)
          );

    return {
      arrowLeft,
      left,
      placement,
      top
    };
  };

  useEffect(() => {
    const getTooltipElement = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return null;
      }

      return target.closest<HTMLElement>(
        '[data-tooltip-content], .widget-card button, .widget-card [role="button"], .widget-picker-window button'
      );
    };

    const resolveTooltipText = (element: HTMLElement) => {
      const explicitText = element.dataset.tooltipContent?.trim();
      if (explicitText) {
        return explicitText;
      }

      if (!element.closest('.widget-card') && !element.closest('.widget-picker-window')) {
        return '';
      }

      const labelText = element.getAttribute('aria-label')?.trim();
      if (labelText) {
        return labelText;
      }

      const titleText = element.getAttribute('title')?.trim();
      if (titleText) {
        return titleText;
      }

      return element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    };

    const normalizeTooltipText = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

    const getVisibleLabelText = (element: HTMLElement) => {
      // Compact size tiers hide button text with font-size: 0 and render a glyph via ::after,
      // so the label text is not actually visible even though innerText still returns it.
      if (window.getComputedStyle(element).fontSize === '0px') {
        return '';
      }

      return element.innerText;
    };

    const getTooltipText = (element: HTMLElement) => {
      const text = resolveTooltipText(element);
      if (!text) {
        return '';
      }

      const visibleLabel = normalizeTooltipText(getVisibleLabelText(element));
      if (visibleLabel && visibleLabel === normalizeTooltipText(text)) {
        return '';
      }

      return text;
    };
    const getTooltipAlignment = (element: HTMLElement): TooltipAlignment => {
      const requestedAlignment = element.dataset.tooltipAlignment?.trim();
      return requestedAlignment === 'start' || requestedAlignment === 'end'
        ? requestedAlignment
        : 'center';
    };

    const hideTooltip = () => {
      activeElementRef.current = null;
      setTooltip(null);
      setPosition(null);
    };

    const syncActiveTooltip = () => {
      const activeElement = activeElementRef.current;
      if (!activeElement) {
        return;
      }

      const text = getTooltipText(activeElement);
      if (!text) {
        hideTooltip();
        return;
      }

      const nextTooltip = {
        alignment: getTooltipAlignment(activeElement),
        anchorRect: activeElement.getBoundingClientRect(),
        text
      };

      setTooltip(nextTooltip);
      setPosition(measureTooltipPosition(nextTooltip));
    };

    const showTooltip = (element: HTMLElement | null) => {
      if (!element) {
        hideTooltip();
        return;
      }

      if (activeElementRef.current !== element) {
        activeElementRef.current = null;
      }

      const title = getTooltipText(element);
      if (!title) {
        hideTooltip();
        return;
      }

      activeElementRef.current = element;
      const nextTooltip = {
        alignment: getTooltipAlignment(element),
        anchorRect: element.getBoundingClientRect(),
        text: title
      };

      setTooltip(nextTooltip);
      setPosition(measureTooltipPosition(nextTooltip));
    };

    const handlePointerOver = (event: PointerEvent) => {
      showTooltip(getTooltipElement(event.target));
    };

    const handlePointerOut = (event: PointerEvent) => {
      const activeElement = activeElementRef.current;
      if (!activeElement) {
        return;
      }

      if (event.relatedTarget instanceof Node && activeElement.contains(event.relatedTarget)) {
        return;
      }

      const nextElement = getTooltipElement(event.relatedTarget);
      if (nextElement) {
        showTooltip(nextElement);
        return;
      }

      hideTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      showTooltip(getTooltipElement(event.target));
    };

    const handleFocusOut = (event: FocusEvent) => {
      const nextElement = getTooltipElement(event.relatedTarget);
      if (nextElement) {
        showTooltip(nextElement);
        return;
      }

      hideTooltip();
    };

    const handlePointerDown = () => {
      hideTooltip();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hideTooltip();
      }
    };

    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', syncActiveTooltip);
    window.addEventListener('scroll', syncActiveTooltip, true);

    return () => {
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('pointerout', handlePointerOut, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', syncActiveTooltip);
      window.removeEventListener('scroll', syncActiveTooltip, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tooltip) {
      return;
    }

    const nextPosition = measureTooltipPosition(tooltip);
    if (!nextPosition) {
      return;
    }

    setPosition((current) =>
      current &&
      current.left === nextPosition.left &&
      current.top === nextPosition.top &&
      current.arrowLeft === nextPosition.arrowLeft &&
      current.placement === nextPosition.placement
        ? current
        : nextPosition
    );
  }, [tooltip]);

  if (!tooltip) {
    return null;
  }

  return (
    <>
      <div
        aria-hidden="true"
        className="app-tooltip app-tooltip--top app-tooltip--measure"
        ref={tooltipMeasureRef}
      />
      <div
        className={`app-tooltip ${position ? `app-tooltip--${position.placement}` : 'app-tooltip--top'}`}
        role="tooltip"
        style={
          position
            ? {
                left: `${position.left}px`,
                opacity: 1,
                top: `${position.top}px`,
                ['--tooltip-arrow-left' as string]: `${position.arrowLeft}px`
              }
            : { opacity: 0 }
        }
      >
        {tooltip.text}
      </div>
    </>
  );
}
