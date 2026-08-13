"use strict";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;
const header = document.querySelector(".site-header");
const iconStage = document.querySelector("[data-icon-stage]");
const tiltSurface = document.querySelector("[data-tilt]");
const downloadLinks = Array.from(document.querySelectorAll(".download-link"));
const releaseMeta = document.querySelector("[data-release-meta]");
const islandDemo = document.querySelector("[data-island-demo]");
const glassIsland = document.querySelector("[data-glass-island]");
const islandCheck = document.querySelector("[data-island-check]");
const islandOpen = document.querySelector("[data-island-open]");
const islandTitle = document.querySelector("[data-island-title]");
const islandTime = document.querySelector("[data-island-time]");
const islandStatus = document.querySelector("[data-island-status]");

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());

const revealItems = document.querySelectorAll(".reveal");

if (reduceMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8%", threshold: 0.12 });

  revealItems.forEach((item, index) => {
    item.style.transitionDelay = Math.min(index % 3, 2) * 70 + "ms";
    revealObserver.observe(item);
  });
}

window.addEventListener("scroll", () => {
  header.classList.toggle("is-scrolled", window.scrollY > 24);
}, { passive: true });

if (!reduceMotion && finePointer && iconStage) {
  window.addEventListener("pointermove", (event) => {
    const x = (event.clientX / window.innerWidth - 0.5) * 2;
    const y = (event.clientY / window.innerHeight - 0.5) * 2;
    iconStage.style.setProperty("--ry", x * 7 + "deg");
    iconStage.style.setProperty("--rx", y * -6 + "deg");
  }, { passive: true });
}

if (!reduceMotion && finePointer && tiltSurface) {
  tiltSurface.addEventListener("pointermove", (event) => {
    const bounds = tiltSurface.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    tiltSurface.style.setProperty("--tilt-y", x * 7 + "deg");
    tiltSurface.style.setProperty("--tilt-x", y * -6 + "deg");
  });

  tiltSurface.addEventListener("pointerleave", () => {
    tiltSurface.style.setProperty("--tilt-y", "0deg");
    tiltSurface.style.setProperty("--tilt-x", "0deg");
  });
}

if (!reduceMotion && finePointer && islandDemo && glassIsland) {
  islandDemo.addEventListener("pointermove", (event) => {
    const bounds = islandDemo.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    glassIsland.style.setProperty("--island-ry", x * 10 + "deg");
    glassIsland.style.setProperty("--island-rx", y * -7 + "deg");
    glassIsland.style.setProperty("--shine-x", 50 + x * 34 + "%");
  });

  islandDemo.addEventListener("pointerleave", () => {
    glassIsland.style.setProperty("--island-ry", "0deg");
    glassIsland.style.setProperty("--island-rx", "0deg");
    glassIsland.style.setProperty("--shine-x", "30%");
  });
}

if (islandCheck && glassIsland) {
  islandCheck.addEventListener("click", () => {
    const isComplete = glassIsland.classList.toggle("is-complete");
    islandCheck.setAttribute("aria-pressed", String(isComplete));
    islandTitle.textContent = isComplete ? "Morning focus complete" : "Morning focus";
    islandTime.textContent = isComplete ? "Done for today" : "8:15 AM – 9:15 AM";
    islandStatus.textContent = isComplete ? "Completed" : "Next · 8:15 AM";
  });
}

if (islandOpen && glassIsland) {
  islandOpen.addEventListener("click", () => {
    const isOpen = glassIsland.classList.toggle("is-open");
    islandOpen.setAttribute("aria-expanded", String(isOpen));
  });
}

async function refreshLatestRelease() {
  try {
    const response = await fetch("https://api.github.com/repos/Abdulla-QsQs/HOVER/releases/latest", {
      headers: { Accept: "application/vnd.github+json" }
    });

    if (!response.ok) return;

    const release = await response.json();
    const installer = Array.isArray(release.assets)
      ? release.assets.find((asset) => /^HOVER-Setup-.*\.exe$/i.test(asset.name))
      : null;

    if (!installer || !installer.browser_download_url) return;

    downloadLinks.forEach((link) => {
      link.href = installer.browser_download_url;
      link.setAttribute("aria-label", "Download " + installer.name + " for Windows");
    });

    const version = String(release.tag_name || "").replace(/^v/i, "");
    if (releaseMeta && version) {
      const size = installer.size
        ? " · " + Math.max(1, Math.round(installer.size / 1024 / 1024)) + " MB"
        : "";
      releaseMeta.textContent = "v" + version + size + " · Windows 10/11";
    }
  } catch {
    // The release link in the HTML remains a working offline-safe fallback.
  }
}

refreshLatestRelease();
