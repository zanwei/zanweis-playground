(function configureTableOfContentDemo() {
  const toc = document.querySelector("table-of-content");
  if (!toc) return;

  const phases = [
    {
      title: "Define the interaction geometry",
      description:
        "Map the rail, tick spacing, preview anchor, and safe component bounds.",
    },
    {
      title: "Connect pointer position to selection",
      description:
        "Choose the nearest record while preserving a continuous visual center.",
    },
    {
      title: "Tune the tick spring",
      description:
        "Keep magnification interruptible, quick, and close to critical damping.",
    },
    {
      title: "Keep content transitions crisp",
      description:
        "Replace title and description immediately without blur or decorative effects.",
    },
    {
      title: "Measure the card from typography",
      description:
        "Let font metrics, wrapping, spacing, and padding determine card height.",
    },
    {
      title: "Clamp the preview at both edges",
      description:
        "Keep every card inside the component while maintaining its visual anchor.",
    },
    {
      title: "Support direct touch input",
      description:
        "Use Pointer Capture so scrubbing continues reliably through the gesture.",
    },
    {
      title: "Complete keyboard navigation",
      description:
        "Arrow keys move by item, Home and End jump, and Escape closes the preview.",
    },
    {
      title: "Respect reduced motion",
      description:
        "Preserve immediate selection while removing spatial interpolation.",
    },
    {
      title: "Verify lifecycle cleanup",
      description:
        "Release observers, timers, listeners, and animation frames on disconnect.",
    },
  ];

  toc.items = Array.from({ length: 38 }, (_, index) => {
    const phase = phases[index % phases.length];
    return {
      id: `demo-${index + 1}`,
      title: `${phase.title} · ${String(index + 1).padStart(2, "0")}`,
      description: phase.description,
    };
  });
})();
