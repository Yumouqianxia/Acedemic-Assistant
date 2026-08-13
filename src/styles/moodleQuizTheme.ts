export const getMoodleQuizTheme = (dark: boolean): string => {
  const colors = dark
    ? {
        page: '#0d1117', surface: '#161b22', surfaceAlt: '#1c2129', border: '#30363d',
        text: '#e6edf3', muted: '#8b949e', accent: '#ff7b3d', focus: '#58a6ff',
      }
    : {
        page: '#f0f2f5', surface: '#ffffff', surfaceAlt: '#fafbfc', border: '#e1e7ee',
        text: '#1b2a3b', muted: '#657487', accent: '#e05c2a', focus: '#3a7bd5',
      }

  return `
    :root {
      --campus-page: ${colors.page};
      --campus-surface: ${colors.surface};
      --campus-surface-alt: ${colors.surfaceAlt};
      --campus-border: ${colors.border};
      --campus-text: ${colors.text};
      --campus-muted: ${colors.muted};
      --campus-accent: ${colors.accent};
      --campus-focus: ${colors.focus};
    }

    html, body, #page, #page-wrapper, #page-content {
      background: var(--campus-page) !important;
      color: var(--campus-text) !important;
    }

    body {
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      padding: 0 !important;
    }

    body.drawer-open-left,
    body.drawer-open-right { margin: 0 !important; }

    .navbar,
    nav.navbar,
    #nav-drawer,
    .drawer,
    .drawer-toggles,
    [data-region="drawer"],
    [data-region="fixed-drawer"],
    .secondary-navigation,
    .breadcrumb,
    .breadcrumb-nav,
    #page-footer,
    footer#page-footer,
    .activity-navigation,
    .block-region { display: none !important; }

    #page { margin-top: 0 !important; }

    #page-header,
    .header-maxwidth,
    .main-inner,
    #page-content,
    #region-main-box {
      width: 100% !important;
      max-width: 1080px !important;
      margin: 0 auto !important;
      padding-left: 18px !important;
      padding-right: 18px !important;
      box-sizing: border-box !important;
    }

    #page-header { padding-top: 26px !important; }

    #region-main,
    [role="main"] {
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
      color: var(--campus-text) !important;
    }

    h1, h2, h3, h4, h5, h6,
    .page-header-headings, .page-header-headings h1,
    .activity-header, .activity-header h1 {
      color: var(--campus-text) !important;
    }

    a { color: var(--campus-focus) !important; }

    .activity-header,
    .quizinfo,
    .quizattempt,
    .quizsummaryofattempt,
    .generalbox,
    .box.py-3,
    .boxaligncenter,
    .submissionstatustable,
    .feedback {
      background: var(--campus-surface) !important;
      border: 1px solid var(--campus-border) !important;
      border-radius: 14px !important;
      box-shadow: 0 4px 18px rgba(15, 23, 42, .06) !important;
      color: var(--campus-text) !important;
      padding: 20px !important;
    }

    .que {
      display: grid !important;
      grid-template-columns: 96px minmax(0, 1fr) !important;
      gap: 0 !important;
      margin: 0 0 18px !important;
      background: var(--campus-surface) !important;
      border: 1px solid var(--campus-border) !important;
      border-radius: 14px !important;
      box-shadow: 0 3px 14px rgba(15, 23, 42, .05) !important;
      /* MathJax glyphs can extend a fraction of a pixel beyond their
         calculated box. Keep the question card from clipping that ink. */
      overflow: visible !important;
    }

    .que .info {
      width: auto !important;
      margin: 0 !important;
      padding: 18px 14px !important;
      background: var(--campus-surface-alt) !important;
      border: 0 !important;
      border-right: 1px solid var(--campus-border) !important;
      color: var(--campus-muted) !important;
      border-radius: 13px 0 0 13px !important;
      box-sizing: border-box !important;
    }

    .que .info h3,
    .que .info .qno { color: var(--campus-text) !important; }

    .que .content {
      margin: 0 !important;
      padding: 20px 22px 24px !important;
      min-width: 0 !important;
    }

    .que .formulation,
    .que .outcome,
    .que .comment {
      background: transparent !important;
      border: 0 !important;
      color: var(--campus-text) !important;
      padding: 0 !important;
    }

    .que .qtext {
      color: var(--campus-text) !important;
      font-size: 16px !important;
      line-height: 1.65 !important;
      margin-bottom: 18px !important;
    }

    .que .answer,
    .que .ablock { color: var(--campus-text) !important; }

    .que .answer > div,
    .que .answer .r0,
    .que .answer .r1 {
      padding: 10px 12px !important;
      border-radius: 9px !important;
    }

    .que .answer > div:hover,
    .que .answer .r0:hover,
    .que .answer .r1:hover { background: var(--campus-surface-alt) !important; }

    input[type="text"], input[type="number"], input[type="password"],
    textarea, select, .form-control {
      background: var(--campus-surface) !important;
      color: var(--campus-text) !important;
      border: 1px solid var(--campus-border) !important;
      border-radius: 8px !important;
      min-height: 40px !important;
      box-shadow: none !important;
    }

    .que input.campus-autosize-answer {
      min-width: 10ch !important;
      max-width: min(100%, 48ch) !important;
      padding-left: 10px !important;
      padding-right: 10px !important;
      font-variant-numeric: tabular-nums;
      transition: width 120ms ease-out;
      vertical-align: middle;
    }

    input:focus, textarea:focus, select:focus, .form-control:focus {
      border-color: var(--campus-focus) !important;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--campus-focus) 22%, transparent) !important;
      outline: 0 !important;
    }

    input[type="radio"], input[type="checkbox"] {
      width: 18px !important;
      height: 18px !important;
      accent-color: var(--campus-accent) !important;
    }

    .btn-primary,
    input[type="submit"],
    button[type="submit"] {
      background: var(--campus-accent) !important;
      border-color: var(--campus-accent) !important;
      color: #fff !important;
      border-radius: 9px !important;
      min-height: 42px !important;
      padding: 9px 18px !important;
      box-shadow: none !important;
    }

    .btn-secondary,
    .btn-default {
      background: var(--campus-surface) !important;
      border: 1px solid var(--campus-border) !important;
      color: var(--campus-text) !important;
      border-radius: 9px !important;
      min-height: 40px !important;
    }

    #quiz-timer-wrapper,
    #quiz-timer,
    .quiz-timer {
      background: var(--campus-surface) !important;
      color: var(--campus-text) !important;
      border: 1px solid var(--campus-border) !important;
      border-radius: 10px !important;
      box-shadow: 0 3px 12px rgba(15, 23, 42, .08) !important;
    }

    .qn_buttons .qnbutton {
      background: var(--campus-surface) !important;
      color: var(--campus-text) !important;
      border-color: var(--campus-border) !important;
      border-radius: 7px !important;
    }

    .qn_buttons .qnbutton.thispage,
    .qn_buttons .qnbutton.answersaved {
      border-color: var(--campus-accent) !important;
      box-shadow: inset 0 -3px 0 var(--campus-accent) !important;
    }

    .que img,
    .que video,
    .que iframe {
      max-width: 100% !important;
      height: auto !important;
      border-radius: 8px !important;
    }

    /* Moodle may serve either MathJax 2 or 3, using CHTML or SVG output.
       All variants need a small ink-safe area because Windows fractional
       display scaling otherwise clips negative glyph bearings and strokes. */
    mjx-container,
    mjx-container[jax="CHTML"],
    mjx-container[jax="SVG"],
    mjx-container mjx-math,
    .MathJax,
    .MathJax_Display,
    .MathJax_CHTML,
    .MathJax_CHTML_Display,
    .MathJax_SVG,
    .MathJax_SVG_Display,
    .mjx-chtml,
    .mjx-math {
      overflow: visible !important;
      box-sizing: content-box !important;
    }

    mjx-container,
    .MathJax,
    .MathJax_CHTML,
    .MathJax_SVG {
      padding: 3px 4px !important;
    }

    mjx-container svg,
    mjx-container svg *,
    .MathJax_SVG svg,
    .MathJax_SVG_Display svg {
      overflow: visible !important;
    }

    .que img.texrender,
    .que img.filter_mathjaxloader_equation,
    .que .filter_mathjaxloader_equation img {
      max-width: none !important;
      padding: 2px 3px !important;
      border-radius: 0 !important;
      overflow: visible !important;
    }

    table, .generaltable {
      color: var(--campus-text) !important;
      background: var(--campus-surface) !important;
    }

    table th, table td,
    .generaltable th, .generaltable td { border-color: var(--campus-border) !important; }

    .alert { border-radius: 10px !important; }

    @media (max-width: 720px) {
      #page-header, .header-maxwidth, .main-inner, #page-content, #region-main-box {
        padding-left: 10px !important;
        padding-right: 10px !important;
      }
      .que { grid-template-columns: 1fr !important; }
      .que .info {
        border-right: 0 !important;
        border-bottom: 1px solid var(--campus-border) !important;
        border-radius: 13px 13px 0 0 !important;
      }
    }
  `
}

