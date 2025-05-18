/**
 * Fade an HTML element in or out
 * @param element The HTML element to fade
 * @param out Whether to fade out (true) or in (false)
 * @param displayStyle The CSS display style to use when visible
 * @param duration The duration of the fade animation in milliseconds
 * @param onComplete Optional callback function to execute when the animation completes
 * @returns The interval ID that can be used to cancel the animation
 */
export const fadeElement = (
  element: HTMLElement,
  out: boolean,
  displayStyle: string,
  duration: number,
  onComplete?: () => void
): number => {
  const startTime = performance.now();

  let startOpacity =
    element.style.display === "none" ? 0 : parseFloat(element.style.opacity);
  if (isNaN(startOpacity)) startOpacity = 1;

  const interval = window.setInterval(() => {
    const currentTime = performance.now();
    const elapsed = currentTime - startTime;

    let t = Math.min(elapsed / duration, 1.0);
    if (t > 0.999) t = 1;

    let opacity: number;
    if (out) {
      opacity = (1.0 - t) * startOpacity;
      if (opacity < 0.0001) opacity = 0;
    } else {
      opacity = (1.0 - startOpacity) * t + startOpacity;
    }

    if (opacity > 0) {
      element.style.display = displayStyle;
      element.style.opacity = opacity.toString();
    } else {
      element.style.display = "none";
    }

    if (t >= 1) {
      if (onComplete) onComplete();
      window.clearInterval(interval);
    }
  }, 16);
  return interval;
};

/**
 * Cancel a fade animation
 * @param interval The interval ID returned by fadeElement
 */
export const cancelFade = (interval: number): void => {
  window.clearInterval(interval);
};
