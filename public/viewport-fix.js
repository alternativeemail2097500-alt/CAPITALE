/**
 * viewport-fix.js
 *
 * Mobile browsers lie about `100vh` (address bar showing/hiding changes the
 * real visible height, but 100vh doesn't update). We measure the ACTUAL
 * window.innerHeight in JS and expose it as a CSS variable (--vh) that the
 * stylesheet uses instead. Re-measured on resize/orientation change so it
 * stays correct if the host rotates their phone or the browser chrome
 * shows/hides mid-broadcast.
 */
(function () {
  function setRealViewportHeight() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty("--vh", `${vh}px`);
  }
  setRealViewportHeight();
  window.addEventListener("resize", setRealViewportHeight);
  window.addEventListener("orientationchange", setRealViewportHeight);
})();