export const MOODLE_QUIZ_ENHANCEMENTS_SCRIPT = `(() => {
  const selector = '.que input[type="text"], .que input[type="number"]';

  const resizeAnswer = (input) => {
    const content = String(input.value || input.placeholder || '');
    const contentLength = Array.from(content).length;
    const characterWidth = Math.min(48, Math.max(10, contentLength + 3));
    input.classList.add('campus-autosize-answer');
    input.style.setProperty('width', characterWidth + 'ch', 'important');
  };

  const bindAnswer = (input) => {
    if (!(input instanceof HTMLInputElement)) return;
    resizeAnswer(input);
    if (input.dataset.campusAutosizeBound === '1') return;
    input.dataset.campusAutosizeBound = '1';
    input.addEventListener('input', () => resizeAnswer(input));
    input.addEventListener('change', () => resizeAnswer(input));
  };

  const scan = (root = document) => {
    if (root instanceof HTMLInputElement && root.matches(selector)) bindAnswer(root);
    if ('querySelectorAll' in root) root.querySelectorAll(selector).forEach(bindAnswer);
  };

  scan();
  if (!window.__campusQuizAutosizeObserver) {
    window.__campusQuizAutosizeObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) scan(node);
      }));
    });
    window.__campusQuizAutosizeObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  return true;
})()`
